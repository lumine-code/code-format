const path = require("path");
const { TextEditor } = require("lumine");

describe("format-on-save policy", () => {
  let editor, observedFiles, policy;
  beforeEach(async () => {
    const pack = await lumine.packages.activatePackage("code-format");
    observedFiles = require("../lib/observed-files");
    policy = pack.mainModule.policy;
    editor = new TextEditor({ buffer: new (require("lumine").TextBuffer)({ text: "source" }) });
    editor.getBuffer().setPath(path.resolve("project/src/index.js"));
  });
  afterEach(() => {
    observedFiles.clearObserved();
    editor.destroy();
  });
  it("uses grammar settings and observed opt-ins before glob selection", () => {
    expect(policy.shouldFormat(editor)).toBe(false);
    lumine.config.set("code-format.formatOnSave", true);
    lumine.config.set("code-format.excludedGlobs", ["*.js"]);
    expect(policy.shouldFormat(editor)).toBe(false);
    observedFiles.setObserved(editor.getPath(), true);
    expect(policy.shouldFormat(editor)).toBe(true);
    observedFiles.clearObserved();
    lumine.config.set("code-format.includedGlobs", ["index.js"]);
    expect(policy.shouldFormat(editor)).toBe(true);
    lumine.config.set("code-format.includedGlobs", ["*.ts"]);
    expect(policy.shouldFormat(editor)).toBe(false);
  });
  it("normalizes platform paths and matches slashless globs on basenames", () => {
    expect(policy.matches(["**/src/**"], "project/src/index.js")).toBe(true);
    expect(policy.matches(["index.js"], "project/src/index.js")).toBe(true);
    expect(policy.matches(["*.ts"], "project/src/index.js")).toBe(false);
  });
  it("preserves a file opt-in through close and reopen and normalizes its path", () => {
    observedFiles.setObserved(editor.getPath(), true);
    expect(
      observedFiles.isObserved(path.join(path.dirname(editor.getPath()), ".", "index.js")),
    ).toBe(true);
    const filePath = editor.getPath();
    editor.destroy();
    editor = new TextEditor({ buffer: new (require("lumine").TextBuffer)() });
    editor.getBuffer().setPath(filePath);
    expect(policy.shouldFormat(editor)).toBe(true);
  });
});
