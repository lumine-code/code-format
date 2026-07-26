const fs = require("fs");
const os = require("os");
const path = require("path");

const packageRoot = path.join(__dirname, "..");
const { SAVE_TIMEOUT } = require("../lib/code-format-manager");

// Polls a real-clock condition; requires jasmine.useRealClock().
async function until(predicate, description = "condition", timeout = 8000) {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeout) {
      throw new Error(`Timed out waiting for ${description}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe("code-format", () => {
  let mainModule;
  let tempDir;
  let filePath;
  let editor;
  let disposables;

  beforeEach(async () => {
    jasmine.useRealClock();
    jasmine.attachToDOM(atom.views.getView(atom.workspace));
    atom.notifications.clear();

    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "code-format-spec-"));
    filePath = path.join(tempDir, "sample.txt");
    fs.writeFileSync(filePath, "abc\n");

    const pack = await atom.packages.activatePackage(packageRoot);
    mainModule = pack.mainModule;
    editor = await atom.workspace.open(filePath);
    disposables = [];
  });

  afterEach(async () => {
    for (const disposable of disposables) disposable.dispose();
    await atom.packages.deactivatePackage("code-format");
    for (const item of atom.workspace.getTextEditors()) item.destroy();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  const scopeName = () => editor.getGrammar().scopeName;
  const dispatch = (command) => atom.commands.dispatch(atom.views.getView(editor), command);

  function addProvider(consume, overrides = {}) {
    const provider = {
      priority: 1,
      packageName: "code-format-spec",
      get grammarScopes() {
        return [scopeName()];
      },
      ...overrides,
    };
    disposables.push(mainModule[consume](provider));
    return provider;
  }

  describe("the format-code command", () => {
    it("applies file-provider edits bottom-up as a single undo step", async () => {
      // The first edit changes the line length; only a bottom-up application
      // inside one transaction leaves both target ranges valid.
      addProvider("consumeFileProvider", {
        formatEntireFile: () =>
          Promise.resolve([
            {
              oldRange: [
                [0, 0],
                [0, 1],
              ],
              newText: "XY",
            },
            {
              oldRange: [
                [0, 2],
                [0, 3],
              ],
              newText: "Z",
            },
          ]),
      });
      await dispatch("code-format:format-code");
      expect(editor.getText()).toBe("XYbZ\n");
      editor.undo();
      expect(editor.getText()).toBe("abc\n");
    });

    it("formats only the selection through a range provider", async () => {
      editor.setText("aaa bbb ccc\n");
      let receivedRange = null;
      addProvider("consumeRangeProvider", {
        formatCode: (item, range) => {
          receivedRange = range.copy();
          return Promise.resolve([
            {
              oldRange: [range.start, range.end],
              newText: item.getTextInBufferRange(range).toUpperCase(),
            },
          ]);
        },
      });
      editor.setSelectedBufferRange([
        [0, 4],
        [0, 7],
      ]);
      await dispatch("code-format:format-code");
      expect(
        receivedRange.isEqual([
          [0, 4],
          [0, 7],
        ]),
      ).toBe(true);
      expect(editor.getText()).toBe("aaa BBB ccc\n");
    });

    it("runs only the highest-priority provider by default", async () => {
      const low = jasmine.createSpy("low").and.resolveTo([]);
      const high = jasmine.createSpy("high").and.resolveTo([
        {
          oldRange: [
            [0, 0],
            [0, 3],
          ],
          newText: "def",
        },
      ]);
      addProvider("consumeFileProvider", { priority: 1, formatEntireFile: low });
      addProvider("consumeFileProvider", { priority: 2, formatEntireFile: high });
      await dispatch("code-format:format-code");
      expect(high).toHaveBeenCalled();
      expect(low).not.toHaveBeenCalled();
      expect(editor.getText()).toBe("def\n");
    });

    it("discards stale edits and retries once when the buffer changes mid-format", async () => {
      let calls = 0;
      const resolvers = [];
      addProvider("consumeFileProvider", {
        formatEntireFile: () => {
          calls++;
          return new Promise((resolve) => resolvers.push(resolve));
        },
      });
      const dispatched = dispatch("code-format:format-code");
      await until(() => resolvers.length === 1, "first provider call");

      // The buffer changes while the provider is pending, so its edits are
      // stale and the manager asks once more.
      editor.getBuffer().append("zzz");
      resolvers[0]([
        {
          oldRange: [
            [0, 0],
            [0, 3],
          ],
          newText: "def",
        },
      ]);
      await until(() => resolvers.length === 2, "retry provider call");

      // The retry goes stale too; this time the edits are dropped for good.
      editor.getBuffer().append("qqq");
      resolvers[1]([
        {
          oldRange: [
            [0, 0],
            [0, 3],
          ],
          newText: "def",
        },
      ]);
      await dispatched;
      expect(calls).toBe(2);
      expect(editor.getText()).not.toContain("def");
      expect(editor.getText()).toContain("zzz");
    });
  });

  describe("format on save", () => {
    it("applies on-save edits before the buffer hits the disk, per-language scoped", async () => {
      // Enabled only for this grammar; the global default stays off.
      atom.config.set("code-format.formatOnSave", true, { scopeSelector: `.${scopeName()}` });
      expect(atom.config.get("code-format.formatOnSave")).toBe(false);
      addProvider("consumeOnSaveProvider", {
        formatOnSave: () =>
          Promise.resolve([
            {
              oldRange: [
                [0, 0],
                [0, 3],
              ],
              newText: "def",
            },
          ]),
      });
      await editor.save();
      expect(editor.getText()).toBe("def\n");
      expect(fs.readFileSync(filePath, "utf8")).toBe("def\n");
    });

    it("lets the save proceed unformatted when the provider misses the timeout", async () => {
      atom.config.set("code-format.formatOnSave", true, { scopeSelector: `.${scopeName()}` });
      addProvider("consumeOnSaveProvider", {
        formatOnSave: () => new Promise(() => {}),
      });
      const start = Date.now();
      await editor.save();
      expect(Date.now() - start).toBeGreaterThanOrEqual(SAVE_TIMEOUT - 50);
      expect(editor.getText()).toBe("abc\n");
      expect(fs.readFileSync(filePath, "utf8")).toBe("abc\n");
    });
  });

  describe("format on type", () => {
    it("formats around the cursor after the buffer stops changing", async () => {
      atom.config.set("code-format.formatOnType", true, { scopeSelector: `.${scopeName()}` });
      const typePath = path.join(tempDir, "ontype.txt");
      fs.writeFileSync(typePath, "");
      const typeEditor = await atom.workspace.open(typePath);

      let receivedCharacter = null;
      addProvider("consumeOnTypeProvider", {
        keepCursorPosition: false,
        formatAtPosition: (item, position, character) => {
          receivedCharacter = character;
          return Promise.resolve([
            {
              oldRange: [
                [0, 0],
                [0, 1],
              ],
              newText: "A",
            },
          ]);
        },
      });

      typeEditor.insertText("a");
      await until(() => typeEditor.getText() === "A", "on-type edits applied");
      expect(receivedCharacter).toBe("a");
    });
  });
});
