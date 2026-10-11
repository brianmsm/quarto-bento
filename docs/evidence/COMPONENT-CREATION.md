# Explicit authored Studio cards and indicators

Linux-local implementation checked on 2026-10-11. The component runtime and
regression checkpoint is `6511d83a736fbe2ae829ddbe7eef74fdeafc9310`, on the
retained-typography helper originally committed as
`6753e72498f0e98d5242034e19b3ffff41027691`. The installed tools are Quarto
1.10.19, Deno 2.9.6 and R 4.6.1. The native vocabulary and shell are Bento
1.2.6, pinned to `3d6f7f1fcdf2308e875345ce4f1e0ec0820c914b`.

This evidence covers explicit authored component creation, recovery and approved
source promotion. It does not claim inference from arbitrary grouped objects,
computed-value creation in Studio, cross-platform qualification or a complete
product release. Studio was tested through local headless Chromium against the
shipped client and pinned native shell; foreground desktop acceptance is a
separate validation layer.

## User operation and source result

`Añadir componente` creates a Tarjeta with explicit título/cuerpo, or an
Indicador with explicit etiqueta/valor and optional detalle, on the saved
current slide. Initial form contents are literal text. Native rich text editing
and visual design then use the ordinary Bento editor. Creation saves the new
group and ownership intent atomically in `.qbento/`; the QMD is unchanged.

A card has two semantic roles. Its title is an identified H3 inside the card, so
it cannot become a slide heading. Its body is one paragraph inside an identified
plain wrapper. The inspected insertion has this shape:

```text
:::: {#qb-card-example .bento-card}

### Conclusion {#qb-card-example-title}

::: {#qb-card-example-body}
The authored result.
:::

::::
```

An indicator uses the existing strict original-source KPI contract:

```text
:::: {#qb-kpi-example .bento-kpi}

::: {#qb-kpi-example-label bento-role="label"}
Participants
:::

::: {#qb-kpi-example-value bento-role="value"}
123
:::

::: {#qb-kpi-example-detail bento-role="detail"}
Complete cases
:::

::::
```

Generated IDs reserve the outer identity, every explicit role identity, implicit
paragraph identity and generated background identity across the source and all
retained state, including pending targets and promoted metadata. The background
native ID is `<outer>/qb-card-background` or `<outer>/qb-kpi-background`; card
title IDs equal their H3 source ID, and paragraph IDs equal
`<role-source-ID>/paragraph:1`. These are the existing adapter's identities, so
promotion does not rename native objects.

The source operation is a zero-width insertion at the end of the target slide,
before the next slide's technical marker/heading, using the source's LF/CRLF
convention. Original source blocks and slide boundaries are verified unchanged.
Native geometry, styles, effects, order and group presentation remain sidecar
state and are not copied into QMD attributes.

Creation, Save, recovery and preview do not execute R or document code. A
fragment-only `quarto pandoc` read, the existing adapter and native text
measurement verify syntax, inline semantics and measurement before Apply. The
actual checked render executes the document once per invocation.

## Exact optional state contract

The existing schema-version-1 state adds two optional collections. Unknown
metadata keys/versions, overlapping membership, repeated source identities and
invalid native snapshots refuse validation. Old states without these fields keep
their existing behavior.

```typescript
componentCreations?: {
  version: 1;
  id: string;
  kind: "card" | "kpi";
  slideId: string;
  backgroundId: string;
  backgroundSnapshot: BentoElement;
  projectionFrame: { x: number; y: number; w: number; h: number };
  restoreOrder: string[];
  members: {
    role: "title" | "body" | "label" | "value" | "detail";
    sourceId: string;
    nativeId: string;
    snapshot: BentoElement;
  }[];
}[];
componentProjections?: {
  version: 1;
  id: string;
  kind: "card" | "kpi";
  slideId: string;
  frame: { x: number; y: number; w: number; h: number };
}[];
```

