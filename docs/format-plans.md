# Complete formatting plans

File, range and on-save providers may return a validated complete document.

```ts
type FullTextFormatPlan = {
  text: string;
  edits: TextEdit[];
  isCurrent(): boolean;
};
```

A plan contains its target text and changes in original UTF-16 buffer coordinates. Use it when the provider has validated a complete target document, restored protected source or combined several selected ranges. `isCurrent` is a read-only callback; it must never edit the buffer. It may use the [request's guard](format-requests.md) plus any tool-specific ownership, projection or cancellation checks.

The hub validates non-overlapping, in-bounds ranges, rejects boundaries inside surrogate pairs and reconstructs the target from the edits and current source. That reconstruction must equal `text`. Coordinates for selection translation are derived from the edits; optional `newRange` metadata is not trusted.

A current plan applies its complete text once in one editor transaction, translating multiple selections and preserving their direction. An identical target succeeds without making an edit. Source revision, path, selections, provider registration, lifecycle and cancellation are checked again immediately before application. A rejected plan changes nothing.

For range requests, the first plan handles every selection in `request.ranges`; the provider is not called separately for the remaining selections. Array answers are aggregated and validated before a single transaction. On-type providers return arrays only.
