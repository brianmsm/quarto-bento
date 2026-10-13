# Native Markdown lists — implementation evidence

## Native creation, conversion and deletion follow-up

At Studio runtime `2dbc8e2`, the coordinator used the pinned Bento editor in
headless Chromium on Linux (2026-10-13). Its actual formatting bar converted a
plain-QMD paragraph containing bold β into a bullet list. Save left QMD intact;
review showed heading/paragraph/producer identity acquisition and `convert-text`.
Apply and Recalculate retained the exact saved native document with zero pending
changes.

The native Add text control then created a separate two-item list. Its reviewed
insertion introduced one identified list container; Save and preview left source
unchanged. After Apply/recompute the complete emitted document matched the saved
one, including its new native ID and default geometry/style.

Deleting that list and saving did not change QMD. Review disabled Apply until
the element's deletion was confirmed. Before confirmation, Compare with QMD and
the explicit Restore decision recovered the same content, stacking and design;
only the document's modification timestamp differed. A second deletion, this
time confirmed and inspected, removed exactly the list container. Recalculation
left zero pending changes and preserved the second slide's source bytes exactly.
The execution counter reached six: initial render, conversion recomputation,
creation recomputation, comparison, fresh restore validation and final deletion
recomputation. Save/source synchronization added no computations in these cycles.

A fresh source/state-only relocation was then run at integrated `d0cadb6`.
QMD plus `.qbento/project.json` and `.qbento/state.json` rebuilt the exact whole
emitted document and `docId`, without the previous HTML and with zero pending
changes. The parent independently checked these equalities and inspected the
restored native canvas and confirmed-deletion review screenshots.

Artifacts are under `output/verification/list-authoring-2dbc8e2/`: original and
pre-delete QMD, saved/final/restored states, rebuilt project, rebuild log and
receipts. Screenshots include `output/playwright/list-created-review-2dbc8e2.png`,
`list-restored-2dbc8e2.png` and `list-delete-review-2dbc8e2.png`.
This native run complements the 63-test author regression and 12-test independent
review of author commit `5b324b8`. List-to-paragraph conversion and lists on newly
created slides have source/core coverage in those tests; this particular UI run
does not relabel those as manually exercised. Other platforms remain untested.

## Integrated native acceptance on Linux

The coordinator ran the shipped Studio and pinned Bento in headless Chromium
against integrated revision `eb57c6f`. The example's ordinary nested bullets,
decimal numbered list and loose items with paragraphs were visually inspected.
The native editor appended text to the final item of the first list; Save kept
QMD unchanged, and both recomputation with pending edits and browser reopen
retained the edited native structure, bold/italic text, inline code and link.

Review displayed the heading/list identity patches and the exact bounded list
replacement. Apply followed by Recalculate yielded zero pending edits and an
emitted document exactly equal to the saved native document. All source bytes
from the second slide onward, including the computed inline expression, remained
unchanged. A fresh copy containing only QMD and the two durable sidecars rebuilt
the exact whole document with the same `docId`.

Native screenshots were inspected at `output/playwright/lists-native-before.png`,
`lists-native-review.png`, `lists-native-loose.png` and
`lists-native-ordered.png`. Local source diffs, receipts and the integrated
**52-test passing** regression log are under
`output/verification/authoring-eb57c6f/`. Independent source/core list review
passed 33 tests, including atomic refusal when a filter removed an authored list
from a project containing pending edits. The native receipt covers editing
existing lists; the creation/conversion/deletion limits below remain separate.

This slice extends ordinary QMD authoring with native `ul`/`ol`/`li` text objects.
The upstream reference is Bento 1.2.6, pinned revision
`3d6f7f1fcdf2308e875345ce4f1e0ec0820c914b`. Its
`slides/src/render.ts` sanitizer permits list and paragraph tags but removes all
list attributes; `slides/src/editor/bullets.ts` commits typed bullets into native
lists. No upstream fork or sanitizer relaxation is introduced.

## Implemented contract

- Plain lists and lists in identified fenced divs project to native text objects.
  Existing supported inline formatting is retained. Nested lists and loose items
  with multiple paragraphs use native list/paragraph structure.
- Ordinary decimal ordered lists begin at 1 and use period markers. Other starts,
  alphabets, Roman numerals and delimiters refuse because the pinned native editor
  cannot retain their required attributes. Task-list checkbox semantics refuse.
  Images, code blocks and other non-text blocks inside list items require separate
  adapters. Nesting is bounded to eight levels beneath the root.
- Save persists pending list content and geometry without writing QMD. Reviewed
  sync acquires stable identities for previously unlabelled authored lists, titles
  and other weak text objects together, then replaces only the exact list span.
- A dedicated codec verifies native structural tags and delegates leaf content to
  the existing strict inline codec. No `style`, event or list-number attributes are
  accepted. Each edited list is independently reparsed by Pandoc before a source
  plan is accepted; its native HTML must equal the approved canonical edit.
- Original authored lists are also independently read by Pandoc without executing
  them and compared with execution output. Inline computation stays computed when
  its explicit source binding is available; an ambiguous unbound result refuses.
  Computed list edits remain conflicts and cannot be reverse-written to code.
