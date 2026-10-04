const { CompositeDisposable } = require("lumine");
const observedFiles = require("./observed-files");
const ObservedFilesStatus = require("./observed-status");

module.exports = class SaveStatus {
  constructor(statusBar, policy, callbacks) {
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
    this.watchEditor(lumine.workspace.getActiveTextEditor());
  }

  watchEditor(editor) {
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
    if (lumine.config.get("code-format.showInStatusBar")) {
      if (!this.tile) {
        this.element = document.createElement("status-bar-tile");
        this.element.className = "code-format-save-status";
        this.element.addEventListener("click", (event) => {
          if (event.altKey) this.callbacks.toggleObserved();
          else this.callbacks.toggleSave();
        });
        this.tooltip = lumine.tooltips.addComposite(this.element, [
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
        this.tile = this.statusBar.addLeftTile({ item: this.element, priority: 450 });
      }
      const editor = lumine.workspace.getActiveTextEditor();
      const enabled = editor && this.policy.shouldFormat(editor);
      this.element.textContent = enabled ? "Format on Save" : "Format on Save: Off";
      this.element.classList.toggle("is-enabled", Boolean(enabled));
    } else {
      this.removeTile();
    }
    const count = observedFiles.getObservedCount();
    if (count && !this.observedTile) {
      this.observedView = new ObservedFilesStatus({
        onOpenObservedFiles: this.callbacks.showObserved,
        onClearObservedFiles: this.callbacks.clearObserved,
      });
      this.observedTile = this.statusBar.addRightTile({
        item: this.observedView.getElement(),
        priority: 530,
      });
    }
    this.observedView?.setCount(count);
  }

  removeTile() {
    this.tooltip?.dispose();
    this.tooltip = null;
    this.tile?.destroy();
    this.tile = null;
    this.element = null;
  }

  dispose() {
    this.subscriptions.dispose();
    this.editorSubscriptions.dispose();
    this.removeTile();
    this.observedTile?.destroy();
    this.observedView?.destroy();
    this.observedTile = null;
    this.observedView = null;
  }
};
