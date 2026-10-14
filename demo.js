// Authentic package usage. Run with lumine/script/demo.js; fixtures stay in demo/.
module.exports = {
  version: 1,
  dependencies: ["prettier"],
  viewport: { width: 1100, height: 340 },
  async before() {},
  async prepare(context) {
    const { lumine, state, fixture, open } = context;
    state.editor = await open("usage/signal.js");
    await lumine.project.setPaths([fixture("usage")]);
  },
  scenes: [
    {
      id: "scene-1",
      file: "demo.png",
      caption: "Source before formatting.",
      timeout: 60000,
      async run() {},
      ready() {
        return Boolean(
          document.querySelector("lumine-workspace")?.getBoundingClientRect().height > 0 &&
          document.body.innerText.trim().length > 0,
        );
      },
    },
    {
      id: "scene-2",
      file: "demo-2.png",
      caption: "Source after formatting.",
      timeout: 60000,
      async run(context) {
        const { lumine, state } = context;
        {
          lumine.commands.dispatch(lumine.views.getView(state.editor), "code-format:format-code");
        }
      },
      ready(context) {
        const { state } = context;
        return Boolean(state.editor.getText().includes("const samples = ["));
      },
    },
  ],
  async cleanup() {},
};
