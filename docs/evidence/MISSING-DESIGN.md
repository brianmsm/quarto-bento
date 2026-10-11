# Missing external design diagnostics

Bounded implementation evidence, 2026-10-11. This verifies design availability
and actionable warnings; it does not certify recovery of the original visual
appearance.

## Contract

`readDesignAnnotations` inspects the original source mapping. It reuses the
strict managed-comment parser and original heading-attribute tokens. A real
`.qbento-design` class on a source slide heading is a minimal trace. A valid
managed detailed comment directly following that heading identifies its slide,
sidecar references and categories. A detailed comment is meaningful even if its
optional heading class is absent.

YAML frontmatter, fenced code, executable chunks, display math, quoted attribute
values and indented code are not managed reference comments. Comments at zero
through three spaces remain recognized; four spaces or a leading tab remain
literal. Installed Quarto/Pandoc 1.10.19 represents unindented comments as
`RawBlock`, one-to-three-space comments as paragraph `RawInline`, and four-space
or tab-indented text as `CodeBlock`. This is parser verification, not a promise
of general native projection for arbitrary raw HTML or indented code.

`MISSING_DESIGN` contains `slideId`, `reference` and an actionable message. A
minimal class has no exact sidecar information, so its reference is `.qbento/`.
Detailed warnings identify `.qbento/state.json` or `.qbento/design.json` and
missing categories. A valid registry theme or a used named registry layout can
satisfy a generic minimal trace; an unused registry entry cannot. Detailed
references require every declared corresponding category: an override does not
hide missing decorations, and an active theme does not hide a missing layout.

Native creation design changes representation during approved synchronization. A
pending mapped creation counts as available before recomputation. After
promotion, retained overrides, decorations or stacking on that same slide can
satisfy its descriptive `created-design` category. This equivalence affects only
the warning; it never approves a creation, establishes semantic authorship,
changes ownership or bypasses the existing checked promotion operation.

The diagnostic tells the user to restore the referenced `.qbento/` data from Git
or backup, then render again, or explicitly resolve an obsolete trace through
reviewed sync. Rendering a base deck is allowed and leaves QMD untouched.
Presence of current or newly saved design is not proof that the old visual
appearance was recovered. Malformed/conflicting managed annotations instead
produce `UNVERIFIABLE_DESIGN_ANNOTATION` during inspection; strict source sync
continues to preserve and refuse those unsupported annotations.

## Persistence and integration

No state schema, additional receipt or diagnostic sidecar is introduced. Every
read/render compares original traces with available saved external signals. An
empty freshly generated baseline has no such signals and cannot suppress the
warning on the next render or reopen. A detailed reference to an absent registry
also remains missing when valid visual state exists. A source-only rebuild of a
previously created slide warns until design is supplied or its obsolete trace is
explicitly resolved. Save/render do not add, remove or normalize QMD traces.

`projectProjection` includes warnings for both core render and ordinary
`qbento-html` post-render publication. `readProjectDiagnostics(source)` provides
the same evaluation without Quarto execution, source changes or state writes,
including before a baseline exists. CLI JSON already retains render diagnostics;
the ordinary hook prints their code/message. Studio integration consumes this
separate read-only diagnostic result and render responses; it must display the
warning on opening and after Recalc, without representing it as a pending edit.
UI delivery/runtime evidence belongs to the coordinating integration.

Corrupt state, invalid/unsafe registries and an unresolved
`.qbento/design-save.json` transaction remain failures. The annotation registry
snapshot calls the shared `assertDesignRegistryReady` guard before its raw-byte
read; preview/apply cannot infer missing/default registry data during an
interrupted save. Registry hashes still use exact bytes including a UTF-8 BOM.

## Focused verification

```bash
deno test --allow-read --allow-write tests/design_diagnostics_test.ts tests/annotations_test.ts
# 24 passed: 9 availability/parser regressions and 15 existing annotation contracts.
deno test --allow-read --allow-write --allow-env --allow-run tests/design_diagnostics_execution_test.ts
# 6 passed on Linux; /tmp/qbento-missing-design-final-real.log
```

Real tests verify CRLF/Unicode source preservation, read-only diagnostics before
state exists and after reopening, repeated core and ordinary Quarto renders,
missing registry with present design, invalid-registry refusal, approved native
creation with retained x=200/x=300 and decoration, a source-only creation
rebuild, and refusal of diagnostics/preview/apply while a registry-save marker
exists with the registry either present or absent. The latter preserves exact
QMD and state bytes, including an already reviewed sync plan.

Type checks, lint, formatting and diff checks cover changed modules/tests. No
full suite, hosted CI, native macOS/Windows or browser/desktop visual claim is
made by this slice. The peer registry implementation is a prerequisite; its
reviewed file SHA-256 is
`7ecaf8f8b6a4f2364b2dde1f64643b9ee5f4bd6f98fe80d80add6ad1a0ad3f7e`. It is
deliberately excluded from this diagnostic commit.
