const picomatch = require("picomatch");
const observedFiles = require("./observed-files");

module.exports = class SavePolicy {
  constructor() {
    this.matchers = new Map();
  }

  setting(key, editor) {
    return lumine.config.get(`code-format.${key}`, {
      scope: editor?.getRootScopeDescriptor(),
    });
  }

  matches(patterns, filePath) {
    return patterns.some((pattern) => {
      let matcher = this.matchers.get(pattern);
      if (!matcher) {
        matcher = picomatch(pattern, { dot: true, basename: !pattern.includes("/") });
        this.matchers.set(pattern, matcher);
      }
      return matcher(filePath);
    });
  }

  shouldFormat(editor) {
    const filePath = editor.getPath();
    if (!filePath) return false;
    if (observedFiles.isObserved(filePath)) return true;
    if (!this.setting("formatOnSave", editor)) return false;
    const [, relativePath] = lumine.project.relativizePath(filePath);
    const normalized = (relativePath || filePath).replaceAll("\\", "/");
    const included = this.setting("includedGlobs", editor) ?? [];
    if (included.length) return this.matches(included, normalized);
    return !this.matches(this.setting("excludedGlobs", editor) ?? [], normalized);
  }

  toggle(editor) {
    if (!editor) return;
    const scopeName = editor?.getGrammar()?.scopeName;
    lumine.config.set(
      "code-format.formatOnSave",
      !this.setting("formatOnSave", editor),
      scopeName ? { scopeSelector: `.${scopeName}` } : undefined,
    );
  }
};
