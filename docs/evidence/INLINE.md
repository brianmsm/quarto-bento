# Faithful inline text projection and synchronization

Date: 2026-10-11. Pinned Bento accepts semantic `code`, `a` (http/https `href`
only), and `s` tags. The projector now uses those tags instead of flattening code
and links or styling a span whose attributes native Bento removes.

A shared bounded converter supports plain text, bold, italic, strikeout, line
breaks, inline code and explicit web links. It preserves case-sensitive URL paths
and query strings, escapes literal Markdown, uses suitable backtick delimiters,
and normalizes only reviewed equivalent HTML such as `strong` to `b`.
Source provenance records the inline codec version. Older saved baselines that
flattened rich content still refuse rich-source synchronization until refreshed;
existing saved edits are not silently reinterpreted after an upgrade.

`tests/inline_test.ts` checks forbidden URL schemes, extra attributes, malformed
HTML, nested/ambiguous formatting, Markdown escaping, code delimiters and native
HTML equivalence against installed Pandoc. The real Quarto test edits a mapped
paragraph containing code, a link and strikeout, checks a bounded UTF-8/CRLF source
patch, renders again with zero pending changes, and retains geometry. It also
refuses a code span that would become an executable inline R expression.

Pandoc's Markdown reader normalizes significant spaces in inline code. Empty,
leading/trailing, repeated-space, tab and multiline code therefore refuse reverse
conversion instead of losing bytes. Nested formatting, non-web links and link
titles/extra attributes remain explicit unsupported cases. This is a supported
subset, not arbitrary HTML-to-Markdown conversion.

Live Chromium evidence used a separate temporary QMD and the real Studio/native
editor. The rendered DOM contained `code`, the exact case-sensitive `a.href`, and
`s` with computed `text-decoration-line: line-through`. The inspected screenshot
is `output/playwright/native-rich-inline.png` (ignored local artifact). Double
clicking the native paragraph, typing `Now ` at its start, then project save →
review → apply → recalculate preserved all three semantic tags. QMD changed only
the reviewed paragraph; the refreshed editor showed the updated wording and the
same markup. No native document model was mutated through test JavaScript.

After the inline and repeated-template identity changes, the complete integrated
suite passed **167 tests, 0 failures** on Linux. Type checks and lint passed.
