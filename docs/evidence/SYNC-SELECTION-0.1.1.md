# Prepared Linux 0.1.1 correction evidence

Date: 2026-10-17. This receipt covers corrections prepared after the app/plugin
contrast review at source `a1b8025`. The skill/plugin repository is outside the
change scope. Package `0.1.0` remains the last publicly verified release until
separate publication confirms `0.1.1`.

## Corrected behavior

- Read-only project access verifies `.qbento/project.json` against the requested
  QMD. `status`, `diff`, `get`, saved-state readers and Studio startup refuse a
  sibling source. A genuinely uninitialized project reports `NO_BASELINE`; an
  existing state whose source metadata is absent refuses
  `PROJECT_BINDING_MISSING`, including automatic Studio initialization and
  explicit render.
- CLI `--select selection.json` and Studio use the same strict versioned
  selection request. Document ID/revision, pending IDs, component dependencies
  and selected destructive confirmations are verified before preview.
- Apply retains exact-plan/source/revision checks. Supporting identities and
  annotations remain visible in the complete proposal. Excluded work remains
  pending; selections that would delete excluded target/subtree edits refuse.
- Semantic pending entries are intentionally retained after writing QMD until a
  later render verifies them. Receipt fields and approval-related refusals are
  explained in the app guides, with an explicit Studio message.

## Validation

Runtime correction commit: `32bb946`. Independent code review found and then
rechecked destructive selection dependencies, new-project CLI bootstrap and
missing-binding refusal. Each was corrected before the final validation run.

Focused checks passed: eight source-binding regressions; eight selection/CLI
startup tests; eleven existing sync and five structural tests; Studio selector,
body-limit, busy-Apply and deletion-confirmation regressions. Real headless
Chromium verified selected Apply followed by render, retaining two excluded
pending changes, document identity and exact saved design. These checks do not
establish arbitrary visual quality or desktop/other-platform acceptance.

The installed npm smoke passed on the frozen implementation: 122 tarball files,
all 117 runtime payload hashes, offline temporary installation, prefix
relocation and state-only reconstruction. It also exercised selected sync,
receipt/pending semantics, final render and sibling-source refusals for
status/diff/get/edit. There was one pending edit before sync and zero after
verified render; content, geometry and docId were retained. It changed no user
installation/configuration.

Type checks, lint (211 files), formatting (213 source/script/test files) and
whitespace checks passed. A legacy component-deletion test was extended to
reject incomplete destructive selection and then explicitly review all affected
pending edits; its original remaining-state assertions are preserved and its
real Quarto rerun passed.

Final broad-suite and clean-artifact results will be appended when complete. The
first broad pass was deliberately stopped after the implementation froze; its
earlier legacy fixture failure is not relabeled as a passing run. No registry
publication is inferred from source or local package checks.
