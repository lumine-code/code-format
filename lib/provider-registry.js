const { Disposable } = require("lumine");

// A registration has its own identity: registering the same provider object
// again must not revive a request belonging to its previous registration.
module.exports = class ProviderRegistry {
  constructor() {
    this.entries = [];
  }

  addProvider(provider) {
    const entry = { provider, active: true };
    this.entries.push(entry);
    return new Disposable(() => {
      entry.active = false;
      const index = this.entries.indexOf(entry);
      if (index !== -1) this.entries.splice(index, 1);
    });
  }

  candidatesForEditor(editor, packageName = "") {
    const scopeName = editor.getGrammar()?.scopeName;
    return this.entries
      .filter(({ provider }) => {
        if (packageName && provider.packageName !== packageName) return false;
        const scopes = provider.grammarScopes;
        if (Array.isArray(scopes)) return scopes.includes(scopeName);
        return typeof provider.canFormat === "function";
      })
      .sort((a, b) => (b.provider.priority ?? 0) - (a.provider.priority ?? 0));
  }

  providersForEditor(editor) {
    return this.candidatesForEditor(editor).map(({ provider }) => provider);
  }
};
