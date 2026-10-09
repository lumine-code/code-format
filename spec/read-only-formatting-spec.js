describe("Formatting read-only editors", () => {
  let editor, main, lease;

  beforeEach(async () => {
    for (const method of ["openExternal", "openPath", "showItemInFolder", "openApplication"])
      spyOn(lumine.shell, method).and.returnValue(Promise.resolve());
    spyOn(lumine.application, "openWindow").and.returnValue(Promise.resolve());
    jasmine.attachToDOM(lumine.workspace.getElement());
    main = (await lumine.packages.activatePackage("code-format")).mainModule;
    editor = await lumine.workspace.open();
    editor.setText("start");
  });

  afterEach(() => {
    lease?.dispose();
    editor?.destroy();
    editor = main = lease = null;
  });

  function provide(format) {
    lease = lumine.packages.serviceHub.provide("code-format.file", "1.0.0", {
      packageName: "owned-formatter",
      grammarScopes: [editor.getGrammar().scopeName],
      formatEntireFile: format,
    });
  }
  const edits = () => [
    {
      oldRange: [
        [0, 0],
        [0, 5],
      ],
      newText: "formatted",
    },
  ];

  it("preserves a read-only editor when the formatting command is dispatched", async () => {
    provide(async () => edits());
    editor.setReadOnly(true);
    const format = spyOn(main.manager, "formatCommand").and.callThrough();
    lumine.commands.dispatch(editor.getElement(), "code-format:format-code");
    expect(format).toHaveBeenCalled();
    await format.calls.mostRecent().returnValue;
    expect(editor.getText()).toBe("start");
  });

  it("discards an in-flight formatter result when its editor becomes read-only", async () => {
    let finish;
    provide(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const result = main.manager.formatEditor(editor);
    await waitForFrames(() => typeof finish === "function");
    editor.setReadOnly(true);
    finish(edits());
    await result;
    expect(editor.getText()).toBe("start");
  });
});
