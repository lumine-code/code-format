const { createRequire } = require("node:module");
const path = require("node:path");

module.exports = (pack) => createRequire(path.join(pack.path, "package.json"));
