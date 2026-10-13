const { CompositeDisposable, Disposable } = require("lumine");
const CodeFormatManager = require("./code-format-manager");
const SavePolicy = require("./save-policy");
const observedFiles = require("./observed-files");

module.exports = {
  activate() {
    const main = this;
    const editorCommands = new Set([
      "code-format:format-code",
      "code-format:toggle-format-on-save",
      "code-format:toggle-observed",
      "code-format:list-providers",
    ]);
    const policy = (this.policy = new SavePolicy());
    const owner = (this.subscriptions = new CompositeDisposable());
    this.statusConnections = new Map();
    this.manager = new CodeFormatManager({
      shouldFormatOnSave: (editor) => policy.shouldFormat(editor),
    });
    owner.add(
      lumine.commands.add("lumine-workspace", {
        "code-format:toggle-format-on-save": {
          description: "Turn formatting on save on or off for the active language.",
          didDispatch: (event) => this.policy.toggle(this.manager.resolveEditor(event)),
        },
        "code-format:toggle-observed": {
          description: "Format this one file on save, whatever the setting says.",
          didDispatch: (event) => this.toggleObserved(this.manager.resolveEditor(event)),
        },
        "code-format:observed-files": {
          description: "List the files formatted on save, and stop any of them.",
          didDispatch: (event) => this.showObserved(event?.context?.window),
        },
        "code-format:clear-all-observed-files": {
          description: "Stop formatting every file that was set to format on save.",
          didDispatch: () => observedFiles.clearObserved(),
        },
      }),
      observedFiles.onDidChange(() => this.observedList?.update()),
      lumine.contextMenu.add({
        "status-bar-tile.code-format-save-status": require("../menus/main.json")["context-menu"][
          ".code-format-save-status"
        ].map((item) => ({
          ...item,
          ...(editorCommands.has(item.command)
            ? {
                keyBindingTarget: (target) =>
                  lumine.workspace.resolveCommandContext(target).embeddedEditor?.getElement() ??
                  null,
              }
            : {}),
          created: function (event) {
            const editor = main.manager.resolveEditor({
              target: event.target,
              context: lumine.workspace.resolveCommandContext(event),
            });
            if (item.command === "code-format:toggle-format-on-save")
              this.checked = Boolean(editor && policy.setting("formatOnSave", editor));
            if (item.command === "code-format:toggle-observed")
              this.checked = Boolean(
                editor?.getPath() && observedFiles.isObserved(editor.getPath()),
              );
            if (item.command && item.command !== "code-format:observed-files")
              this.enabled = Boolean(editor);
            if (item.command === "code-format:toggle-observed")
              this.enabled = Boolean(editor?.getPath());
          },
        })),
      }),
    );
  },
  deactivate() {
    const manager = this.manager;
    const owner = this.subscriptions;
    const connections = this.statusConnections;
    const list = this.observedList;
    this.manager = this.policy = this.subscriptions = this.statusConnections = null;
    this.statusRegistration = null;
    this.observedList = null;
    this.observedListWindow = null;
    const registrations = [...(connections?.values() ?? [])].map(
      (connection) => connection.registration,
    );
    connections?.clear();
    observedFiles.clearObserved();
    manager?.dispose();
    owner?.dispose();
    for (const registration of registrations) registration.dispose();
    list?.destroy();
  },
  toggleObserved(editor = lumine.workspace.getActiveTextEditor()) {
    if (!editor) return;
    const filePath = editor.getPath();
    if (!filePath) {
      lumine.notifications.addWarning("code-format: Save the file before observing it.");
      return;
    }
    observedFiles.toggleObserved(filePath);
  },
  showObserved(window = lumine.workspace.getFocusedWindow() ?? lumine.workspace.getMainWindow()) {
    if (this.observedList && this.observedListWindow !== window) {
      this.observedList.destroy();
      this.observedList = null;
    }
    if (!this.observedList) {
      const ObservedList = require("./observed-list");
      this.observedList = new ObservedList(window);
      this.observedListWindow = window;
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
  consumeStatusBar(service) {
    return service.observeWindows(
      (scopedStatusBar, context) => this.consumeWindowStatusBar(scopedStatusBar, context),
      { windows: "all" },
    );
  },

  consumeWindowStatusBar(statusBar, context) {
    const owner = this.subscriptions,
      connections = this.statusConnections,
      policy = this.policy;
    if (!owner || owner.disposed || !connections) return new Disposable();
    let connection = connections.get(statusBar);
    if (!connection) {
      connection = { refs: 1, view: null, retired: false };
      connections.set(statusBar, connection);
      connection.registration = new Disposable(() => {
        if (connection.retired) return;
        connection.retired = true;
        if (connections.get(statusBar) === connection) connections.delete(statusBar);
        owner.remove(connection.registration);
        const view = connection.view;
        connection.view = null;
        if (this.statusConnections === connections) this.syncStatusRegistration();
        view?.dispose();
      });
      owner.add(connection.registration);
      const owns = () =>
        !connection.retired &&
        this.subscriptions === owner &&
        !owner.disposed &&
        this.statusConnections === connections &&
        connections.get(statusBar) === connection;
      const SaveStatus = require("./save-status");
      let view;
      try {
        view = new SaveStatus(statusBar, policy, {
          isCurrent: owns,
          context,
          dispatch: (element, command) => {
            if (owns()) return lumine.commands.dispatch(element, command);
          },
        });
        if (owns()) connection.view = view;
        else view.dispose();
      } catch (error) {
        connection.registration.dispose();
        throw error;
      }
    } else connection.refs++;
    this.syncStatusRegistration();
    return new Disposable(() => {
      if (connections.get(statusBar) !== connection || connection.retired) return;
      connection.refs--;
      if (connection.refs === 0) connection.registration.dispose();
    });
  },
  syncStatusRegistration() {
    this.statusRegistration =
      [...(this.statusConnections?.values() ?? [])].at(-1)?.registration ?? null;
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
