# code-format.on-save

Provides save-specific formatting before the buffer is written to disk.

|             |                                                              |
| ----------- | ------------------------------------------------------------ |
| Version     | `1.0.0`                                                      |
| Provided by | `provideCodeFormatOnSave()` returning one provider           |
| Consumed by | `consumeCodeFormatOnSave(provider)` returning a `Disposable` |
| Owner       | [`code-format`](https://github.com/lumine-code/code-format)  |

## Registration

```json
{
  "providedServices": {
    "code-format.on-save": {
      "versions": { "1.0.0": "provideCodeFormatOnSave" }
    }
  }
}
```

## Contract

```ts
type OnSaveFormatProvider = {
  formatOnSave(
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

`formatOnSave` is required; a registration without it is ignored with a console warning. See [formatting requests](format-requests.md) for the shared provider policy and [complete plans](format-plans.md) for document results. Ordinary formatters only need a file provider: this service is for save-specific behavior such as a language server's `willSaveWaitUntil` request.

## Minimal example

```js
module.exports = {
  provideCodeFormatOnSave() {
    return {
      packageName: "my-formatter",
      grammarScopes: ["source.mylang"],
      async formatOnSave(editor, request) {
        const edits = await prepareSave(request.text, request.path, request.signal);
        return request.isCurrent() ? edits : null;
      },
    };
  },
};
```

## Behavior

Providing this service makes it available without enabling automatic formatting. The hub owns the user's save policy. Matching save candidates run in priority order until one returns a successful result; `[]` is a successful no-op. If they all decline, the hub tries ordinary whole-file formatting.

The complete save operation has a 500 ms deadline. Timeout aborts the request and lets the disk write proceed; a later response cannot change the buffer. Accepted edits apply before the write, so the disk and buffer contain the same text. An error is reported without failing the save.

## Teardown

The consumer returns a `Disposable` that removes this registration and invalidates its pending results.

## Versioning

`1.0.0` provided, `^1.0.0` consumed. The preproduction contract includes the final request argument, cancellation and explicit decline semantics.
