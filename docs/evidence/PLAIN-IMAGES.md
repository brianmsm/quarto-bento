# Plain local images and authored captions — Linux receipt

The plain QMD form `![A **rich** caption](plot.svg)` projects to a native Bento
image and a native text caption. The image and caption retain separate native
IDs and one source/group binding. `![](plot.svg)` keeps an empty native caption
so a later caption edit can be reviewed without replacing the figure. This
receipt covers the installed Quarto 1.10.19 and the repository's pinned Bento
shell on local Linux; it does not establish another platform or release scope.

The example is
[`examples/plain-images/deck.qmd`](../../examples/plain-images/deck.qmd). Run
the ordinary `qbento render` workflow, or install this single-QMD project with
`qbento install` and use `quarto render`. No environment manager, remote asset
request or additional runtime installation is introduced.

## Source and asset proof

The original Pandoc image/Figure is read independently from the executed AST.
The adapter accepts that exact Figure/plain Image in ordinary Quarto's capture,
or the concrete Quarto HTML figure wrapper containing one image and one bounded
figcaption. Original URI and caption semantics must match before any objects are
emitted. General HTML figcaptions, invented captions, removed/duplicated
figures, mismatched URI and moved acquired wrappers refuse publication. Both
projected objects carry original source proof, asset digest, role and paired
native IDs. Neither the executed AST nor an editor-selected ID can invent the
original source binding.

Authored files are read only from the source directory, including canonical
realpath containment. A generated build file with the same name cannot supply an
authored asset. Percent-encoded local URIs are decoded once for filesystem
resolution; the URI in the source/proof remains intact. Spaces, Unicode, quoted
names and literal percent escapes are covered. Absolute/remote/UNC paths,
escaped traversal and symlink escape refuse. Query/fragment semantics refuse
until a dedicated adapter can preserve them.

Both the CLI renderer and ordinary Quarto's prehook snapshot source image bytes
before execution. Projection verifies the snapshot after execution and refuses
an image modified by a chunk. A deliberate file update made before a new render
supplies fresh image bytes while retaining the design and docId. PNG/JPEG/WebP
and bounded self-contained SVG use the local image loader. The SVG check refuses
scripts, entity/doctype references, companion file hrefs, external CSS URLs,
at-rules/imports and escaped CSS dependency syntax rather than embed an SVG
whose companion styling would be lost. It retains accepted original SVG bytes;
it is not a general SVG/CSS sanitizer or full dependency bundler.

## Reviewed caption synchronization

Saving geometry/style or caption changes leaves QMD unchanged. A weak image
acquires an identified source wrapper only through the inspected source-sync
plan. The wrapper retains the original image and URI and records both native IDs
using `bento-element-id` (caption) and `bento-image-id` (image). The reviewed
binding checks caption HTML and the original asset digest separately.

An approved caption edit replaces only the original image alt/caption byte span.
Rich inline text uses the existing bounded Markdown codec. Nested brackets/code
spans, multiline CRLF and UTF-8 spans are checked. Creating or clearing a
caption preserves the image URI, pair, design and docId. An empty caption is an
empty alt span; it does not delete the source image. A URI or bracket injection
cannot escape that span. Native source replacement and individual/pair deletion
remain recoverable pending edits with explicit refusal; no implicit asset-file
rewrite or image-deletion codec is claimed.

## Current acceptance tests

`tests/plain_images_test.ts` covers Save → inspect identities/asset binding →
Apply → render, unchanged QMD on Save, a rich caption roundtrip with Unicode and
CRLF, ordinary caption creation/clearing, source-asset refresh with retained
geometry, and an exact rebuild from QMD + asset + versioned `.qbento/` without
HTML. Failure paths check AST transformation/duplication/removal, unsafe and
missing assets before R, and asset mutation during one execution in both render
routes. `tests/image_codec_test.ts` covers original/executed shape, UTF-8 source
spans, SVG dependencies and local URI decoding/containment.

The headless Linux native test loads the pinned Bento shell under the offline
policy. It verifies natural image dimensions, original data URI, `contain` fit,
visible rich caption glyph bounds and absence of a semantic placeholder for an
empty caption. Captures were inspected for the rich and empty caption. This is
native rendering plus the project Save/review APIs; it does not claim foreground
Studio click acceptance, PDF export, arbitrary inline images, image creation,
general HTML, image titles/attributes, numbered/cross-reference figures or
dynamic computed caption/path support. Those shapes require their own faithful
source and execution adapters.

To reproduce the focused native evidence:

```sh
QBENTO_PLAIN_IMAGES_EVIDENCE=/absolute/path/to/evidence \
  deno test -A tests/plain_images_test.ts --filter 'pinned native'
deno test -A tests/image_codec_test.ts tests/plain_images_test.ts
```

The lane's focused Linux run passed **11 tests, zero failures (37 s)**. A
separate regression set covering image rendering, source/inline, weak math/code
identity, plain tables and project resources passed **41 tests, zero failures
(1m58s)**. The quoted-path computed SVG regression also passed: ordinary Quarto
rendered a QMD basename containing spaces, single/double quotes and Unicode,
retained captured geometry on recompute and executed each render once. This
exercised the shared local URI resolver with `%22` in the generated figure
reference. Type checks and lint passed for the changed TypeScript. These focused
results precede the coordinator's combined full-suite run.
