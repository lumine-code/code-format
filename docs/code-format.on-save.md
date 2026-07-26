# code-format.on-save

Reformats a buffer as it is saved.

|             |                                                              |
| ----------- | ------------------------------------------------------------ |
| Version     | `1.0.0`                                                      |
| Provided by | `provideCodeFormatOnSave()` returning one provider           |
| Consumed by | `consumeCodeFormatOnSave(provider)` returning a `Disposable` |
| Owner       | [`code-format`](https://github.com/lumine-code/code-format)  |

Distinct from [`code-format.file`](code-format.file.md) even though both format the whole buffer: this one is invoked by the save itself, so a formatter that should run on save without also being the manual formatter provides this and not that.

A language server reaches this through an [`ide-client`](https://lumine-code.github.io/docs.html#services/ide-client) adapter.

## Registration

In your `package.json`:

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
  formatOnSave(editor: TextEditor): Promise<TextEdit[]> | TextEdit[];
  grammarScopes?: string[];
  priority?: number;
  packageName?: string;
};
```

| Member                                     | Description                                                             |
| ------------------------------------------ | ----------------------------------------------------------------------- |
| `formatOnSave(editor)`                     | Required — a provider without it is **ignored with a console warning**. |
| `grammarScopes`, `priority`, `packageName` | As for the other three services.                                        |

Return an array of `{ oldRange, newText }` edits.

## Minimal example

```js
module.exports = {
  provideCodeFormatOnSave() {
    return {
      grammarScopes: ["source.mylang"],
      async formatOnSave(editor) {
        const source = editor.getText();
        const formatted = await runFormatter(source);
        if (formatted === source) return [];
        return [{ oldRange: editor.getBuffer().getRange(), newText: formatted }];
      },
    };
  },
};
```

## Behavior

Whether formatting happens on save at all is the **user's** setting in `code-format`. Providing this service makes you available; it does not turn the behavior on.

Matching providers are asked concurrently and the first non-empty result in priority order is applied. Return `[]` when there is nothing to do — a save that rewrites nothing should leave the buffer's modified state alone.

The edits are applied before the write, so what lands on disk is the formatted text and the buffer is not left dirty afterwards. That also means a slow provider delays every save of a matching file: keep it bounded, and prefer returning `[]` quickly over blocking on a tool that may not be installed.

An error is surfaced as a dismissable notification rather than failing the save.

## Teardown

`consumeCodeFormatOnSave` returns a `Disposable` that removes the provider — a no-op one if `formatOnSave` was missing.

## Versioning

`1.0.0` provided, `^1.0.0` consumed. A change that breaks this shape gets a new service name rather than a new major version, and both sides move in the same release.
