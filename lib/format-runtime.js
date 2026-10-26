const { Range } = require("lumine");
const { MAX_STRING_LENGTH } = require("node:buffer").constants;

function scopedSetting(key, editor) {
  return lumine.config.get(key, { scope: editor.getRootScopeDescriptor() });
}

function copyRanges(value) {
  const ranges = Array.isArray(value) && typeof value[0]?.[0] !== "number" ? value : [value];
  return ranges.map((range) => Range.fromObject(range).copy());
}

module.exports = {
  requestedRanges(editor, { range, reason }) {
    const fullRange = editor.getBuffer().getRange();
    if (range !== undefined) return copyRanges(range);
    if (reason === "save" || reason === "type") return [fullRange.copy()];
    const selections = editor.getSelectedBufferRanges().filter((item) => !item.isEmpty());
    return selections.length > 0 ? selections.map((item) => item.copy()) : [fullRange.copy()];
  },

  async formatEditor(editor, options = {}, saveTimeout) {
    if (this.disposed || !editor || editor.isDestroyed() || editor.isReadOnly()) return null;
    if (editor.getGrammar?.() === lumine.grammars.nullGrammar) return null;
    const buffer = editor.getBuffer();
    this.watchBuffer(buffer);
    this.operations.get(buffer)?.controller.abort();
    const reason = options.reason ?? "manual";
    const ranges = this.requestedRanges(editor, { ...options, reason });
    const wholeFile = ranges.length === 1 && ranges[0].isEqual(buffer.getRange());
    const kinds = reason === "type" ? ["onType"] : wholeFile ? ["file", "range"] : ["range"];
    if (reason === "save") kinds.unshift("onSave");
    const selectedProvider =
      options.provider ?? scopedSetting("code-format.defaultProvider", editor) ?? "";
    const version = this.bufferVersions.get(buffer) ?? 0;
    const path = editor.getPath();
    const grammar = editor.getGrammar();
    const mode = buffer.getLanguageMode();
    const textSource = buffer.getTextSnapshot();
    let text;
    const readText = () => {
      if (textSource.length > MAX_STRING_LENGTH) {
        const error = new RangeError(
          "This formatter requires a single string that exceeds the JavaScript limit. Use a formatter that reads request.textSource and returns range edits.",
        );
        error.code = "ERR_FORMAT_TEXT_TOO_LARGE";
        error.length = textSource.length;
        error.limit = MAX_STRING_LENGTH;
        throw error;
      }
      return (text ??= textSource.toString());
    };
    const selections = editor.getSelections().map((selection) => ({
      range: selection.getBufferRange().copy(),
      reversed: selection.isReversed(),
    }));
    const operation = { editor, version, controller: new AbortController(), applying: false };
    this.operations.set(buffer, operation);
    const isCurrent = () =>
      !this.disposed &&
      !operation.controller.signal.aborted &&
      this.operations.get(buffer) === operation &&
      !editor.isDestroyed() &&
      !editor.isReadOnly() &&
      editor.getBuffer() === buffer &&
      editor.getPath() === path &&
      editor.getGrammar() === grammar &&
      buffer.getLanguageMode() === mode &&
      (this.bufferVersions.get(buffer) ?? 0) === version &&
      editor.getSelections().length === selections.length &&
      editor
        .getSelections()
        .every(
          (selection, index) =>
            selection.getBufferRange().isEqual(selections[index].range) &&
            selection.isReversed() === selections[index].reversed,
        );
    let timer;
    const cancelled = new Promise((resolve) => {
      operation.controller.signal.addEventListener("abort", () => resolve(null), { once: true });
    });
    if (reason === "save") timer = setTimeout(() => operation.controller.abort(), saveTimeout);
    try {
      const result = this.runCandidates(
        editor,
        {
          textSource,
          readText,
          path,
          reason,
          ranges,
          signal: operation.controller.signal,
          isCurrent,
        },
        kinds,
        selectedProvider,
        options,
        operation,
      );
      return await Promise.race([result, cancelled]);
    } finally {
      clearTimeout(timer);
      if (this.operations.get(buffer) === operation) this.operations.delete(buffer);
    }
  },

  async runCandidates(editor, context, kinds, selectedProvider, options, operation) {
    for (const kind of kinds) {
      const candidates = this.providers[kind].candidatesForEditor(editor, selectedProvider);
      for (const entry of candidates) {
        const { provider } = entry;
        const { readText, ...requestContext } = context;
        const request = Object.freeze({
          ...requestContext,
          get text() {
            return readText();
          },
          kind,
          ranges: Object.freeze(
            context.ranges.map((range) => {
              const copy = range.copy();
              Object.freeze(copy.start);
              Object.freeze(copy.end);
              return Object.freeze(copy);
            }),
          ),
          isCurrent: () => entry.active && context.isCurrent(),
        });
        if (!context.isCurrent()) return null;
        if (!entry.active) continue;
        let result;
        try {
          const canFormat = provider.canFormat;
          if (!request.isCurrent()) {
            if (!context.isCurrent()) return null;
            continue;
          }
          if (canFormat && !(await canFormat.call(provider, editor, request))) {
            if (!context.isCurrent()) return null;
            continue;
          }
          if (!request.isCurrent()) {
            if (!context.isCurrent()) return null;
            continue;
          }
          if (kind === "range") result = await this.formatRanges(provider, editor, request);
          else {
            const method =
              provider[
                kind === "onType"
                  ? "formatAtPosition"
                  : kind === "onSave"
                    ? "formatOnSave"
                    : "formatEntireFile"
              ];
            if (!request.isCurrent()) return null;
            result =
              kind === "onType"
                ? await method.call(provider, editor, options.position, options.character, request)
                : await method.call(provider, editor, request);
          }
        } catch (error) {
          if (!request.isCurrent()) return null;
          throw error;
        }
        if (!context.isCurrent()) return null;
        if (!entry.active || result == null) continue;
        if (kind === "onType" && !Array.isArray(result)) return false;
        if (!Array.isArray(result)) {
          const plan = result;
          if (typeof plan.isCurrent !== "function") return false;
          if (!plan.isCurrent()) return null;
          result = { ...plan, isCurrent: () => request.isCurrent() && plan.isCurrent() };
        }
        // All awaited work ends before this transaction; a multi-selection
        // request cannot leave partially formatted text in the editor.
        operation.applying = true;
        try {
          if (!require("./apply-edits").applyEdits(editor, result, request.isCurrent)) return false;
          const buffer = editor.getBuffer();
          const version = this.bufferVersions.get(buffer) ?? 0;
          if (version !== operation.version) this.lastFormattedRevision.set(buffer, version);
          if (kind === "onType" && provider.keepCursorPosition)
            editor.setCursorBufferPosition(options.position);
          return true;
        } finally {
          operation.applying = false;
        }
      }
    }
    return false;
  },

  async formatRanges(provider, editor, request) {
    const [first, ...remaining] = request.ranges;
    if (!first) return [];
    const format = (range) => {
      if (!request.isCurrent()) return null;
      const method = provider.formatCode;
      if (!request.isCurrent()) return null;
      return method.call(provider, editor, range.copy(), request);
    };
    const result = await format(first);
    if (!request.isCurrent() || result == null) return null;
    // A complete plan accounts for request.ranges as a whole.
    if (!Array.isArray(result)) return result;
    const rest = await Promise.all(remaining.map(format));
    if (!request.isCurrent() || rest.some((edits) => edits == null)) return null;
    if (rest.some((edits) => !Array.isArray(edits)))
      throw new Error("A complete range plan must be returned for the first range");
    return result.concat(...rest);
  },
};
