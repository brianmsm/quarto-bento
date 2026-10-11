# Native Markdown lists — implementation evidence

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
