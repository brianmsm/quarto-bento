# Structured JSON operations for agents

Implemented Linux contract, reviewed for public source publication 2026-10-13.
These commands operate on the same saved project as Studio. They do not require
a browser, edit generated HTML, execute Quarto implicitly, or synchronize QMD
implicitly. The JSON protocol is version 1 and validates against the bundled
Bento Slides revision `3d6f7f1fcdf2308e875345ce4f1e0ec0820c914b` (1.2.6).

```sh
qbento get presentation.qmd
qbento patch presentation.qmd patch.json
```

For the development checkout, use `deno task qbento` in place of `qbento`.
Render the QMD once before using these operations. Each `.qbento/` directory is
bound to its single QMD. In `0.1.1`, `get`, `status`, `diff` and Studio all
verify this association: another QMD refuses `PROJECT_SOURCE_MISMATCH`. A
genuinely uninitialized project reports `NO_BASELINE`; saved state whose source
binding is missing reports `PROJECT_BINDING_MISSING` and must be restored
without automatically adopting it for another QMD. Version `0.1.0` already
guarded `get`, but its `status`/`diff` readers could return another document's
state.

## Reusable designs in the current source build

The `design` CLI family shares the same checked registry core as Studio:

```sh
deno task qbento design init lesson.qmd course.design.json
deno task qbento render lesson.qmd
deno task qbento design show lesson.qmd
deno task qbento design export lesson.qmd 'Course design' > course.design.json
deno task qbento design preview other.qmd course.design.json > design-plan.json
# Inspect the entire plan, then pass it back unchanged:
deno task qbento design apply other.qmd design-plan.json
```

`design init` only initializes a new directory without prior `.qbento` state or
Bento output. It associates the selected source and installs design definitions;
it does not execute QMD. Existing saved projects require preview/apply.
Application checks document identity, revision, QMD hash, registry bytes and
the complete proposed package. It retains pending semantics/native overrides
and reports `renderNeeded`; it does not implicitly render or synchronize source.
Unknown style/variant/layout references in the original QMD refuse before
installing incompatible design definitions.

`design adapt reference.html mapping.json` optionally uses installed local
Chromium to sample explicit styles from inert self-contained Reveal HTML. The
default JSON result separates `package` from its provenance `report`;
`--package` emits the reusable package alone. Reference scripts and external
resources are disabled. See [packages](DESIGN_PACKAGES.md),
[adaptation](DESIGN_ADAPTATION.md), and the
[native field grammar](evidence/REUSABLE-THEME-RENDERER.md).

These additions require the current source build and are absent from the
published npm 0.1.1 archive. Existing `get`/`patch` protocol and state schema
versions remain 1.

## Read a snapshot

`get` emits this object to stdout and exits 0:

```json
{
  "version": 1,
  "contractRevision": "3d6f7f1fcdf2308e875345ce4f1e0ec0820c914b",
  "docId": "the saved Bento document identity",
  "revision": 12,
  "deck": { "docId": "the saved Bento document identity", "slides": [] },
  "provenance": {},
  "ownership": {},
  "pending": []
}
```

This abbreviated shape illustrates the envelope; an actual deck has at least one
slide and the complete native Bento properties. `deck` is the latest saved
snapshot, including visual overrides and pending semantic edits. It is not a new
execution or an implicit capture of a separately edited HTML file. Save Studio
or explicitly capture native HTML edits before patching; the existing
uncaptured-output guard refuses a mutation otherwise.

Targets are exact slide/element IDs obtained from `deck`, never positional
indexes. Element IDs are scoped to their slide. `provenance` and `ownership` use
the existing key `JSON.stringify([slideId, elementId])`, including `null` for a
slide-level entry. Provenance records retain authored/computed/bento-only/
detached origin, producer and source binding where available. Anonymous source
objects remain snapshot-local: existing render/sync identity checks still apply
after source changes. `get` does not assert that every object can synchronize.

## Apply a checked batch

Construct a JSON file using the `docId`, revision and IDs from the latest `get`.
This example moves and edits existing objects:

```json
{
  "version": 1,
  "docId": "replace with the exact docId from get",
  "expectedRevision": 12,
  "operations": [
    {
      "op": "element.patch",
      "slideId": "results",
      "elementId": "finding/paragraph:1",
      "fields": { "html": "Edited by an agent.", "x": 210, "w": 640 }
    },
    {
      "op": "slide.patch",
      "slideId": "conclusion",
      "fields": { "background": "#eef5f0" }
    },
    { "op": "slide.move", "slideId": "conclusion", "afterId": null }
  ]
}
```

