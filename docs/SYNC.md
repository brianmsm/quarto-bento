# Persistence, provenance and safe synchronization

## Two authorities — with explicit exceptions

| Field/content | Normal authority | When edited in Studio |
|---|---|---|
| Authored text, semantic structure, headings, source LaTeX, displayed code and notes | `.qmd` | Persist pending edit; offer safe, explicit sync back to its source span. |
| Code-produced numbers, figures and table values | Executed QMD + inputs | No reverse mapping to executable code. Restore output, edit producer source, or explicitly detach. |
| Layout geometry, colors, typography, transitions, animations and decorative elements | `.qbento/` | Save immediately as visual state; no QMD write necessary. |
| Any **visual property explicitly declared in QMD** | That QMD attribute until changed by deliberate sync | Flag field-level divergence; sync/keep source/revert or resolve conflict. |
| Studio-created card/KPI content | `.qbento/` until sync, then QMD | Review every pending member together; design stays in the sidecar. |
| Diagram edge endpoints (`from`/`to`) | Exact QMD attributes | Studio **Relaciones** selects both source nodes as one pending update; reviewed Apply writes the exact attributes. Native drag detaches an anchor; use Relaciones or Undo. |
| Timeline order and derived links | Source milestone order | Studio displays the sequence read-only. Reorder QMD blocks to change adjacency; z-order does not. Restore native endpoint edits before publication. |

The source of a value and its **provenance** are different from its current **synchronization state**.

## Two independent state dimensions

- **Origin/provenance:** `authored`, `computed`, `bento-only` (pure design or not yet sourced), `detached` (explicitly separated from a computation).
- **Sync state (per change/property):** `clean`, `qmd-ahead`, `bento-ahead`, `conflict`, `bento-only`. Source mapping failures are surfaced as an `unmapped` diagnostic rather than silently guessed.

Example with baseline text "Buen ajuste": QMD "Ajuste adecuado", Bento unchanged → `qmd-ahead`. If Bento also independently says "Muy buen ajuste" → `conflict`.

No blanket "last writer wins". Disjoint field edits should merge automatically where safe (e.g. Quarto text changes and Bento frame changes); contradictory edits to the same semantic property need review.

## Save, sync and render are separate operations

**Save in Studio:** persist current Bento design **and unsynced semantic change journal** in recoverable project state, not only in a generated HTML or the browser. QMD remains unchanged. Sync metadata tracks which changes have already been applied; closing Studio must not lose a pending edit. **Bento's own Save outside Studio instead saves an HTML file**, not `.qbento/`; see the capture workflow below.

**Sync:** load the last confirmed baseline and both current states. Show itemized changes (direction, source, property), preview patches, validate anchors and source hashes/expected fragments, let the user choose actions, then commit applied edits and advance baseline only for successful operations. Writes must be atomic/rollback-capable and avoid unrelated formatting changes.

For a source diagram, Studio's **Relaciones** dialog lists the slide, diagram,
edge and source nodes by label and ID. A timeline is shown as its milestone
sequence with endpoint controls disabled. Opening the dialog first saves the
current native editor state, then reads a snapshot bound to `docId`, project
revision and QMD source hash. **Guardar relación pendiente** writes the chosen
`from` and `to` together as one project update, preserving visual anchor sides;
stale revisions/sources, conflicting endpoints and foreign node IDs are
refused. This Save does not write QMD or execute Quarto/R. Sync verifies that
the journal's pair still matches the saved connector and validates the
prospective topology before offering a source patch. **Apply** writes only the
reviewed QMD patch; **Recalculate** is the separate step that executes QMD and
refreshes the projection.

Studio-created cards and KPIs are one semantic creation per component, not a
loose group inferred from placement. The pending intent records its exact
member IDs, roles, snapshots and fixed projection frame. Preview refuses a
partial selection of one component's semantic members or an incomplete/stale
component. A reviewed approval inserts only the exact role schema into the
selected source slide. The saved frame used for subsequent source projection is
independent from the native background's mutable geometry; that background's
placement and styling remain a visual override. A KPI entered through this
Studio form contains literal text, not a calculation. Focused tests cover the
creation contract and Studio client; this does not yet establish native visual
acceptance for the creation flow.

