const path = require("path");
const os = require("os");
const { Icon } = require("lumine");
const currentPackageRequire = require("./helpers/current-package-require");

describe("code-format item actions", () => {
  let observedList, list, iconRegistration, observedFiles, ObservedFilesList;

  beforeEach(async () => {
    jasmine.attachToDOM(lumine.views.getView(lumine.workspace));
    const pack = await lumine.packages.activatePackage("code-format");
    const requireCurrent = currentPackageRequire(pack);
    observedFiles = requireCurrent("./lib/observed-files");
    ObservedFilesList = requireCurrent("./lib/observed-list");

    observedList = new ObservedFilesList();
    list = observedList.selectList;
  });

  afterEach(async () => {
    iconRegistration?.dispose();
    await observedList.destroy();
    observedFiles.clearObserved();
    await lumine.packages.deactivatePackage("code-format");
  });

  it("routes observed file paths through the shared icon registry", async () => {
    const filePath = path.join(os.tmpdir(), "code-format-item-actions.js");
    observedFiles.setObserved(filePath, true);
    const renderedList = new ObservedFilesList();
    await renderedList.update();
    const line = renderedList.selectList.getElement().querySelector(".primary-line");
    expect(line).toHaveClass("icon-file-text");

    iconRegistration = lumine.icons.addProvider(
      {
        id: "code-format-observed-files-spec",
        handles: ["path"],
        usesContext: true,
        iconFor(target) {
          return target.context === "code-format-observed-files"
            ? Icon.classes(["icon-flame"])
            : null;
        },
      },
      { priority: 100 },
    );
    expect(line).toHaveClass("icon-flame");
    await renderedList.destroy();
  });

  it("derives its item and list actions from command registrations and the keymap", async () => {
    const filePath = path.join(os.tmpdir(), "code-format-item-actions.js");
    observedFiles.setObserved(filePath, true);
    observedList.selectListHost.getPanel();
    await observedList.update();
    const actions = list.getAvailableActions();
    const byCommand = new Map(actions.map((action) => [action.command, action]));

    expect(actions.map((action) => action.command)).toEqual([
      "code-format:open-selected-file",
      "code-format:open",
      "code-format:open-external",
      "code-format:show-in-folder",
      "code-format:unobserve-selected-file",
      "code-format:clear-all-observed-files",
      "select-list:toggle-keep-open",
    ]);

    const open = byCommand.get("code-format:open-selected-file");
    expect(open.name).toBe("Open Selected File");
    expect(open.description).toBe(
      "Open the selected observed file, reusing its pane if it is already open.",
    );
    expect(open.primary).toBe(true);
    expect(open.context).toBe("item");

    const unobserve = byCommand.get("code-format:unobserve-selected-file");
    expect(unobserve.name).toBe("Unobserve Selected File");
    expect(unobserve.description).toBe(
      "Stop formatting the selected file on save and drop it from this list.",
    );
    expect(unobserve.keystrokes).toEqual([process.platform === "darwin" ? "cmd-d" : "ctrl-d"]);
    // Resolve at the query editor: an ancestor binding loses to select-word.
    expect(
      lumine.keymaps.findKeyBindings({
        target: list.getQueryEditor().getElement(),
        keystrokes: unobserve.keystrokes[0],
      })[0]?.command,
    ).toBe("code-format:unobserve-selected-file");
    expect(unobserve.context).toBe("item");

    const clear = byCommand.get("code-format:clear-all-observed-files");
    expect(clear.description).toBe("Stop formatting every file that was set to format on save.");
    expect(clear.keystrokes).toEqual([]);
    expect(clear.context).toBe("dialog");
    expect(clear.tone).toBe("danger");
    expect(list.getItemId({ filePath })).toBe(filePath);
  });

  it("keeps list actions without a selection and hides Clear All when the source is empty", async () => {
    const filePath = path.join(os.tmpdir(), "code-format-item-actions.js");
    observedFiles.setObserved(filePath, true);
    await observedList.update();
    list.setItems([]);

    expect(list.getAvailableActions().map((action) => action.command)).toEqual([
      "code-format:clear-all-observed-files",
      "select-list:toggle-keep-open",
    ]);

    observedFiles.clearObserved();
    await observedList.update();
    expect(list.getAvailableActions().map(({ command }) => command)).toEqual([
      "select-list:toggle-keep-open",
    ]);
  });

  for (const keepOpen of [false, true]) {
    it(`removes the last observed file with keep-open mode ${keepOpen}`, async () => {
      observedFiles.setObserved(path.join(os.tmpdir(), "last-observed.js"), true);
      await observedList.show();
      await list.setKeepOpen(keepOpen);

      await list.runAction("code-format:unobserve-selected-file");

      expect(observedFiles.getObservedCount()).toBe(0);
      expect(list.getItems()).toEqual([]);
      expect(observedList.selectListHost.isVisible()).toBe(keepOpen);
    });
  }

  it("shows the actions as a flow step and runs one against the master list", async () => {
    // Two observed files, so removing one keeps the list open.
    const fileA = path.join(os.tmpdir(), "code-format-item-actions-a.js");
    const fileB = path.join(os.tmpdir(), "code-format-item-actions-b.js");
    observedFiles.setObserved(fileA, true);
    observedFiles.setObserved(fileB, true);
    await observedList.show();

    await observedList.selectListHost.showActions();

    expect(lumine.workspace.getModalTrail()).toEqual(["Observed Files", "Actions"]);

    lumine.workspace.popModal();
    await list.runAction("code-format:unobserve-selected-file");

    expect(observedFiles.getObservedCount()).toBe(1);
    expect(observedList.selectListHost.isVisible()).toBeTruthy();
  });
});
