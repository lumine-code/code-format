const { CompositeDisposable, Disposable } = require("lumine");
const CodeFormatManager = require("./code-format-manager");
const SavePolicy = require("./save-policy");
const observedFiles = require("./observed-files");

module.exports = {
  activate() {
    this.policy = new SavePolicy();
    this.manager = new CodeFormatManager({
      shouldFormatOnSave: (editor) => this.policy.shouldFormat(editor),
    });
    this.subscriptions = new CompositeDisposable(
      lumine.commands.add("lumine-workspace", {
        "code-format:toggle-format-on-save": {
          description: "Turn formatting on save on or off for the active language.",
          didDispatch: () => this.policy.toggle(lumine.workspace.getActiveTextEditor()),
        },
        "code-format:toggle-observed": {
          description: "Format this one file on save, whatever the setting says.",
          didDispatch: () => this.toggleObserved(),
        },
        "code-format:observed-files": {
          description: "List the files formatted on save, and stop any of them.",
          didDispatch: () => this.showObserved(),
        },
        "code-format:clear-all-observed-files": {
          description: "Stop formatting every file that was set to format on save.",
          didDispatch: () => observedFiles.clearObserved(),
        },
      }),
      observedFiles.onDidChange(() => this.observedList?.update()),
    );
  },
  deactivate() {
    this.manager?.dispose();
    this.subscriptions?.dispose();
    this.statusRegistration?.dispose();
    this.statusRegistration = null;
    this.observedList?.destroy();
    this.observedList = null;
    observedFiles.clearObserved();
    this.manager = null;
    this.policy = null;
  },
  toggleObserved() {
    const editor = lumine.workspace.getActiveTextEditor();
    if (!editor) return;
    const filePath = editor.getPath();
    if (!filePath) {
      lumine.notifications.addWarning("code-format: Save the file before observing it.");
      return;
    }
    observedFiles.toggleObserved(filePath);
  },
  showObserved() {
    if (!this.observedList) {
      const ObservedList = require("./observed-list");
      this.observedList = new ObservedList();
    }
    return this.observedList.show();
  },
  provideBackgroundTips() {
    return {
      packageName: "code-format",
      tips: [
        "You can format the current file with any registered formatter using {{ 'code-format:format-code' | keystroke }}",
      ],
    };
  },
  provideCodeFormatExecutor() {
    const manager = this.manager;
    return Object.freeze({
      formatEditor: (editor, options) => manager.formatEditor(editor, options),
    });
  },
  consumeStatusBar(statusBar) {
    this.statusRegistration?.dispose();
    const SaveStatus = require("./save-status");
    const view = new SaveStatus(statusBar, this.policy, {
      toggleSave: () => this.policy.toggle(lumine.workspace.getActiveTextEditor()),
      toggleObserved: () => this.toggleObserved(),
      showObserved: () => this.showObserved(),
      clearObserved: () => observedFiles.clearObserved(),
    });
    const registration = new Disposable(() => {
      view.dispose();
      if (this.statusRegistration === registration) this.statusRegistration = null;
    });
    this.statusRegistration = registration;
    return registration;
  },
  consumeCodeFormatRange(provider) {
    return this.manager.addRangeProvider(provider);
  },
  consumeCodeFormatFile(provider) {
    return this.manager.addFileProvider(provider);
  },
  consumeCodeFormatOnType(provider) {
    return this.manager.addOnTypeProvider(provider);
  },
  consumeCodeFormatOnSave(provider) {
    return this.manager.addOnSaveProvider(provider);
  },
};