**Render:** execute Quarto and project updated outputs through the saved design, preserving stable visual identity. It is not a command to erase pending Bento edits or silently settle source conflicts. An unattended strict render/CI should fail with a structured diagnostic if it cannot produce a coherent deck without selecting a conflicting value.

`sync.lock.json` is a conceptual, versioned three-way baseline manifest; concrete baseline snapshots and pending-journal encoding are not frozen. They must survive Git checkout/machine changes and handle incompatible versions defensively. Project metadata must also preserve **Bento `docId`** across regenerations; new independent copies require different IDs. Keep detached semantic snapshots labeled and persisted in the sidecar: they no longer regenerate from the producing code.

## Safe QMD patches

- Prefer explicit slide/block IDs, QMD heading attributes and named chunk labels; pin weak identities via `qb:*` markers when needed for round-trip.
- Source mapping identifies the *original* fragment despite Quarto reader transforms and execution outputs.
- Apply bounded patch to the exact verified span. Do **not** rewrite the entire file using a Pandoc Markdown writer.
- If the span is ambiguous, concurrently modified, generated by computation, or crosses unrelated/shared code, refuse or request explicit resolution.
- Preserve surrounding indentation, fenced blocks, comments, line endings and user-authored formatting where possible.
- Direct edits in an editor/another Git branch must be detected; avoid overwriting newer QMD bytes.

## Slide-level actions

| Action in Bento | Persistence / QMD rule |
|---|---|
| Move visual object / change font / animate / add decorative arrow | Save in `.qbento/`. Optional QMD design signal at next sync. |
| Edit authored text or notes | Pending; sync corresponding authored source block. |
| New slide with text | Pending until sync; then insert a real slide section in QMD, with source mapping. Keep visual state in `.qbento/`. |
| Reorder slides | Pending; sync source slide ordering after checking boundaries/dependencies. |
| Hide slide | Retain QMD source; visually hide from normal presentation and PDF, reversible. |
| Restore slide | Recover previously hidden/deleted-pending state. |
| Delete source-backed slide/element | Offer hide/restore/delete-from-QMD; **only confirmed safe delete** removes the source span and associated design. |

## Computed vs literal content

A displayed number sourced from `fitMeasures(model)` cannot be rewritten back to the analytical code by changing the rendered `0.962` to `0.980`. Studio supports **restore**, **edit producing source**, or **detach** (explicitly breaking that computed link). Detached content must be clearly labeled to avoid presenting it as freshly recomputed.

Literal authored Markdown and source LaTeX *can* round-trip. Dynamic Quarto inline output is **computed**, even when visually presented as text.

## Explicit local HTML capture

The bounded secondary workflow is implemented by `qbento capture`. After
editing a project-generated `.bento.html` in native Bento, capture the saved
file into `.qbento/` **before the next render**. The capture checks the
publication receipt, document identity, generation and current emitted
baseline; it accepts one capture per publication generation. It supports a
same-path native save and a downloaded copy when those checks pass. See the
[usage steps](USAGE.md) and [capture evidence](evidence/CAPTURE.md).

```text
Last emitted BentoDoc baseline + locally saved HTML's #bento-doc
  → compare by stable slide/element IDs
  → extract safe visual-property overrides and Bento-only objects
  → write versioned design state; flag semantic changes for review
  → next Quarto render reapplies the overrides
```

Capture is not a general HTML import and does not directly write semantic edits
to QMD. Any captured semantic differences remain subject to the ordinary
provenance, review and sync rules; computed content cannot be reverse-written to
its producer. A changed, not-yet-captured project HTML must **not be silently
overwritten** by a subsequent render. Native browser Save may download a copy
instead of changing the existing path. Legacy receipt-less, stale, foreign,
encrypted or collaborative HTML requires separate reconciliation and is not
accepted by this command. A second capture requires a fresh publication; see
the evidence for the exact refusal and recovery behavior.

## Failure and recovery principles

- No silent overwrites, silent lossy conversion, or invisible data loss on save, sync, render, undo or format upgrades.
- Inspector reports which slide/element/property changed, in which direction, and where it came from.
- Validation detects source-identity collisions, missing/changed assets, overflow, invalid charts, stale layout references and version incompatibilities.
- A QMD with design annotations but missing `.qbento/` should yield an actionable missing-design warning; never pretend the original visual design was recovered.
- The initial version assumes one active editor and **does not integrate Bento live collaboration**. Git merges remain possible and must be reconciled explicitly.
