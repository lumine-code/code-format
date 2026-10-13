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