The file must be a regular UTF-8 JSON file, not a symlink, and at most **1 MiB
including whitespace**. The reader checks file size and actual streamed bytes;
it does not read an unlimited file before checking the cap. The core also limits
the serialized request to 1 MiB and requires **1–100 operations**.

Operations run sequentially on an in-memory copy. Each intermediate document is
validated against the pinned schema. Only after the whole batch succeeds does
the existing `saveProject` perform one locked compare-and-swap save. A missing
target or invalid later operation leaves the earlier operations unapplied. The
revision increments once for a changed batch; a no-op preserves it. Two writers
using the same revision cannot both commit. Fetch again after a stale-revision
or project-busy response; do not blindly replay against a newer snapshot. The
document identity is also rechecked inside the locked mutation, including
hide/show. A sidecar replacement with a different `docId` refuses even when its
revision matches. Studio's slide actions send and require the same identity.

| Operation       | Exact properties besides `op`    | Behavior                                                                            |
| --------------- | -------------------------------- | ----------------------------------------------------------------------------------- |
| `element.patch` | `slideId`, `elementId`, `fields` | Assign supported top-level properties to one existing element.                      |
| `slide.patch`   | `slideId`, `fields`              | Assign supported top-level properties to one existing slide.                        |
| `slide.move`    | `slideId`, `afterId`             | Move after another existing slide; `null` means first. Moving after itself refuses. |
| `slide.create`  | `slideId`, `afterId`, `slide`    | Insert a bounded authored native slide after an existing slide; `null` means first. |
| `slide.hide`    | `slideId`                        | Hide visually using the existing reversible Studio action.                          |
| `slide.show`    | `slideId`                        | Show using the same Studio action.                                                  |

`slide.hide`/`slide.show` must be submitted as the **only** operation in their
request, because they delegate to the existing independently locked action. They
preserve QMD and pending semantic edits. Submit another checked request with
their returned revision for subsequent edits.

`fields` must be a nonempty object. Allowed element properties are:

```text
x y w h rotation opacity
fontSize fontFamily fontWeight color align valign lineHeight letterSpacing
fill stroke strokeWidth strokeStyle strokeDash radius
html content src markup rows columns header option
```

Allowed slide properties are:

```text
background name notes transition unnumbered
```

The allowlist is only the operation boundary: each property must also belong to
that element's actual pinned type and have a valid native value. For example,
`src` on a text element, a string `x`, a negative width or an unknown transition
refuses. Arrays and typed data such as table rows or chart options are assigned
as complete property values and checked by the existing model validator. There
are no generic JSON pointers, dotted paths, type/ID changes, replacements of
slide/element arrays, source deletion or arbitrary code execution operations in
this slice. Invalid numbers, prototype keys, non-JSON values and unknown
request/operation properties refuse. Null is an ordinary value and must pass its
property's schema; it does not mean delete a property.

## Create an authored slide

`slide.create` accepts a native slide with **1–50 elements**, including at least
one text element. The first text is the heading; each later text is one authored
body paragraph or one supported native list. Separate list objects retain
separate source containers, including adjacent lists on a newly created slide.
Paragraphs and list items use the existing bounded inline codec: plain text,
`b`/`strong`, `i`/`em`, `s`, inline `code`, explicit web links and `br` where
the source grammar permits them. Decorations use native `type: "shape"`,
including its `shape: "line"`, `"arrow"` and `"path"` subtypes, and remain in
`.qbento/`. All native properties must pass the pinned model validator.

Creation requires a source-backed execution baseline matching the entire current
QMD. If source was edited or a sync was applied since that execution,
`STALE_SOURCE` asks to recalculate before creating; it preserves saved pending
edits. This conservative check also prevents creating relative to a saved slide
that has already disappeared from the source. A baseline without source
provenance requires authoring an identified QMD slide and rendering first.

This complete request creates useful content without a browser. Replace the
identity and revision with the latest `get` values, and choose fresh IDs:

```json
{
  "version": 1,
  "docId": "replace with the exact docId from get",
  "expectedRevision": 12,
  "operations": [
    {
      "op": "slide.create",
      "slideId": "next-step",
      "afterId": null,
      "slide": {
        "id": "next-step",
        "background": "#eef5f0",
        "elements": [
          {
            "id": "next-step-title",
            "type": "text",
            "html": "Next step",
            "x": 80,
            "y": 52,
            "w": 1120,
            "h": 90,
            "fontSize": 42
          },
          {
            "id": "next-step-body",
            "type": "text",
            "html": "Review the <b>results</b> together.",
            "x": 80,
            "y": 166,
            "w": 1120,
            "h": 90,
            "fontSize": 26
          },
          {
            "id": "next-step-arrow",
            "type": "shape",
            "shape": "arrow",
            "fill": "#156f65",
            "x": 80,
            "y": 299,
            "w": 100,
            "h": 33
          }
        ]
      }
    }
  ]
}
```

