# code-format.range

Formats selected ranges with their full source context and returns a result.

|             |                                                             |
| ----------- | ----------------------------------------------------------- |
| Version     | `1.0.0`                                                     |
| Provided by | `provideCodeFormatRange()` returning one provider           |
| Consumed by | `consumeCodeFormatRange(provider)` returning a `Disposable` |
| Owner       | [`code-format`](https://github.com/lumine-code/code-format) |

## Registration

```json
{
  "providedServices": {
    "code-format.range": {
      "versions": { "1.0.0": "provideCodeFormatRange" }
    }
  }
}
```

## Contract

```ts
type TextEdit = { oldRange: Range; newText: string };
type RangeFormatProvider = {
  formatCode(
    editor: TextEditor,
    range: Range,
    request: FormatRequest,
  ):
    | Promise<TextEdit[] | FullTextFormatPlan | null | undefined>
    | TextEdit[]
    | FullTextFormatPlan
    | null
    | undefined;
  grammarScopes?: string[];
  canFormat?(editor: TextEditor, request: FormatRequest): boolean | Promise<boolean>;
  priority?: number;
  packageName?: string;
};
```

`formatCode` is required; a registration without it is ignored with a console warning. See [formatting requests](format-requests.md) for eligibility, selection and cancellation. A formatter can decline with `null` or `undefined`; `[]` means it handled the request without changing this range.

The `range` is expressed in original buffer coordinates. Use `request.text` for full syntax context. A formatter may expand to enclosing syntax where needed, but it must not interpret an arbitrary selection as a standalone complete document.

## Minimal example

```js
module.exports = {
  provideCodeFormatRange() {
    return {
      packageName: "my-formatter",
      grammarScopes: ["source.mylang"],
      async formatCode(editor, range, request) {
        const edits = await formatRangeInDocument(request.text, range, {
          tabSize: editor.getTabLength(),
          insertSpaces: editor.getSoftTabs(),
          signal: request.signal,
        });
        return request.isCurrent() ? edits : null;
      },
    };
  },
};
```

## Behavior

When several ranges are selected, a provider returning edit arrays is invoked for each range against the same original snapshot. Answers are collected before applying; identical expansion edits are deduplicated and conflicting overlaps are rejected atomically. No intermediate edit can shift a later request's coordinates.

A provider may instead return a [complete formatting plan](format-plans.md) on the first invocation. That plan accounts for every range in `request.ranges`; the hub applies it once and does not invoke the provider again for the remaining ranges. Both result forms land as one undo step.

When nothing is selected, a range provider may receive the full buffer range as a fallback after file providers decline.

## Teardown

The consumer returns a `Disposable` that removes this registration and invalidates its pending results.

## Versioning

`1.0.0` provided, `^1.0.0` consumed. The preproduction contract includes request snapshots, complete range plans and explicit decline semantics.
