const path = require("node:path");
const currentPackageRequire = require("./helpers/current-package-require");
const windowService = require("./helpers/window-service");

describe("format status constructor bootstrap", () => {
  let pack, registration;
  beforeEach(async () => {
    if (lumine.packages.isPackageLoaded("code-format"))
      await lumine.packages.unloadPackage("code-format");
    pack = await lumine.packages.activatePackage("code-format");
    lumine.config.set("code-format.showInStatusBar", true);
  });
  afterEach(async () => {
    registration?.dispose();
    registration = null;
    await lumine.packages.unloadPackage("code-format");
  });

  it("renders the Off tile synchronously without a separate constructor module load", () => {
    let item;
    const bar = { addLeftTile: (options) => ((item = options.item), { destroy() {} }) };
    registration = pack.mainModule.consumeStatusBar(windowService(bar));
    expect(item.textContent).toBe("Format on Save: Off");
    const filename = path.join(__dirname, "../lib/save-status.js");
    expect(Object.values(require.cache).some((entry) => entry?.filename === filename)).toBe(false);
    const Constructor = currentPackageRequire(pack)("./lib/save-status");
    expect(Constructor).toBe(pack.mainModule.SaveStatus);
    expect(pack.mainModule.statusConnections.get(bar).view.constructor).toBe(Constructor);
  });

  it("keeps the old helper path within the current package generation", async () => {
    const previous = currentPackageRequire(pack)("./lib/save-status");
    await lumine.packages.unloadPackage("code-format");
    pack = await lumine.packages.activatePackage("code-format");
    const current = currentPackageRequire(pack)("./lib/save-status");
    expect(current).not.toBe(previous);
    expect(current).toBe(pack.mainModule.SaveStatus);
  });

  it("shares the constructor when the compatibility helper is required before package activation", async () => {
    await lumine.packages.unloadPackage("code-format");
    const early = currentPackageRequire(pack)("./lib/save-status");
    pack = await lumine.packages.activatePackage("code-format");
    expect(pack.mainModule.SaveStatus).toBe(early);
    expect(currentPackageRequire(pack)("./lib/save-status")).toBe(early);
  });
});
