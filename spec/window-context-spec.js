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
});
