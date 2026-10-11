# Native Markdown lists — implementation evidence

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

The codec synchronizes existing source-backed list objects. Converting unrelated
paragraph objects into lists, inserting new native-only list objects, and deleting
an entire source list through the existing element-deletion workflow remain
explicitly unsupported operations; pending content is retained for source review.

The post-review combined run passed **27/27** (eleven list tests, eleven source
scanner tests and five plain-QMD tests) in **1 minute 22 seconds**, with zero
failures. Focused lint/format and `git diff --check` also passed. The independent
reviewer's original marker, indented-root and filter probes were rerun successfully
against the corrected implementation.
