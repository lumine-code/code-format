const { CompositeDisposable } = require("lumine");
const observedFiles = require("./observed-files");
const ObservedFilesStatus = require("./observed-status");

module.exports = class SaveStatus {
  constructor(statusBar, policy, callbacks) {
    this.destroyed = false;
    this.statusBar = statusBar;
    this.policy = policy;
    this.callbacks = callbacks;
    this.context = callbacks.context;
    this.container = this.context?.editorContainer ?? lumine.workspace;
    this.subscriptions = new CompositeDisposable();
    this.editorSubscriptions = new CompositeDisposable();
    this.subscriptions.add(
      lumine.config.onDidChangeConfiguration((event) => {
        const editor = this.container.getActiveEmbeddedTextEditor();
        if (event.affectsConfiguration("code-format", { scope: editor?.getRootScopeDescriptor() }))
          this.update();
      }),
      this.container.observeActiveEmbeddedTextEditor((editor) => this.watchEditor(editor)),
      observedFiles.onDidChange(() => this.update()),
    );
    try {
      this.watchEditor(this.container.getActiveEmbeddedTextEditor());
    } catch (error) {
      this.dispose();
      throw error;
    }
  }

  isCurrent() {
    return !this.destroyed && (this.callbacks.isCurrent?.() ?? true);
  }

  watchEditor(editor) {
    if (!this.isCurrent()) return;
    this.editorSubscriptions.dispose();
    this.editorSubscriptions = new CompositeDisposable();
    if (editor)
      this.editorSubscriptions.add(
        editor.onDidChangeGrammar(() => this.update()),
        editor.onDidChangePath(() => this.update()),
      );
    this.update();
  }

  update() {
    if (!this.isCurrent()) return;
    if (lumine.config.get("code-format.showInStatusBar")) {
      if (!this.tile) {
        const element = (this.context?.document ?? document).createElement("status-bar-tile");
        element.className = "code-format-save-status";
        element.setAttribute("data-context-menu-boundary", "");
        element.addEventListener("click", (event) => {
          if (!this.isCurrent() || event.button !== 0) return;
          if (process.platform === "darwin" && event.ctrlKey) return;
          this.callbacks.dispatch(
            element,
            event.altKey ? "code-format:toggle-observed" : "code-format:toggle-format-on-save",
          );
        });
        element.addEventListener("mousedown", (event) => {
          if (!this.isCurrent() || event.button !== 1) return;
          event.preventDefault();
          this.callbacks.dispatch(element, "code-format:format-code");
        });
        const tooltip = lumine.tooltips.add(element, {
          title: () =>
            `Format on save ${element.classList.contains("is-enabled") ? "enabled" : "disabled"}. Toggle for this language.`,
        });
        let tile;
        let committed = false;
        try {
          if (!this.isCurrent()) return;
          tile = this.statusBar.addLeftTile({ item: element, priority: 450 });
          if (this.isCurrent() && lumine.config.get("code-format.showInStatusBar") && !this.tile) {
            this.element = element;
            this.tooltip = tooltip;
            this.tile = tile;
            committed = true;
          }
        } finally {
          if (!committed) {
            tooltip.dispose();
            tile?.destroy();
            element.remove();
          }
        }
      }
      if (!this.isCurrent() || !this.element) return;
      const editor = this.container.getActiveEmbeddedTextEditor();
      const enabled = editor && this.policy.shouldFormat(editor);
      this.element.textContent = enabled ? "Format on Save" : "Format on Save: Off";
      this.element.classList.toggle("is-enabled", Boolean(enabled));
    } else {
      this.removeTile();
    }
    if (!this.isCurrent()) return;
    const count = observedFiles.getObservedCount();
    if (count && !this.observedTile) {
      const view = new ObservedFilesStatus({
        document: this.context?.document,
        dispatch: this.callbacks.dispatch,
      });
      let tile;
      let committed = false;
      try {
        if (!this.isCurrent()) return;
        tile = this.statusBar.addRightTile({ item: view.getElement(), priority: 530 });
        if (this.isCurrent() && observedFiles.getObservedCount() && !this.observedTile) {
          this.observedView = view;
          this.observedTile = tile;
          committed = true;
        }
      } finally {
        if (!committed) {
          tile?.destroy();
          view.destroy();
        }
      }
    }
    if (this.isCurrent()) this.observedView?.setCount(observedFiles.getObservedCount());
  }

  removeTile() {
    const tooltip = this.tooltip,
      tile = this.tile;
    this.tooltip = null;
    this.tile = null;
    this.element = null;
    tooltip?.dispose();
    tile?.destroy();
  }

  dispose() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.subscriptions.dispose();
    this.editorSubscriptions.dispose();
    this.removeTile();
    const tile = this.observedTile,
      view = this.observedView;
    this.observedTile = null;
    this.observedView = null;
    tile?.destroy();
    view?.destroy();
  }
};
