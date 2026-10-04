const { CompositeDisposable, Disposable, Range } = require("lumine");
const { applyEdits } = require("./apply-edits");
const ProviderRegistry = require("./provider-registry");

const SAVE_TIMEOUT = 500;

function scopedSetting(key, editor) {
  return lumine.config.get(key, { scope: editor.getRootScopeDescriptor() });
}

function shouldFormatOnType(change, editor) {
  if (change.oldText !== "" || change.newText === "") return false;
  if (change.newText.length === 1) return true;
  if (!lumine.packages.getActivePackage("bracket-matcher")) return false;
  const pairs = scopedSetting("bracket-matcher.autocompleteCharacters", editor);
  return Array.isArray(pairs) && pairs.includes(change.newText);
}

function copyRanges(value) {
  const ranges = Array.isArray(value) && typeof value[0]?.[0] !== "number" ? value : [value];
  return ranges.map((range) => Range.fromObject(range).copy());
}

module.exports = class CodeFormatManager {
  constructor({ shouldFormatOnSave } = {}) {
    this.shouldFormatOnSave = shouldFormatOnSave;
    this.providers = {
      range: new ProviderRegistry(),
      file: new ProviderRegistry(),
      onType: new ProviderRegistry(),
      onSave: new ProviderRegistry(),
    };
    this.bufferVersions = new WeakMap();
    this.lastFormattedRevision = new WeakMap();
    this.watchedBuffers = new Map();
    this.operations = new Map();
    this.subscriptions = new CompositeDisposable(
      lumine.commands.add("lumine-workspace", {
        "code-format:format-code": {
          description: "Format the selection, or the whole file when nothing is selected.",
          didDispatch: (event) => this.formatCommand(event),
        },
        "code-format:list-providers": {
          description: "Report which packages can format this file.",
          didDispatch: (event) => this.listProviders(event),
        },
      }),
    );
    this.subscriptions.add(
      lumine.workspace.observeTextEditors((editor) => this.watchEditor(editor)),
    );
  }

  dispose() {
    this.disposed = true;
    for (const operation of this.operations.values()) operation.controller.abort();
    this.operations.clear();
    this.subscriptions.dispose();
    this.watchedBuffers.clear();
  }

  watchEditor(editor) {
    this.watchBuffer(editor.getBuffer());
    const cancel = () => {
      const operation = this.operations.get(editor.getBuffer());
      if (operation?.editor === editor && !operation.applying) operation.controller.abort();
    };
    const subscriptions = new CompositeDisposable(
      editor.onDidChangeSelectionRange(cancel),
      editor.onDidChangeGrammar(cancel),
      editor.onDidDestroy(() => {
        cancel();
        this.subscriptions.remove(subscriptions);
        subscriptions.dispose();
      }),
    );
    this.subscriptions.add(subscriptions);
  }

  editorForBuffer(buffer) {
    const active = lumine.workspace.getActiveTextEditor();
    if (active?.getBuffer() === buffer) return active;
    return lumine.workspace.getTextEditors().find((editor) => editor.getBuffer() === buffer);
  }

  // Split editors share a buffer; each buffer owns exactly one save/type hook.
  watchBuffer(buffer) {
    if (this.watchedBuffers.has(buffer)) return;
    const cancel = () => {
      const operation = this.operations.get(buffer);
      if (operation && !operation.applying) operation.controller.abort();
    };
    const subscriptions = new CompositeDisposable(
      buffer.onDidChange(() => {
        this.bufferVersions.set(buffer, (this.bufferVersions.get(buffer) ?? 0) + 1);
        cancel();
      }),
      buffer.onDidChangePath(cancel),
      buffer.onDidStopChanging((event) => {
        // Formatting can itself insert one character. Its stop-change event
        // must not start another formatter, while a later user edit still can.
        const version = this.bufferVersions.get(buffer) ?? 0;
        if (this.lastFormattedRevision.get(buffer) === version) return;
        const editor = this.editorForBuffer(buffer);
        if (!editor || !scopedSetting("code-format.formatOnType", editor)) return;
        this.formatOnType(editor, event).catch((error) => {
          console.warn("code-format: failed to format on type", error);
        });
      }),
      buffer.onWillSave(() => {
        const editor = this.editorForBuffer(buffer);
        if (editor) return this.formatOnSave(editor);
      }),
      buffer.onDidDestroy(() => {
        cancel();
        this.watchedBuffers.delete(buffer);
        this.subscriptions.remove(subscriptions);
        subscriptions.dispose();
      }),
    );
    this.watchedBuffers.set(buffer, subscriptions);
    this.subscriptions.add(subscriptions);
  }

  resolveEditor(event) {
    const element = event?.target?.closest?.("lumine-text-editor:not([mini])");
    return element?.getModel?.() ?? lumine.workspace.getActiveTextEditor() ?? null;
  }

  async formatCommand(event) {
    const editor = this.resolveEditor(event);
    if (!editor) return false;
    try {
      const handled = await this.formatEditor(editor);
      if (handled === false && !editor.isDestroyed())
        lumine.notifications.addWarning("code-format: no formatter available for this editor");
      return handled;
    } catch (error) {
      lumine.notifications.addError("code-format: failed to format code", {
        detail: error.message,
      });
      return false;
    }
  }

  async formatOnSave(editor) {
    try {
      if (
        !(await (this.shouldFormatOnSave?.(editor) ??
          scopedSetting("code-format.formatOnSave", editor)))
      )
        return false;
      return await this.formatEditor(editor, { reason: "save" });
    } catch (error) {
      lumine.notifications.addError("code-format: failed to format on save", {
        detail: error.message,
      });
      return false;
    }
  }

  requestedRanges(editor, { range, reason }) {
    const fullRange = editor.getBuffer().getRange();
    if (range !== undefined) return copyRanges(range);
    if (reason === "save" || reason === "type") return [fullRange.copy()];
    const selections = editor.getSelectedBufferRanges().filter((item) => !item.isEmpty());
    return selections.length > 0 ? selections.map((item) => item.copy()) : [fullRange.copy()];
  }

  async formatEditor(editor, options = {}) {
    if (this.disposed || !editor || editor.isDestroyed()) return null;
    const buffer = editor.getBuffer();
    this.watchBuffer(buffer);
    this.operations.get(buffer)?.controller.abort();
    const reason = options.reason ?? "manual";
    const ranges = this.requestedRanges(editor, { ...options, reason });
    const wholeFile = ranges.length === 1 && ranges[0].isEqual(buffer.getRange());
    const kinds = reason === "type" ? ["onType"] : wholeFile ? ["file", "range"] : ["range"];
    if (reason === "save") kinds.unshift("onSave");
    const selectedProvider =
      options.provider ?? scopedSetting("code-format.defaultProvider", editor) ?? "";
    const version = this.bufferVersions.get(buffer) ?? 0;
    const path = editor.getPath();
    const grammar = editor.getGrammar();
    const text = buffer.getText();
    const selections = editor.getSelections().map((selection) => ({
      range: selection.getBufferRange().copy(),
      reversed: selection.isReversed(),
    }));
    const operation = { editor, version, controller: new AbortController(), applying: false };
    this.operations.set(buffer, operation);
    const isCurrent = () =>
      !this.disposed &&
      !operation.controller.signal.aborted &&
      this.operations.get(buffer) === operation &&
      !editor.isDestroyed() &&
      editor.getBuffer() === buffer &&
      editor.getPath() === path &&
      editor.getGrammar() === grammar &&
      (this.bufferVersions.get(buffer) ?? 0) === version &&
      editor.getSelections().length === selections.length &&
      editor
        .getSelections()
        .every(
          (selection, index) =>
            selection.getBufferRange().isEqual(selections[index].range) &&
            selection.isReversed() === selections[index].reversed,
        );
    let timer;
    const cancelled = new Promise((resolve) => {
      operation.controller.signal.addEventListener("abort", () => resolve(null), { once: true });
    });
    if (reason === "save") timer = setTimeout(() => operation.controller.abort(), SAVE_TIMEOUT);
    try {
      const result = this.runCandidates(
        editor,
        {
          text,
          path,
          reason,
          ranges,
          signal: operation.controller.signal,
          isCurrent,
        },
        kinds,
        selectedProvider,
        options,
        operation,
      );
      return await Promise.race([result, cancelled]);
    } finally {
      clearTimeout(timer);
      if (this.operations.get(buffer) === operation) this.operations.delete(buffer);
    }
  }

  async runCandidates(editor, context, kinds, selectedProvider, options, operation) {
    for (const kind of kinds) {
      const candidates = this.providers[kind].candidatesForEditor(editor, selectedProvider);
      for (const entry of candidates) {
        const { provider } = entry;
        const request = Object.freeze({
          ...context,
          kind,
          ranges: Object.freeze(
            context.ranges.map((range) => {
              const copy = range.copy();
              Object.freeze(copy.start);
              Object.freeze(copy.end);
              return Object.freeze(copy);
            }),
          ),
          isCurrent: () => entry.active && context.isCurrent(),
        });
        if (!context.isCurrent()) return null;
        if (!entry.active) continue;
        if (provider.canFormat && !(await provider.canFormat(editor, request))) {
          if (!context.isCurrent()) return null;
          continue;
        }
        if (!request.isCurrent()) {
          if (!context.isCurrent()) return null;
          continue;
        }
        let result;
        if (kind === "range") result = await this.formatRanges(provider, editor, request);
        else if (kind === "onType")
          result = await provider.formatAtPosition(
            editor,
            options.position,
            options.character,
            request,
          );
        else if (kind === "onSave") result = await provider.formatOnSave(editor, request);
        else result = await provider.formatEntireFile(editor, request);
        if (!context.isCurrent()) return null;
        if (!entry.active || result == null) continue;
        if (kind === "onType" && !Array.isArray(result)) return false;
        if (!Array.isArray(result)) {
          const plan = result;
          if (typeof plan.isCurrent !== "function") return false;
          if (!plan.isCurrent()) return null;
          result = { ...plan, isCurrent: () => request.isCurrent() && plan.isCurrent() };
        }
        // All awaited work ends before this transaction; a multi-selection
        // request cannot leave partially formatted text in the editor.
        operation.applying = true;
        try {
          if (!applyEdits(editor, result, request.isCurrent)) return false;
          const buffer = editor.getBuffer();
          const version = this.bufferVersions.get(buffer) ?? 0;
          if (version !== operation.version) this.lastFormattedRevision.set(buffer, version);
          if (kind === "onType" && provider.keepCursorPosition)
            editor.setCursorBufferPosition(options.position);
          return true;
        } finally {
          operation.applying = false;
        }
      }
    }
    return false;
  }

  async formatRanges(provider, editor, request) {
    const [first, ...remaining] = request.ranges;
    if (!first) return [];
    const result = await provider.formatCode(editor, first.copy(), request);
    if (!request.isCurrent() || result == null) return null;
    // A complete plan accounts for request.ranges as a whole.
    if (!Array.isArray(result)) return result;
    const rest = await Promise.all(
      remaining.map((range) => provider.formatCode(editor, range.copy(), request)),
    );
    if (!request.isCurrent() || rest.some((edits) => edits == null)) return null;
    if (rest.some((edits) => !Array.isArray(edits)))
      throw new Error("A complete range plan must be returned for the first range");
    return result.concat(...rest);
  }

  async formatOnType(editor, { changes }) {
    if (changes.length !== 1 || !shouldFormatOnType(changes[0], editor)) return false;
    return this.formatEditor(editor, {
      reason: "type",
      position: editor.getCursorBufferPosition().copy(),
      character: changes[0].newText.at(-1),
    });
  }

  listProviders(event) {
    const editor = this.resolveEditor(event);
    if (!editor) return;
    const selected = scopedSetting("code-format.defaultProvider", editor) || "Automatic";
    const lines = [`Preferred formatter: ${selected}`, ""];
    for (const [kind, label] of [
      ["range", "Range"],
      ["file", "File"],
      ["onType", "On-type"],
      ["onSave", "On-save"],
    ]) {
      const names = this.providers[kind]
        .providersForEditor(editor)
        .map((provider) => provider.packageName ?? "Unnamed provider");
      lines.push(`- ${label}: ${names.join(", ") || "None"}`);
    }
    lumine.notifications.addInfo("Code formatting providers", {
      description: lines.join("\n"),
      dismissable: true,
    });
  }

  addRangeProvider(provider) {
    return this.addProvider(this.providers.range, provider, "formatCode");
  }
  addFileProvider(provider) {
    return this.addProvider(this.providers.file, provider, "formatEntireFile");
  }
  addOnTypeProvider(provider) {
    return this.addProvider(this.providers.onType, provider, "formatAtPosition");
  }
  addOnSaveProvider(provider) {
    return this.addProvider(this.providers.onSave, provider, "formatOnSave");
  }

  addProvider(registry, provider, method) {
    if (typeof provider?.[method] !== "function") {
      console.warn(`code-format: ignoring a provider without ${method}`, provider);
      return new Disposable(() => {});
    }
    return registry.addProvider(provider);
  }
};

module.exports.SAVE_TIMEOUT = SAVE_TIMEOUT;
