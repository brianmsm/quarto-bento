# Ordinary pipe tables and reviewed identity acquisition

A plain, uncaptioned pipe table no longer requires an authored fenced-div
wrapper for its initial render. The existing bounded native table codec is
retained: exact literal cells and alignment, no spans/rich-cell conversion,
and measured complete row geometry. This adds ordinary source mapping and
identity persistence; table-cell reverse synchronization remains unsupported.

## Original-source proof

The original scanner still classifies the table fragment as `unsupported` for
semantic editing. A separate literal-table parser proves its original bytes,
authorship and complete structure. The executed native table must match every
cell, alignment, header and column weight. Bare tables match exactly one whole
original fragment. Identical bare tables are ambiguous and require explicit
source wrappers; a table is never assigned to the first plausible candidate.
Caller-supplied source metadata cannot substitute different original bytes.

The resulting native object is checked against its original source slide.
Invented groups, transformed cells, forged source markers, and missing source
tables refuse. Coverage continues after identity acquisition: removing the
entire identified wrapper cannot evade the per-table check. Execution filters
cannot introduce or replace a table's `bento-element-id` declaration.

## Save, review, sync and rebuild

[The example](../../examples/plain-tables/deck.qmd) starts with an ordinary
heading, pipe table and paragraph, without explicit source IDs. Visual table
position/style changes are stored in `.qbento/`. Editing a paragraph and
reviewing source synchronization also acquires an explicit table identity.
The inspectable patch inserts one source wrapper with `bento-element-id`,
preserving the literal table bytes and existing native ID. Only an approved
Apply writes that patch.

An approval carries the exact before/after source provenance plus a hash of
native table content (header, column weights, cells and alignments). The fresh
render must prove both the source binding and content hash before adopting
that identity. Geometry/style are not part of the semantic hash, so saved
visual changes remain authoritative. Altered or stale review plans refuse.
This does not make arbitrary `unsupported` blocks editable.

Changing a cell in Bento still saves a recoverable pending semantic edit;
source sync refuses `UNSUPPORTED_SYNC` rather than guessing a QMD patch.
Change those cells in QMD and recalculate, or explicitly resolve the pending
change. The QMD is not silently rewritten.

## Linux evidence

The focused tests in `tests/plain_tables_test.ts` use actual installed Quarto
and the project core. They cover exact literal proof, ambiguous duplicate and
transformed tables, forged caller metadata, Save/review/Apply, retained x=115
and opacity=.85, stable `docId` and native table ID, exact reconstruction from
QMD/project/state without generated HTML, recoverable unsupported cell edits,
and atomic filter refusals retaining original source/state/publication bytes.
Existing table, composed-table and chart regressions retain their numerical,
visual and computed-producer checks.

```sh
deno test --allow-read --allow-write --allow-env --allow-run \
  --allow-net=127.0.0.1 tests/plain_tables_test.ts tests/table_test.ts
```

After rebasing onto the integrated producer/chart baseline `b5923c2` and the
weak math/code source-scope fixes, 24 combined tests passed in 1m14s: plain tables,
existing tables, weak math/code identities and chart source context. That result
preceded the additional explicit native-identity and whole-wrapper-coverage
regressions and is not a full-suite result. After adding those checks, the final
focused run passed **19/19 in 46s** (five plain-table tests, six composed-table
tests and eight chart tests). Source type checking, targeted lint/format and
`git diff --check` passed. Independent review separately checks identical
authored/computed table data, CRLF/Unicode and execution counters.

The native renderer is unchanged. This receipt demonstrates core operations
and real Quarto execution, not a manual Studio table interaction. Native table
DOM/visual acceptance is recorded in [TABLES.md](TABLES.md) and
[COMPOSED-TABLES.md](COMPOSED-TABLES.md). Linux is the only executed platform.
