const { Point, Range } = require("lumine");

function extent(text) {
  let rows = 0,
    last = 0;
  const endings = /\r\n|\r|\n/g;
  while (endings.exec(text)) {
    rows++;
    last = endings.lastIndex;
  }
  return new Point(rows, text.length - last);
}

function applyPlan(editor, plan) {
  if (
    typeof plan?.text !== "string" ||
    !Array.isArray(plan.edits) ||
    typeof plan.isCurrent !== "function" ||
    editor.isDestroyed() ||
    !plan.isCurrent()
  )
    return;
  const buffer = editor.getBuffer(),
    source = buffer.getText();
  const edits = [];
  for (const edit of plan.edits) {
    if (!edit?.oldRange || typeof edit.newText !== "string") return;
    let oldRange;
    try {
      oldRange = Range.fromObject(edit.oldRange);
    } catch {
      return;
    }
    if (
      ![oldRange.start.row, oldRange.start.column, oldRange.end.row, oldRange.end.column].every(
        (value) => Number.isInteger(value) && value >= 0,
      )
    )
      return;
    edits.push({ ...edit, oldRange });
  }
  edits.sort((a, b) => a.oldRange.start.compare(b.oldRange.start));
  const pieces = [];
  let offset = 0,
    oldEnd = new Point(0, 0),
    newEnd = new Point(0, 0);
  const splitsPair = (index) =>
    index > 0 &&
    source.charCodeAt(index - 1) >= 0xd800 &&
    source.charCodeAt(index - 1) <= 0xdbff &&
    source.charCodeAt(index) >= 0xdc00 &&
    source.charCodeAt(index) <= 0xdfff;
  let previousRange;
  for (const edit of edits) {
    const range = edit.oldRange;
    if (
      typeof edit.newText !== "string" ||
      !buffer.clipPosition(range.start).isEqual(range.start) ||
      !buffer.clipPosition(range.end).isEqual(range.end)
    )
      return;
    const start = buffer.characterIndexForPosition(range.start),
      end = buffer.characterIndexForPosition(range.end);
    if (
      start < offset ||
      previousRange?.start.isEqual(range.start) ||
      splitsPair(start) ||
      splitsPair(end)
    )
      return;
    previousRange = range;
    pieces.push(source.slice(offset, start), edit.newText);
    offset = end;
    const newStart = newEnd.traverse(range.start.traversalFrom(oldEnd));
    newEnd = newStart.traverse(extent(edit.newText));
    oldEnd = range.end;
    // Derive target coordinates independently of provider metadata.
    edit.newRange = new Range(newStart, newEnd);
  }
  pieces.push(source.slice(offset));
  if (pieces.join("") !== plan.text || plan.text === source || !plan.isCurrent()) return;
  const translate = (point, affinity) => {
    let low = 0,
      high = edits.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (edits[middle].oldRange.start.compare(point) <= 0) low = middle + 1;
      else high = middle;
    }
    const change = edits[low - 1];
    if (!change) return point.copy();
    if (point.compare(change.oldRange.end) <= 0)
      return (
        affinity === "left" && !change.oldRange.isEmpty() && point.isEqual(change.oldRange.start)
          ? change.newRange.start
          : change.newRange.end
      ).copy();
    return change.newRange.end.traverse(point.traversalFrom(change.oldRange.end));
  };
  const selections = editor.getSelections().map((selection) => {
    const range = selection.getBufferRange();
    return {
      range: new Range(
        translate(range.start, range.isEmpty() ? "right" : "left"),
        translate(range.end, "right"),
      ),
      reversed: selection.isReversed(),
    };
  });
  if (!plan.isCurrent()) return;
  editor.transact(() => {
    editor.setText(plan.text);
    editor.setSelectedBufferRanges(selections.map((selection) => selection.range));
    editor
      .getSelections()
      .forEach((selection, index) =>
        selection.setBufferRange(selections[index].range, { reversed: selections[index].reversed }),
      );
  });
}

// Applies provider edits ({ oldRange, newText }) to the editor's buffer in a
// single transaction, sorted bottom-up so an applied edit cannot shift the
// ranges of the edits still to come. One undo reverts the whole format.
function applyEdits(editor, edits) {
  if (edits && !Array.isArray(edits)) return applyPlan(editor, edits);
  if (!edits || edits.length === 0) return;
  const sorted = edits
    .map((edit) => ({ oldRange: Range.fromObject(edit.oldRange), newText: edit.newText }))
    .sort((a, b) => b.oldRange.compare(a.oldRange));
  const buffer = editor.getBuffer();
  buffer.transact(() => {
    for (const edit of sorted) {
      buffer.setTextInRange(edit.oldRange, edit.newText);
    }
  });
}

module.exports = { applyEdits };
