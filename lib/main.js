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

  consumeCodeFormatOnType(provider) {
    return this.manager.addOnTypeProvider(provider);
  },

  consumeCodeFormatOnSave(provider) {
    return this.manager.addOnSaveProvider(provider);
  },
};
