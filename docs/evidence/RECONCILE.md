# Explicit conflict reconciliation

`previewReconcile` executes fresh Quarto input and composes a non-published
comparison. It binds source bytes, saved state revision/hash and projected
document/provenance/ownership to the review plan. No source, saved state or output
HTML is changed by preview; execution artifacts are refreshed under `.qbento/build`.

`applyReconcile` executes again and compares the complete authoritative plan.
Changed source, state, computation or a modified plan refuses all decisions.
Accepted decisions save state only; source synchronization remains a separate
preview/apply operation. Computed edits offer explicit detach or source restoration.
Authored conflicts also offer retaining the Bento value against the reviewed QMD
baseline. Unselected changes remain pending. Source-owned visual conflicts remove
the superseded overlay so the same resolved conflict cannot silently reappear.

The CLI exposes `reconcile source.qmd`, followed by
`reconcile source.qmd --apply resolution.json`, where the file contains
`{ "plan": <reviewed plan>, "choices": [{"changeId":"...", "action":"keep-source"}] }`.
Actions are `keep-source`, `keep-bento` or `detach` as permitted by each plan item.
Studio exposes the same operations through **Comparar con QMD** and **Guardar
decisiones**. The interface states that comparison executes the document.

Unit tests cover no-write previews, explicit authored/computed choices, stale
plans/state/source/computation, duplicate choices and removal of superseded visual
overrides. The separate execution test exercises the real Quarto conflict →
reviewed Bento choice → explicit QMD sync → fresh render path. Browser confirmation
of the new dialog was also performed on 2026-10-11 in Chromium using the actual
native text editor and parent Studio controls. An independent QMD edit produced
a visible three-value conflict. Choosing `keep-bento` kept QMD byte-identical;
the subsequent separate review/apply/recalculate cycle changed only the approved
paragraph and returned to zero pending changes. Screenshot inspected:
`output/playwright/conflict-review.png`. The test used a temporary project copy.
