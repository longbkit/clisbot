# PDF file panel example

Requires Clisbot 0.13.0 or later. Install this directory with
`clisbot plugin install /absolute/path/to/plugin-examples/pdf-panel`, then open a `.pdf` in Files.

The panel resolves the file's local URL with `useFileUrl`, shows `Loading` until it does, and passes
it to `DocumentFrame`. Where a platform cannot show a PDF inline (Android), `DocumentFrame` says so.
The plugin does not construct daemon URLs.

See the [file panel reference](https://clisbot.com/docs/plugins/reference#file-panels).

Inline PDF rendering needs a daemon from Clisbot 0.13.0 or later; see the
[DocumentFrame reference](https://clisbot.com/docs/plugins/reference#documentframe).
