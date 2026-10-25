describe("Code Format command availability", () => {
  let main, editor, provider;
  beforeEach(async () => {
    const textGrammarPackage = await lumine.packages.activatePackage("language-text");
    await textGrammarPackage.resourceLoadPromise;
    jasmine.attachToDOM(lumine.workspace.getElement());
    main = (await lumine.packages.activatePackage("code-format")).mainModule;
    editor = await lumine.workspace.open();
  });
  afterEach(async () => {
    provider?.dispose();
    editor.destroy();
    await lumine.packages.deactivatePackage("code-format");
    provider = null;
  });
  it("declines an unsaved observed-file toggle", () => {
    expect(lumine.commands.canDispatch(editor.element, "code-format:toggle-observed")).toBe(false);
  });
  it("uses provider metadata without calling its expensive capability probe", () => {
    expect(lumine.commands.canDispatch(editor.element, "code-format:format-code")).toBe(false);
    const canFormat = jasmine.createSpy("expensive capability").and.resolveTo(true);
    provider = main.manager.addFileProvider({ canFormat, formatEntireFile() {} });
    expect(lumine.commands.canDispatch(editor.element, "code-format:format-code")).toBe(true);
    expect(canFormat).not.toHaveBeenCalled();
    editor.setText("one\ntwo");
    editor.setSelectedBufferRange([
      [0, 0],
      [0, 2],
    ]);
    expect(lumine.commands.canDispatch(editor.element, "code-format:format-code")).toBe(false);
    expect(canFormat).not.toHaveBeenCalled();
  });
});
