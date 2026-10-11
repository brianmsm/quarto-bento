# Plain speaker-notes round-trip

## New-notes native acceptance after integration

On Linux, the coordinator exercised the shipped Studio and pinned Bento editor
in headless Chromium. Runtime `442c38e` first demonstrated editing the actual
notes textarea, Save, browser reopen, pending recomputation, inspected insertion,
Apply without execution and final recomputation. The saved background and whole
emitted document were unchanged by source promotion; pending notes reached zero.

Runtime `61977eb` then exercised the repaired producer-identity path: notes on a
plain-QMD slide before an unlabelled R graphic, followed by creating a native
title/content slide with its own notes. Studio displayed the `qb-producer`
identity patch, `insert-slide`, `insert-notes` and source order before approval.
Each Apply left the R execution counter unchanged; Recalculate executed once.
Both promotions retained the exact saved document, including native IDs,
decorative template line, typography, figure and notes, with zero pending edits.

Independent review subsequently approved `c80e436`, which additionally rejects
producer markers crossing source scope boundaries. After integrating that fix
with lists and packaging at `eb57c6f`, a fresh reconstruction copied only the
native fixture's QMD and `.qbento/{project,state}.json`: the complete emitted
document and `docId` matched exactly, with zero pending edits. The native actions
above were not relabelled as having run on the later revision.

The integrated focused set passed **52 tests, zero failures, in 1m44s**:
notes creation/existing notes, lists, source scanning, plain QMD, agent creation,
agent operations and packaging. This is separate from the historical 430-test
full-suite receipt. Independent notes review added twelve passing probes,
including two later unlabelled R producers, changed CSV, retained geometry,
unselected pending content, stale/forged plans and state-only reconstruction.

Local receipts and source fixtures are retained under
`output/verification/authoring-eb57c6f/`; inspected native screenshots include
`output/playwright/notes-final-producer-review.png`,
`output/playwright/notes-newslide-review.png` and
`output/playwright/notes-newslide-synced.png`. This proves headless native editor
interaction and local Linux execution, not foreground OS dialogs or other
platforms.

Verified on Linux with Quarto 1.10.19, Deno 2.9.6 and the pinned Bento 1.2.6
revision `3d6f7f1fcdf2308e875345ce4f1e0ec0820c914b` (2026-10-11). This evidence
covers the core API, executed Quarto projection and native editor workflow
described below. Presenter visual acceptance remains separate.

## Supported source and native representation

