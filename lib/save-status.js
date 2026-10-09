const { CompositeDisposable } = require("lumine");
const observedFiles = require("./observed-files");
const ObservedFilesStatus = require("./observed-status");

module.exports = class SaveStatus {
  constructor(statusBar, policy, callbacks) {
    this.destroyed = false;
    this.statusBar = statusBar;
    this.policy = policy;
    this.callbacks = callbacks;
    this.subscriptions = new CompositeDisposable();
    this.editorSubscriptions = new CompositeDisposable();
    this.subscriptions.add(
      lumine.config.onDidChangeConfiguration((event) => {
        const editor = lumine.workspace.getActiveTextEditor();
        if (event.affectsConfiguration("code-format", { scope: editor?.getRootScopeDescriptor() }))
          this.update();
      }),
      lumine.workspace.onDidChangeActiveTextEditor((editor) => this.watchEditor(editor)),
      observedFiles.onDidChange(() => this.update()),
    );
    try {
      this.watchEditor(lumine.workspace.getActiveTextEditor());
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
        const element = document.createElement("status-bar-tile");
        element.className = "code-format-save-status";
        element.addEventListener("click", (event) => {
          if (!this.isCurrent()) return;
          if (event.altKey) this.callbacks.toggleObserved();
          else this.callbacks.toggleSave();
        });
        const tooltip = lumine.tooltips.addComposite(element, [
          {
            title: "Toggle format on save for this language",
            keyBindingCommand: "code-format:toggle-format-on-save",
            keyBindingExtra: "LMB",
          },
          {
            title: "Observe this file for format on save",
            keyBindingCommand: "code-format:toggle-observed",
            keyBindingExtra: "Alt+LMB",
          },
        ]);
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
      const editor = lumine.workspace.getActiveTextEditor();
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
        onOpenObservedFiles: this.callbacks.showObserved,
        onClearObservedFiles: this.callbacks.clearObserved,
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
