# Displayed code projection and bounded synchronization

Date: 2026-10-11. Quarto 1.10.19, Deno 2.9.6 and pinned Bento on Linux.

Identified ordinary code fences project to native `code` objects with `content`
and `grammarName`. The native editor can change the code as displayed text.
Save retains it in pending state; explicit sync patches only the original fence
body, preserving the opener, language, attributes and surrounding source bytes.
Line endings follow the source, including CRLF, and a content trailing newline
survives a fresh Quarto projection. Supported explicit geometry and typography
are independently source-owned. Native language changes currently refuse sync.

Executable chunk echoes stay computed. Quarto sometimes removes an ordinary
cell label from the executed AST. When a cell contains one echoed code block,
an exact unique match against the original chunk body, excluding its `#|` option
lines, can recover the producer identity. Zero or multiple matches refuse with
`UNMAPPED_PROVENANCE`; matching does not turn executable code into authored text.

`tests/displayed_code_test.ts` verifies:

- Real Quarto projection, bounded UTF-8/CRLF content plus attribute sync,
  retained geometry and zero pending changes after regeneration.
- A displayed `file.create(...)` string never executes before or after sync.
- A replacement that closes its fence and adds an executable chunk refuses,
  leaving QMD unchanged.
- Echoed executable code cannot reverse-write the producer; missing or
  ambiguous original producer matches refuse.

Live Chromium validation used `/tmp/qbento-code-native-3fuonm9j/deck.qmd` and
the local Studio. Double-clicking the native code object opened its editable
`pre`; filling it appended `# Revisado en Bento`. Project save, review, apply
and recalculate updated only the displayed fence body. The regenerated native
code retained all three lines and syntax highlighting; durable state revision 4
had no pending changes. The inspected screenshot is
`output/playwright/native-displayed-code.png` (ignored local evidence).
The test did not mutate the native document model through JavaScript.

The integrated automated suite passed **174 tests, 0 failures**. Type checking
and lint passed. Browser console errors were the known blocked upstream update
check and missing favicon; no external update was fetched. This proves the
documented displayed-code subset, not arbitrary executable-source editing.
