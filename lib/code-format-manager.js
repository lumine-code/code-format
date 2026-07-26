const { CompositeDisposable, Disposable } = require("atom");
const { applyEdits } = require("./apply-edits");
const ProviderRegistry = require("./provider-registry");

// Save events are critical, so a formatter only gets a limited window before
// the save proceeds without it.
const SAVE_TIMEOUT = 500;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Read a package setting honoring per-language overrides, so users can
// enable e.g. format-on-save for a single grammar via a scoped config block.
function scopedSetting(key, editor) {
  return atom.config.get(key, { scope: editor.getRootScopeDescriptor() });
}

// There is no direct way to know what caused a change event, so guess from
// its shape: a single typed character, or a bracket pair inserted by
// bracket-matcher, triggers on-type formatting; deletions, replacements, and
// pastes do not.
function shouldFormatOnType(change) {
  if (change.oldText !== "") return false;
  if (change.newText === "") return false;
  if (change.newText.length > 1 && !isBracketPair(change.newText)) return false;
  return true;
}

// A paste is indistinguishable from bracket-matcher inserting a pair, so any
// pair that bracket-matcher recognizes is assumed to come from that package.
function isBracketPair(text) {
  if (atom.packages.getActivePackage("bracket-matcher") === undefined) return false;
  const pairs = atom.config.get("bracket-matcher.autocompleteCharacters");
  return Array.isArray(pairs) && pairs.includes(text);
}

