const CodeFormatManager = require("./code-format-manager");

module.exports = {
  provideBackgroundTips() {
    return {
      packageName: "code-format",
      tips: [
        "You can format the current file with any registered formatter using {{ 'code-format:format-code' | keystroke }}",
      ],
    };
  },

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
