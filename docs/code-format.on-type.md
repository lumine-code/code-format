# code-format.on-type

Reformats around the cursor after a typed character settles.

|             |                                                              |
| ----------- | ------------------------------------------------------------ |
| Version     | `1.0.0`                                                      |
| Provided by | `provideCodeFormatOnType()` returning one provider           |
| Consumed by | `consumeCodeFormatOnType(provider)` returning a `Disposable` |
| Owner       | [`code-format`](https://github.com/lumine-code/code-format)  |

## Registration

```json
{
  "providedServices": {
    "code-format.on-type": {
      "versions": { "1.0.0": "provideCodeFormatOnType" }
    }
  }
}
```

## Contract

```ts
type OnTypeFormatProvider = {
  formatAtPosition(
    editor: TextEditor,
    position: Point,
    character: string,
    request: FormatRequest,
  ): Promise<TextEdit[] | null | undefined> | TextEdit[] | null | undefined;
  keepCursorPosition?: boolean;
  grammarScopes?: string[];
  canFormat?(editor: TextEditor, request: FormatRequest): boolean | Promise<boolean>;
  priority?: number;
  packageName?: string;
};
```

`formatAtPosition` is required; a registration without it is ignored with a console warning. Shared eligibility, provider selection and lifecycle guards are described in [formatting requests](format-requests.md). `keepCursorPosition` restores the original cursor after accepted edits when true.

## Minimal example

```js
module.exports = {
  provideCodeFormatOnType() {
    return {
      packageName: "my-formatter",
      grammarScopes: ["source.mylang"],
      async formatAtPosition(editor, position, character, request) {
        if (character !== "}" && character !== ";") return null;
        const edits = await reindentBlock(request.text, position);
        return request.isCurrent() ? edits : null;
      },
    };
  },
};
```

## Behavior

The trigger is the last character of an insertion. A recognized bracket pair uses its closing character. Deletions, replacements and ordinary pastes do not trigger this service. The setting is opt-in and read per language.

Return `null` or `undefined` for a trigger you do not serve, allowing another provider to try. An array, including `[]`, handles the request. Typing or moving the selection while a provider works invalidates the answer. On-type results are edit arrays, not complete formatting plans.

The formatting transaction is separate from the typed text: one undo removes formatting, another removes typing. Keep on-type work fast and conservative.

## Teardown

The consumer returns a `Disposable` that removes this registration and invalidates its pending results.

## Versioning

`1.0.0` provided, `^1.0.0` consumed. The preproduction contract includes the final request argument and explicit decline semantics.