- Source conflicts, unsupported formatting, executable inline insertion, stale
  plans and modified plans refuse without changing QMD or discarding pending data.

## Focused verification

`tests/lists_test.ts` covers native structural/inline codecs, unsupported starts
and numbering, XSS/attributes, nesting, loose paragraphs, UTF-8/CRLF source spans,
computed inline classification, reviewed identity acquisition, durable Save/reopen,
source Apply/recompute, geometry retention and a full document rebuild after
removing generated HTML. It also exercises refusal paths against real project
state and asserts QMD/state bytes remain unchanged after failed previews.

The relevant regression set is:

```sh
deno test --allow-read --allow-write --allow-env --allow-run --allow-net=127.0.0.1 \
  tests/lists_test.ts tests/source_test.ts tests/plain_qmd_test.ts
```

The former source-scanner negative example for a simple bullet list is replaced
by positive list coverage; blockquote, table, include and malformed-container
refusals remain unchanged. This receipt documents source/core and real Quarto
execution tests. Native editor interaction and screenshots are separate acceptance
evidence, not implied by direct core document edits.

A runnable example is [native-lists](../../examples/native-lists/deck.qmd), with
[instructions](../../examples/native-lists/README.md).

Implementation validation on local Linux (2026-10-11): the final list-specific
suite passed **8/8** in **27 seconds**. The preceding combined regression run
passed **23/23** (the then seven list tests plus eleven source-scanner and five
plain-QMD tests) in **56 seconds**. The final additional list test covers real
Quarto filter alteration and task checkbox refusal. `deno task check`, focused
lint/format checks and `git diff --check` passed. No full-suite or native browser
acceptance claim is made by these author-side checks.

## Review hardening

Independent review reproduced marked-list sibling ordinal drift, root lists
indented by two spaces being conflated, and a Quarto filter silently removing an
authored list. The follow-up implementation increments source ordinals even when
a technical marker supplies the native ID, distinguishes root markers by their
content column, and requires every supported authored source list on a source
slide to appear in the validated projection. Trailing blank separators remain
outside list spans so wrapping another sibling does not change an untouched
list's original-source proof. Tests exercise root indentation from zero through
three spaces, mixed nested list types, loose paragraphs, marked sibling
review/rebuild and a real deletion filter. These checks refuse dropped or altered
semantics before publishing HTML.

The initial codec covered existing source-backed lists. The later authored-list
creation, conversion and deletion slice below extends that scope through explicit
reviewed structural operations.

The post-review combined run passed **27/27** (eleven list tests, eleven source
scanner tests and five plain-QMD tests) in **1 minute 22 seconds**, with zero
failures. Focused lint/format and `git diff --check` also passed. The independent
reviewer's original marker, indented-root and filter probes were rerun successfully
against the corrected implementation.


## Authored list creation, conversion and deletion

Native list objects can now be saved as pending authored content on an existing
slide and in a newly created slide (including the JSON agent API). Each body
object keeps its own source wrapper and native identity; adjacent lists of the
same type are not silently combined. Review reparses each new body with Pandoc
without executing QMD and requires exact canonical native content. Save leaves
QMD unchanged; Apply writes the inspected source transaction; only render executes
code and clears approved pending changes after fresh verification.

An existing independent authored paragraph can become a list and a list can become
one paragraph. Conversion is a dedicated structural operation over the verified
source unit, rather than relaxing ordinary paragraph patches. The source/native
identity is preserved with the existing technical marker or an explicit native
binding in its plain wrapper. Source-owned visual attributes can be reviewed
alongside conversion and are checked against the final exact declarations.
Plain QMD acquires identities only in the review plan. Computed values, component
roles, shared wrappers and nested ambiguous containers refuse conversion.

Lists also use the existing recoverable source-element deletion workflow. Removing
a list from the saved deck retains its pending text and visual design; Compare
with QMD can restore them. Source deletion still requires explicit confirmation,
backs up original QMD and retires pending state only after fresh execution proves
the approved omission. A previously unlabelled plain list is bound through the
reviewed identity phase before its exact unit is deleted. Computed producers and
referenced/shared source units remain protected.

Independent review found a wrapper containing its own child technical marker:
adding a second native binding made that valid source ambiguous on regeneration.
Conversion now retains the existing marker directly, and a regression verifies
both directions with a simultaneously edited source-owned `x` attribute. Original
attribute parsing prevents quoted text from impersonating a native identity.

`tests/list_authoring_test.ts` exercises creation on existing/new agent-created
slides, separate adjacent list identities, plain/identified/marker conversions,
source-owned geometry, restore and confirmed deletion, plain-list deletion,
computed and executable refusals, stale or modified plans, CRLF/Unicode,
unchanged producer bytes and zero execution during review/Apply. The source/core
checks do not by themselves claim native browser interaction acceptance for
these newly added operations.

Validation for this authoring slice: the eight focused suites
(`source_structure`, `text_insertion`, `sync_structure`, `agent_create`,
`notes_creation`, `element_deletion`, `lists`, `list_authoring`) passed
**63/63, 0 failures in 4m34s** with real local Quarto. The focused TypeScript,
lint, formatting and whitespace checks also passed. Native interaction for
new list creation, conversion and deletion remains a separate acceptance step.
