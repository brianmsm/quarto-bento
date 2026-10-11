# Structured JSON operations for agents

Implemented Linux vertical slice, 2026-10-11. These commands operate on the same
saved project as Studio. They do not require a browser, edit generated HTML,
execute Quarto implicitly, or synchronize QMD implicitly. The JSON protocol is
version 1 and validates against the bundled Bento Slides revision
`3d6f7f1fcdf2308e875345ce4f1e0ec0820c914b` (1.2.6).

```sh
qbento get presentation.qmd
qbento patch presentation.qmd patch.json
```

For the development checkout, use `deno task qbento` in place of `qbento`.
Render the QMD once before using these operations. Each `.qbento/` directory is
bound to its single QMD; supplying another QMD in the same directory refuses
instead of returning or editing the first deck.

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
slide/element arrays, creation, deletion or arbitrary code execution operations
in this slice. Invalid numbers, prototype keys, non-JSON values and unknown
request/operation properties refuse. Null is an ordinary value and must pass its
property's schema; it does not mean delete a property.

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
identities, computed conflicts, missing identified notes blocks or unsafe
execution order can refuse a sync/render even though a pending edit was saved.
Resolve those changes through the current reviewed workflow. Patch neither
clears pending edits nor grants source-deletion approval.

## Errors and validation evidence

Success exits **0** with JSON on stdout. Failure exits **1** with JSON on stderr
and no success envelope. Error objects have `error`, `message` and optional
`details`. Agent-specific codes include `AGENT_USAGE`, `AGENT_INVALID_REQUEST`,
`AGENT_INVALID_TARGET`, `AGENT_TARGET_NOT_FOUND`, `AGENT_UNKNOWN_OPERATION`,
`AGENT_UNKNOWN_FIELD`, `AGENT_INPUT_FILE`, `AGENT_INPUT_TOO_LARGE` and
`AGENT_INVALID_JSON`. Existing errors retain their structured code, including
`UNRELATED_DOCUMENT`, `STALE_REVISION`, `UNSAFE_KEY`, `BENTO_CONTRACT` and
`UNCAPTURED_HTML_EDITS`; other core/I/O failures use the existing CLI fallback.

```sh
deno test --allow-read --allow-write --allow-env --allow-run tests/agent_test.ts
deno check src/core/agent.ts src/cli.ts tests/agent_test.ts
deno lint src/core/agent.ts src/cli.ts tests/agent_test.ts
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
claimed.