Roles and IDs must match exactly the vocabulary above, in their declared order;
cards require title/body, KPIs require label/value and optionally detail. Active
creation intents are bounded at 128, creation plus promoted metadata at 5000,
and saved native restoration order at 5000 IDs, matching the pinned per-slide
native limit. Frame dimensions are finite and positive.

Save refreshes each present valid text/rect snapshot before normal pending-edit
filtering. A missing or retyped field retains its last valid snapshot. An
incomplete component refuses synchronization with an actionable explanation and
offers `Restaurar componente incompleto` or `Descartar componente pendiente`.
Restore adds only missing original IDs, retaining present objects and edits. Its
placement uses the earliest currently surviving historical successor, then the
last surviving predecessor; a recovered background stays below surviving roles
even when those roles were reordered while the component was incomplete.

Discard removes only the intent's listed native IDs and pending decoration. It
does not remove unknown same-group objects. Unknown additions to the group block
promotion; changing a native group never assigns a new semantic role. Deleting
all original members can retire the intent only while its slide still exists and
no unknown original-group objects remain. Deleting the containing slide retains
child intent and snapshots until restoration or exact approved parent source
deletion. Source disappearance without that approval cannot silently retire an
intent or its promoted bootstrap metadata.

`projectionFrame` is the immutable adapter measurement frame at creation.
Successful promotion transfers it to `componentProjections.frame`, bound to the
same source wrapper/kind/slide. It is separate from editable background
geometry. Moving or shrinking only the decorative background before or after
promotion cannot resize, move or reject the text roles. Explicit QMD frame
declarations continue to control geometry and capacity.

## Review, approval and promotion

A component's complete semantic membership is selected together. Partial
selection refuses before source publication. Preview shows the exact fenced div
and, for ordinary QMD without IDs, the exact source identity acquisition in the
same inspected plan. Creation itself never rewrites unpinned QMD.

Apply rechecks document ID, revision, original source hash, complete plan hash,
CAS and the exact intent snapshots. The existing durable source/state journal,
backup and approval receipt remain authoritative. Apply retains pending content
until a successful fresh render.

Fresh promotion requires the new source hash, stable outer source wrapper, exact
authored role source/native bindings, faithful semantic HTML, generated
rectangular background ID/group and the approved immutable frame. Previous
provenance or matching IDs alone cannot promote a component. Only the approved
record and its pending members/background are consumed. Native design becomes
retained overrides, including exact saved text/background boxes, while the
source-generated baseline and provenance remain source projections.

Previously verified KPI typography is scoped by source slide and exact role
receipt, never by a flattened document-wide native-ID lookup. The renderer uses
fresh source HTML and may use proven unowned visual typography when the baseline
would reject that otherwise valid design. Current source-owned fields win.
Geometry preservation is applied as sidecar overlays before composition, with
fresh source-owned paths excluded. Unsupported glyph overhang remains a genuine
refusal; a valid saved line height can rescue the same rich text without
weakening measurement. Baseline-valid but unreadable saved typography retains
its existing composed diagnostic behavior.

Computed values remain authored as formulas in QMD. Converting a promoted
literal KPI value to an explicit inline R expression keeps its stable bootstrap
and visual design, while fresh provenance records the computed result. A native
computed-value edit remains a conflict, and cannot acquire authored literal
provenance through Studio component promotion.

## Validation receipts

The final bounded regression run on `6511d83` passed **39/39** tests in 2m38s:

```sh
deno test --allow-read --allow-write --allow-env --allow-run \
  --allow-net=127.0.0.1 \
  tests/component_creation_test.ts tests/component_studio_test.ts \
  tests/kpi_appearance_binding_test.ts tests/plain_qmd_test.ts \
  tests/text_insertion_test.ts tests/studio_client_diagnostics_test.ts \
  tests/studio_element_deletion_client_test.ts tests/studio_sync_busy_test.ts \
  tests/studio_sync_review_test.ts tests/sync_test.ts
```