module.exports = class CodeFormatManager {
  constructor() {
    this.providers = {
      range: new ProviderRegistry(),
      file: new ProviderRegistry(),
      onType: new ProviderRegistry(),
      onSave: new ProviderRegistry(),
    };
    // Monotonic per-buffer modification counters backing the stale-edit
    // guard; the TextBuffer exposes no public change counter of its own.
    this.bufferVersions = new WeakMap();
    this.watchedBuffers = new WeakSet();
    this.subscriptions = new CompositeDisposable(
      atom.commands.add("atom-text-editor:not([mini])", {
        "code-format:format-code": (event) => this.formatCommand(event),
        "code-format:list-providers": (event) => this.listProviders(event),
      }),
      atom.workspace.observeTextEditors((editor) => this.watchEditor(editor)),
    );
  }

  dispose() {
    this.subscriptions.dispose();
  }

  watchEditor(editor) {
    const buffer = editor.getBuffer();
    const editorSubscriptions = new CompositeDisposable(
      // Format on type once the buffer stops changing.
      buffer.onDidStopChanging((event) => {
        if (!scopedSetting("code-format.formatOnType", editor)) return;
        this.formatOnType(editor, event).catch((error) => {
          console.warn("code-format: failed to format on type", error);
        });
      }),
      editor.onDidDestroy(() => {
        this.subscriptions.remove(editorSubscriptions);
        editorSubscriptions.dispose();
      }),
    );
    this.subscriptions.add(editorSubscriptions);
    this.watchBuffer(buffer);
  }

  watchBuffer(buffer) {
    if (this.watchedBuffers.has(buffer)) return;
    this.watchedBuffers.add(buffer);
    const bufferSubscriptions = new CompositeDisposable(
      buffer.onDidChange(() => {
        this.bufferVersions.set(buffer, (this.bufferVersions.get(buffer) ?? 0) + 1);
      }),
      // Format on save: the buffer defers the disk write until the returned
      // promise resolves, and the race keeps an unresponsive provider from
      // holding up the save for more than SAVE_TIMEOUT.
      buffer.onWillSave(() => {
        const editor = atom.workspace.getTextEditors().find((item) => item.getBuffer() === buffer);
        if (!editor) return;
        return Promise.race([wait(SAVE_TIMEOUT), this.formatOnSave(editor)]);
      }),
      buffer.onDidDestroy(() => {
        this.watchedBuffers.delete(buffer);
        this.subscriptions.remove(bufferSubscriptions);
        bufferSubscriptions.dispose();
      }),
    );
    this.subscriptions.add(bufferSubscriptions);
  }

  // Formats the selection, or the whole file when the selection is empty.
  async formatCommand(event) {
    const editor = event.currentTarget.getModel();
    let range = editor.getSelectedBufferRange();
    if (range.isEmpty()) range = editor.getBuffer().getRange();
    const pipeline = this.buildFormatPipeline(editor, range);
    if (pipeline.length === 0) {
      atom.notifications.addWarning("code-format: no formatter available for this editor");
      return;
    }
    try {
      await this.runPipeline(pipeline, editor, range);
    } catch (error) {
      atom.notifications.addError("code-format: failed to format code", {
        detail: error.message,
      });
    }
  }

  // Builds and runs the on-save pipeline. Any failure is reported as a
  // notification; the save itself always proceeds.
  async formatOnSave(editor) {
    if (!scopedSetting("code-format.formatOnSave", editor)) return;
    let pipeline = this.providers.onSave
      .configuredProvidersForEditor(editor)
      .map((provider) => (item) => provider.formatOnSave(item));
    if (pipeline.length === 0) {
      // Fall back to file or range providers over the whole buffer.
      pipeline = this.buildFormatPipeline(editor, editor.getBuffer().getRange());
    }
    try {
      await this.runPipeline(pipeline, editor);
    } catch (error) {
      atom.notifications.addError("code-format: failed to format on save", {
        detail: error.message,
      });
    }
  }

  // A whole-buffer request goes to the file providers when any exist;
  // everything else goes to the range providers.
  buildFormatPipeline(editor, range) {
    if (range.isEqual(editor.getBuffer().getRange())) {
      const fileProviders = this.providers.file.configuredProvidersForEditor(editor);
      if (fileProviders.length > 0) {
        return fileProviders.map((provider) => (item) => provider.formatEntireFile(item));
      }
    }
    return this.providers.range
      .configuredProvidersForEditor(editor)
      .map(
        (provider) => (item, target) =>
          provider.formatCode(item, target ?? item.getBuffer().getRange()),
      );
  }

  // Runs each formatter over the buffer in series, applying the edits of one
  // step before the next runs. A marker keeps the requested range current
  // while edits land.
  async runPipeline(pipeline, editor, range = null) {
    const marker = range ? editor.markBufferRange(range) : null;
    try {
      for (const step of pipeline) {
        const edits = await this.runGuarded(step, editor, marker);
        applyEdits(editor, edits);
      }
    } finally {
      marker?.destroy();
    }
  }

  // Stale-edit guard: capture the buffer version before awaiting the
  // provider; if the buffer changed while waiting, the edits may describe
  // text that no longer exists, so discard them and retry once.
  async runGuarded(step, editor, marker, retry = true) {
    const buffer = editor.getBuffer();
    const before = this.bufferVersions.get(buffer) ?? 0;
    const edits = (await step(editor, marker?.getBufferRange())) ?? [];
    if ((this.bufferVersions.get(buffer) ?? 0) !== before) {
      return retry ? this.runGuarded(step, editor, marker, false) : [];
    }
    return edits;
  }

  async formatOnType(editor, { changes }) {
    if (changes.length !== 1) return;
    const providers = this.providers.onType.configuredProvidersForEditor(editor);
    if (providers.length === 0) return;
    const [change] = changes;
    if (!shouldFormatOnType(change)) return;

    // With bracket-matching, the last character is the one that usually
    // triggers a reformat (`}` rather than `{`).
    const character = change.newText[change.newText.length - 1];
    const buffer = editor.getBuffer();
    const version = this.bufferVersions.get(buffer) ?? 0;
    const cursorPosition = editor.getCursorBufferPosition().copy();

    const allEdits = await Promise.all(
      providers.map((provider) =>
        provider.formatAtPosition(editor, editor.getCursorBufferPosition(), character),
      ),
    );
    const index = allEdits.findIndex((edits) => edits && edits.length > 0);
    if (index === -1) return;
    // Typing may have continued while the provider worked; stale edits are
    // discarded rather than applied to text they no longer describe.
    if ((this.bufferVersions.get(buffer) ?? 0) !== version) return;

    // Deliberately not grouped with the typing that triggered it: one undo
    // removes the formatting, another removes the typed text.
    applyEdits(editor, allEdits[index]);
    if (providers[index].keepCursorPosition) {
      editor.setCursorBufferPosition(cursorPosition);
    }
  }

  // Shows which formatters are active in the current editor and which active
  // packages advertise a code-format service.
  listProviders(event) {
    const editor = event.currentTarget.getModel();
    const kinds = [
      ["range", "Range"],
      ["file", "File"],
      ["onType", "On-type"],
      ["onSave", "On-save"],
    ];
    const lines = ["### Active providers in this editor", ""];
    for (const [kind, label] of kinds) {
      lines.push(`- ${label}: ${this.providers[kind].providersForEditor(editor).length}`);
    }
    const packagesByKind = { range: [], file: [], onType: [], onSave: [] };
    for (const pack of atom.packages.getActivePackages()) {
      for (const name of Object.keys(pack.metadata?.providedServices ?? {})) {
        if (!name.startsWith("code-format.")) continue;
        packagesByKind[name.slice("code-format.".length)]?.push(pack.name);
      }
    }
    for (const [kind, label] of kinds) {
      if (packagesByKind[kind].length === 0) continue;
      lines.push(
        "",
        `### ${label} formatters`,
        "",
        ...packagesByKind[kind].map((name) => `- ${name}`),
      );
    }
    atom.notifications.addInfo("Code formatting providers", {
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
