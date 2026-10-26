const { CompositeDisposable, Disposable } = require("lumine");
const ProviderRegistry = require("./provider-registry");

const SAVE_TIMEOUT = 500;
let formatRuntime;
const getFormatRuntime = () => (formatRuntime ||= require("./format-runtime"));

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
      lumine.commands.add("lumine-text-editor:not([mini]):not([readonly])", {
        "code-format:format-code": {
          description: "Format the selection, or the whole file when nothing is selected.",
          isAvailable: (event) => this.hasFormatProvider(this.resolveEditor(event)),
          didDispatch: (event) => this.formatCommand(event),
        },
      }),
      lumine.commands.add("lumine-text-editor:not([mini])", {
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
    if (this.disposed) return;
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
    if (this.disposed) return;
    if (this.watchedBuffers.has(buffer)) return;
    let versionAtReload = -1;
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
      buffer.onDidChangeLanguageMode(cancel),
      buffer.onWillReload(() => {
        versionAtReload = this.bufferVersions.get(buffer) ?? 0;
        cancel();
      }),
      buffer.onDidStopChanging((event) => {
        // Formatting can itself insert one character. Its stop-change event
        // must not start another formatter, while a later user edit still can.
        const version = this.bufferVersions.get(buffer) ?? 0;
        if (version === versionAtReload) return;
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
    if (event)
      return lumine.workspace.getTextEditorForElement(event.target, { includeMini: false }) ?? null;
    return lumine.workspace.getActiveTextEditor() ?? null;
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

  hasFormatProvider(editor) {
    if (this.disposed || !editor || editor.isDestroyed() || editor.isReadOnly()) return false;
    const preferred = scopedSetting("code-format.defaultProvider", editor) ?? "";
    if (this.providers.range.candidatesForEditor(editor, preferred).length > 0) return true;
    const ranges = editor.getSelectedBufferRanges().filter((range) => !range.isEmpty());
    const wholeFile =
      ranges.length === 0 ||
      (ranges.length === 1 && ranges[0].isEqual(editor.getBuffer().getRange()));
    return wholeFile && this.providers.file.candidatesForEditor(editor, preferred).length > 0;
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

  requestedRanges(editor, options) {
    return getFormatRuntime().requestedRanges.call(this, editor, options);
  }

  async formatEditor(editor, options = {}) {
    if (this.disposed || !editor) return null;
    return getFormatRuntime().formatEditor.call(this, editor, options, SAVE_TIMEOUT);
  }

  async runCandidates(editor, context, kinds, selectedProvider, options, operation) {
    return getFormatRuntime().runCandidates.call(
      this,
      editor,
      context,
      kinds,
      selectedProvider,
      options,
      operation,
    );
  }

  async formatRanges(provider, editor, request) {
    return getFormatRuntime().formatRanges.call(this, provider, editor, request);
  }

  async formatOnType(editor, event) {
    const lastTransaction = event.transactions.at(-1);
    if (lastTransaction?.origin !== "edit") return false;
    const { changes } = lastTransaction;
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
    const registration = registry.addProvider(provider);
    lumine.commands.invalidateAvailability();
    return new Disposable(() => {
      registration.dispose();
      lumine.commands.invalidateAvailability();
    });
  }
};

module.exports.SAVE_TIMEOUT = SAVE_TIMEOUT;
