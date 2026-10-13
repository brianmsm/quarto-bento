# Displayed code projection and bounded synchronization

Date: 2026-10-11. Quarto 1.10.19, Deno 2.9.6 and pinned Bento on Linux.

Identified ordinary code fences project to native `code` objects with `content`
and `grammarName`. The native editor can change the code as displayed text. Save
retains it in pending state; explicit content sync patches only the original
fence body, preserving the opener, language, attributes and surrounding source
bytes. The additional language-selector sync described below patches only the
original language token. Line endings follow the source, including CRLF, and a
content trailing newline survives a fresh Quarto projection. Supported explicit
geometry and typography are independently source-owned. The current
language-selector reverse path is described below.

Executable chunk echoes stay computed. Quarto sometimes removes an ordinary cell
label from the executed AST. When a cell contains one echoed code block, an
exact unique match against the original chunk body, excluding its `#|` option
lines, can recover the producer identity. Zero or multiple matches refuse with
`UNMAPPED_PROVENANCE`; matching does not turn executable code into authored
text.

`tests/displayed_code_test.ts` verifies:

- Real Quarto projection, bounded UTF-8/CRLF content plus attribute sync,
  retained geometry and zero pending changes after regeneration.
- A displayed `file.create(...)` string never executes before or after sync.
- A replacement that closes its fence and adds an executable chunk refuses,
  leaving QMD unchanged.
- Echoed executable code cannot reverse-write the producer; missing or ambiguous
  original producer matches refuse.

Live Chromium validation used `/tmp/qbento-code-native-3fuonm9j/deck.qmd` and
the local Studio. Double-clicking the native code object opened its editable
`pre`; filling it appended `# Revisado en Bento`. Project save, review, apply
and recalculate updated only the displayed fence body. The regenerated native
code retained all three lines and syntax highlighting; durable state revision 4
had no pending changes. The inspected screenshot is
`output/playwright/native-displayed-code.png` (ignored local evidence). The test
did not mutate the native document model through JavaScript.

The integrated automated suite passed **174 tests, 0 failures**. Type checking
and lint passed. Browser console errors were the known blocked upstream update
check and missing favicon; no external update was fetched. This proves the
documented displayed-code subset, not arbitrary executable-source editing.

## Reviewed language-selector synchronization — 2026-10-13

Bento pin `3d6f7f1fcdf2308e875345ce4f1e0ec0820c914b` exposes 77 selector IDs:
the built-in kernel tokenizer `LANGS` keys plus `diff` and `md`. Its native
selector stores the exact chosen value in `grammarName`; it selects `js` when
that property is absent. Tokenization also falls back to JavaScript rules for an
unknown ID. This implementation accepts new choices only from the exact pinned
selector IDs, rather than treating unknown aliases as known languages. For
example, the selector's Python ID is `py`, not `python`. An existing literal
language remains unchanged until explicitly reviewed; aliases are not silently
rewritten. Grammar/theme asset seams remain outside this reverse codec.

The source language codec reads one original non-executable fence, including
plain `` ```r `` / `~~~r` and braced language classes such as
`` ```{#shown .r font-size="20"} ``. It replaces only `r` / `.r`, inserts a
literal language/class when absent, or removes that token. Existing whitespace,
attributes, IDs, fence length and body bytes remain intact. Removing the only
class from `{.r}` leaves `{}`, which the installed Quarto/Pandoc test confirms
is displayed code. No form turns into a runnable `{r}` chunk or raw block.
Executable-source content and echoes stay computed and refuse reverse sync.

`SyncPlan.languages` is an optional, independently inspectable stage after
body/visual-attribute patches. Plans without language changes retain their
previous shape. The stage records the exact original language and literal byte
patch; Apply regenerates the plan and rejects tampered, extra or stale fields.
The fresh original-source Pandoc proof must agree with both the saved baseline
and the proposed language. Stable IDs and weak reviewed identity acquisition use
the existing exact content+grammar expectations. A language-only review keeps an
edited body pending; a body-only review keeps the language pending.

Absent `grammarName` canonically means no declared source language. Removing the
property preserves absence through Apply/render. An empty string is normalized
explicitly to property absence in the reviewed plan, rather than creating an
empty language class; the native fallback is the same. Unknown literal values,
aliases, multiple classes, braces, whitespace/newline injection and
computed-language edits refuse while preserving source and pending edits.

`tests/code_language_test.ts` covers exact source token patches, UTF-8/CRLF,
simultaneous and partial body/language review, weak identities and source-only
rebuild, removal/empty normalization, a single identified `.bento-code` wrapper,
computed and malformed grammar refusals, source drift and fabricated plans. The
native headless test uses the shipped Studio and pinned editor's actual language
selector, confirms all 77 IDs, chooses `py`, saves unchanged QMD, reviews the
token and full proposed QMD, applies and recalculates. It verifies retained
content/docId, zero pending edits and that displayed `file.create(...)` never
ran. This local Linux receipt does not claim arbitrary grammar assets, execution
editing or another platform.

The final focused language/displayed-code/weak-identity run passed **15 tests,
zero failures (1m58s)**. A separate final native replay, including visible token
content and Python `def` keyword highlighting after the splash closed, passed
in 9s. The final native capture was visually inspected. Typecheck and lint
passed for the changed TypeScript/JavaScript. Receipts and native evidence are
retained locally in `output/verification/code-language/`; no full project suite
was rerun for this isolated lane.
