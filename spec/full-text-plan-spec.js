const path = require("path");
const { Point, Range } = require("lumine");

describe("validated complete format plans", () => {
  let editor, main, applyEdits, registrations;
  beforeEach(async () => {
    jasmine.useRealClock();
    main = (await lumine.packages.activatePackage(path.resolve(__dirname, ".."))).mainModule;
    // Reacquire the helper from the package generation activated for this test.
    ({ applyEdits } = require("../lib/apply-edits"));
    editor = await lumine.workspace.open();
    registrations = [];
  });
  afterEach(async () => {
    registrations.forEach((item) => item.dispose());
    editor.destroy();
    await lumine.packages.deactivatePackage("code-format");
  });
  const plan = (source, target) => ({
    text: target,
    edits: editor.getBuffer().getChangesToText(target),
    isCurrent: () => editor.getText() === source,
  });
  const filePipeline = (provider) => {
    registrations.push(
      main.consumeCodeFormatFile({ grammarScopes: [editor.getGrammar().scopeName], ...provider }),
    );
    return main.manager.buildFormatPipeline(editor, editor.getBuffer().getRange());
  };

  it("applies 1000 edits with one replacement and one undo step", async () => {
    const source = Array.from(
      { length: 1000 },
      (_, index) => `#%% ${index}\nvalue_${index}=1\n`,
    ).join("");
    const target = source.replaceAll("=1", " = 1");
    editor.setText(source);
    editor.getBuffer().clearUndoStack();
    const result = plan(source, target);
    const replace = spyOn(editor, "setText").and.callThrough();
    const individual = spyOn(editor.getBuffer(), "setTextInRange").and.callThrough();
    await main.manager.runPipeline(filePipeline({ formatEntireFile: () => result }), editor);
    expect(replace).toHaveBeenCalledTimes(1);
    expect(individual).toHaveBeenCalledTimes(1);
    expect(editor.getText()).toBe(target);
    editor.undo();
    expect(editor.getText()).toBe(source);
    editor.redo();
    expect(editor.getText()).toBe(target);
  });

  it("derives target ranges independently and preserves reversed multiple selections and CRLF", () => {
    const source = "#%% Title\r\nx=1; chosen=2\r\n",
      target = "#%% Title\r\nx = 1; chosen = 2\r\n";
    editor.setText(source);
    editor.getBuffer().clearUndoStack();
    editor.setSelectedBufferRanges([new Range([0, 0], [0, 9]), new Range([1, 5], [1, 11])]);
    editor.getSelections()[1].setBufferRange(new Range([1, 5], [1, 11]), { reversed: true });
    const original = editor.getSelectedBufferRanges().map((range) => range.copy());
    const result = plan(source, target);
    result.edits.forEach((edit) => {
      edit.newRange = new Range([99, 99], [100, 100]);
    });
    applyEdits(editor, result);
    expect(editor.getSelections().map((selection) => selection.getText())).toEqual([
      "#%% Title",
      "chosen ",
    ]);
    expect(editor.getSelections()[1].isReversed()).toBe(true);
    editor.undo();
    expect(editor.getText()).toBe(source);
    expect(editor.getSelectedBufferRanges()).toEqual(original);
    editor.redo();
    expect(editor.getText()).toBe(target);
  });

  it("maps insertion and replacement-end endpoints without moving selections backward", () => {
    for (const reversed of [false, true]) {
      editor.setText("abc");
      editor.setSelectedBufferRange(new Range([0, 1], [0, 3]), { reversed });
      applyEdits(editor, {
        text: "YYbc",
        edits: [
          {
            oldRange: [
              [0, 0],
              [0, 1],
            ],
            newText: "YY",
          },
        ],
        isCurrent: () => true,
      });
      expect(editor.getSelectedBufferRange()).toEqual(new Range([0, 2], [0, 4]));
      expect(editor.getSelectedText()).toBe("bc");
      expect(editor.getSelections()[0].isReversed()).toBe(reversed);
      editor.setText("abc");
      editor.setSelectedBufferRange(new Range([0, 1], [0, 2]), { reversed });
      applyEdits(editor, {
        text: "a_bc",
        edits: [
          {
            oldRange: [
              [0, 1],
              [0, 1],
            ],
            newText: "_",
          },
        ],
        isCurrent: () => true,
      });
      expect(editor.getSelectedBufferRange()).toEqual(new Range([0, 2], [0, 3]));
      expect(editor.getSelectedText()).toBe("b");
      expect(editor.getSelections()[0].isReversed()).toBe(reversed);
    }
  });

  it("rejects overlap, invalid coordinates, surrogate boundaries and inconsistent target text atomically", () => {
    const source = "value=1\nemoji='😀'\n";
    editor.setText(source);
    editor.getBuffer().clearUndoStack();
    const cases = [
      [
        {
          oldRange: [
            [0, 0],
            [0, 3],
          ],
          newText: "x",
        },
        {
          oldRange: [
            [0, 2],
            [0, 5],
          ],
          newText: "y",
        },
      ],
      [
        {
          oldRange: [
            [0, 0],
            [0, 999],
          ],
          newText: "x",
        },
      ],
      [
        {
          oldRange: [
            [-1, 0],
            [0, 0],
          ],
          newText: "x",
        },
      ],
      [
        {
          oldRange: [
            [0, 0.5],
            [0, 1],
          ],
          newText: "x",
        },
      ],
      [
        {
          oldRange: [
            [1, 8],
            [1, 9],
          ],
          newText: "x",
        },
      ],
      [
        {
          oldRange: [
            [0, 0],
            [0, 1],
          ],
          newText: "x",
        },
      ],
    ];
    const replace = spyOn(editor, "setText").and.callThrough();
    for (const edits of cases)
      applyEdits(editor, { text: "invalid", edits, isCurrent: () => true });
    expect(replace).not.toHaveBeenCalled();
    expect(editor.getText()).toBe(source);
    expect(editor.getBuffer().undo()).toBe(false);
  });

  it("does not apply a no-op or a plan whose final current callback refuses", () => {
    const source = "value=1\n";
    editor.setText(source);
    const replace = spyOn(editor, "setText").and.callThrough();
    applyEdits(editor, plan(source, source));
    const result = plan(source, "value = 1\n");
    let calls = 0;
    result.isCurrent = () => ++calls < 3;
    applyEdits(editor, result);
    expect(calls).toBe(3);
    expect(replace).not.toHaveBeenCalled();
    expect(editor.getText()).toBe(source);
  });

  for (const change of [
    "path",
    "selection",
    "reverse",
    "dispose",
    "abort",
    "destroy",
    "revision",
  ]) {
    it(`discards a completed plan after ${change} changes during its request`, async () => {
      const source = "value=1\n";
      editor.setText(source);
      editor.setSelectedBufferRange(new Range([0, 0], [0, 3]));
      let resolve,
        aborted = false;
      const result = plan(source, "value = 1\n"),
        current = result.isCurrent;
      result.isCurrent = () => !aborted && current();
      const completion = new Promise((reply) => {
        resolve = reply;
      });
      const pending = main.manager.runPipeline(
        filePipeline({
          formatEntireFile: () => completion,
        }),
        editor,
      );
      if (change === "revision") editor.setText("changed source\n");
      const replace = spyOn(editor, "setText").and.callThrough();
      if (change === "path") editor.getBuffer().setPath(path.join(__dirname, "renamed.txt"));
      if (change === "selection") editor.setCursorBufferPosition(new Point(0, 1));
      if (change === "reverse")
        editor.getSelections()[0].setBufferRange(new Range([0, 0], [0, 3]), { reversed: true });
      if (change === "dispose") main.manager.dispose();
      if (change === "abort") aborted = true;
      if (change === "destroy") editor.destroy();
      resolve(result);
      await pending;
      expect(replace).not.toHaveBeenCalled();
      if (change !== "destroy")
        expect(editor.getText()).toBe(change === "revision" ? "changed source\n" : source);
    });
  }

  it("keeps range providers on the edit-array contract", async () => {
    const source = "value=1\n";
    editor.setText(source);
    registrations.push(
      main.consumeCodeFormatRange({
        grammarScopes: [editor.getGrammar().scopeName],
        formatCode: () => plan(source, "value = 1\n"),
      }),
    );
    await main.manager.runPipeline(
      main.manager.buildFormatPipeline(editor, new Range([0, 0], [0, 3])),
      editor,
      new Range([0, 0], [0, 3]),
    );
    expect(editor.getText()).toBe(source);
  });
});
