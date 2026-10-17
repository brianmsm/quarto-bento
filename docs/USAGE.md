# Use the development implementation

This guide describes implemented workflows. Current acceptance evidence is from
local Linux; the [implementation ledger](IMPLEMENTATION_STATUS.md) distinguishes
verified behavior from pending capabilities. The Linux development objective is
complete for its documented scope. Public source availability does not establish
a full v1 release. Windows and macOS qualification remains future work.

Studio currently uses Spanish control labels. This guide preserves the exact
labels you will see and provides their English meanings here:

| Studio label                                 | English meaning                   |
| -------------------------------------------- | --------------------------------- |
| **Guardar proyecto**                         | Save project                      |
| **Revisar cambios**                          | Review changes                    |
| **Aplicar estos cambios a QMD**, **Aplicar** | Apply these changes to QMD; Apply |
| **Recalcular**                               | Recalculate                       |
| **Comparar con QMD**                         | Compare with QMD                  |
| **Guardar decisiones**                       | Save decisions                    |
| **Diapositivas**                             | Slides                            |
| **Notas del orador**                         | Speaker notes                     |
| **Añadir componente**                        | Add component                     |
| **Tarjeta**, **Indicador**                   | Card; KPI indicator               |
| **Relaciones**, **Desde**, **Hacia**         | Relationships; From; To           |
| **Guardar relación pendiente**               | Save pending relationship         |
| **Deshacer**                                 | Undo                              |
| **Aplicar diseño**                           | Apply layout                      |
| **Vista previa de posiciones**               | Preview positions                 |
| **Diseños y temas**, **Guardar diseños**     | Layouts and themes; Save layouts  |
| **Descartar borrador y recargar registro**   | Discard draft and reload registry |
| **Presentar con gráficos**                   | Present with charts               |

## Prepare a presentation

You need Deno 2, Quarto, and the dependencies used by your document. Local
execution has been verified with Deno 2.9.6, Quarto 1.10.19, and R 4.6.1. A
document without computation does not require R. Quarto-Bento does not install
or manage these environments.

From this repository:

```sh
deno task qbento doctor
deno task qbento render /path/to/my-presentation/deck.qmd
deno task qbento edit /path/to/my-presentation/deck.qmd
```

`edit` keeps a local server running and prints a URL on `127.0.0.1`. Open that
URL in your browser. If the project has no state yet, it generates the state;
otherwise, it opens the saved state so you can recover and resolve pending
changes. Use **Recalcular** to incorporate new QMD or data changes. When you
stop the server process, the page can no longer save; run `edit` again to
continue.

You can also create a [portable development directory](PACKAGING.md) and use its
`qbento` launcher instead of `deno task qbento`.

Keep **one QMD presentation per project directory**: `.qbento/` is associated
with a single document. To experiment without changing the repository examples,
copy `deck.qmd` and `data.csv` from
[`examples/semantic-roundtrip`](../examples/semantic-roundtrip) into a new
directory. That example requires R and uses an SVG figure computed from the CSV.

Explicit IDs are useful before you start designing. For example:

```qmd
---
title: My presentation
---

## Results {#results}

::: {#finding}
This text can be edited in Bento and synchronized to QMD.
:::

## Conclusion {#conclusion}

::: {#closing}
The next step of the study.
:::
```

IDs let the project verify which source fragment corresponds to each edit. You
can also start with ordinary Markdown headings and paragraphs without IDs. If
synchronization needs stable identities, **Revisar cambios** can propose source
IDs as explicit patches, including for content you have not edited. Review and
apply those patches alongside semantic changes; save and recalculate do not add
them. Changing identities after saving design may still require reconciliation.
See [authoring syntax and limits](AUTHORING.md) for components, code, equations,
notes, tables, and charts, and the [plain-QMD receipt](evidence/PLAIN-QMD.md).

## Local images and captions

You can write an ordinary Markdown image without first creating an identified
wrapper:

```markdown
## Results

![Comparison with **β** and `code`](figures/result.svg)
```

The image and its caption project as two linked native objects. Edit the caption
in Studio and select **Guardar proyecto** to retain it as a pending change.
**Revisar cambios** shows the required identities and exact caption patch;
**Aplicar** writes it to QMD. **Recalcular** preserves the asset path and
design. An empty caption, `![](figures/result.svg)`, can receive text through
the same workflow. Creating or clearing a caption does not delete its image.

