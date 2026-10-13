# KPI components in cards and layouts

Run `deno task qbento render examples/composed-kpis/deck.qmd` from the
repository root using a compatible installed Quarto/R/knitr environment. The
example does not install or manage packages.

The first column contains a card heading and a KPI whose value is calculated
from `data.csv`. The second column is a literal KPI directly in the layout. The
heading intentionally has no explicit ID: ordinary data-only recalculation
retains native design through its verified source receipt.

KPI roles are measured at the final content width before component placement. A
card gives its KPI the remaining height after its other children. Placement only
translates the measured objects; it never shrinks text to make it fit. Bento has
flat native groups, so every nested object belongs to the outer source layout
group while its semantic provenance remains its original role.

Edit/save native typography or position, change the CSV, and recalculate to
retain appearance with fresh computed values. Save never rewrites QMD. Computed
text edits become conflicts; authored role edits remain pending until reviewed
synchronization. A weak heading needs reviewed identity acquisition before
changing source text; data-only changes do not change the source hash.

Declare typography on a KPI or its role. Parent-card typography that would
change measured KPI metrics, competing child geometry, arbitrary wrapper
ancestors, and transformed ancestor attributes refuse before publication. For a
longer new value, complete verified saved typography can rescue an unowned
frame. If the enclosing frame or KPI geometry is explicitly owned by QMD,
capacity overflow must be corrected in source; native typography does not
silently authorize replacement of source-owned boxes.

This is bounded Linux support for identified source cards/layouts, not arbitrary
native grouping inference or a full product/cross-platform release. Bounded
native charts in components are also implemented; see the
[composed-chart receipt](../../docs/evidence/COMPOSED-CHARTS.md) for their
independent scope and evidence.
