const { Disposable } = require("atom");

// Holds the providers of one code-format service. `grammarScopes` may be a
// live getter on the provider, so it is read through on every query and never
// snapshotted here.
module.exports = class ProviderRegistry {
  constructor() {
    this.providers = [];
  }

  addProvider(provider) {
    this.providers.push(provider);
    return new Disposable(() => this.removeProvider(provider));
  }

  removeProvider(provider) {
    const index = this.providers.indexOf(provider);
    if (index !== -1) this.providers.splice(index, 1);
  }

  // Providers that support the editor's grammar, highest priority first.
  providersForEditor(editor) {
    const scopeName = editor.getGrammar()?.scopeName;
    return this.providers
      .filter((provider) => provider.grammarScopes?.includes(scopeName))
      .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
  }

  // The providers the user's settings select: all of them acting as a
  // pipeline when `useAllProviders` is set, otherwise only the best one.
  configuredProvidersForEditor(editor) {
    const providers = this.providersForEditor(editor);
    if (providers.length === 0) return [];
    return atom.config.get("code-format.useAllProviders") ? providers : [providers[0]];
  }
};
