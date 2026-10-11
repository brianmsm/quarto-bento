# Rich computed tables

This fixture uses locally installed Quarto, R, `gt`, `gtsummary`, and Chromium.
The last dependency is optional for Quarto-Bento generally, but required for
this rich-table fallback. `qbento doctor` reports its availability; no
dependency is installed automatically.

From the repository root:

```sh
deno task qbento render examples/rich-tables/deck.qmd
```

The two tables become native image objects containing complete PNG snapshots at
2x resolution. The diagnostic explicitly identifies this static raster fallback.
Edit the CSVs or the R producers to change content; native image content edits
remain computed conflicts until restored or explicitly detached. Saved position
and size are visual state. Keep these tables on separate slides so their natural
size fits without automatic reduction.

For ordinary Quarto rendering, install the local project extension with
`deno task qbento init examples/rich-tables/deck.qmd`, then run `quarto render`
in that directory. The installer refuses to replace existing configuration.
Generated HTML and `.qbento/` artifacts are not canonical fixture source.
