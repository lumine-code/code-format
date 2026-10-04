# code-format.executor

Requests formatting through the shared hub without modifying an editor directly.

|             |                                       |
| ----------- | ------------------------------------- |
| Version     | `1.0.0`                               |
| Provided by | `provideCodeFormatExecutor()`         |
| Consumed by | `consumeCodeFormatExecutor(executor)` |
| Owner       | `code-format`                         |

## Registration

```json
{
  "consumedServices": {
    "code-format.executor": {
      "versions": { "^1.0.0": "consumeCodeFormatExecutor" }
    }
  }
}
```

## Contract

```ts
type FormatExecutor = {
  formatEditor(
    editor: TextEditor,
    options?: {
      provider?: string;
      reason?: "manual" | "save";
      range?: Range | Range[];
    },
  ): Promise<boolean | null>;
};
```

The result is `true` for a handled request, including a successful no-op, `false` when no provider handles it, and `null` after cancellation. Errors reject the promise. Report unavailable formatting only for `false`; cancelled requests stay quiet.

`provider` explicitly selects a provider's exact `packageName` and overrides the scoped preference. Without it, the user's preference applies. `range` overrides the current selections; use the buffer's full range to request the whole document. `reason: "save"` uses the bounded save path; it does not enable the save policy or write the file.

## Minimal example

```js
module.exports = {
  consumeCodeFormatExecutor(executor) {
    this.executor = executor;
    return new Disposable(() => {
      if (this.executor === executor) this.executor = null;
    });
  },
  async format(editor) {
    return this.executor?.formatEditor(editor, { provider: "my-formatter" });
  },
};
```

## Teardown

Consumption is passive and does not install or activate the hub. Dispose the service edge by clearing only the reference it owns. A retained executor from a deactivated hub returns `null`.

## Versioning

`1.0.0` provided and `^1.0.0` consumed. Update this contract and both sides together when changing it.
