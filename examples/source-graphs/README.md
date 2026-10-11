# Source diagrams and timelines

This Linux example projects a two-node diagram, a three-node fork and four
ordered milestones into the pinned native Bento rect/text/anchored-line model.
Labels remain literal authored QMD paragraphs. The final slide reads data.csv
through R; changing its values recalculates the figure independently of the
graph design.

Run:

    deno task qbento render examples/source-graphs/deck.qmd

The installed local Quarto/R and Chromium dependencies are required; ordinary
editing stays offline. Use Studio Save or explicit HTML capture to persist
native changes, then the ordinary sync preview/apply to synchronize authored
labels or diagram endpoints. Save does not rewrite QMD.

Native movement, colors, font choices, groups and object stacking remain visual
state unless a compatible property is declared explicitly in the original QMD.
The node shape and label initially share a native group. Native grouping does
not establish source membership. Moving one object cannot infer a containing
component's authored frame or an attribute inherited by multiple children.

Each .bento-diagram needs 2..6 identified direct .bento-node children with
exactly one literal authored paragraph. Identified direct .bento-edge children
declare from and to as source node IDs in that same component and allow zero or
one authored label paragraph. This adapter supports directed acyclic graphs with
at most three topological columns, two nodes per column and eight distinct
edges. Clear straight routing is required; crossings, paths through other nodes,
overflow and unfaithful native typography refuse before publication.

Each .bento-timeline needs 2..6 identified direct .bento-milestone children with
one literal authored paragraph. Their lexical QMD order is the sequence. Reorder
the milestone blocks in QMD to change adjacency. Native z-order, positions and
groups never change sequence. Native endpoint changes on derived timeline links
stay pending and must be restored before publication.

Diagram endpoint changes save as semantic pending edits to from.el/to.el. Sync
changes only the exact verified original attribute value. Native anchor side
stays visual. Foreign/dangling/duplicate relationships, source conflicts, stale
reviews and prospective unsupported topology refuse without source writes. The
combined proposed QMD plus retained font/geometry is measured before sync. An
unverifiable automatic-flow change before a graph requires an independent
original y/h frame or review/restoration of the preceding structure.

Node/milestone shapes use the suffix /qb-node; their labels retain /paragraph:1.
Diagram connector shapes use /qb-edge. Timeline link IDs derive
deterministically from the original component and adjacent source IDs.
Reordering retains node/label IDs and their design. Saved design on an obsolete
link becomes a recoverable orphan; it is not guessed onto another relationship.

Dynamic/executed label text, arbitrary HTML graphs, nested graph components,
universal layout and automatic source node/edge creation are outside this slice.
Standalone literal numbers remain text; this adapter does not turn them into
formulas.
