# Complete formatting plans

The file and on-save services accept either the existing `TextEdit[]` or a complete formatting plan:

```ts
type FullTextFormatPlan = {
  text: string;
  edits: TextEdit[];
  isCurrent(): boolean;
};
```

Use a plan when the provider has already validated a complete target document and restored any protected source. `edits` describe the changes in original UTF-16 buffer coordinates. `isCurrent` is a read-only callback that must refuse results after source, path, selections, ownership or cancellation changes; it must never edit the buffer.

The consumer independently checks non-overlapping, in-bounds ranges, rejects boundaries inside surrogate pairs and reconstructs the target from the edits and current source. That reconstruction must equal `text`. Target ranges used for selection translation are derived from the edits; optional provider `newRange` metadata is not trusted.

A current plan applies its complete text once in one editor transaction, translating multiple selections and preserving their direction. An identical target applies nothing. Revision, path, selection and lifecycle guards are checked again immediately before applying the result. A rejected plan changes nothing. Ordinary edit arrays retain their existing behavior; range and on-type providers continue returning arrays.
