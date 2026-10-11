# Remaining functional acceptance work

This checklist follows the full product objective. Passing the integrated Linux
suite does not prove requirements outside its fixtures. Current validation is
limited to the owner's Linux machine; other operating systems and hosted CI are
deferred. Public release scope is a separate decision.

## Verified gaps at `0bf0d9c`

### Plain QMD source mapping and reviewed identity acquisition

The authoring contract explicitly supports plain QMD. A real Quarto repro with
`## Slide` followed by `Texto original.` opens and saves a native text edit.
Sync preview/apply accepts its bounded paragraph patch, but the following render
fails with `AMBIGUOUS_IDENTITY`. Source already contains the approved edit;
pending content and saved geometry remain recoverable. The same plain fixture
with `Texto **importante**.` fails the initial projection with
`UNMAPPED_PROVENANCE` because the unlabelled fallback compares raw Markdown with
rendered HTML.

The required fix must establish faithful original-source mapping for the
supported inline subset and complete the approved edit/rebuild loop. Any needed
identity acquisition belongs in an inspectable source plan; Save/render must not
pin source implicitly, and unrelated external edits must retain the current
identity protections. Other unedited weak bindings, document/native identity,
saved geometry and source bytes outside reviewed patches also need proof.

The real repro and temporary fixtures are recorded in
`/tmp/qbento-functional-audit.log`. Implementation and independent review are in
progress.

### Confirmed deletion of a source-backed element

The [sync contract](SYNC.md) includes verified source-backed slide/element
deletion. Existing slide deletion is implemented. Removing the identified
authored body `body/paragraph:1` from a native slide and saving creates a
durable `delete-element` pending change, but current sync returns
`UNSUPPORTED_SYNC` even when its ID is explicitly confirmed. Studio's
confirmation UI only handles slide deletion.

A complete slice needs an exact source-block proposal, specific confirmation,
recoverable pending deletion/restoration, checked application and regeneration
that removes only the approved object and its retained design. Computed/shared
producers and ambiguous structure must refuse before publication. Restoring a
pending deletion must retain pre-existing pending content and visual edits.
Implementation and independent review are in progress.

### Meaningful Studio-created cards and KPIs

[WORKFLOWS.md](WORKFLOWS.md) and [DECISIONS.md](DECISIONS.md) require meaningful
content inside a newly created card/KPI to become a pending semantic component,
then a source-backed fenced div after reviewed sync. Standalone new text now
works; the current insertion path rejects grouped text, and `.bento-kpi` has no
projection adapter.

The missing slice needs explicit semantic intent and membership. Spatial
proximity or arbitrary native grouping must not silently establish source
structure. Authored text belongs in QMD; decorations/geometry remain in the
sidecar; a computed value keeps its producer. The original contract permits
defining the exact component schema as implementation work.

### Declarative diagram and timeline adapters

The [target component vocabulary](AUTHORING.md) names `.bento-diagram` and
`.bento-timeline`. Both currently refuse with `UNSUPPORTED_COMPONENT`, as does
`.bento-kpi`. A documented explicit node/edge or milestone structure and
faithful native adapter are still needed. Native shapes/connectors are
presentation; their meaningful labels and sequence/relationships need source
authority. Universal diagram or HTML conversion is not required.

## Boundaries that do not establish missing universal features

Unsupported arbitrary widgets, general TeX, ambiguous source spans, automatic
computed-value reverse edits and inference of an entire parent transform from
one child remain legitimate refusals. They must not be used to excuse the
ordinary authoring and explicit component scenarios above. Each gap closes only
with its relevant source/runtime/native evidence, not by renaming it a limit.
