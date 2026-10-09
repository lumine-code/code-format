# Formatting requests

Every formatter receives an immutable source snapshot and a cancellation guard.

```ts
type FormatRequest = {
  readonly text: string;
  readonly path: string | undefined;
  readonly reason: "manual" | "save" | "type";
  readonly kind: "range" | "file" | "onType" | "onSave";
  readonly ranges: readonly Range[];
  readonly signal: AbortSignal;
  isCurrent(): boolean;
};
```

Use `request.text` as the input, rather than reading the editor after asynchronous work. `path` and `ranges` describe that same snapshot. Providers compute results without changing the editor; only the hub applies them. `isCurrent()` refuses results after a source, path, grammar, selection, lifecycle, provider-registration or ownership change, or when the editor becomes read-only. `signal` also aborts when another request takes the buffer or the save deadline expires. A stale request is discarded without retrying the user's newer text.

The executor returns `true` for a handled result, `false` when no candidate handles the request and `null` when the operation is cancelled. An explicit command reports a missing formatter only for `false`; cancellation stays quiet.

A provider may declare `grammarScopes`, `canFormat(editor, request)` or both. A scopes array narrows the candidate set; an asynchronous `canFormat` then checks whether this exact path, operation and tool configuration are supported. Without scopes, `canFormat` is required. A false eligibility result declines the request without running the formatting method.

Within each service, candidates run one at a time in descending `priority`. `null` or `undefined` declines and lets the next candidate try. An edit array, including `[]`, is a successful answer and stops provider selection. An unchanged complete plan also succeeds. An exception reports a formatting failure and does not try another formatter. `packageName` identifies the provider for `code-format.defaultProvider` and executor overrides; an explicit preference selects that package strictly and never silently substitutes another one.

Whole-file requests try file providers before range providers. Saves try on-save providers first, then the ordinary whole-file path when every on-save candidate declines. A successful no-op ends that search. On-type requests use only on-type providers. Save requests have a shared 500 ms deadline for eligibility, formatting and fallback; an expired request cannot edit the buffer after the disk write proceeds. A buffer shared by split editors has one save hook.

Multi-selection requests carry every nonempty selected range. A range provider returning a complete plan handles `request.ranges` together in one call. For ordinary arrays, the hub asks each selected range against the same snapshot, gathers their answers, removes identical edits and rejects conflicting overlaps. No edits apply until the entire request is ready. One transaction and one undo cover the accepted result.
