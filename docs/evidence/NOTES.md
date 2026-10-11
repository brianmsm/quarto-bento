# Plain speaker-notes round-trip

Verified on Linux with Quarto 1.10.19, Deno 2.9.6 and the pinned Bento 1.2.6
revision `3d6f7f1fcdf2308e875345ce4f1e0ec0820c914b` (2026-10-11). This evidence
covers the core API and the executed Quarto projection. It does not claim a new
native-browser or Presenter visual acceptance run.

## Supported source and native representation

```markdown
## Results {#results}

::: {#results-notes .notes} Explain the first result. Continue on a new line.

Mention the second result. :::
```

One explicitly identified, top-level `.notes` fenced div belongs to one
explicitly identified slide. Its plain paragraphs become the native slide's
`notes` string: single line breaks stay line breaks, paragraphs are separated by
a blank line, and Unicode is retained. An empty existing notes div is supported.

The pinned upstream editor reads and writes this property with a textarea
(`slides/src/editor/panels.ts`); the Presenter uses `textContent`
(`slides/src/present.ts`). The adapter therefore emits plain text and refuses
rich Markdown, HTML, code, math, links, lists and other structure instead of
inserting HTML markup into the notes string or flattening meaningful structure.
A literal character sequence that looks like Markdown can still be typed in
Bento: the reviewed reverse patch escapes punctuation so it remains plain text.

## Save, sync and conflicts

The generated notes carry a versioned source binding at slide level. Save
retains the pending edit in `.qbento/state.json`, without touching QMD. A fresh
render with unchanged source preserves the pending native notes and visual
design.

`previewSync()` produces a separate `notes` preview inside the combined sync
plan. Its UTF-8 span covers only the existing div body, preserving the opening
fence, notes identity, closing fence, headings, other slides and the source's
CRLF/LF convention. The Studio review displays this patch under “notas de
orador” and enables Apply when notes are the only selected change. This UI
wiring is implemented; native-browser acceptance is a separate validation layer.

`applySync()` recomputes the complete approved plan and independently
revalidates the notes bounds, expected fragment and result before using the
existing durable source transaction. Sync preserves pending edits until
recomputation confirms them. Clearing notes uses an empty string and retains the
source div.

An unrelated QMD edit does not prevent a safely identified notes patch. Editing
the same notes body independently produces `SOURCE_CONFLICT`; fresh
reconciliation presents the conflict and an explicit keep-Bento choice can then
be synchronized. A stale or modified preview cannot widen the patch or overwrite
a newer source.

## Validation

`tests/notes_test.ts` exercises:

- Real Quarto projection and round-trip of Unicode, multiple paragraphs and
  CRLF, including durable save/reload, unsynced render retention, independent
  source editing, design preservation and clearing existing notes.
- Same-fragment conflict and explicit fresh reconciliation before source sync.
- Plain-text preservation when notes contain literal headings, div syntax,
  Markdown formatting, HTML-like text, URLs, quotes, math-like text and
  shortcode-like text, with knitr explicitly enabled. Source slide structure
  remains unchanged; native inline-execution syntax refuses before a source
  write.
- Refusal of rich, computed, ambiguous and unbound notes, unsupported
  whitespace, altered preview bounds and stale source snapshots.

Run the focused checks with:

```sh
deno test --allow-read --allow-write --allow-env --allow-run \
  tests/notes_test.ts tests/render_test.ts
```

## Remaining boundaries

Creating a notes div from Bento when no source binding exists is not
implemented; author the identified `.notes` div in QMD first and recalculate.
New-slide notes remain subject to the existing source-creation restriction.
Nested or multiple notes divs, extra attributes/classes, formatting, generated
notes and transforms without an exact literal plain-text proof refuse with a
diagnostic.

Execution-looking inline text such as backtick-`r` expressions is refused even
when Markdown backslashes would escape it: a real `engine: knitr` probe showed
that knitr processes the expression before Markdown escaping. This conservative
gate prevents an approved notes edit from introducing execution source.

Leading/trailing blank lines inside the **QMD container body** are allowed as
Markdown block separation. Projection does not write them away; they are not
part of the paragraph text or native notes string. Editing the notes produces an
explicitly reviewed body patch with canonical paragraph separation.

Whitespace in the **native notes value** that Markdown cannot preserve in this
bounded mapping (tabs, indentation, doubled spaces, extra blank lines or
leading/trailing line breaks) is refused instead of silently normalized. CRLF
and CR line endings in a native edit are normalized to LF in the native value
through the existing reviewed normalization receipt; the source patch retains
the QMD newline convention.