The asset must exist within the source project. PNG, JPEG, WebP, and compatible
self-contained SVG are supported; SVG that depends on external files or scripts
is refused. Updating the file before recalculation incorporates its new bytes
while retaining design. Changes during execution are refused to avoid producing
an inconsistent combination.

Replacing the asset path from Bento, deleting the pair, numbered figures, and
computed captions require additional adapters. Their pending edits are retained.
See the [example](../examples/plain-images/deck.qmd) and
[image evidence](evidence/PLAIN-IMAGES.md) for the current limits.

## Design, save, and synchronize

1. Move, resize, or style objects in the Bento editor. You can add decorative
   shapes and edit supported authored content.
2. Select **Guardar proyecto**. Design and pending semantic edits are retained
   in `.qbento/`; QMD stays unchanged. You can close and reopen Studio.
3. Select **Revisar cambios**. Inspect the old and proposed content, exact QMD
   fragments, and any diagnostics. Purely visual sidecar changes do not need to
   become Markdown.
4. Select **Aplicar estos cambios a QMD** when you approve the proposal. The
   operation checks that the document and state still match the plan. Slide and
   source-element deletions also require their specific visible confirmations.
5. Select **Recalcular** to execute Quarto and update the presentation with the
   synchronized content and saved design.

Bento's native Save downloads a standalone HTML file. **Guardar proyecto** is
the control that persists work in this project. Edits to computed output do not
become R/Python code: change the computation or use the available explicit
resolution.

If QMD and Bento have incompatible changes, open **Comparar con QMD**. That
comparison executes the document. Inspect the source and values of each
difference and select an offered resolution. **Guardar decisiones** resolves
project state; writing QMD still requires reviewed synchronization. Explicitly
detaching a computed result from its calculation stops that object from updating
as a linked result.

In **Diapositivas**, hide or show a slide without deleting its QMD. Marking a
slide for deletion retains a pending operation that can be restored before
synchronization. Removing producer code, references, or other ambiguous cases
may be refused with a diagnostic.

You can also delete certain QMD-backed elements from the canvas. **Guardar
proyecto** retains the pending deletion. In review, select the confirmation that
identifies the element. Before applying, use **Comparar con QMD** to restore it
with its pending text and design. Confirmed deletion synchronizes only supported
independent source units: paragraphs, displayed code, or display equations with
stable technical identity, including a unit that is the only child of a simple,
identified top-level div. Headings, computed results, and shared or ambiguous
structures are retained with a diagnostic. See the
[deletion scope and native receipt](evidence/ELEMENT-DELETION.md).

You can add a standalone text box to an existing slide. **Guardar proyecto**
retains it as pending; **Revisar cambios** proposes an identified block at the
end of that slide's QMD section. After apply and recalculate, its position,
size, and style survive. Insertion supports one paragraph in the supported text
subset; grouped objects and ambiguous structures may require explicit QMD
authoring. See the [scope and native receipt](evidence/TEXT-INSERTION.md).

In **Notas del orador**, write notes even if the slide does not yet have a QMD
notes block, including a slide just created in Bento. **Guardar proyecto**
retains the pending text. **Revisar cambios** shows the `.notes` block to insert
and any required technical identities; only **Aplicar** writes QMD. Notes
support plain text and paragraphs with the
[documented whitespace and execution limits](evidence/NOTES.md).

Markdown lists, including nested lists and numbered lists starting at 1, remain
editable native lists. Create lists in new text boxes or convert an independent
paragraph to a list and back using Bento's formatting toolbar. Save retains the
pending change; review shows insertion or conversion; apply writes QMD. Deletion
requires element confirmation, and **Comparar con QMD** can recover the list
before apply. See the [current list scope](evidence/LISTS.md).

## KPI components declared in QMD

The `.bento-kpi` source adapter supports an identified component at slide level
or within identified source cards and layouts, with identified direct containers
for `label`, `value`, and optional `detail`. Reproducible examples are
[`examples/kpi`](../examples/kpi/deck.qmd) and
[`examples/composed-kpis`](../examples/composed-kpis/deck.qmd).
[KPI evidence](evidence/KPI.md) details the supported schema and refusals.

A value can be literal text or a supported Quarto inline expression. A computed
value stays linked to its expression: editing the displayed value does not
change code; reconciliation offers restoration or explicit detachment. Studio
can also create a new KPI with a literal text value. Its form does not create a
computed expression; that workflow is described below.

