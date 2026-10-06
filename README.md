# code-format

Format code on demand or on save using registered providers.

Providers calculate changes; this hub selects the formatter and applies its results to open editors.

## Features

- **Provider selection**: choose one formatter per language or use the first capable provider by priority.
- **Format command**: format every selection, or the whole document when nothing is selected.
- **Format on save**: opt in per language, filter paths with globs, or observe individual files for the current session.
- **Format on type**: opt in to formatting around the cursor as you type.
- **Safe results**: discard results after edits, selection changes, rename, provider removal, cancellation or editor destruction.
- **Bounded saves**: cancel formatting after half a second and prevent late results from changing the saved buffer.
- **Single undo**: apply formatting in one transaction while preserving multiple selections.
- **Save status**: show the current file's policy and an observed-file counter in the status bar.

## Installation

To install `code-format` search for it in the Install pane of the Lumine settings, or run the command `lumine --install lumine-code/code-format`.

## Commands

Commands available in `lumine-workspace`:

- `code-format:format-code`: format the selections or the whole file,
- `code-format:list-providers`: show registered providers and the preferred formatter,
- `code-format:toggle-format-on-save`: toggle format on save for the active language,
- `code-format:toggle-observed`: opt the active file into formatting on save or remove its opt-in,
- `code-format:observed-files`: show the files opted into formatting on save,
- `code-format:clear-all-observed-files`: remove every per-file opt-in.

Commands available in `.code-format-observed-files-list`:

- `code-format:open-selected-file`: open the selected observed file,
- `code-format:unobserve-selected-file`: remove the selected file's opt-in.

## Usage

Install and enable a formatting provider. Automatic selection tries capable providers in priority order. A declined request yields to the next one, while a successful result with no changes stops selection. A default formatter selects that package strictly, without silently replacing it with another engine.

Observed files are session-only opt-ins that override the hub's save switch and glob filters. Provider eligibility checks still apply. Alt-click the save-status tile to observe the current file. The observed-file counter opens the list on left click and clears it on right click.

## Configuration

Use scoped settings to select a formatter and enable formatting on save for one language:

```json
{
  ".source.js": {
    "code-format": {
      "defaultProvider": "prettier",
      "formatOnSave": true
    }
  }
}
```

## Customization

Restyle the save-status tiles from your `styles.css`:

```css
.code-format-observed-status {
  color: var(--accent-link-color);
}
```

## Services

- [`code-format.executor`](docs/code-format.executor.md): provided to request formatting through the hub with an optional explicit provider.
- [`code-format.range`](docs/code-format.range.md): consumed to format selected ranges.
- [`code-format.file`](docs/code-format.file.md): consumed to format whole buffers.
- [`code-format.on-type`](docs/code-format.on-type.md): consumed to format around the cursor while typing.
- [`code-format.on-save`](docs/code-format.on-save.md): consumed for provider-specific save operations.
- `status-bar`: consumed to show save status and the observed-file counter.
- `background-tips.provider`: provided to teach the formatting command.

## Contributing

Got ideas to make this package better, found a bug, or want to help add new features? Just drop your thoughts on GitHub. Any feedback is welcome!
