# Native content bounds on Linux

The workflow contract says changed text must reflow within retained design and
report overflow. Box-edge diagnostics alone cannot detect a paragraph that is
inside the slide but whose content escapes its saved height.

The renderer now checks the final composed native text and code, after saved
geometry and typography overrides. `TEXT_OVERFLOW` identifies the slide and
native element and reports its four content-bound excesses in slide pixels. The
check preserves geometry, QMD, pending edits and computed authority; it does not
fit, shrink or rewrite content automatically. Increase the box dimensions,
adjust typography, or review authored content through the usual sync workflow.
`OVERFLOW` continues to describe element boxes outside the slide.

The check renders all text/code in one isolated headless browser through the
pinned Bento shell. Lists, rich inline HTML, native KaTeX and displayed code use
the actual native DOM and embedded font resources. Measurements use the main
editor canvas, excluding scaled thumbnails, and normalize its scale back to
slide coordinates. The native inner box and DOM Range rectangles detect wrapped
height, glyph/inline bounds and code that is clipped by the element. A one CSS
pixel tolerance handles fractional layout rounding; it does not allow an extra
line. These are layout/content bounds, not arbitrary painted shadows, outlines,
filters, rotation or transient animation extents.

Rotated text and document-field substitutions receive
`TEXT_MEASUREMENT_UNAVAILABLE`, because the isolated measurement cannot claim
faithful axis-aligned bounds/context for them. Missing or failed local Chromium
also produces that actionable warning for each unchecked text element. Ordinary
render/save remains usable and nothing is discarded; the project does not
install a browser. Graph/table/widget features retain their own stronger browser
requirements. A successful content check is reused only for an identical full
document/resource hash within this process, for at most 30 seconds and eight
snapshots; concurrent reads share the check. Failures are retried. A change to
locally installed fallback fonts may require expiry or process restart. This is
not cross-platform pixel equivalence.

`readProjectDiagnostics` reevaluates the saved snapshot without Quarto execution
or state/source writes. Studio replaces its prior bounds warnings on this fresh
inspection, including after Save or reopening. Correcting the saved box clears a
warning before recomputation; later render checks the new composed content
again. Saving new semantic content remains pending and never changes QMD.

## Verification

- The original changed-source repro retained paragraph x=80, y=166, w=300, h=80
  and fontSize=26. Its final renderer reported 1545px of bottom overflow; native
  DOM scrollHeight was 1625px against 80px saved height. The native screenshot
  showed the text passing the box and colliding with the next paragraph. The
  measured diagnostic was present; the original audit had none.
- Focused tests cover rich text, top/center/bottom alignment, lists, KaTeX,
  clipped multi-line code, duplicate IDs on separate slides, exact snapshot
  invalidation, unchanged input documents, and correction clearing warnings.
- Real QMD tests cover changed source after saved geometry, read-only saved
  inspection, correction without source edits, ordinary `quarto render`, and
  absent browser permission producing warnings with successful publication.
- Studio client regressions cover replacing stale warnings rather than
  duplicating them, correction after Save/inspection, and unavailable metrics.
  Protected API regressions retain design/recovery checks and fresh box bounds.

This receipt establishes the bounded Linux DOM checks above. It does not claim
arbitrary effect bounds or a native desktop/other-platform acceptance.

The implementation check used a two-element deck on this Linux host: a cold
local check took approximately 497ms and an identical cached inspection 0.18ms.
These are one-run observations, not a benchmark or performance guarantee. The
Studio client requests diagnostics on load, Save and explicit operations; it
does not start a periodic metric polling loop.
