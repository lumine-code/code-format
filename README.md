# code-format

Format code on demand or on save using registered providers.

The package is a hub: other packages register formatting providers through the `code-format` services, and this package decides when to run them — on command, while typing, or when a buffer is saved.

## Features

- **Provider based**: formatting strategies come from other packages through the `code-format` services.
- **Format command**: format the selection, or the whole file when nothing is selected.
- **Format on save**: opt-in, per language; a slow provider never delays the save by more than half a second.
- **Format on type**: opt-in reformatting around the cursor as you type.
- **Priority selection**: the highest-priority provider wins, or all act as a pipeline when the use-all-providers setting is enabled.
- **Stale-edit guard**: edits computed against a buffer that changed in the meantime are discarded and requested once more.
- **Single undo**: a format lands as one transaction, so one undo reverts it.

## Installation

To install `code-format` search for _code-format_ in the Install pane of the Lumine settings or run `lumine --install lumine-code/code-format`.

## Commands

Commands available in `atom-text-editor:not([mini])`:

- `code-format:format-code`: format the selection, or the whole file when the selection is empty,
- `code-format:list-providers`: show the formatters active in the current editor and the packages that provide them.

## Usage

Enable at most one on-save formatter per language: the `prettier` package also offers format-on-save via its own opt-in list, so avoid pointing both at the same files.

## Configuration

The `formatOnSave` and `formatOnType` settings are read per language, so they can be enabled only where wanted. For example, to format Python buffers on save while leaving every other language alone, add a scoped block to your `config.json`:

```json
".source.python": {
  "code-format": {
    "formatOnSave": true
  }
}
```

## Services

- **[code-format.range](docs/code-format.range.md)** (`^1.0.0`): consumed to format a selected range of the buffer.
- **[code-format.file](docs/code-format.file.md)** (`^1.0.0`): consumed to format the whole buffer at once.
- **[code-format.on-type](docs/code-format.on-type.md)** (`^1.0.0`): consumed to format around the cursor as you type.
- **[code-format.on-save](docs/code-format.on-save.md)** (`^1.0.0`): consumed to format the buffer when it is saved.

## Contributing

Got ideas to make this package better, found a bug, or want to help add new features? Just drop your thoughts on GitHub. Any feedback is welcome!