```qmd
## Results {#results}

::: {#results-notes .notes}
Explain the first result.
Continue on a new line.

Mention the second result.
:::
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
orador” and enables Apply when notes are the only selected change.

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

The integrated native Chromium run used
`/tmp/qbento-notes-native-z_ta2f1d/deck.qmd`. Editing the actual notes textarea to
two paragraphs including `α = 0.05`, then save → review → apply → recalculate,
left the QMD unchanged until Apply, changed only the notes body with reviewed
Markdown escapes, and reopened the exact plain notes in the native textarea.
Durable revision 4 had no pending edits. The notes-only Apply control was
enabled; the inspected review screenshot is
`output/playwright/native-notes-review.png` (ignored local evidence).

The agent's integrated branch passed 180 tests before the other parallel slices
were combined; this is separate from the coordinator's subsequent full-suite run.

Notes creation is now supported by the bounded core workflow described below;
its native Studio acceptance is separate from the earlier existing-notes run.
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

## Creating notes without a pre-existing source container

The bounded core now accepts nonempty plain native notes on an existing slide
whose executed baseline contains no notes and whose source is unchanged. The
reviewed structural operation inserts a single top-level `.notes` div at that
slide's source boundary, using `qb-notes-` plus a deterministic 24-character
SHA-256 prefix of the native slide ID. Existing source identities cannot be
reused. Plain QMD headings acquire their stable technical identities in the
same explicit review before the insertion; source bytes stay unchanged on Save.

A newly authored slide can carry notes too. Its reviewed plan contains both the
slide insertion and notes insertion. JSON `slide.create`, including a following
`slide.patch` in the same batch, validates that same source grammar before its
single durable Save. Unsupported inline execution cannot be introduced through
this route. The API does not write QMD before the checked sync operation.

Creation differs from editing an existing bound notes body: it requires the
unchanged executed source, an empty baseline, a verified slide scope, and no
existing notes container in that scope. Ambiguous structure, stale source,
colliding identities and modified plans refuse. The inserted literal text uses
the existing punctuation escaping and whitespace rules. Existing notes edits
and their conflict behavior retain their original bounded-body patch.

`tests/notes_creation_test.ts` adds five focused checks (all passed on Linux,
29 seconds): exact Unicode/CRLF insertion and tamper/stale/collision/injection
refusal; real Quarto round trips for both explicitly identified and plain-QMD
slides; JSON new-slide creation followed by a notes patch; and atomic refusal
when QMD independently gains notes or native notes contain inline execution.
The existing-slide cases also select only notes while another semantic edit
remains pending, preserve visual placement and `docId`, and reconstruct the exact
emitted document from copied QMD and `.qbento/{project,state}.json` without HTML
or history. No native UI or other-platform acceptance is claimed by these new
core tests.

The combined focused regression run passed **38 tests, zero failures** in
**1 min 3 s**, covering `notes_creation_test.ts`, `notes_test.ts`,
`source_structure_test.ts`, `sync_structure_test.ts`, `agent_test.ts` and
`agent_create_test.ts` with `DENO_JOBS=2` and `deno test --parallel` plus read,
write, env, run and localhost-net permissions. `deno task check`, lint and format
checks for all changed TypeScript files, and `git diff --check` also passed.

### Unlabelled computed producers after a new notes insertion

Independent review reproduced an additional failure: adding notes to slide A
before an unlabelled R chunk in slide B shifted that chunk's byte offset. Its
source identity and native figure/code identities had been derived from the
old offset. Simply ignoring changed IDs would risk losing the existing design.

Reviewed identity acquisition now retains each unlabelled top-level producer's
existing identity with an explicit technical comment immediately before it,
for example `<!-- qb-producer:chunk@36 -->`. This marker belongs to the source
identity phase and is visible in the approved source diff. It does not add a
Quarto execution label or alter any executable fence/body bytes. The scanner
only accepts this dedicated marker on an unlabelled top-level executable
chunk; its origin remains computed and its source remains non-editable.
Ordinary source/native identifier syntax is not expanded.

The unchanged executed source hash is required before acquiring such an
identity. Preview and Apply independently verify the exact chunk ID, kind,
origin, raw bytes and body. Duplicate, malformed, dangling, displaced or
wrong-kind markers refuse; marker-looking strings inside code remain code.
After acquisition, native figure and `/code:1` identities remain the same
through subsequent source insertion and rebuild, so retained design continues
to address the same computed objects.

Two additional tests cover the marker guards and the real R failure case. The
latter saves notes before the unlabelled chunk, changes both figure and code
geometry, rejects a forged plan, applies the reviewed marker/notes insertion,
recomputes with zero pending edits and preserves the entire computed slide.
Copying only QMD and the two durable sidecar files into a fresh directory then
rebuilds the exact complete emitted document with the same `docId`. These two
checks passed on Linux in 14 seconds.

After the producer-identity repair, the expanded focused run passed **56 tests,
zero failures** in **1 min 24 s**. It includes the six earlier modules plus
`source_test.ts` and `plain_qmd_test.ts`, with the same permissions and two-worker
parallelism. The existing computed-producer deletion test remains unchanged and
passes: a producer inside a slide selected for deletion reaches the original
`unsafe-delete` guard instead of being acquired. Types, lint, formatting and
source diff whitespace checks passed for the repair as well.

A second independent scanner probe found that a marker inside a div could survive
its closing fence and incorrectly name a later, unrelated top-level chunk.
The scanner now rejects nested producer markers immediately and consumes any
pending marker before dispatching a following line that is not an executable
fence. The regression covers one or two closing divs, opening divs, headings,
raw HTML, include directives and non-executable code fences, checking both the
diagnostic and that the invalid marker never supplies the later chunk's ID.
The independent three-case boundary probe passed after this repair.

The final scanner-boundary repair passed **24 focused tests, zero failures** in
**43 seconds** (`notes_creation_test.ts`, `source_test.ts`, `plain_qmd_test.ts`),
including both existing/plain note round trips and the unlabelled R producer's
complete design-preserving rebuild. Type checking via these test imports, lint,
formatting and diff whitespace checks also passed.