`slide.id` must equal `slideId` exactly; neither is normalized. Every new native
ID must start with an ASCII letter and then contain only ASCII letters, digits,
`_`, `:`, `.` or `-`, with a maximum of 200 characters. New IDs must be fresh
against the live QMD, saved deck, retained generated baseline and pending
creations. The check also reserves the future source body IDs `next-step-text-1`
and `next-step-text-1/paragraph:1`. Removing a slide visually does not free its
retained identity. Unlike targeting an existing element by its slide-scoped ID,
this creation boundary conservatively requires fresh IDs across all retained
native objects.

`afterId` identifies a slide in the current in-memory deck, including a slide
created earlier in the same batch; `null` inserts first. Later `element.patch`,
`slide.patch` and `slide.move` operations can target the new slide. The final
created content is checked again before saving, so a later unsupported field
patch refuses the whole batch. Native order is saved immediately; source order
changes only through explicit reviewed sync.

The operation uses the existing structural source authoring grammar in memory
before committing. Empty or multiline headings, unsupported rich body markup,
display equations or separate `slide.title` metadata require explicit QMD
authoring. Plain nonempty `notes` are supported on created and existing slides:
Save retains them as pending, and reviewed sync inserts a notes container when
none existed in the unchanged executed source. Existing bound notes use their
body-only patch. Notes may be omitted or empty; `slide.title` must be omitted or
empty. See [notes creation evidence](evidence/NOTES.md). The structural scanner
can conservatively refuse table-like text containing a pipe (`|`) even when it
is intended as a literal paragraph. Images, tables, charts, executable producers
and declared `origin`/`producer`/`provenance`/`source` metadata are outside this
creation subset. Computed content continues to originate from Quarto execution.

Saving produces a durable authored `create-slide` pending change without writing
QMD or generated HTML. The live source hash used to check fresh IDs is rechecked
under the same operation lock as the revision save; a source change at that
boundary refuses with `STALE_SOURCE`. Reviewed sync converts the text to a
heading and identified paragraph/list containers, with technical
`bento-title-id`/`bento-element-id` attributes retaining the chosen native IDs.
Its inspected plan may also include the configured optional design annotation.
The next explicit render adopts the source-backed content and retains native
geometry, background and decorations. Existing identity, execution-order and
pending-edit guards still govern that render; pin anonymous source objects
before structural changes if those guards require it.

## Save remains separate from source sync and render

A successful patch emits the same snapshot fields as `get`, plus
`sourceUnchanged: true` and `renderNeeded: true`. QMD remains byte-identical.
Geometry/style edits become existing sparse visual overrides. Authored semantic
edits become durable pending changes. QMD-owned visual fields follow their
existing per-field ownership rules. Editing computed content becomes a conflict;
no source code or computed values are reverse-written.

Use the existing commands to inspect and deliberately continue:

```sh
qbento status presentation.qmd
qbento sync presentation.qmd > inspected-plan.json
# Inspect the exact proposal before applying it.
qbento sync presentation.qmd --apply inspected-plan.json
qbento render presentation.qmd
```

Existing source-safety limits still apply: unsupported rich content, unverified
identities, computed conflicts, ambiguous notes containers or unsafe execution
order can refuse a sync/render even though a pending edit was saved. Resolve
those changes through the current reviewed workflow. Patch neither clears
pending edits nor grants source-deletion approval.

## Select only the changes you intend to synchronize

The `0.1.1` implementation exposes selected synchronization in the CLI and
Studio. Version `0.1.0` previews all pending changes; it does not offer this
selection interface. Use `qbento get deck.qmd` to obtain the current `docId`,
revision and exact `pending[].id` values. A change ID is different from a slide
or element ID; copy the complete observed string.

Write a regular UTF-8 JSON selection file (at most 1 MiB):

```json
{
  "version": 1,
  "docId": "the exact document ID from get",
  "expectedRevision": 12,
  "selectedChangeIds": ["an exact pending change ID from get"],
  "confirmedDeleteIds": []
}
```

Replace all illustrative values with the current snapshot. `confirmedDeleteIds`
is optional and confirms only selected destructive actions. It does not select a
change. Duplicate, unknown, malformed or stale IDs refuse without writing source
or state. A foreign `docId` refuses `UNRELATED_DOCUMENT`; an old revision
refuses `STALE_REVISION`. Read the current snapshot and reconsider the selection
rather than replaying it blindly.

```sh
qbento sync deck.qmd --select selection.json > plan.json
# Review the complete proposed patches, result and excludedChangeIds.
qbento sync deck.qmd --apply plan.json
```

