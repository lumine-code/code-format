const path = require("path");
const { Emitter } = require("lumine");

// Per-session file opt-ins survive closing and reopening an editor.
const observedFiles = new Map();
const emitter = new Emitter();

const keyForPath = (filePath) => {
  const normalized = path.normalize(path.resolve(filePath));
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
};

const isObserved = (filePath) => Boolean(filePath) && observedFiles.has(keyForPath(filePath));

const getObservedFiles = () => Array.from(observedFiles.values());

const getObservedCount = () => observedFiles.size;

const setObserved = (filePath, enabled) => {
  if (!filePath) return false;

  const key = keyForPath(filePath);
  if (enabled === observedFiles.has(key)) return false;

  if (enabled) {
    observedFiles.set(key, path.resolve(filePath));
  } else {
    observedFiles.delete(key);
  }

  emitter.emit("did-change", { filePath: path.resolve(filePath), observed: enabled });
  return true;
};

const toggleObserved = (filePath) => {
  const enabled = !isObserved(filePath);
  return setObserved(filePath, enabled) ? enabled : isObserved(filePath);
};

const clearObserved = () => {
  const count = observedFiles.size;
  if (count === 0) return 0;

  observedFiles.clear();
  emitter.emit("did-change", { filePath: null, observed: false });
  return count;
};

const onDidChange = (callback) => emitter.on("did-change", callback);

module.exports = {
  isObserved,
  getObservedFiles,
  getObservedCount,
  setObserved,
  toggleObserved,
  clearObserved,
  onDidChange,
};
