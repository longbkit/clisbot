# Markdown file panel example

Requires Clisbot 0.13.0 or later. Install the editor dependencies, then install this directory:

```sh
cd plugin-examples/markdown-panel
npm install
clisbot plugin install "$PWD"
```

Open a `.md` or `.markdown` file in Files. Choose **Rich Markdown — markdown-panel** in the
picker. Check **Don't ask me again** to remember the choice on this device.

The panel is a CodeMirror editor with Markdown highlighting, line numbers, undo, redo, and line
wrapping. It reads the file once with `readText`, saves 500 ms after the last edit with
`writeText`, and reports unsaved edits with `tab.setModified`. When the file changes on disk with
nothing unsaved, it reads again; with unsaved edits, or when a write rejects with
`PluginFileConflictError`, it offers **Reload** and **Overwrite**. **Open with…** in the tab menu
switches the tab back to Clisbot's Markdown panel. Native shows selectable, read-only text through
`useFileText`.

Clisbot bundles the editor dependencies into this plugin. They are loaded only on web; the native
path uses React Native primitives. DOM integration lives in `client/web.ts`.

See the [file panel reference](https://clisbot.com/docs/plugins/reference#file-panels).
