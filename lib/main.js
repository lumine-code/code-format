const CodeFormatManager = require("./code-format-manager");

module.exports = {
  activate() {
    this.manager = new CodeFormatManager();
  },

  deactivate() {
    this.manager?.dispose();
    this.manager = null;
  },

  consumeCodeFormatRange(provider) {
    return this.manager.addRangeProvider(provider);
  },

  consumeCodeFormatFile(provider) {
    return this.manager.addFileProvider(provider);
  },

  consumeOnTypeProvider(provider) {
    return this.manager.addOnTypeProvider(provider);
  },

  consumeOnSaveProvider(provider) {
    return this.manager.addOnSaveProvider(provider);
  },
};