The new component tests cover rich native edits, Save/reopen, exact reviewed
source, partial selection, stale/tampered approval, computed/structural
injection, missing/retyped fields and background, reordered survivors,
containing-slide restore/deletion, immutable frames, promoted
literal-to-computed conversion, HTML-free rebuild and real `QUARTO_FAILED`
recovery. The real happy fixture counts one initial R execution, no additional
execution during creation, Save, preview or Apply, and one execution for each
requested render. Whole-document comparisons check native IDs, document ID and
every retained visual field.

The local Studio test operates the shipped dialog and native editor: creation,
ordinary Save after removing background/detail, restore and discard, with source
bytes unchanged until an approved sync. The proof tests reject detached/retyped,
wrong parent/hash/source/slide receipts and a repeated native ID on another
slide; rescue adds only permitted geometry overlays and leaves generated
baseline, HTML and provenance unchanged.

The helper and component combined run passed **14/14**, including five new KPI
helper regressions for rich typography, source priority, computed fresh results,
existing unreadable-design diagnostics and explicit frame refusal. Type checking
all `src/**/*.ts`, targeted lint/format checks and `git diff --check` passed.

Independent read-only review closed green on the exact `6511d83` runtime
checkpoint: 12 focal tests, 40 surgical source cases, pure
snapshot/frame/receipt checks, real pending and source-backed rich text with
complete native-document preservation, source-owned refusals, recovery stacking,
fixed-frame rebuild, adversarial parent/approval checks and injected
source/state/publication failures. Receipts are in
`/tmp/qbento-component-review-6511-{focal,frame,transaction,negative}.log`.
Those files are local session evidence, not a portable acceptance artifact.

## Incremental retained-capacity flow receipt

The separately approved capacity follow-up uses helper
`3be96ca296aa614f41e8e047c61a3ff4d6632753` and caller
`2445963d389bb3966efdc15d45392cdff1955f02`. A fresh source/default capacity
refusal may use complete, proven retained typography only when the outer source
does not own x/y/w/h. Effective fresh source HTML must pass native glyph/width
measurement and fit the authoritative frame; no font or box is automatically
shrunk. Any explicit outer geometry remains strict, including an otherwise
identical explicit height. Missing/invalid role appearance cannot rescue
capacity.

When this rescue is used, the renderer advances following source content by the
generated background frame, whose dimensions come from source/defaults or the
approved immutable bootstrap. It does not advance from default role heights that
are not painted and does not import saved background geometry into source flow.
Saved role boxes still become scoped visual overlays before composition;
generated baseline typography, geometry and fresh provenance remain projections
of source/defaults.

The incremental focused run passed **9/9** tests in 44s:

```sh
deno test --allow-read --allow-write --allow-env --allow-run \
  --allow-net=127.0.0.1 tests/kpi_retained_flow_test.ts \
  tests/kpi_retained_typography_test.ts tests/kpi_appearance_binding_test.ts
```

The real flow fixture edits a source-backed label to 160 repeated words, saves
font size 12 and line height 1.6 with native boxes inside the component, then
checks Sync/render and HTML-free rebuild. The complete native document and the
following paragraph's placement remain exact; generated baseline font size 26
and line height 1.25 remain unchanged. The strengthened test additionally checks
zero `KPI_CONTENT_OVERFLOW` diagnostics on both successful renders and rejects
the same long source inside explicit `h="470"` without modifying saved state.
That strengthened version passed **1/1** in 13s. The final component creation
and shipped Studio recheck on `2445963` passed **10/10** in 1m31s. Type checking
all `src/**/*.ts`, targeted lint/format and whitespace checks passed for the
complete caller.

Independent KPI review verified exact `2445963` through the public project API:
a fresh 200-word computed result measures 215px inside its saved 310px box at
font size 12 and line height 1.6. All native member geometry and following
paragraph y=656 remain unchanged, source/default baseline font size 52 and line
height 1.25 remain intact, and the final document has no KPI overflow
diagnostic. Explicit outer `h="100"` or `x="80"` still refuses without changing
source, state or published HTML. The incremental helper's six regressions also
passed independently on its exact commit.

No full repository suite, Windows/macOS run, remote operation, release or
foreground desktop qualification is asserted by this slice.
