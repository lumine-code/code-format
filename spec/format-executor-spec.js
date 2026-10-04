const fs = require("fs");
const os = require("os");
const path = require("path");
const { Range } = require("lumine");

function deferred() {
  let resolve;
  const promise = new Promise((reply) => {
    resolve = reply;
  });
  return { promise, resolve };
}

async function until(predicate) {
  const deadline = Date.now() + 5000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("Formatter did not start");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe("format executor ownership and arbitration", () => {
  let editor, main, registrations, tempDir, filePath;
  beforeEach(async () => {
    jasmine.useRealClock();
    main = (await lumine.packages.activatePackage(path.resolve(__dirname, ".."))).mainModule;
    registrations = [];
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "format-executor-"));
    filePath = path.join(tempDir, "sample.txt");
    fs.writeFileSync(filePath, "aaa bbb ccc\n");
    editor = await lumine.workspace.open(filePath);
    editor.getBuffer().clearUndoStack();
  });
  afterEach(async () => {
    registrations.forEach((item) => item.dispose());
    await lumine.packages.deactivatePackage("code-format");
    for (const item of lumine.workspace.getTextEditors()) item.destroy();
    fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  });

  const register = (method, provider) => {
    const value = {
      packageName: "test-formatter",
      grammarScopes: [editor.getGrammar().scopeName],
      ...provider,
    };
    const registration = main[method](value);
    registrations.push(registration);
    return registration;
  };
  const replacement = (text) => [{ oldRange: editor.getBuffer().getRange(), newText: text }];

  it("falls through a declined provider and stops at a successful no-op", async () => {
    const last = jasmine.createSpy("last").and.returnValue(replacement("unexpected\n"));
    const noOp = jasmine.createSpy("no-op").and.returnValue([]);
    const decline = jasmine.createSpy("decline").and.returnValue(null);
    register("consumeCodeFormatFile", { priority: 3, formatEntireFile: decline });
    register("consumeCodeFormatFile", { priority: 2, formatEntireFile: noOp });
    register("consumeCodeFormatFile", { priority: 1, formatEntireFile: last });
    expect(await main.manager.formatEditor(editor)).toBe(true);
    expect(decline).toHaveBeenCalledTimes(1);
    expect(noOp).toHaveBeenCalledTimes(1);
    expect(last).not.toHaveBeenCalled();
    expect(editor.getText()).toBe("aaa bbb ccc\n");
    expect(editor.getBuffer().undo()).toBe(false);
  });

  it("treats an unchanged complete plan as a successful no-op", async () => {
    const fallback = jasmine.createSpy("fallback").and.returnValue(replacement("unexpected\n"));
    register("consumeCodeFormatFile", {
      priority: 2,
      formatEntireFile: (_editor, request) => ({
        text: request.text,
        edits: [],
        isCurrent: request.isCurrent,
      }),
    });
    register("consumeCodeFormatFile", { priority: 1, formatEntireFile: fallback });
    expect(await main.manager.formatEditor(editor)).toBe(true);
    expect(fallback).not.toHaveBeenCalled();
    expect(editor.getText()).toBe("aaa bbb ccc\n");
    expect(editor.getBuffer().undo()).toBe(false);
  });

  it("selects a path-based provider and skips one declining eligibility", async () => {
    const unavailable = jasmine.createSpy("unavailable");
    register("consumeCodeFormatFile", {
      priority: 10,
      canFormat: async () => false,
      formatEntireFile: unavailable,
    });
    let captured;
    register("consumeCodeFormatFile", {
      grammarScopes: undefined,
      canFormat: async (_editor, request) => request.path.endsWith("sample.txt"),
      formatEntireFile: (_editor, request) => {
        captured = request;
        return replacement("formatted\n");
      },
    });
    expect(await main.manager.formatEditor(editor)).toBe(true);
    expect(unavailable).not.toHaveBeenCalled();
    expect(captured.text).toBe("aaa bbb ccc\n");
    expect(captured.path).toBe(filePath);
    expect(captured.reason).toBe("manual");
    expect(captured.kind).toBe("file");
    expect(editor.getText()).toBe("formatted\n");
  });

  it("honors the scoped package preference and a one-request override strictly", async () => {
    const automatic = jasmine.createSpy("automatic").and.returnValue([]);
    const preferred = jasmine.createSpy("preferred").and.returnValue([]);
    register("consumeCodeFormatFile", {
      packageName: "automatic",
      priority: 100,
      formatEntireFile: automatic,
    });
    register("consumeCodeFormatFile", { packageName: "preferred", formatEntireFile: preferred });
    lumine.config.set("code-format.defaultProvider", "preferred", {
      scopeSelector: `.${editor.getGrammar().scopeName}`,
    });
    expect(await main.manager.formatEditor(editor)).toBe(true);
    expect(preferred).toHaveBeenCalledTimes(1);
    expect(automatic).not.toHaveBeenCalled();
    expect(await main.manager.formatEditor(editor, { provider: "missing" })).toBe(false);
    expect(automatic).not.toHaveBeenCalled();
    expect(await main.manager.formatEditor(editor, { provider: "automatic" })).toBe(true);
    expect(automatic).toHaveBeenCalledTimes(1);
  });

  it("falls from an on-save decline to a file provider", async () => {
    const file = jasmine.createSpy("file").and.returnValue([]);
    register("consumeCodeFormatOnSave", { formatOnSave: () => undefined });
    register("consumeCodeFormatFile", { formatEntireFile: file });
    expect(await main.manager.formatEditor(editor, { reason: "save" })).toBe(true);
    expect(file).toHaveBeenCalledTimes(1);
  });

  it("reports a save-policy error while allowing the disk write", async () => {
    main.manager.shouldFormatOnSave = async () => {
      throw new Error("Invalid save policy");
    };
    const notification = spyOn(lumine.notifications, "addError");
    editor.setText("unformatted user text\n");
    await editor.save();
    expect(notification).toHaveBeenCalledWith("code-format: failed to format on save", {
      detail: "Invalid save policy",
    });
    expect(fs.readFileSync(filePath, "utf8")).toBe("unformatted user text\n");
    expect(editor.getBuffer().isModified()).toBe(false);
  });

  it("invalidates an eventual response after the save deadline", async () => {
    const completion = deferred();
    let request;
    register("consumeCodeFormatOnSave", {
      formatOnSave: (_editor, value) => {
        request = value;
        return completion.promise;
      },
    });
    lumine.config.set("code-format.formatOnSave", true);
    const source = editor.getText();
    const saved = editor.save();
    await until(() => request !== undefined);
    await saved;
    expect(request.signal.aborted).toBe(true);
    expect(request.isCurrent()).toBe(false);
    completion.resolve(replacement("late response\n"));
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(editor.getText()).toBe(source);
    expect(editor.getBuffer().isModified()).toBe(false);
    expect(fs.readFileSync(filePath, "utf8")).toBe(source);
  });

  it("registers only one save hook for editors sharing a buffer", async () => {
    const other = editor.copy();
    lumine.workspace.getActivePane().splitRight({ items: [other] });
    expect(other.getBuffer()).toBe(editor.getBuffer());
    const formatter = jasmine.createSpy("formatter").and.returnValue([]);
    register("consumeCodeFormatOnSave", { formatOnSave: formatter });
    lumine.config.set("code-format.formatOnSave", true);
    await other.save();
    expect(formatter).toHaveBeenCalledTimes(1);
  });

  it("cancels the previous operation when a newer request owns the buffer", async () => {
    const completion = deferred();
    let request,
      calls = 0;
    register("consumeCodeFormatFile", {
      formatEntireFile: (_editor, value) => {
        calls++;
        if (calls === 1) {
          request = value;
          return completion.promise;
        }
        return replacement("new operation\n");
      },
    });
    const first = main.manager.formatEditor(editor);
    await until(() => request !== undefined);
    expect(await main.manager.formatEditor(editor)).toBe(true);
    expect(await first).toBeNull();
    expect(request.signal.aborted).toBe(true);
    completion.resolve(replacement("old operation\n"));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(editor.getText()).toBe("new operation\n");
  });

  it("does not report a missing formatter when typing cancels a command", async () => {
    const completion = deferred();
    let request;
    register("consumeCodeFormatFile", {
      formatEntireFile: (_editor, value) => {
        request = value;
        return completion.promise;
      },
    });
    const warning = spyOn(lumine.notifications, "addWarning");
    const pending = main.manager.formatCommand({ target: lumine.views.getView(editor) });
    await until(() => request !== undefined);
    editor.setText("user's newer text\n");
    expect(await pending).toBeNull();
    completion.resolve([]);
    expect(warning).not.toHaveBeenCalled();
  });

  for (const change of [
    "source",
    "path",
    "selection",
    "reverse",
    "deactivate",
    "provider",
    "destroy",
  ]) {
    it(`rejects ordinary edit arrays after ${change} changes`, async () => {
      editor.setSelectedBufferRange(new Range([0, 0], [0, 3]));
      const completion = deferred();
      let request;
      const registration = register("consumeCodeFormatFile", {
        formatEntireFile: (_editor, value) => {
          request = value;
          return completion.promise;
        },
      });
      const edits = replacement("stale edits\n");
      const pending = main.manager.formatEditor(editor, { range: editor.getBuffer().getRange() });
      await until(() => request !== undefined);
      if (change === "source") editor.setText("user's later text\n");
      if (change === "path") editor.getBuffer().setPath(path.join(tempDir, "renamed.txt"));
      if (change === "selection") editor.setCursorBufferPosition([0, 1]);
      if (change === "reverse")
        editor.getSelections()[0].setBufferRange(new Range([0, 0], [0, 3]), { reversed: true });
      if (change === "deactivate") await lumine.packages.deactivatePackage("code-format");
      if (change === "provider") registration.dispose();
      if (change === "destroy") editor.destroy();
      expect(request.isCurrent()).toBe(false);
      expect(request.text).toBe("aaa bbb ccc\n");
      completion.resolve(edits);
      if (change === "provider") expect(await pending).toBe(false);
      else expect(await pending).toBeNull();
      if (change !== "destroy")
        expect(editor.getText()).toBe(
          change === "source" ? "user's later text\n" : "aaa bbb ccc\n",
        );
    });
  }

  it("formats every selection against the original source as one undo step", async () => {
    editor.setSelectedBufferRanges([new Range([0, 0], [0, 3]), new Range([0, 8], [0, 11])]);
    const requests = [];
    register("consumeCodeFormatRange", {
      formatCode: (_editor, range, request) => {
        requests.push(request);
        return [{ oldRange: range, newText: editor.getTextInBufferRange(range).toUpperCase() }];
      },
    });
    expect(await main.manager.formatEditor(editor)).toBe(true);
    expect(requests.length).toBe(2);
    expect(requests.every((request) => request.text === "aaa bbb ccc\n")).toBe(true);
    expect(editor.getText()).toBe("AAA bbb CCC\n");
    editor.undo();
    expect(editor.getText()).toBe("aaa bbb ccc\n");
    expect(editor.getBuffer().undo()).toBe(false);
  });

  it("applies a complete multi-range plan once", async () => {
    editor.setSelectedBufferRanges([new Range([0, 0], [0, 3]), new Range([0, 8], [0, 11])]);
    const formatter = jasmine.createSpy("plan").and.callFake((_editor, _range, request) => {
      expect(request.ranges.length).toBe(2);
      const text = "AAA bbb CCC\n";
      return {
        text,
        edits: editor.getBuffer().getChangesToText(text),
        isCurrent: request.isCurrent,
      };
    });
    register("consumeCodeFormatRange", { formatCode: formatter });
    expect(await main.manager.formatEditor(editor)).toBe(true);
    expect(formatter).toHaveBeenCalledTimes(1);
    expect(editor.getText()).toBe("AAA bbb CCC\n");
  });

  it("deduplicates identical expansion edits and rejects differing overlaps atomically", async () => {
    editor.setSelectedBufferRanges([new Range([0, 0], [0, 3]), new Range([0, 8], [0, 11])]);
    const range = new Range([0, 0], [0, 11]);
    let conflict = false,
      calls = 0;
    register("consumeCodeFormatRange", {
      formatCode: () => {
        calls++;
        return [
          { oldRange: range, newText: conflict && calls % 2 === 0 ? "different" : "combined" },
        ];
      },
    });
    expect(await main.manager.formatEditor(editor)).toBe(true);
    expect(editor.getText()).toBe("combined\n");
    editor.undo();
    conflict = true;
    expect(await main.manager.formatEditor(editor)).toBe(false);
    expect(editor.getText()).toBe("aaa bbb ccc\n");
  });
});
