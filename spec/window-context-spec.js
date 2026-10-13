describe("format on save window context", () => {
  beforeEach(async () => {
    jasmine.useRealClock();
    jasmine.attachToDOM(lumine.workspace.getElement());
    await lumine.packages.activatePackage("status-bar");
    await lumine.packages.activatePackage("code-format");
    lumine.config.set("code-format.showInStatusBar", true);
  });
  afterEach(async () => {
    await lumine.workspace.discardEditorWindows();
  });
  it("changes the policy for the invoking window's editor instead of another globally active view", async () => {
    const workspace = lumine.workspace;
    const main = workspace.getMainWindow();
    const editor = await workspace.open();
    const extra = await workspace.openEditorWindow({ show: false });
    const other = workspace.buildTextEditor();
    extra.getEditorContainer().getActivePane().activateItem(other, { activatePane: true });
    const module = lumine.packages.getActivePackage("code-format").mainModule;
    const toggle = spyOn(module.policy, "toggle");
    main.getElement().querySelector(".code-format-save-status").click();
    expect(toggle).toHaveBeenCalledOnceWith(editor);
    toggle.calls.reset();
    extra.getElement().querySelector(".code-format-save-status").click();
    expect(toggle).toHaveBeenCalledOnceWith(other);
  });
  it("formats and lists providers for the window selected through its status menu", async () => {
    const workspace = lumine.workspace;
    await workspace.open();
    const extra = await workspace.openEditorWindow({ show: false });
    const other = workspace.buildTextEditor();
    extra.getEditorContainer().getActivePane().activateItem(other, { activatePane: true });
    const main = lumine.packages.getActivePackage("code-format").mainModule;
    const format = spyOn(main.manager, "formatEditor").and.resolveTo(true);
    const resolve = spyOn(main.manager, "resolveEditor").and.callThrough();
    const tile = extra.getElement().querySelector(".code-format-save-status");
    await lumine.commands.dispatch(tile, "code-format:format-code");
    expect(format).toHaveBeenCalledOnceWith(other);
    await lumine.commands.dispatch(tile, "code-format:list-providers");
    expect(resolve.calls.mostRecent().returnValue).toBe(other);
  });
  it("shows the actual formatting shortcut and policy of the invoking window", async () => {
    const workspace = lumine.workspace;
    const mainWindow = workspace.getMainWindow();
    const editor = await workspace.open();
    editor.getBuffer().setPath(__filename);
    editor.setGrammar(lumine.grammars.nullGrammar);
    await lumine.packages.activatePackage("language-json");
    const extra = await workspace.openEditorWindow({ show: false });
    const other = workspace.buildTextEditor();
    other.getBuffer().setPath(__filename + ".json");
    other.setGrammar(lumine.grammars.grammarForScopeName("source.json"));
    extra.getEditorContainer().getActivePane().activateItem(other, { activatePane: true });
    const main = lumine.packages.getActivePackage("code-format").mainModule;
    lumine.config.set("code-format.formatOnSave", true, { scopeSelector: ".source.json" });
    main.toggleObserved(other);
    expect(workspace.getActiveTextEditor()).toBe(other);
    const ownMenu = lumine.contextMenu.templateForElement(
      mainWindow.getElement().querySelector(".code-format-save-status"),
    );
    const otherMenu = lumine.contextMenu.templateForElement(
      extra.getElement().querySelector(".code-format-save-status"),
    );
    const command = (items, name) => items.find((item) => item.command === "code-format:" + name);
    const label = process.platform === "darwin" ? "⌥⌘B" : "Ctrl+Alt+B";
    expect(command(ownMenu, "format-code").keyBindingLabel).toBe(label);
    expect(command(otherMenu, "format-code").keyBindingLabel).toBe(label);
    expect(command(ownMenu, "toggle-format-on-save").checked).toBe(false);
    expect(command(otherMenu, "toggle-format-on-save").checked).toBe(true);
    expect(command(ownMenu, "toggle-observed").checked).toBe(false);
    expect(command(otherMenu, "toggle-observed").checked).toBe(true);
    const pdfElement = document.createElement("div");
    const item = {
      filePath: __filename.replace(/\.js$/, ".pdf"),
      getTitle: () => "PDF",
      getElement: () => pdfElement,
    };
    mainWindow.getEditorContainer().getActivePane().activateItem(item);
    const noEditorMenu = lumine.contextMenu.templateForElement(
      mainWindow.getElement().querySelector(".code-format-save-status"),
    );
    expect(command(noEditorMenu, "format-code").keyBindingLabel).toBe("");
    expect(command(noEditorMenu, "format-code").enabled).toBe(false);
    expect(command(noEditorMenu, "toggle-format-on-save").checked).toBe(false);
    expect(command(noEditorMenu, "toggle-observed").checked).toBe(false);
    await mainWindow.getEditorContainer().getActivePane().destroyItem(item);
  });
  it("formats the embedded editor offered by the active document", async () => {
    const workspace = lumine.workspace;
    const editor = workspace.buildTextEditor();
    const element = document.createElement("div");
    const item = {
      getTitle: () => "Embedded source",
      getElement: () => element,
      getActiveEmbeddedTextEditor: () => editor,
    };
    workspace.getActivePane().activateItem(item);
    const main = lumine.packages.getActivePackage("code-format").mainModule;
    const format = spyOn(main.manager, "formatEditor").and.resolveTo(true);
    await lumine.commands.dispatch(
      workspace.getMainWindow().getElement().querySelector(".code-format-save-status"),
      "code-format:format-code",
    );
    expect(format).toHaveBeenCalledOnceWith(editor);
    workspace.getActivePane().destroyItem(item);
    editor.destroy();
  });
});
