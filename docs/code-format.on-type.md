# code-format.on-type

Reformats as the user types, when a trigger character lands.

|             |                                                              |
| ----------- | ------------------------------------------------------------ |
| Version     | `1.0.0`                                                      |
| Provided by | `provideCodeFormatOnType()` returning one provider           |
| Consumed by | `consumeCodeFormatOnType(provider)` returning a `Disposable` |
| Owner       | [`code-format`](https://github.com/lumine-code/code-format)  |

The one sibling that runs without the user asking, so it is also the one with the strictest requirements: it must be fast, it must be conservative, and it must not fight the cursor.

A language server reaches this through an [`ide-client`](https://lumine-code.github.io/docs.html#services/ide-client) adapter.

## Registration

In your `package.json`:

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
  ): Promise<TextEdit[]> | TextEdit[];
  keepCursorPosition?: boolean;
  grammarScopes?: string[];
  priority?: number;
  packageName?: string;
};
```

| Member                                          | Description                                                                       |
| ----------------------------------------------- | --------------------------------------------------------------------------------- |
| `formatAtPosition(editor, position, character)` | Required — a provider without it is **ignored with a console warning**.           |
| `keepCursorPosition`                            | Whether the cursor should be restored after the edits. `ide-client` sets `false`. |
| `grammarScopes`, `priority`, `packageName`      | As for the other three services.                                                  |

`character` is the character that triggered the reformat.

## Minimal example

```js
module.exports = {
  provideCodeFormatOnType() {
    return {
      grammarScopes: ["source.mylang"],
      keepCursorPosition: false,
      async formatAtPosition(editor, position, character) {
        if (character !== "}" && character !== ";") return [];
        return reindentEnclosingBlock(editor, position);
      },
    };
  },
};
```

## Behavior

**`character` is the last character of the change, not the first.** With bracket matching inserting a pair, the closing `}` is what the user actually typed, so keying off the last character is what makes auto-indent trigger at the right moment.

Matching providers are asked concurrently and the first non-empty result in priority order is applied. Return `[]` — cheaply, and for almost every keystroke — unless the character is one you care about.

Edits are **discarded if the buffer changed while you worked**. Typing does not stop for a formatter, so a slow provider simply has no effect rather than corrupting text it no longer describes. Keep the work under a keystroke's worth of time.

The resulting change is **deliberately not grouped with the typing that triggered it**: one undo removes the formatting and a second removes the typed text, so a user who dislikes the reformat can back it out without losing what they typed.

## Teardown

`consumeCodeFormatOnType` returns a `Disposable` that removes the provider — a no-op one if `formatAtPosition` was missing.

## Versioning

`1.0.0` provided, `^1.0.0` consumed. A change that breaks this shape gets a new service name rather than a new major version, and both sides move in the same release.