The existing `qbento sync deck.qmd` still previews all pending changes. A
selection preview is read-only. Apply verifies the complete plan again; do not
manually edit its IDs, patches or hashes. If no selected changes or optional
annotation updates remain, preview reports `NO_PENDING_CHANGES`.

Studio's **Revisar cambios** lists each pending change with its own selection
checkbox. All begin selected. Excluded changes are listed and preserved. The
separate deletion checkboxes confirm only selected deletions. Changing a
selection invalidates the previous preview; **Aplicar** becomes available only
for a current complete plan. Component creation remains atomic: select all
semantic members of a card/KPI together, or exclude the component. The core
refuses partial component selections and overlapping structural operations.
Selecting a deletion while excluding pending edits on the deleted element or
slide refuses `PARTIAL_DELETE_SELECTION`; include the affected edits in the
reviewed deletion or preserve/restore the target instead.

A selected semantic change can require supporting identity acquisition or
optional annotations elsewhere in QMD. Inspect the full result, not only the
selected row. Selection preserves excluded work; it does not resolve unrelated
conflicts or guarantee that a later strict render can proceed.

## State after a successful synchronization

A successful sync receipt contains `appliedChangeIds`, `pendingRetained: true`
and `renderNeeded: true`, plus recovery backups and a receipt path. QMD is
already updated, while semantic pending entries and the last executed baseline
remain until a later render verifies the new source. Nonempty `pending` alone
does not mean that Apply failed or that the same plan should be reapplied.

Identity acquisition, creation, deletion or normalization can also retain
`.qbento/sync-approved.json`. A second application may refuse
`APPROVAL_PENDING`, and reconciliation may refuse `SYNC_APPROVAL_PENDING`. These
can describe a normal successful Apply awaiting execution. With execution
authorized, run `qbento render deck.qmd` and inspect the result. With execution
prohibited or deferred, preserve the pending state and approval and report "QMD
updated; rendering still required." Do not delete approval/journal files or
initiate recovery solely because pending entries remain. Recovery is for a
reported interrupted operation, using its offered actions.

The render clears only applied edits verified against executed source and
consumes the relevant approval. Unselected changes remain recoverable. Inspect
any remaining diagnostics/conflicts before continuing.

## Errors and validation evidence

Success exits **0** with JSON on stdout. Failure exits **1** with JSON on stderr
and no success envelope. Error objects have `error`, `message` and optional
`details`. Agent-specific codes include `AGENT_USAGE`, `AGENT_INVALID_REQUEST`,
`AGENT_INVALID_TARGET`, `AGENT_TARGET_NOT_FOUND`, `AGENT_UNKNOWN_OPERATION`,
`AGENT_UNKNOWN_FIELD`, `AGENT_INPUT_FILE`, `AGENT_INPUT_TOO_LARGE` and
`AGENT_INVALID_JSON`, `AGENT_ID_COLLISION` and `AGENT_UNSUPPORTED_CREATION`.
Existing errors retain their structured code, including `UNRELATED_DOCUMENT`,
`STALE_REVISION`, `UNSAFE_KEY`, `BENTO_CONTRACT` and `UNCAPTURED_HTML_EDITS`;
creation also uses `STALE_SOURCE` and the existing source/inline grammar
diagnostics. Other core/I/O failures use the existing CLI fallback.

```sh
deno test --allow-read --allow-write --allow-env --allow-run tests/agent_test.ts tests/agent_create_test.ts
deno check src/core/agent.ts src/core/project.ts src/cli.ts tests/agent_test.ts tests/agent_create_test.ts
deno lint src/core/agent.ts src/core/project.ts src/cli.ts tests/agent_test.ts tests/agent_create_test.ts
git diff --check
```

The focused tests exercise actual CLI subprocesses and Quarto 1.10.19/R renders:
get → patch visual/authored text/identified notes/order → status → read-only
sync preview → explicit apply → changed-data render. They verify updated
computed graphics, retained geometry/background, stable `docId` and cleared
authored pending edits. A subsequent computed edit remains a conflict and blocks
sync and render without source changes. Other tests verify stale/unrelated
targets, invalid later operations without partial writes, concurrent writers,
native HTML protection, hide/show, source binding, nonfinite/prototype rejection
and the exact input-byte boundary. A lock-entry regression replaces the sidecar
with another valid document at the same revision and verifies that field, hide
and show operations refuse without changing it or either QMD. Studio's HTTP
tests require document identity before its reversible slide actions. This is
Linux runtime/core evidence; no new GUI or native-platform acceptance is
claimed. The creation-specific CLI, atomicity, identity and source-lock evidence
is recorded in [AGENT-CREATE.md](evidence/AGENT-CREATE.md).
