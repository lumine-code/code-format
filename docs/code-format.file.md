# code-format.file

Formats a whole buffer and returns a result for the hub to apply.

|             |                                                             |
| ----------- | ----------------------------------------------------------- |
| Version     | `1.0.0`                                                     |
| Provided by | `provideCodeFormatFile()` returning one provider            |
| Consumed by | `consumeCodeFormatFile(provider)` returning a `Disposable`  |
| Owner       | [`code-format`](https://github.com/lumine-code/code-format) |

## Registration

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
  formatEntireFile(
    editor: TextEditor,
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

`formatEntireFile` is required; a registration without it is ignored with a console warning. See [formatting requests](format-requests.md) for eligibility, selection, cancellation and the distinction between declining and returning no changes. File and range services share that policy.

A complete result may be a validated [formatting plan](format-plans.md). Ordinary edits use original buffer coordinates and contain `{ oldRange, newText }`. Never mutate the editor from a provider.

## Minimal example

```js
module.exports = {
  provideCodeFormatFile() {
    return {
      packageName: "my-formatter",
      grammarScopes: ["source.mylang"],
      async formatEntireFile(editor, request) {
        const text = await runFormatter(request.text, {
          tabSize: editor.getTabLength(),
          insertSpaces: editor.getSoftTabs(),
          signal: request.signal,
        });
        if (!request.isCurrent()) return null;
        if (text === request.text) return [];
        return [{ oldRange: editor.getBuffer().getRange(), newText: text }];
      },
    };
  },
};
```

## Behavior

An unselected editor is a whole-file request. File candidates are preferred; range candidates are tried only when no file candidate handles the request. The hub validates edit coordinates and overlaps before applying one transaction. One undo restores the original text.

## Teardown

The consumer returns a `Disposable` that removes this registration and invalidates its pending results.

## Versioning

`1.0.0` provided, `^1.0.0` consumed. The preproduction contract includes the final request argument and an explicit declined result.
