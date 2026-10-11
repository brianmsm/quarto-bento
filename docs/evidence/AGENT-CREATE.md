# Structured authored slide creation

Implementation evidence, 2026-10-11. This extends the version 1 local JSON agent
API with bounded `slide.create`; it uses the existing native validation,
`captureEdits`, locked `saveProject` and reviewed structural sync. It does not
introduce a separate state format or write QMD during a patch. The request
contract and a complete title/body/decor example are in
[AGENT-API.md](../AGENT-API.md).

The focused executable evidence is `tests/agent_create_test.ts`, on Linux with
Quarto 1.10.19, Deno 2.9.6, R 4.6.1 and bundled Bento Slides 1.2.6 revision
`3d6f7f1fcdf2308e875345ce4f1e0ec0820c914b`. Projects and generated artifacts are
temporary test copies; no checked-in example or user source is modified.

## Actual CLI creation and reviewed source round-trip

The test executes CLI subprocesses for initial render → get → patch → status →
sync preview → explicit apply → render → get. One batch creates an authored
slide after an existing identified slide, patches its body text and geometry,
then moves it to the beginning. Save advances the revision once and creates one
authored `create-slide` pending change. It leaves QMD and generated HTML
byte-identical and declares no computed provenance.

The inspected source result is compared byte-for-byte with the original QMD plus
this inserted section:

```qmd
## Created β title {#created bento-title-id="created-title" .qbento-design}

::: {#created-text-1 bento-element-id="created-body"}
Reviewed **body**.
:::
```

The original frontmatter and both existing sections remain byte-identical. The
fixture uses explicit heading/body IDs and normal blank section separators. The
`.qbento-design` class is the current default minimal annotation, included in
the explicit sync proposal. The native arrow decoration does not become source
content.

Preview leaves QMD unchanged. Explicit apply writes exactly the inspected result
and keeps the pending creation until a fresh checked render. Reopening through
`get` then verifies stable `docId`, no remaining pending changes, order
`created,a,b`, native IDs `created-title`, `created-body`, `created-arrow`, body
text `Reviewed <b>body</b>.`, retained body `x=411,w=540`, retained background
`#eef5f0` and an exactly preserved native arrow object. The body obtains
authored source-backed provenance after execution.

## Rejection and mutation boundaries

Invalid cases verify that saved state, QMD and generated HTML remain unchanged:
foreign document, stale revision, mismatched `slideId`/`slide.id`, collisions
with source containers, retained native IDs and derived source body IDs,
duplicate native IDs, empty elements, 51 elements, unsupported notes/title
metadata, fake producer/computed origin, unsupported resource types, invalid
native values, unknown native fields, nonfinite numbers, prototype keys and an
oversized request. It also rejects `line`/`arrow`/`path` as element types;
decorations must use the pinned native `shape` type and its subtype property.
Display equations and table-like pipe text exercise the current conservative
source grammar rather than bypassing it.

Combined batches cover a valid creation followed by a missing move target,
duplicate creation, unsupported new notes or unsupported body markup. They
refuse atomically. A pending creation reserves its future QMD paragraph IDs; a
removed native slide still retains its generated baseline identity. QMD changed
before the patch also refuses with `STALE_SOURCE`: tests remove the creation
anchor, change source order, edit text and introduce a technical native ID
binding. The preexisting pending changes, injected QMD and generated HTML remain
unchanged. Creation requires the current whole-source hash to match its
source-backed execution provenance, so it cannot admit an order pending based on
already divergent source structure. A positive boundary test saves exactly
**50** native elements: two texts and 48 decorations, with QMD unchanged.

A lock-entry regression injects three external changes just before
`operation.lock` acquisition: changed QMD with a colliding new identity, a newer
saved revision, and a valid replacement sidecar with another document at the
same revision. They refuse with `STALE_SOURCE`, `STALE_REVISION` and
`UNRELATED_DOCUMENT`, respectively. The injected source/sidecar remains
unchanged by the rejected patch. This verifies the existing CAS/identity path
and the added source-hash check at the locked save boundary.

## Focused validation and scope

```sh
deno test --allow-read --allow-write --allow-env --allow-run tests/agent_create_test.ts tests/agent_test.ts
deno check src/core/agent.ts src/core/project.ts tests/agent_create_test.ts tests/agent_test.ts
deno lint src/core/agent.ts src/core/project.ts tests/agent_create_test.ts tests/agent_test.ts
deno fmt --check src/core/agent.ts tests/agent_create_test.ts docs/AGENT-API.md docs/evidence/AGENT-CREATE.md
git diff --check
```

This is local Linux CLI/core and real Quarto runtime evidence. It does not claim
a browser visual review, macOS/Windows validation, a full-suite run or product
completion. Creation currently accepts authored text and native visual
decorations. Source deletion, new speaker notes, computed/resource-backed
content and unsupported rich source structures remain outside this operation;
the existing explicit authoring, sync and recovery workflow remains necessary.
