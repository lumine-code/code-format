# code-format.range

Formats a selected range and returns the edits.

|             |                                                             |
| ----------- | ----------------------------------------------------------- |
| Version     | `1.0.0`                                                     |
| Provided by | `provideCodeFormatRange()` returning one provider           |
| Consumed by | `consumeCodeFormatRange(provider)` returning a `Disposable` |
| Owner       | [`code-format`](https://github.com/lumine-code/code-format) |

One of four sibling services that differ only in when they are called and what they are handed: [`code-format.file`](code-format.file.md) for the whole buffer, [`code-format.on-type`](code-format.on-type.md) for a trigger character, and [`code-format.on-save`](code-format.on-save.md) for save. A package may provide any subset.

A language server reaches all four through an [`ide-client`](https://lumine-code.github.io/docs.html#services/ide-client) adapter; implement these directly only for a formatter that is not a language server.

## Registration

In your `package.json`:

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
type RangeFormatProvider = {
  formatCode(editor: TextEditor, range: Range): Promise<TextEdit[]> | TextEdit[];
  grammarScopes?: string[];
  priority?: number;
  packageName?: string;
};

type TextEdit = {
  oldRange: Range;
  newText: string;
};
```

| Member                      | Description                                                                           |
| --------------------------- | ------------------------------------------------------------------------------------- |
| `formatCode(editor, range)` | Required — a provider without it is **ignored with a console warning**, not an error. |
| `grammarScopes`             | Scope names you serve. May be a getter, and is read on every use.                     |
| `priority`                  | Higher is preferred. `ide-client` uses `2`.                                           |
| `packageName`               | Identifies you in error notifications.                                                |

Return **edits, not text**: an array of `{ oldRange, newText }`. An empty array means "nothing to change", which is different from declining.

## Minimal example

```js
module.exports = {
  provideCodeFormatRange() {
    return {
      grammarScopes: ["source.mylang"],
      priority: 1,
      async formatCode(editor, range) {
        const source = editor.getTextInBufferRange(range);
        const formatted = await runFormatter(source, {
          tabSize: editor.getTabLength(),
          insertSpaces: editor.getSoftTabs(),
        });
        if (formatted === source) return [];
        return [{ oldRange: range, newText: formatted }];
      },
    };
  },
};
```

## Behavior

When several providers match, they are all asked concurrently and **the first non-empty result in priority order is applied**. Returning `[]` therefore steps aside for a lower-priority provider rather than blocking it.

The range is the user's selection. When nothing is selected, the caller falls back to the whole buffer range, so `formatCode` should handle a full-file range too.

Respect the editor's own indentation settings — `editor.getTabLength()` and `editor.getSoftTabs()` — rather than a formatter's defaults; that is what `ide-client` passes to a server and what the user expects.

Edits are applied as a single change, so one undo reverts the whole format.

## Teardown

`consumeCodeFormatRange` returns a `Disposable` that removes the provider. A provider missing `formatCode` also gets a `Disposable` back — a no-op one — so a broken registration is silent apart from the console warning.

## Versioning

`1.0.0` provided, `^1.0.0` consumed. A change that breaks this shape gets a new service name rather than a new major version, and both sides move in the same release.
