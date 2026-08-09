const { Range } = require("lumine");

// Applies provider edits ({ oldRange, newText }) to the editor's buffer in a
// single transaction, sorted bottom-up so an applied edit cannot shift the
// ranges of the edits still to come. One undo reverts the whole format.
function applyEdits(editor, edits) {
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
