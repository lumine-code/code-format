const windowService = require("./helpers/window-service");
const currentPackageRequire = require("./helpers/current-package-require");
describe("formatting save status", () => {
  let main, observedFiles;
  beforeEach(async () => {
    jasmine.attachToDOM(lumine.workspace.getElement());
    const pack = await lumine.packages.activatePackage("code-format");
    main = pack.mainModule;
    observedFiles = currentPackageRequire(pack)("./lib/observed-files");
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
  it("releases an editor observer returned after its synchronous callback retires the view", () => {
    const SaveStatus = currentPackageRequire(lumine.packages.getActivePackage("code-format"))(
      "./lib/save-status",
    );
    const container = lumine.workspace.getMainWindow().getEditorContainer();
    const observe = container.observeActiveEmbeddedTextEditor.bind(container);
    const returned = [];
    spyOn(container, "observeActiveEmbeddedTextEditor").and.callFake((callback) => {
      const subscription = observe(callback);
      spyOn(subscription, "dispose").and.callThrough();
      returned.push(subscription);
      return subscription;
    });
    class RetiringStatus extends SaveStatus {
      watchEditor(editor) {
        super.watchEditor(editor);
        this.dispose();
      }
    }
    const tile = { destroy: jasmine.createSpy("retired tile") };
    lumine.config.set("code-format.showInStatusBar", true);
    const view = new RetiringStatus({ addLeftTile: () => tile }, main.policy, {
      context: { editorContainer: container },
      isCurrent: () => true,
      dispatch() {},
    });
    expect(returned.length).toBe(1);
    expect(returned[0].dispose).toHaveBeenCalledTimes(1);
    expect(tile.destroy).toHaveBeenCalledTimes(1);
    view.dispose();
    expect(returned[0].dispose).toHaveBeenCalledTimes(1);
  });
  it("observes and renders the initial editor once and retains its subscriptions on a repeat", async () => {
    const editor = await lumine.workspace.open();
    lumine.config.set("code-format.showInStatusBar", true);
    const policy = spyOn(main.policy, "shouldFormat").and.callThrough();
    const grammar = spyOn(editor, "onDidChangeGrammar").and.callThrough();
    const path = spyOn(editor, "onDidChangePath").and.callThrough();
    const statusBar = {
      addLeftTile: () => ({ destroy() {} }),
      addRightTile: () => ({ destroy() {} }),
    };
    const registration = main.consumeStatusBar(windowService(statusBar));
    try {
      const view = main.statusConnections.get(statusBar).view;
      view.watchEditor(editor);
      view.watchEditor(editor);
      expect(policy).toHaveBeenCalledOnceWith(editor);
      expect(grammar).toHaveBeenCalledTimes(1);
      expect(path).toHaveBeenCalledTimes(1);
      expect(view.element.textContent).toBe("Format on Save: Off");
      observedFiles.setObserved(__filename, true);
      expect(view.observedView.getElement().textContent).toContain("Formatting (1)");
    } finally {
      registration.dispose();
      editor.destroy();
    }
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
    const tooltips = spyOn(lumine.tooltips, "add").and.callThrough();
    const editor = await lumine.workspace.open();
    editor.element.focus();
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
    const options = tooltips.calls.all().find((call) => call.args[0] === item).args[1];
    expect(options.keyBindingCommand).toBe("code-format:toggle-format-on-save");
    expect(options.keyBindingTarget()).toBe(editor.getElement());
    expect(options.html).toBe(false);
    expect(options.keyBindingExtra).toBeUndefined();
    expect(options.title()).toBe("Format on save disabled. Toggle for this language.");
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
    expect(dispatch).toHaveBeenCalledOnceWith(editor.element, "code-format:format-code");
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
