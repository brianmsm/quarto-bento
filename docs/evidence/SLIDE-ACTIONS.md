# Reversible slide actions and separately confirmed source deletion

Evidence recorded 2026-10-11 on Linux with Deno 2.9.6, Quarto 1.10.19 and Bento
Slides 1.2.6, pinned revision `3d6f7f1fcdf2308e875345ce4f1e0ec0820c914b`.

Studio's **Diapositivas** dialog now offers hide/show and pending
delete/restore. It saves the native editor before each action, checks the
editor's revision, and reloads the managed editor only after the durable state
receipt. The server uses the existing loopback/session-token/origin checks,
bounded streaming body reader, project lock and compare-and-swap revision. The
uncaptured-HTML guard also runs before these actions.

## Contract and recovery

- **Ocultar/Mostrar:** `slide.hidden` is visual sidecar state. QMD and semantic
  pending edits remain intact. A fresh render retains the hidden flag and the
  pending authored content. This uses upstream's existing flag, without a Bento
  fork. Upstream `slides/src/model.ts` defines `inLinearFlow` as neither a state
  nor hidden; ordinary navigation and `editor/editor.ts`'s PDF print-page loop
  skip those slides. Hidden slides remain available in the native editor and can
  still be explicitly reached by native links.
- **Marcar para eliminar:** removes the slide from the current editable deck and
  records a pending deletion. It does not modify QMD. The original baseline,
  pending semantic fields, visual overrides, element order and decorations
  remain available for restoration.
- **Restaurar:** reconstructs the slide from those retained records, cancels
  only its pending deletion, and preserves its other edits. The optional
  `delete-slide.restoreOrder` records the observed order before removal and
  survives capture and rendering. Restoration uses the closest surviving
  successor, then predecessor, without reordering survivors. Older pending
  records without this evidence use baseline order as a fallback. QMD must still
  contain the slide; after an approved source deletion, restoration requires
  recovering QMD from history and recalculating instead of silently recreating
  semantic source.
- **Eliminar de QMD:** the separate review dialog starts with each deletion
  confirmation unchecked. Checking it prepares an inspectable plan containing
  the exact removed section and final QMD. Applying that checked plan performs
  the existing recoverable source transaction. A late preview reply cannot
  enable Apply after confirmation is withdrawn. Pending edits clear only after
  execution confirms source agreement, and only the deleted slide's design is
  retired.

Deletion checks run both before marking and during source preview/apply. They
refuse computed producers, unsupported source/dependencies, surviving native
slide-state/element links, known source references, and deletion of the last
editable slide. A new slide must first acquire source through reviewed sync; it
can be hidden meanwhile. Source-reference protection covers terminal citation
punctuation such as `@body.`, Markdown fragment links, and authored inline HTML
`href="#id"` links, including quoted/unquoted attributes and percent/numeric
entity encodings. This remains a conservative guard for the supported source
grammar, not a general dependency analyser for arbitrary executable output.

## Focused validation

```sh
deno test --allow-read --allow-write --allow-env --allow-run --allow-net=127.0.0.1 \
  tests/slide_actions_test.ts tests/source_structure_test.ts \
  tests/studio_test.ts tests/studio_body_test.ts tests/state_test.ts
deno check src/core/slide-actions.ts src/studio/server.ts tests/slide_actions_test.ts
deno lint src/core/slide-actions.ts src/studio src/source/structure.ts \
  src/state/types.ts src/state/merge.ts tests/slide_actions_test.ts \
  tests/studio_body_test.ts tests/source_structure_test.ts
git diff --check
```

**45 tests pass**, plus type/lint/diff checks. Four slide-action tests execute
actual Quarto renders. They cover pending text and shape design through
hide/render/show/delete/render/restore, stable `docId`, stale revisions,
computed and linked-slide refusal, new-slide and last-slide protection, separate
HTTP deletion approval, source/design retirement after sync, and restoration
refusal once source has been removed. The order regression verifies
`[end,start,appendix]` survives a directly captured native deletion, render and
restore; a later reordered survivor sequence remains unchanged by restoration.
The source, state, existing Studio and body-cap tests cover the shared seams
affected by these additions. The full suite was not rerun for this bounded
change.

## Browser evidence

A dedicated headed Chromium session opened `qbento edit` on a temporary
three-slide fixture. Native Bento showed the hidden marker; the Studio dialog
showed **Oculta** and **Mostrar diapositiva**. The browser then showed, marked,
restored and marked the appendix again. The QMD was byte-identical before source
approval. Review kept Apply disabled with the confirmation unchecked; checking
it showed the exact appendix section. A deliberately delayed preview response
followed by unchecking left Apply disabled. Checking again and applying removed
only the approved appendix section; recalculation reopened the native deck with
`start,end` and no pending changes.

The screenshots were opened and visually inspected:

- `output/playwright/slide-hidden.png`
- `output/playwright/slide-delete-preview.png`

They are ignored local validation artifacts. The browser console contained the
existing favicon refusal and blocked upstream update-manifest request under the
offline CSP. PDF omission is verified against the pinned native print-page code;
this evidence does not claim that a PDF artifact or print dialog was visually
reviewed. It also does not establish a full product release boundary.
