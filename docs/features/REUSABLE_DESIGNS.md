# Reusable presentation designs

Owner-authorized feature, 2026-10-18. Implementation branch:
`codex/reusable-designs`. This feature extends the supported Linux workflow;
it does not declare a stable release or authorize npm publication.

## User outcome

An author creates a course design once and reuses it in independent QMD
presentations. Humans use Studio and agents use JSON/CLI operations backed by
the same checked core. A local Reveal.js reference can supply an explicitly
mapped adaptation draft. Ordinary editing and rebuilding remain offline.

The motivating reference is a locally authored Metropolis presentation with
session CSS: dark title bars, magenta section dividers, pink/teal cards and
legible code/captions. The course remains a read-only reference. No session
content, student material, figures or private assets belong in a shared design.

## Required behavior

- Keep existing registry/state schema versions and four-field themes working.
- Add bounded text/code/card styles and named slide variants with explicit
  frames and pure visual decorations. Keep source selectors separate from
  existing KPI `bento-role` attributes.
- Apply design defaults before measuring native content. Explicit QMD styles
  retain their authority; saved native overrides and pending semantics survive
  design import, render and subsequent design updates.
- Share a versioned JSON design package, independent of a deck's identity,
  semantic content and saved state. Import by value into the target registry.
- Inspect and preview the complete replacement before applying it. Bind the
  plan to the target document, revision, source and exact registry bytes.
- Use the existing registry save journal and recoverable history. Import never
  implicitly rewrites QMD, executes code or publishes generated HTML.
- Expose export/preview/apply in CLI and Studio. Preserve advanced definitions
  when the basic registry form edits the original four theme fields.
- Adapt explicit samples of inlined Reveal CSS in an isolated installed
  Chromium, without running reference scripts or fetching external resources.
  Report selectors, source digest, excluded dependencies and limitations
  separately from the pure-data package.

## Design boundaries

Packages contain definitions, never `.qbento/state.json`, native semantic
templates, executable CSS/JavaScript, arbitrary assets, paths or URLs. Each
presentation keeps its own document identity and local registry snapshot.
Shared package updates require another explicit preview/application.

Text/card styles and native slide variants are supported vocabularies rather
than a universal CSS translator. Adaptation does not convert course content,
infer arbitrary grid/flex layouts or rewrite statistical figure code. Fonts
remain supplied by the user; no network font installation is introduced.

## Acceptance

1. Two independently rendered decks import one reusable design and retain
   different document identities with matching design defaults.
2. A saved native visual override and pending authored edit survive import,
   recomputation and a subsequent design update; QMD remains byte-identical.
3. Rich definitions survive native export/import and basic Studio form edits.
4. Invalid packages, unknown selectors, foreign documents, changed source,
   changed registry bytes and stale plan revisions refuse safely.
5. Real Quarto execution and Chromium show title/section variants, styled
   cards, code and ordinary text; subsequent data regeneration retains design.
6. An explicitly mapped local Metropolis/SPP reference produces a bounded
   adaptation draft. Script execution and external fetching remain disabled.
7. A relocated packaged application can perform the new operations offline.

## Work units and evidence

Implementation and validation receipts will be recorded here before closeout.
Independent renderer, package core, adaptation and Studio worktrees are merged
into the integration branch before the complete acceptance run.