## Create a card or KPI in Studio

Select **Añadir componente** in an open presentation. Studio first saves the
editor's current changes, then opens the form. Choose an existing QMD-backed
slide and select **Tarjeta** or **Indicador**. A card requests a title and body;
a KPI requests a label, a written value, and optional detail. Fields are
explicit authored text with defined roles. The action does not execute code or
interpret the KPI value as a formula. Declare a data-linked result in QMD
through the `.bento-kpi` adapter.

If QMD changed since the last recalculation, Studio blocks creation and retains
pending edits. Recalculate and resolve differences before reopening the form.

The new component is saved as pending content in `.qbento/`. **Guardar
proyecto** does not change QMD; you can edit text or design in Bento before
sync. In **Revisar cambios**, keep all semantic field changes for a component
together: selecting only part of a card or KPI is refused. Review the proposed
QMD block and use **Aplicar estos cambios a QMD** to insert its explicit
authoring schema into the chosen slide section. Then use **Recalcular** to
rebuild and check the presentation; saved native design is retained separately.

If a managed object is missing at save time, the creation intent and latest
snapshots remain in the project. Reopen **Añadir componente** to restore missing
members in their previous order or discard that pending creation. If a retained
object changed type or its native group has additional members, resolve it in
Bento or discard the creation; synchronization does not guess membership.

