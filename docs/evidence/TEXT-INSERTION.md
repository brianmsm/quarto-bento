# Native authored text insertion into an existing slide

Implemented and checked on Linux, 2026-10-11, from main `6225391`. Quarto
1.10.19, Deno 2.9.6, R 4.6.1; native document vocabulary is the bundled pinned
Bento contract. This closes the standalone-text part of the meaningful-object
scenario in [WORKFLOWS](../WORKFLOWS.md). Component/card/KPI inference is not
claimed by this slice.

## Contract

A new native `text` object on an existing, explicitly identified source slide
remains a recoverable `create-element` pending edit after Save. A selected Sync
preview now proposes one zero-width UTF-8 byte insertion at the end of that
slide's source section, before the next slide's technical marker/heading. Its
form is:

```text
::: {#qb-text-<identity-hash> bento-element-id="native-id"}
The authored paragraph, using the existing supported inline Markdown codec.
:::
```

The source identity is `qb-text-` plus the first 24 hexadecimal characters of
SHA-256 over canonical JSON `[slideId, elementId]`. It is globally checked for
collision, including its parsed child identity. The native identity stays
slide-local: the same native ID on two slides yields distinct source IDs.
Neither identity is renamed silently. The attribute requires the existing safe
identity grammar, so a native ID cannot inject QMD attributes or fences.

The source operation adds only separators and the new fenced div; original bytes
are retained. LF/CRLF follows the source, with LF when it contains no newline
from which to infer a convention. A blank line between a technical `qb:` marker
and its following slide heading stays with that heading. A fresh scan must prove
exactly one standalone div and one authored paragraph were added, existing block
content and slide identities are unchanged, and computed producer content/order
are retained. Inserting after a final original block without a terminal newline
adds its first line separator; it does not replace any original bytes.
Informational visual annotations, when enabled, are separate inspected patches
in the same plan.

Before a proposal is accepted:

- QMD must match the executed baseline. Source changes require regeneration and
  review; newly introduced source/native bindings cannot bypass the check.
- The target must be an existing source slide with a free native element ID.
  Existing source-backed objects and computed origins cannot be reclassified as
  a creation.
- Existing authored provenance must remain stable through a source insertion:
  explicit IDs or singleton children of identified containers. Weak positional
  mappings refuse before writing, rather than failing after approved source
  publication. Automatic migration/pinning of old weak mappings is not added.
- New text must be ungrouped (`groupId` absent/empty), nonempty, and exactly one
  supported paragraph. Bold, emphasis, strikeout, inline code, web links and
  hard breaks use the current codec. Unsupported inline fonts/styles, nested
  formatting, paragraph lists, display math, structural syntax, executable
  inline code and ambiguous containers refuse with pending content retained.
- A fragment-only `quarto pandoc` read checks Markdown back to the canonical
  native HTML. This executes no document code and does not use a Markdown writer
  over the QMD. Reader transformations such as `...` to a typographic ellipsis
  refuse before source publication when they would change the accepted HTML.

Apply uses the existing whole-plan/state/source checks, backup and transaction
journal. Pending content is retained through Apply. Only a fresh render with the
checked approval receipt promotes the exact creation, converts its visual fields
to retained overrides, and retires its pending entry. Native geometry,
font/style, effects, stacking, decorations and document identity remain in the
existing state machinery. Selected and unselected creations remain independent.
No schema extension or implicit approval was introduced.

The ordinary source-reader/filter configuration remains authoritative: if a
custom source transform changes the freshly executed creation, promotion refuses
a semantic mismatch rather than consuming its pending content.

## Validation

`tests/text_insertion_test.ts` exercises:

- One exact bounded insertion, UTF-8/CRLF/Unicode, no final newline, nested
  ordinary heading, next-slide marker with a blank line, and final R fence.
- Rejection of open div/comment/fence/math boundaries, structural/executable
  payloads, source collisions, unsafe binding attributes and stale previews.
- Real Quarto + R: native document Save → preview → Apply → render → reopen; two
  new texts with the same native ID on different slides, selected sync, retained
  geometry/font/color/rotation/effects/stacking and decorative arrow, unchanged
  `docId`, verified authored provenance, pending counts `2 → 1 → 0`, and a later
  ordinary source-backed text edit/sync.
- An R execution counter verifies five explicit renders execute five times;
  preview and Apply execute none. The exact original source backup and source
  bytes are checked, including CRLF and the original producer.
- Source/state/plan staleness, grouped text, unsupported fonts/content, weak
  identities and a current source-ID collision preserve QMD and pending state.
- Existing authored edits + insertion + slide reorder + optional minimal
  annotations compose in one inspected transaction and clear only after render.

Focused regression command (not the full project suite):

```sh
deno test --allow-read --allow-write --allow-run --allow-env \
  tests/text_insertion_test.ts tests/source_structure_test.ts \
  tests/sync_structure_test.ts tests/sync_test.ts
```

The focused command passed **34 tests, 0 failures** in 31 seconds. The changed
TypeScript files also pass focused type checking and lint.

An independent reviewer also exercised two insertions on the same slide with
existing-text edits, reorder, transition and annotations; fresh render/reopen
retained exact IDs, geometry, stacking and authored origins with no pending
edits. A separately injected `Deno.link` failure after QMD publication but
before state/approval publication preserved the original source backup and
pending edits; `recover finish` followed by render completed promotion. Those
runtime probes were temporary `/tmp` fixtures and made no repository changes.

The checks in this document establish source/core/native-document runtime
behavior. The contributor did not open a headed browser or claim new pixel
inspection here; native Studio interaction is validated separately by the
integration owner.
