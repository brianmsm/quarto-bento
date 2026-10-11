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
labels. Save does not rewrite QMD.

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

To change a diagram relationship, open **Relaciones** in Studio, choose its
slide, diagram and connection, then select **Desde** and **Hacia** by their real
source labels and IDs. **Guardar relación pendiente** durably saves both
endpoints as pending semantic edits to from.el/to.el; it does not write QMD or
execute R. Reopen Relaciones to inspect that saved choice. Use **Revisar
cambios** to inspect the exact old/new source attribute and complete proposed
QMD, then **Aplicar** and **Recalcular**. Derived timeline relationships are
shown read-only, with their sequence in QMD order.

Dragging a connector endpoint in the pinned native editor detaches its anchors;
it does not reassign source relationships. Save retains this pending detachment,
and synchronization refuses it until you select both nodes explicitly in
Relaciones or restore the connector. The selector can reconstruct both anchors
while retaining their saved visual sides. Existing graph members and the
original source projection must be intact; stale QMD or an endpoint conflict
requires recalculation or comparison before another relationship action.

Sync changes only the exact verified original attribute value. Native anchor
side stays visual. Foreign/dangling/duplicate relationships, source conflicts,
stale reviews and prospective unsupported topology refuse without source writes.
The combined proposed QMD plus retained font/geometry is measured before sync.
An unverifiable automatic-flow change before a graph requires an independent
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
