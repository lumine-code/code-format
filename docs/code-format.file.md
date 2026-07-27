# code-format.file

Formats a whole buffer and returns the edits.

|             |                                                             |
| ----------- | ----------------------------------------------------------- |
| Version     | `1.0.0`                                                     |
| Provided by | `provideCodeFormatFile()` returning one provider            |
| Consumed by | `consumeCodeFormatFile(provider)` returning a `Disposable`  |
| Owner       | [`code-format`](https://github.com/lumine-code/code-format) |

The whole-buffer sibling of [`code-format.range`](code-format.range.md). Provide this when your formatter needs the entire file to produce correct output — most do, since imports, indentation, and line wrapping depend on context outside any selection.

A language server reaches this through an `ide-client` adapter.

## Registration

In your `package.json`:

```json
{
  "providedServices": {
    "code-format.file": {
      "versions": { "1.0.0": "provideCodeFormatFile" }
    }
  }
}
```

## Contract

```ts
type FileFormatProvider = {
  formatEntireFile(editor: TextEditor): Promise<TextEdit[]> | TextEdit[];
  grammarScopes?: string[];
  priority?: number;
  packageName?: string;
};
```

| Member                     | Description                                                             |
| -------------------------- | ----------------------------------------------------------------------- |
| `formatEntireFile(editor)` | Required — a provider without it is **ignored with a console warning**. |
| `grammarScopes`            | Scope names you serve. May be a getter, and is read on every use.       |
| `priority`                 | Higher is preferred. `ide-client` uses `2`.                             |
| `packageName`              | Identifies you in error notifications.                                  |

Return an array of `{ oldRange, newText }` edits, not the formatted text.

## Minimal example

```js
module.exports = {
  provideCodeFormatFile() {
    return {
      grammarScopes: ["source.mylang"],
      async formatEntireFile(editor) {
        const source = editor.getText();
        const formatted = await runFormatter(source, {
          tabSize: editor.getTabLength(),
          insertSpaces: editor.getSoftTabs(),
        });
        if (formatted === source) return [];
        return [{ oldRange: editor.getBuffer().getRange(), newText: formatted }];
      },
    };
  },
};
```

## Behavior

Matching providers are asked concurrently and **the first non-empty result in priority order wins**, so returning `[]` yields to another provider rather than blocking it.

Returning a single edit spanning the whole buffer is the simplest correct answer, and what a formatter that reprints the file should do. Returning fine-grained edits is better when you can: it preserves markers, folds, and the cursor far more accurately.

When both a file and a range provider match, the range service is used for a selection and this one for an unselected buffer.

The edits are applied as one change, so one undo reverts the format.

## Teardown

`consumeCodeFormatFile` returns a `Disposable` that removes the provider — a no-op one if `formatEntireFile` was missing.

## Versioning

`1.0.0` provided, `^1.0.0` consumed. A change that breaks this shape gets a new service name rather than a new major version, and both sides move in the same release.
