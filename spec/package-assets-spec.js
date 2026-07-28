const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
const exists = (rel) => fs.existsSync(path.join(root, rel));

// Guards for the pulsar-code-format -> code-format rebrand and modernization.
// The command prefix, config namespace, and package name all move to
// `code-format`; the TypeScript build, the dedent dependency, and the empty
// stylesheet are gone.
describe("code-format package assets", () => {
  it("ships the keymap and menu as JSON under the code-format name", () => {
    expect(exists("keymaps/code-format.json")).toBe(true);
    expect(exists("menus/code-format.json")).toBe(true);
    expect(exists("keymaps/pulsar-code-format.json")).toBe(false);
    expect(exists("menus/pulsar-code-format.json")).toBe(false);

    // The pure cmd/ctrl platform split collapses into one cmdorctrl binding.
    const keymap = JSON.parse(read("keymaps/code-format.json"));
    expect(keymap["atom-text-editor:not([mini])"]["cmdorctrl-alt-b"]).toBe(
      "code-format:format-code",
    );

    const menu = JSON.parse(read("menus/code-format.json"));
    const flat = JSON.stringify(menu);
    expect(flat).toContain("Format Code");
    expect(flat).toContain("code-format:format-code");
    expect(flat).not.toContain("pulsar-code-format");
  });

  it("is named `code-format` and points at lumine-code", () => {
    const pkg = JSON.parse(read("package.json"));
    expect(pkg.name).toBe("code-format");
    expect(pkg.author).toBe("lumine-code");
    expect(pkg.repository).toBe("https://github.com/lumine-code/code-format");
    expect(pkg.bugs.url).toBe("https://github.com/lumine-code/code-format/issues");
    expect(pkg.main).toBe("./lib/main");
    expect(pkg.description).toBe("Format code on demand or on save using registered providers.");
    expect(read("README.md").split(/\r?\n/)[2]).toBe(pkg.description);
  });

  it("consumes the four code-format services at ^1.0.0", () => {
    const pkg = JSON.parse(read("package.json"));
    expect(pkg.consumedServices["code-format.range"].versions["^1.0.0"]).toBe(
      "consumeCodeFormatRange",
    );
    expect(pkg.consumedServices["code-format.file"].versions["^1.0.0"]).toBe(
      "consumeCodeFormatFile",
    );
    expect(pkg.consumedServices["code-format.on-type"].versions["^1.0.0"]).toBe(
      "consumeCodeFormatOnType",
    );
    expect(pkg.consumedServices["code-format.on-save"].versions["^1.0.0"]).toBe(
      "consumeCodeFormatOnSave",
    );
    expect(pkg.providedServices).toBeUndefined();
  });

  it("keeps its settings in the code-format namespace without order keys", () => {
    const pkg = JSON.parse(read("package.json"));
    const schema = pkg.configSchema;
    expect(schema.formatOnSave.type).toBe("boolean");
    expect(schema.formatOnSave.default).toBe(false);
    expect(schema.formatOnType.type).toBe("boolean");
    expect(schema.formatOnType.default).toBe(false);
    expect(schema.useAllProviders.type).toBe("boolean");
    expect(schema.useAllProviders.default).toBe(false);
    for (const entry of Object.values(schema)) {
      expect(entry.order).toBeUndefined();
    }
  });

  it("has no runtime dependencies and no upstream leftovers in lib", () => {
    const pkg = JSON.parse(read("package.json"));
    expect(pkg.dependencies).toBeUndefined();
    expect(exists("tsconfig.json")).toBe(false);
    expect(exists("dist")).toBe(false);
    expect(exists("styles")).toBe(false);
    const libDir = path.join(root, "lib");
    for (const file of fs.readdirSync(libDir)) {
      expect(file.endsWith(".js")).toBe(true);
      const src = fs.readFileSync(path.join(libDir, file), "utf8");
      expect(src).not.toContain("pulsar-code-format");
      expect(src).not.toContain("dedent");
      expect(src).not.toContain("atom-ide-base");
    }
  });
});
