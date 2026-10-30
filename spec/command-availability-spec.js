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
  it("refreshes all menu aliases when observed files change outside command dispatch", () => {
    const currentPackageRequire = require("./helpers/current-package-require");
    const observedFiles = currentPackageRequire(lumine.packages.getActivePackage("code-format"))(
      "./lib/observed-files",
    );
    editor.getBuffer().setPath(__filename);
    const invalidate = spyOn(lumine.commands, "invalidateAvailability").and.callThrough();
    const state = () =>
      lumine.commands.getCommandState("code-format:toggle-observed", { target: editor.element });

    observedFiles.setObserved(__filename, true);
    expect(invalidate).toHaveBeenCalledWith();
    expect(state()).toEqual({ type: "checkbox", checked: true });
    invalidate.calls.reset();
    observedFiles.clearObserved();
    expect(invalidate).toHaveBeenCalledWith();
    expect(state()).toEqual({ type: "checkbox", checked: false });
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
