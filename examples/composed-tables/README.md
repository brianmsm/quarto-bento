# Tables inside cards and layouts

Run `deno task qbento render examples/composed-tables/deck.qmd` from the
repository root with the compatible installed Quarto/R/knitr environment. No
dependencies are installed or managed by this example.

The left card contains an authored pipe table between a heading and a paragraph.
The right card contains one labelled R producer reading `data.csv`. Both cards
occupy a two-column layout. Tables use the final 496px content width with native
18px text, 16px horizontal/11px vertical padding, and a 168px complete row box.

Change the CSV and recalculate to replace computed cell values. Save geometry
and table style changes to retain design. Authored cell edits remain pending;
computed cell edits are conflicts. Neither operation rewrites the R producer or
claims a safe reverse table-cell codec. Table columns retain the existing
semantic classification; this slice does not reclassify column edits as design.

A table wrapper must contain only its table (or transparent execution wrappers).
Use separate card children for adjacent text. Rich cells, merged cells,
captions, wrapping that exceeds the conservative width limit, excessive row
height, and unadapted native charts refuse before publication. This is a bounded
Linux implementation, not a full product or cross-platform release.
