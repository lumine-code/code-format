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
    const registration = main.consumeStatusBar(statusBar);
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
    const registration = main.consumeStatusBar({
      addLeftTile(options) {
        item = options.item;
        return { destroy() {} };
      },
      addRightTile() {
        return { destroy() {} };
      },
    });
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
});
