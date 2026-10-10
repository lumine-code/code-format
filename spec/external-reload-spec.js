const { Readable } = require("stream");
const { TextBuffer } = require("lumine");

async function microtasks() {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

describe("On-type formatting across external reloads", () => {
  let main, editor, source, lease;

  beforeEach(async () => {
    jasmine.useRealClock();
    main = (await lumine.packages.activatePackage("code-format")).mainModule;
    source = {
      text: "abc",
      getPath: () => null,
      existsSync: () => true,
      createReadStream() {
        return Readable.from([this.text]);
      },
      onDidChange() {
        return { dispose() {} };
      },
    };
    const buffer = await TextBuffer.load(source);
    editor = lumine.workspace.buildTextEditor({ buffer });
    lumine.workspace.getActivePane().addItem(editor);
    editor.setCursorBufferPosition([0, 3]);
    lumine.config.set("code-format.formatOnType", true);
  });

  afterEach(async () => {
    lease?.dispose();
    editor?.destroy();
    await lumine.packages.deactivatePackage("code-format");
    editor = source = lease = main = null;
  });

  function provideFormatter() {
    const format = jasmine.createSpy("formatAtPosition").and.resolveTo([
      {
        oldRange: [
          [0, 0],
          [0, 1],
        ],
        newText: "A",
      },
    ]);
    lease = main.consumeCodeFormatOnType({
      packageName: "reload-formatter",
      grammarScopes: [editor.getGrammar().scopeName],
      formatAtPosition: format,
    });
    return format;
  }

  function stoppedChanging() {
    return new Promise((resolve) => {
      const subscription = editor.getBuffer().onDidStopChanging((event) => {
        subscription.dispose();
        resolve(event);
      });
    });
  }

  it("does not format a character loaded from the external source", async () => {
    const format = provideFormatter();
    const stopped = stoppedChanging();
    source.text = "abcd";
    await editor.getBuffer().load({ internal: true });
    await stopped;
    await microtasks();

    expect(format).not.toHaveBeenCalled();
    expect(editor.getText()).toBe("abcd");
    expect(editor.getFileState()).toBe("unmodified");
  });

  it("formats the next typed character before the reload's idle timer expires", async () => {
    const format = provideFormatter();
    const stopped = stoppedChanging();
    source.text = "abcd";
    await editor.getBuffer().load({ internal: true });
    editor.setCursorBufferPosition([0, 4]);
    editor.insertText(";");
    const event = await stopped;
    await microtasks();

    expect(event.origin).toBe("mixed");
    expect(format.calls.count()).toBe(1);
    expect(format.calls.mostRecent().args[2]).toBe(";");
    expect(editor.getText()).toBe("Abcd;");
    expect(source.text).toBe("abcd");
  });

  it("uses the last typing transaction when several edits follow a reload", async () => {
    const format = provideFormatter();
    const stopped = stoppedChanging();
    source.text = "abcd";
    await editor.getBuffer().load({ internal: true });
    editor.setCursorBufferPosition([0, 4]);
    editor.insertText("e");
    editor.insertText(";");
    await stopped;
    await microtasks();

    expect(format.calls.count()).toBe(1);
    expect(format.calls.mostRecent().args[2]).toBe(";");
    expect(format.calls.mostRecent().args[1].isEqual([0, 6])).toBe(true);
    expect(editor.getText()).toBe("Abcde;");
  });

  it("uses the last typing transaction during uninterrupted typing", async () => {
    const format = provideFormatter();
    const stopped = stoppedChanging();
    editor.insertText("d");
    editor.insertText(";");
    await stopped;
    await microtasks();

    expect(format.calls.count()).toBe(1);
    expect(format.calls.mostRecent().args[2]).toBe(";");
    expect(editor.getText()).toBe("Abcd;");
  });

  it("does not format an earlier keystroke after a reload replaced it", async () => {
    const format = provideFormatter();
    const stopped = stoppedChanging();
    editor.insertText(";");
    source.text = "abcd";
    await editor.getBuffer().load({ internal: true, discardChanges: true });
    await stopped;
    await microtasks();

    expect(format).not.toHaveBeenCalled();
    expect(editor.getText()).toBe("abcd");
    expect(editor.getFileState()).toBe("unmodified");
  });

  it("retires pending typing when a forced reload has no text difference", async () => {
    const format = provideFormatter();
    const stopped = stoppedChanging();
    editor.insertText(";");
    source.text = "abc;";
    await editor.getBuffer().load({ internal: true, discardChanges: true });
    await stopped;
    await microtasks();

    expect(format).not.toHaveBeenCalled();
    expect(editor.getText()).toBe("abc;");
    expect(editor.getFileState()).toBe("unmodified");
  });
});