This workflow has focused contract and Studio-interface tests, plus headless
Chromium Linux acceptance using the pinned Bento editor. See the
[native creation receipt](evidence/COMPONENT-CREATION.md#integrated-native-creation-acceptance-on-linux).
The receipt establishes that browser workflow; foreground desktop interaction
and other platforms have separate qualification requirements.

## Diagrams and timelines

The [source-graphs example](../examples/source-graphs/deck.qmd) contains a
diagram, a fork, a timeline, and a computed figure. Run it with:

```sh
deno task qbento render examples/source-graphs/deck.qmd
```

Diagrams declare nodes and relationships using QMD IDs. Open **Relaciones** to
choose the slide, diagram, connection, and **Desde** / **Hacia** nodes. Options
show source labels and IDs; endpoints must be distinct and belong to the same
diagram. Opening this control first saves current editor changes to `.qbento/`
and loads a verified project/QMD snapshot. If the project or source changed,
close and reopen the dialog after resolving or recalculating the differences.

In the pinned Bento version, dragging a native connector endpoint detaches its
anchor instead of assigning the relationship to the node under the pointer.
Review blocks that incomplete change. Restore it with **Deshacer** or explicitly
select both source endpoints in **Relaciones**. Select **Guardar relación
pendiente** to save the `from`/`to` pair as one `.qbento/` update, retaining
visual anchor sides. This save does not change QMD or execute R. QMD conflicts
and identities outside the diagram are refused; sync also checks that the
pending relationship still matches the saved connector and the resulting
topology is supported.

Use **Revisar cambios** to inspect exact source attributes and proposed QMD;
**Aplicar estos cambios a QMD** writes the reviewed patch. **Recalcular** is the
separate step that executes QMD and updates projection. Save, sync, and
recalculate are distinct operations.

The dialog shows timelines as read-only sequences. Their relationships derive
from QMD order of `.bento-milestone` blocks. Reorder those blocks and
recalculate to change adjacency; native visual order does not change their
meaning. Supported labels are authored QMD paragraphs. The adapter supports
bounded topology and text metrics; it refuses crossings, overflow, ambiguous
relationships, computed labels, and unsupported composition. See the
[example contract](../examples/source-graphs/README.md) and
[Linux relationship-control acceptance](evidence/GRAPHS.md#explicit-relationship-controls-accepted-on-linux)
for exact limits and native headless validation.

## Annotations and reusable layouts

To redistribute existing content, use **Aplicar diseño** in Studio or Bento's
native layout button. Choose the slide and layout, explicitly assign objects to
each column, and select **Vista previa de posiciones** before applying. The
title and unselected objects retain their positions. Applying a layout changes
geometry while retaining content, identities, and pending edits. Geometric
attributes authored in QMD still require reviewed synchronization.

Free objects retain a snapshot of applied positions. After changing a definition
in **Diseños y temas**, reapply it to update those objects. QMD-declared
components retain their registry-reference contract. Simple tables and charts
are checked against their supported metrics; an incompatible layout produces a
diagnostic and retains work. See
[evidence and limits](evidence/REUSABLE-LAYOUTS.md).

Informational QMD annotations are controlled by
`qbento-annotations: none|minimal|detailed` in front matter. The default,
`minimal`, marks slides with additional design using `.qbento-design`.
`detailed` adds a descriptive sidecar reference without copying coordinates;
`none` omits optional annotations. Changing them is part of a reviewed plan,
never an implicit save or render. When adding them is unsafe for existing
identities, Studio explains the omission.

If QMD retains an annotation but its associated design data is missing, Studio
reports `MISSING_DESIGN` on open and recalculate. You can view a base
presentation, but that does not recover its original appearance. Restore the
reported files from Git or a backup, or explicitly review an annotation that no
longer belongs to the project. Save and render do not automatically remove the
QMD annotation.

After recalculation, `OVERFLOW` identifies boxes that extend below the slide
height with saved design applied. Correct position or size and recalculate. This
warning checks boxes; it does not measure clipped text, shadows, rotation, or
horizontal overflow.

Open **Diseños y temas** to add or change named layouts and basic reusable
themes. Explicitly select the active theme. **Guardar diseños** updates
`.qbento/design.json`; it does not change QMD or HTML or execute calculations.
**Recalcular** applies saved defaults while retaining project visual overrides
and pending content. Explicit source visual attributes retain their authority.

Select a layout in QMD with `bento-layout-name`. Renaming or removing a layout
in the form requires reviewing those references. If another editor changed the
registry, save refuses and retains the draft: review it before selecting
**Descartar borrador y recargar registro**. You can also edit JSON following the
[registry contract](DESIGN_REGISTRY.md).

## Change data and rebuild

Change input data and select **Recalcular**, or run:

```sh
deno task qbento render /path/to/my-presentation/deck.qmd
```

Supported results recompute while retaining saved visual overrides and the same
`docId`. Pending semantic changes remain available. Conflicts or a conversion
that cannot preserve content faithfully may prevent output publication and
require resolution.

To rebuild from Git, retain QMD, its inputs, and versioned `.qbento/` files,
especially `project.json` and `state.json`, alongside project configuration and
assets. Keep a compatible execution environment. Generated HTML, build
directories, and derived widget generations can be regenerated. Reproduction
does not promise identical pixels across operating systems.

## Deliver HTML, PDF, or interactive charts

Supported computed `gt` and `gtsummary` tables become 2x-resolution PNG images.
They retain headings, values, formats, and notes; change their content in the
producer code. Define width and typography in R to suit the slide. Capture
requires installed Chromium and refuses tables that cannot fit completely,
without automatically shrinking them or dropping rows. See the
[reproducible example](../examples/rich-tables/README.md) and
[limits and tests](evidence/RICH-TABLES.md).

`deck.bento.html` contains the editable static presentation and can be
distributed as a standalone copy. Bento's native PDF export uses its print
representation and omits hidden slides. That print layer has been tested in
Chromium on Linux, with visual PDF inspection; operating-system dialogs are a
separate qualification layer.

For supported Plotly output, **Presentar con gráficos** saves and opens a viewer
containing the static presentation and separate interactive views. Interactive
charts do not overlay the slide at its exact object positions. Ordinary HTML and
PDF retain the static SVG. Generation requires Chromium and a compatible local
Plotly runtime; interactive output bundles its resources for offline viewing.
See [adapter scope, versions, and controls](evidence/PLOTLY.md).

If you edited local HTML through Bento's native Save, explicitly capture those
changes before regeneration:

```sh
deno task qbento capture /path/to/my-presentation/deck.qmd /path/to/edited-copy.html
```

Capture verifies identity and generation. It is not an import path for arbitrary
received copies or parallel edits. Recalculate after an accepted capture before
editing a new native copy.

## Terminal and agents

Commands emit JSON. Review and apply a synchronization plan with:

```sh
deno task qbento status /path/to/my-presentation/deck.qmd
deno task qbento sync /path/to/my-presentation/deck.qmd > plan.json
# Review plan.json before applying the proposal.
deno task qbento sync /path/to/my-presentation/deck.qmd --apply plan.json
deno task qbento render /path/to/my-presentation/deck.qmd
```

`get` and `patch` read a snapshot and apply bounded JSON batches with mandatory
identity and revision checks. Follow the [agent API contract](AGENT-API.md): a
patch saves state and does not implicitly sync or execute QMD. `slide.create`
supports a slide with text and decorative shapes, and can share a batch with
edits or movement. It requires an executed baseline matching current QMD. On
`STALE_SOURCE`, recalculate and read the snapshot again before preparing a
batch. A new slide becomes QMD only after reviewing and applying its sync plan.

`init` installs the local extension for ordinary `quarto render`. It refuses to
replace existing configuration; `--extension-only` copies the extension and
leaves format configuration to the user. Installed hooks execute the document
once per render and protect modified HTML. See the
[verified integration](evidence/QUARTO.md) before adapting an existing Quarto
project.

## Select a synchronization batch and finish it

In the `0.1.1` implementation, **Revisar cambios** has a selection checkbox for
each pending edit and lists excluded changes. Deselection preserves work. A
separate checkbox confirms each selected deletion; excluded deletions need no
confirmation. Review the refreshed complete proposal before **Aplicar**.
Cards/KPIs may require all coupled semantic members to be selected together.

For agent/terminal use, create a versioned selection file bound to the document
ID and revision from `qbento get`, then run:

```sh
qbento sync /path/to/deck.qmd --select selection.json > plan.json
qbento sync /path/to/deck.qmd --apply plan.json
```

The exact
[selection-file schema](AGENT-API.md#select-only-the-changes-you-intend-to-synchronize)
and refusal cases are part of the agent contract. Version `0.1.0` lacks this
public selection interface; ordinary preview still includes all pending edits.

After Apply, QMD can be updated while changes still appear pending. Its receipt
lists `appliedChangeIds`, `pendingRetained: true` and `renderNeeded: true`.
Recalculate explicitly when execution is authorized; it verifies the updated
source and clears confirmed edits. Until then, preserve any approval marker.
`APPROVAL_PENDING` or `SYNC_APPROVAL_PENDING` can mean a successful sync is
awaiting render, rather than requiring another sync or recovery.

All read-only state commands now verify which QMD owns the directory's saved
project. `status`, `diff`, `get` and Studio refuse `PROJECT_SOURCE_MISMATCH` for
a different QMD. A genuinely uninitialized project reports `NO_BASELINE`. Saved
state with missing source metadata reports `PROJECT_BINDING_MISSING`; restore
its binding instead of initializing it as another QMD. This keeps the existing
one-presentation-per-directory rule; it does not add multi-QMD editing.

## Common diagnostics

| Situation                               | Next step                                                                                                                                                                       |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `UNCAPTURED_HTML_EDITS`                 | Preserve the edited HTML and explicitly capture the matching copy. Do not delete it to bypass the check.                                                                        |
| Stale revision or busy project          | Wait for the active operation and reread project state before preparing another edit.                                                                                           |
| QMD/Bento conflict                      | Compare values in Studio and save an explicit resolution; separately review any QMD writes.                                                                                     |
| `UNSUPPORTED_SYNC` or `UNMAPPED_DESIGN` | Retain the pending change. Inspect the diagnostic and supported content subset; safe conversion cannot be assumed.                                                              |
| Interrupted transaction                 | Run `recover deck.qmd inspect`, review state, and explicitly choose `finish` or `rollback` if allowed by the diagnostic. For the Quarto wrapper, also consult `quarto-recover`. |
| Corrupt state or mismatched identity    | Preserve files and backups for investigation. Deleting `.qbento/` loses the design and pending-edit association.                                                                |
| `DESIGN_REGISTRY_RECOVERY_REQUIRED`     | Preserve the marker and registry versions. Follow [manual registry recovery](evidence/STUDIO-REGISTRY.md); generic `recover` does not manage this journal.                      |
| `MISSING_DESIGN`                        | Restore the reported external design from Git or a backup. Generating a base presentation does not demonstrate recovery of the previous appearance.                             |

Content limits and remaining validation gaps are recorded in the
[implementation ledger](IMPLEMENTATION_STATUS.md).

Render also reports `TEXT_OVERFLOW` when native text, lists, formulas, or code
exceed their saved box, even if the box fits inside the slide. Adjust dimensions
or typography and save; Studio inspection updates the warning without executing
QMD. `TEXT_MEASUREMENT_UNAVAILABLE` means that content could not be measured:
inspect the slide or configure local Chromium. The ordinary workflow remains
available and retains work. See
[warning scope and evidence](evidence/CONTENT-OVERFLOW.md).
