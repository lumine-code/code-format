describe("Code Format runtime ownership", () => {
  let main, editor, hub, consumers, providers, bars, StatusBarView, cleanups;
  const statusTiles = (bar) =>
    bar.getLeftTiles().filter((tile) => tile.getItem().matches?.(".code-format-save-status"));
  beforeEach(async () => {
    jasmine.useRealClock();
    jasmine.attachToDOM(lumine.workspace.getElement());
    await lumine.packages.activatePackage("status-bar");
    StatusBarView = lumine.packages.getActivePackage("status-bar").mainModule.statusBar.constructor;
    main = (await lumine.packages.activatePackage("code-format")).mainModule;
    hub = new lumine.packages.serviceHub.constructor();
    consumers = [];
    providers = [];
    bars = [];
    cleanups = [];
    editor = await lumine.workspace.open();
    editor.setText("original");
  });
  afterEach(async () => {
    cleanups.forEach((cleanup) => cleanup());
    consumers.forEach((consumer) => consumer.dispose());
    providers.forEach((provider) => provider.dispose());
    await lumine.packages.deactivatePackage("code-format");
    editor.destroy();
    bars.forEach((bar) => bar.destroy());
  });
  function provide(service, value) {
    const provider = hub.provide(service, "1.0.0", value);
    providers.push(provider);
    return provider;
  }
  function consume(service, method) {
    consumers.push(hub.consume(service, "^1.0.0", (value) => main[method](value)));
  }
  function bar() {
    const value = new StatusBarView();
    bars.push(value);
    jasmine.attachToDOM(value.element);
    return value;
  }
  function provider(method) {
    return {
      packageName: "owned-format",
      grammarScopes: [editor.getGrammar().scopeName],
      formatEntireFile: method,
    };
  }

  it("keeps each exact status payload's tiles until its final lease ends", () => {
    lumine.config.set("code-format.showInStatusBar", true);
    consume("status-bar", "consumeStatusBar");
    const a = bar(),
      b = bar();
    const firstA = provide("status-bar", a),
      secondA = provide("status-bar", a),
      edgeB = provide("status-bar", b);
    expect(statusTiles(a).length).toBe(1);
    expect(statusTiles(b).length).toBe(1);
    firstA.dispose();
    expect(statusTiles(a).length).toBe(1);
    edgeB.dispose();
    expect(statusTiles(a).length).toBe(1);
    secondA.dispose();
    expect(statusTiles(a).length).toBe(0);
  });

  it("does not rebuild a retired status view from a copied config callback", () => {
    lumine.config.set("code-format.showInStatusBar", false);
    const earlier = lumine.config.onDidChange("code-format.showInStatusBar", () =>
      main.deactivate(),
    );
    cleanups.push(() => earlier.dispose());
    const tooltips = spyOn(lumine.tooltips, "addComposite").and.callThrough();
    cleanups.push(() => tooltips.calls.all().forEach((call) => call.returnValue?.dispose()));
    const value = bar();
    const lease = main.consumeStatusBar(value);
    cleanups.push(() => lease.dispose());

    lumine.config.set("code-format.showInStatusBar", true);

    expect(statusTiles(value).length).toBe(0);
  });

  it("does not rebuild a retired status view from copied observed-file callbacks", () => {
    const observedFiles = require("../lib/observed-files");
    lumine.config.set("code-format.showInStatusBar", true);
    const earlier = observedFiles.onDidChange(() => main.deactivate());
    cleanups.push(() => earlier.dispose());
    const tooltips = spyOn(lumine.tooltips, "addComposite").and.callThrough();
    cleanups.push(() => tooltips.calls.all().forEach((call) => call.returnValue?.dispose()));
    const value = bar();
    const lease = main.consumeStatusBar(value);
    cleanups.push(() => lease.dispose());
    observedFiles.setObserved(__filename, true);
    expect(statusTiles(value).length).toBe(0);
  });

  it("retires status resources returned after deactivation during real tile allocation", () => {
    lumine.config.set("code-format.showInStatusBar", true);
    const value = bar();
    const add = value.addLeftTile.bind(value);
    spyOn(value, "addLeftTile").and.callFake((options) => {
      const tile = add(options);
      main.deactivate();
      return tile;
    });
    const lease = main.consumeStatusBar(value);
    cleanups.push(() => lease.dispose());
    expect(statusTiles(value).length).toBe(0);
  });

  it("counts the outer lease before an inner same-payload lease ends during allocation", () => {
    lumine.config.set("code-format.showInStatusBar", true);
    const value = bar();
    const add = value.addLeftTile.bind(value);
    let nested = false;
    spyOn(value, "addLeftTile").and.callFake((options) => {
      const tile = add(options);
      if (!nested) {
        nested = true;
        main.consumeStatusBar(value).dispose();
      }
      return tile;
    });
    const lease = main.consumeStatusBar(value);
    cleanups.push(() => lease.dispose());
    expect(statusTiles(value).length).toBe(1);
    lease.dispose();
    expect(statusTiles(value).length).toBe(0);
  });

  for (const restore of [false, true]) {
    it(`follows a synchronous status config change during allocation (restore=${restore})`, () => {
      lumine.config.set("code-format.showInStatusBar", true);
      const value = bar();
      const add = value.addLeftTile.bind(value);
      let changed = false;
      spyOn(value, "addLeftTile").and.callFake((options) => {
        const tile = add(options);
        if (!changed) {
          changed = true;
          lumine.config.set("code-format.showInStatusBar", false);
          if (restore) lumine.config.set("code-format.showInStatusBar", true);
        }
        return tile;
      });
      const lease = main.consumeStatusBar(value);
      cleanups.push(() => lease.dispose());
      expect(statusTiles(value).length).toBe(restore ? 1 : 0);
      if (restore) expect(statusTiles(value)[0].getItem().isConnected).toBe(true);
      lease.dispose();
      expect(statusTiles(value).length).toBe(0);
    });
  }

  it("discards a withdrawn formatter's late failure in the actual format command", async () => {
    let reject;
    const held = new Promise((_resolve, fail) => {
      reject = fail;
    });
    const format = jasmine.createSpy("format").and.returnValue(held);
    consume("code-format.file", "consumeCodeFormatFile");
    const edge = provide("code-format.file", provider(format));
    const command = spyOn(main.manager, "formatCommand").and.callThrough();
    const errors = spyOn(lumine.notifications, "addError");
    const warnings = spyOn(lumine.notifications, "addWarning");
    lumine.commands.dispatch(editor.element, "code-format:format-code");
    await conditionPromise(() => format.calls.count() === 1);
    edge.dispose();
    reject(new Error("Retired formatter failure"));
    await command.calls.mostRecent().returnValue;
    expect(errors).not.toHaveBeenCalled();
    expect(warnings).not.toHaveBeenCalled();
    expect(editor.getText()).toBe("original");
  });

  it("does not call eligibility returned after its registration was retired", async () => {
    consume("code-format.file", "consumeCodeFormatFile");
    const eligibility = jasmine.createSpy("eligibility").and.returnValue(true);
    const value = provider(() => []);
    let edge;
    Object.defineProperty(value, "canFormat", {
      get() {
        edge.dispose();
        return eligibility;
      },
    });
    edge = provide("code-format.file", value);
    await main.manager.formatEditor(editor);
    expect(eligibility).not.toHaveBeenCalled();
  });

  for (const duringRemaining of [false, true]) {
    it(`does not call a range method returned after withdrawal (remaining=${duringRemaining})`, async () => {
      consume("code-format.range", "consumeCodeFormatRange");
      editor.setSelectedBufferRanges(
        duringRemaining
          ? [
              [
                [0, 0],
                [0, 2],
              ],
              [
                [0, 3],
                [0, 5],
              ],
            ]
          : [
              [
                [0, 0],
                [0, 2],
              ],
            ],
      );
      const format = jasmine.createSpy("format range").and.returnValue([]);
      const value = { packageName: "owned-range", grammarScopes: [editor.getGrammar().scopeName] };
      let edge,
        armed = false,
        calls = 0;
      Object.defineProperty(value, "formatCode", {
        get() {
          if (armed && ++calls === (duringRemaining ? 2 : 1)) edge.dispose();
          return format;
        },
      });
      edge = provide("code-format.range", value);
      armed = true;
      await main.manager.formatEditor(editor);
      expect(format.calls.count()).toBe(duringRemaining ? 1 : 0);
    });
  }

  it("does not register buffer hooks from a copied retired editor observer", async () => {
    editor.destroy();
    await lumine.packages.deactivatePackage("code-format");
    let manager, onWillSave;
    const earlier = lumine.workspace.observeTextEditors((added) => {
      if (manager) {
        onWillSave = spyOn(added.getBuffer(), "onWillSave").and.callThrough();
        manager.dispose();
      }
    });
    cleanups.push(() => earlier.dispose());
    main = (await lumine.packages.activatePackage("code-format")).mainModule;
    manager = main.manager;
    editor = await lumine.workspace.open();
    expect(manager.watchedBuffers.size).toBe(0);
    expect(onWillSave).not.toHaveBeenCalled();
  });
});
