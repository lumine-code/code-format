const path = require("path");
const observedFiles = require("./observed-files");

module.exports = class ObservedFilesList {
  constructor() {
    this.items = [];

    this.selectListHost = lumine.workspace.addSelectList(
      {
        emptyMessage: "No files observed for format-on-save",
        placeholderText: "Observed format-on-save files...",
        getItemId: (item) => item.filePath,
        source: { mode: "snapshot", load: () => this.loadItems() },
        search: { getFilterText: (item) => item.displayPath },
        renderItem: (item, { filterKey, highlight }) => {
          return {
            primary: highlight(filterKey),
            didRender: (element) =>
              lumine.icons.applyTo(
                element.querySelector(".primary-line"),
                {
                  path: item.filePath,
                  context: "code-format-observed-files",
                  hints: { directory: false },
                },
                { setData: false },
              ),
          };
        },
        commands: {
          "code-format:open-selected-file": {
            description: "Open the selected observed file, reusing its pane if it is already open.",
            didDispatch: (event) => this.openSelectedFile(event.detail.item),
          },
          "code-format:unobserve-selected-file": {
            description: "Stop formatting the selected file on save and drop it from this list.",
            didDispatch: (event) => this.unobserveSelectedFile(event.detail.item),
          },
        },
        actions: [
          {
            command: "code-format:open-selected-file",
            context: "item",
            primary: true,
            group: "File",
            disposition: "close",
            dispatch: "local",
          },
          {
            command: "code-format:unobserve-selected-file",
            context: "item",
            group: "File",
            disposition: "stay",
            dispatch: "local",
          },
          {
            command: "code-format:clear-all-observed-files",
            context: "dialog",
            when: () => this.items.length > 0,
            group: "All Files",
            tone: "danger",
            disposition: "stay",
            dispatch: "workspace",
          },
        ],
      },
      { className: "code-format-observed-files-list", crumb: "Observed Files" },
    );
    this.selectList = this.selectListHost.getModel();
  }

  buildItems() {
    return observedFiles.getObservedFiles().map((filePath) => ({
      filePath,
      displayPath: this.displayPath(filePath),
    }));
  }

  displayPath(filePath) {
    const [projectPath, relativePath] = lumine.project.relativizePath(filePath);
    if (projectPath && relativePath) {
      return relativePath;
    }
    return filePath;
  }

  loadItems() {
    this.items = this.buildItems();
    return this.items;
  }

  async update(initialSelectionIndex = null) {
    await this.selectList.setItems(this.loadItems());
    if (initialSelectionIndex != null && this.items.length > 0) {
      await this.selectList.selectIndex(Math.min(initialSelectionIndex, this.items.length - 1));
    }
  }

  openSelectedFile(item = null) {
    item ??= this.selectList.getSelectedItem();
    if (!item) {
      return;
    }

    return lumine.workspace.open(item.filePath, { searchAllPanes: true });
  }

  async unobserveSelectedFile(item = this.selectList.getSelectedItem()) {
    if (!item) {
      return;
    }

    const index = this.selectList.getSelectedIndex() ?? 0;
    observedFiles.setObserved(item.filePath, false);
    lumine.notifications.addHint(`Stopped observing ${path.basename(item.filePath)}`);

    await this.update(Math.max(0, Math.min(index, this.items.length - 2)));
    if (this.items.length === 0) {
      this.selectListHost.hide();
    }
  }

  show() {
    return this.selectListHost.show();
  }

  toggle() {
    return this.selectListHost.toggle();
  }

  destroy() {
    return this.selectListHost.destroy();
  }
};
