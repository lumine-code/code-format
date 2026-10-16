const { CompositeDisposable, Disposable } = require("lumine");
const CodeFormatManager = require("./code-format-manager");
const SavePolicy = require("./save-policy");
const observedFiles = require("./observed-files");

class SaveStatus {
  constructor(statusBar, policy, callbacks) {
    this.destroyed = false;
    this.statusBar = statusBar;
    this.policy = policy;
    this.callbacks = callbacks;
    this.context = callbacks.context;
    this.container = this.context?.editorContainer ?? lumine.workspace;
    this.subscriptions = new CompositeDisposable();
    this.editorSubscriptions = null;
    try {
      this.subscriptions.add(
        lumine.config.onDidChangeConfiguration((event) => {
          const editor = this.container.getActiveEmbeddedTextEditor();
          if (
            event.affectsConfiguration("code-format", { scope: editor?.getRootScopeDescriptor() })
          )
            this.update();
        }),
        observedFiles.onDidChange(() => this.update()),
      );
      // The observer reports the current editor synchronously. Let that one
      // callback create the initial status instead of rebuilding its editor
      // subscriptions and writing the same status a second time.
      const observer = this.container.observeActiveEmbeddedTextEditor((editor) =>
        this.watchEditor(editor),
      );
      if (this.isCurrent()) this.subscriptions.add(observer);
      else observer.dispose();
    } catch (error) {
      this.dispose();
      throw error;
    }
  }

  isCurrent() {
    return !this.destroyed && (this.callbacks.isCurrent?.() ?? true);
  }

  watchEditor(editor) {
    if (!this.isCurrent() || (this.hasObservedEditor && this.editor === editor)) return;
    this.hasObservedEditor = true;
    this.editor = editor;
    this.editorSubscriptions?.dispose();
    this.editorSubscriptions = null;
    if (editor) {
      this.editorSubscriptions = new CompositeDisposable();
      this.editorSubscriptions.add(
        editor.onDidChangeGrammar(() => this.update()),
        editor.onDidChangePath(() => this.update()),
      );
    }
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
          const target = this.container.getActiveEmbeddedTextEditor()?.getElement();
          if (!target) return;
          this.callbacks.dispatch(
            target,
            event.altKey ? "code-format:toggle-observed" : "code-format:toggle-format-on-save",
          );
        });
        element.addEventListener("mousedown", (event) => {
          if (!this.isCurrent() || ![0, 1].includes(event.button)) return;
          event.preventDefault();
          if (event.button === 1) {
            const target = this.container.getActiveEmbeddedTextEditor()?.getElement();
            if (target) this.callbacks.dispatch(target, "code-format:format-code");
          }
        });
        const tooltip = lumine.tooltips.add(element, {
          html: false,
          keyBindingCommand: "code-format:toggle-format-on-save",
          keyBindingTarget: () =>
            this.container.getActiveEmbeddedTextEditor()?.getElement() ?? null,
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
      const ObservedFilesStatus = require("./observed-status");
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
    this.editorSubscriptions?.dispose();
    this.editor = null;
    this.removeTile();
    const tile = this.observedTile,
      view = this.observedView;
    this.observedTile = null;
    this.observedView = null;
    tile?.destroy();
    view?.destroy();
  }
}

module.exports = {
  activate() {
    const main = this;
    const policy = (this.policy = new SavePolicy());
    const owner = (this.subscriptions = new CompositeDisposable());
    this.statusConnections = new Map();
    this.manager = new CodeFormatManager({
      shouldFormatOnSave: (editor) => policy.shouldFormat(editor),
    });
    owner.add(
      lumine.commands.add("lumine-text-editor:not([mini])", {
        "code-format:toggle-format-on-save": {
          description: "Turn formatting on save on or off for the active language.",
          didDispatch: (event) => this.policy.toggle(this.manager.resolveEditor(event)),
        },
        "code-format:toggle-observed": {
          description: "Format this one file on save, whatever the setting says.",
          didDispatch: (event) => this.toggleObserved(this.manager.resolveEditor(event)),
        },
      }),
      lumine.commands.add("lumine-workspace", {
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
        "status-bar-tile.code-format-save-status": {
          commandTarget: "focus",
          items: require("../menus/main.json")["context-menu"][
            ".code-format-save-status"
          ].items.map((item) => ({
            ...item,
            created: function (event, context) {
              const editor = main.manager.resolveEditor({
                target: context.commandTarget,
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
        },
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

Object.defineProperty(module.exports, "SaveStatus", { value: SaveStatus });
