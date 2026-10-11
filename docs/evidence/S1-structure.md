# S1 structural operations and explicit identity pinning

Implementation evidence recorded 2026-10-11, Linux, Deno 2.9.6.

`src/source/structure.ts` builds on the original-byte source scanner. Its two
exports are `previewStructure(document, operations)` and
`applyStructure(currentText, preview)`. Neither writes source files or sidecars.
The caller must present the preview for approval and apply the result using the
transaction layer's locks, backup, atomic write and recovery checks.

## Operations

```ts
type StructureOperation =
  | {
    type: "insert-slide";
    id: string;
    title: string;
    body: string;
    afterId?: string | null;
  }
  | { type: "reorder-slides"; ids: string[] }
  | { type: "delete-slide"; id: string; confirmed: true }
  | {
    type: "pin-identities";
    bindings: { blockId: string; id: string }[];
  };
```

- **Insert:** creates an explicit level-2 heading identity and technical
  `qb:slide-id-text-N` markers for authored body paragraphs. `afterId: null`
  prepends after the retained preamble; a supplied ID inserts after that slide;
  omission appends. Existing bytes stay intact. New content adopts source
  CRLF/LF. Supported bodies contain authored paragraphs, including ordinary
  inline Markdown; headers, fenced blocks, HTML comments, YAML, includes,
  executable inline text, and ambiguous constructs are refused. More elaborate
  authored components remain separate source-authoring operations.
- **Reorder:** the requested list must contain every existing stable slide
  exactly once. Original section bytes are moved unchanged. An adjacent
  technical heading marker travels with its heading. All computed blocks,
  including executable producers and inline computations, must retain their
  relative order and exact content. Thus a deck with one computed slide and new
  authored slides can be reordered; swapping two existing computed producers
  cannot pass. Unsafe missing newline boundaries are refused instead of silently
  repairing or joining text.
- **Delete:** requires the explicit `confirmed: true` operation. Deleting
  computed producers, inline computations, or unsupported source with unverified
  shared dependencies is refused. References from remaining QMD to deleted IDs
  (`@id` and Markdown `](#id)` links) are checked. This does not infer arbitrary
  custom filter/plugin dependencies; unsupported constructs require source
  review.
- **Pin:** inserts only technical comment lines immediately before specifically
  selected unlabelled blocks. Existing explicit IDs are not overwritten. New IDs
  must be unique and survive a fresh scan. Parent div and child pinning can be
  combined without changing their semantic content. This is an explicit sync
  operation, never an automatic mutation during render.

## Validation

Every preview contains the original SHA-256, individual step before/after
hashes, exact expected fragments and replacements, a final hash, and the
resulting QMD. Apply replays the operations against the unchanged original
snapshot and rejects any mismatch or tampered preview. All generated results are
rescanned, and the operation's slide count/order, identities, and
execution-order invariants are checked before a preview is returned.

Reproduction:

```sh
deno test --allow-read --allow-write tests/source_structure_test.ts
deno test --allow-read --allow-write tests/source_test.ts tests/source_structure_test.ts
deno lint src/source/structure.ts tests/source_structure_test.ts
```

Results: **11 structural tests pass**, including UTF-8/emoji/CRLF preservation,
single-producer reorder, multi-producer and inline dependency rejection,
deletion confirmation/crossrefs, marker relocation, nested pinning, dangerous
syntax, duplicate IDs, stale/tampered previews and missing final newline. The
combined source and structural suite passes **22 tests**; lint passes. These are
core source-operation tests, not a claim of Studio UI or transaction
integration.

## Current boundary

Structural operations currently use the canonical level-2 slide convention.
Slide hiding remains sidecar state. Multi-QMD editing, arbitrary source
constructs, engine dependency analysis, and modifying existing heading visual
attributes are not added by this module. Reordering uses retained original
source sections and preserves execution order; it does not claim that arbitrary
user-defined filters or external tooling are independent of presentation order.
