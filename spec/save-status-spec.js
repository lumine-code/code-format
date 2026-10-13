const windowService = require("./helpers/window-service");
describe("formatting save status", () => {
  let main, observedFiles;
  beforeEach(async () => {
    main = (await lumine.packages.activatePackage("code-format")).mainModule;
    observedFiles = require("../lib/observed-files");
  });
  afterEach(() => {
    observedFiles.clearObserved();
  });
  it("constructs optional tiles on demand and disposes the service edge", () => {
    lumine.config.set("code-format.showInStatusBar", true);
    const tiles = [];
    const statusBar = {
      addLeftTile: () => {
        const tile = { destroy: jasmine.createSpy("left") };
        tiles.push(tile);
        return tile;
      },
      addRightTile: () => {
        const tile = { destroy: jasmine.createSpy("right") };
        tiles.push(tile);
        return tile;
      },
    };
    const registration = main.consumeStatusBar(windowService(statusBar));
    expect(tiles.length).toBe(1);
    observedFiles.setObserved(__filename, true);
    expect(tiles.length).toBe(2);
    registration.dispose();
    expect(tiles.every((tile) => tile.destroy.calls.count() === 1)).toBe(true);
  });
  it("updates the current file after scoped policy and path changes", async () => {
    const editor = await lumine.workspace.open();
    editor.getBuffer().setPath(__filename);
    lumine.config.set("code-format.showInStatusBar", true);
    let item;
    const registration = main.consumeStatusBar(
      windowService({
        addLeftTile(options) {
          item = options.item;
          return { destroy() {} };
        },
        addRightTile() {
          return { destroy() {} };
        },
      }),
    );
    expect(item.textContent).toBe("Format on Save: Off");
    main.policy.toggle(editor);
    expect(item.textContent).toBe("Format on Save");
    lumine.config.set("code-format.excludedGlobs", ["*.js"], {
      scopeSelector: `.${editor.getGrammar().scopeName}`,
    });
    expect(item.textContent).toBe("Format on Save: Off");
    editor.getBuffer().setPath(__filename.replace(/\.js$/, ".txt"));
    expect(item.textContent).toBe("Format on Save");
    registration.dispose();
    editor.destroy();
  });
  it("shows every action and reads each checkbox independently when the menu opens", async () => {
    const editor = await lumine.workspace.open();
    editor.getBuffer().setPath(__filename);
    lumine.config.set("code-format.showInStatusBar", true);
    let item;
    const registration = main.consumeStatusBar(
      windowService({
        addLeftTile(options) {
          item = options.item;
          return { destroy() {} };
        },
        addRightTile() {
          return { destroy() {} };
        },
      }),
    );
    const menu = () => lumine.contextMenu.templateForElement(item);
    expect(
      menu()
        .filter((entry) => entry.command)
        .map((entry) => entry.command),
    ).toEqual([
      "code-format:format-code",
      "code-format:toggle-format-on-save",
      "code-format:toggle-observed",
      "code-format:observed-files",
      "code-format:list-providers",
    ]);
    observedFiles.setObserved(__filename, true);
    const entries = menu();
    expect(entries.find((entry) => entry.command === "code-format:toggle-observed").checked).toBe(
      true,
    );
    expect(
      entries.find((entry) => entry.command === "code-format:toggle-format-on-save").checked,
    ).toBe(false);
    registration.dispose();
    editor.destroy();
  });
  it("keeps right-click free of side effects and dispatches middle-click formatting", async () => {
    const editor = await lumine.workspace.open();
    editor.getBuffer().setPath(__filename);
    lumine.config.set("code-format.showInStatusBar", true);
    const items = [];
    const addTile = (options) => {
      items.push(options.item);
      return { destroy() {} };
    };
    const registration = main.consumeStatusBar(
      windowService({ addLeftTile: addTile, addRightTile: addTile }),
    );
    observedFiles.setObserved(__filename, true);
    const dispatch = spyOn(lumine.commands, "dispatch").and.resolveTo();
    for (const item of items) {
      item.remove();
      item.dispatchEvent(new MouseEvent("mousedown", { button: 2, bubbles: true }));
      const event = new MouseEvent("contextmenu", { button: 2, bubbles: true, cancelable: true });
      item.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);
    }
    expect(dispatch).not.toHaveBeenCalled();
    expect(observedFiles.isObserved(__filename)).toBe(true);
    items[0].dispatchEvent(new MouseEvent("mousedown", { button: 1, bubbles: true }));
    expect(dispatch).toHaveBeenCalledOnceWith(items[0], "code-format:format-code");
    expect(
      lumine.contextMenu
        .templateForElement(items[1])
        .filter((entry) => entry.command)
        .map((entry) => entry.command),
    ).toEqual(["code-format:observed-files", "code-format:clear-all-observed-files"]);
    registration.dispose();
    editor.destroy();
  });
});
