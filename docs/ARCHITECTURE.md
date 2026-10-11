# Architecture — conceptual target

**State:** agreed architectural boundaries. Implementation began 2026-10-11;
the conceptual examples below are not a claim that every layer is finished.
See [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md) for measured acceptance.

## Current implementation decisions (2026-10-11)

- Deno/TypeScript core and JSON CLI; Quarto executes the supplied environment.
  A final Lua filter captures the executed HTML AST with figure assets. A
  `qbento-html` project extension reuses that AST and executes chunks once.
- Bento 1.2.6 is pinned by revision and shell hash in `vendor/bento/pin.json`.
  The wrapper polls public document/selection APIs; upstream has no public
  subscription API at this revision. A limited bootstrap prevents browser
  recovery/collaboration from replacing project state.
- `.qbento/state.json` stores checksummed baselines, sparse overrides, retained
  decorations and pending semantics. Revision checks and an operation lock
  protect writes. Render and source-sync journals retain recovery artifacts.
- Source synchronization checks exact original spans and whole-plan hashes.
  Approved native creations retain their IDs through explicit QMD markers;
  a separate promotion receipt proves their source acquisition on next render.
- Published HTML carries a generation receipt outside BentoDoc. Capture checks
  it against the saved publication and refuses stale copies before comparing
  edits. This receipt is retained by the pinned native serializer.
- Studio serves an immutable document/revision pair to each iframe. Saving a
  stale tab refuses; rendering temporarily disables editor input. Source writes
  happen only after reviewing and applying a plan.
- Direct Quarto integration currently validates its invoking process through
  Linux `/proc`. Unsafe output overrides are refused before Pandoc can truncate
  the edited HTML. Portable validation remains an unresolved implementation gate.

## Pipeline

```text
presentation.qmd + input files
    ├─ raw QMD scanner: source IDs, exact spans, mappings
    └─ Quarto execution → Pandoc/Quarto AST + computed outputs
                         │
                         ▼
                  Semantic Deck IR
                         │
         design sidecar .qbento/ + assets
                         │
                    Sync / Compose
                         │
                  Bento adapter
                         │
                     BentoDoc
                         │
          ┌──────────────┴──────────────┐
          ▼                             ▼
     .bento.html                    Bento Studio
 (standalone/PDF)        (visual editing + Sync Inspector)
                                        │
                                change journal / diffs
                                        │
                        three-way merge + verified QMD patches
```

### Retained core of the original `overrides.json` proposal

The simple September pipeline is still the right **visual persistence mechanism**:

```text
QMD + inputs → Quarto execution → generated semantic objects (stable IDs)
                                         + .qbento/ visual overrides
                                         + .qbento/ Bento-only objects
                                         ↓
                                      BentoDoc → Bento HTML
```

For a generated figure, the sidecar may retain only values such as `{ "x": 704, "y": 181, "w": 472, "h": 331, "shadow": ... }`, keyed by the stable **slide/element identity**. Quarto re-computes the figure's *content*; overlays preserve its *visual properties*. This need not be one literal `overrides.json`: `slides/*.json` may work better for Git diffs. Store layouts, animations and visual-only shapes in the same design layer. Do **not** persist every generated BentoDoc field as a competing semantic source.

The later **Deck IR** does not replace overlays: it supplies normalized content, IDs and provenance for composing them correctly; **Sync/Merge** handles edits to QMD-backed semantics that simple visual overrides cannot express safely. Its example shape below is illustrative, not schema:

```json
{
  "slides": [
    {
      "id": "results",
      "blocks": [
        {
          "semanticId": "fig-effects",
          "kind": "figure",
          "origin": "computed",
          "producer": "fig-effects",
          "asset": "fig-effects.svg",
          "source": { "file": "presentation.qmd", "marker": "fig-effects" }
        }
      ]
    }
  ]
}
```

Quarto executes R/Python/Julia etc.; the core does **not** require R or implement those computation environments.

## Ownership and responsibilities

| Layer | Responsibility |
|---|---|
| **Quarto format extension** | Custom HTML-derived format (likely `qbento-html`, name TBD), Lua integration, invoke capture/emit/render pipeline, retain ordinary `quarto render` workflow. |
| **Source scanner/map** | Stable semantic IDs, raw byte-range provenance, included/derived block handling, verified source patches. Pandoc AST alone is insufficient for reliable reverse editing. |
| **Deck IR + validators** | Typed neutral semantics and provenance; adapters for Quarto and Bento. |
| **Design state (`.qbento/`)** | Position, size, styles, groups, layouts, theme, effects, decorative objects, asset references, persistent pending-edit/baseline metadata. |
| **Sync/Merge core** | Field-aware three-way comparison, conflict explanations, semantic change proposals and atomic source patches. |
| **Bento adapter** | Map IR + design to upstream BentoDoc; preserve identity, unsupported-fidelity fallbacks and compatible assets. |
| **Bento Studio** | Bento editor plus visible Sync Inspector/diff/review; durable autosave of pending edits and deliberate sync actions. |
| **CLI / structured API** | Human commands and JSON operations consumed by future MCP/agent adapters. |

## Source provenance and identity

- Every source-backed semantic block needs a stable ID and a source anchor that survives nonsemantic edits.
- Explicit `#id` and chunk labels are preferred; insert unobtrusive `qb:*` markers lazily when a reverse mapping needs pinned identity.
- Raw QMD has pre-parse transformations, so reliable source ranges require a scanner/mapping strategy, not only a post-render Lua filter. Investigate Quarto's reader pipeline and [quarto-source-map](https://github.com/posit-dev/quarto-source-map), without assuming they supply all reverse mappings automatically.
- Separate `semanticId`, per-slide visual element `id`, and optional Bento `morphId`. Bento can repeat a visual ID across slides for morph behavior.

## Bento integration and compatibility

Bento's standalone HTML contains a JSON document (the `#bento-doc` script block) with a pure-data model and a bundled app shell. Its upstream model includes text/shapes/images/SVG/charts/tables/media as well as code/embed types; **check source code at the pinned upstream version** rather than assuming documentation and code are always aligned.

- Prefer upstream APIs/hooks; determine whether change, selection, undo, save and load can be integrated without a fork.
- An external Studio wrapper/`iframe` by itself does **not** guarantee reliable real-time change events. Add a minimal adapter if needed; propose upstream hooks first.
- Pin upstream shell/revision and version the adapter contract. Changes to the Bento model must never silently corrupt older projects.
- Save the **Bento `docId`** once in project metadata (likely `.qbento/deck.yml`) and reuse it across all renders. Bento uses it for document identity and IndexedDB autosave/recovery; new independent decks must get new IDs. A re-render must not inadvertently resurrect a stale browser recovery snapshot into the new computed document: Studio's own persisted source/design state is authoritative.
- Preserve original Bento object identity and any user-authored Bento-only objects across regeneration; map a semantic ID plus slide ID to actual Bento element IDs, separately from `morphId`.
- A Bento HTML file is self-saving: edited files can carry user changes solely inside `#bento-doc`. Rebuilding must not overwrite such *unreconciled* local edits without warning/capture. Chromium may rewrite in place with File System Access; other browsers can download a copy. This is a reason to prefer Studio for live sync, **not** a reason to reject a local HTML-capture workflow.
- Preserve the native pure-data principle; do not inject arbitrary executable widget code into BentoDoc. When writing `#bento-doc` into an HTML `<script>` block, **escape every `<` in JSON as `\u003c`**, as required by Bento's splice contract, so embedded text cannot prematurely close the script. Keep the single-file runtime/shell and content format compatible.

Reference: [Bento repository](https://github.com/nyblnet/bento), [model.ts](https://github.com/nyblnet/bento/blob/main/slides/src/model.ts), [format spec](https://github.com/nyblnet/bento/blob/main/docs/format.md).

## Render fidelity and export

- **Static R/Python figures:** prefer SVG where available. Computed source remains computed; Bento controls its frame and visual composition.
- **Simple charts/tables:** native Bento conversion only if sufficiently faithful. Complex `gt`/`gtsummary`/HTML or unsupported charts: static SVG/HTML representation.
- **LaTeX:** keep authored source and source links; display through suitable render projection (e.g. SVG); Studio edits change LaTeX source only via sync.
- **Plotly/htmlwidgets:** maintain a static fallback for Bento standalone/PDF; supported enhanced Presenter widgets may be interactive in a sandboxed host with bundled offline dependencies. Bento's current `embed` element already supports an SVG `view` with optional data, which is useful for static fallback; its native live web iframe is **online-only**, so it does not by itself fulfill our offline Plotly goal. Not all htmlwidgets are guaranteed.
- **Notes, animations, morphs, layouts and themes** are first-class design/output features, with semantic notes synchronized to QMD.
- **Reveal.js:** may be separately rendered from the same QMD but must not promise parity with Bento visual edits.

## Platform and distribution

- **Offline:** core editing, rendering and viewing should not require a cloud service; externally linked assets break that guarantee and must be detected or bundled.
- **Git:** `.qmd`, inputs and relevant `.qbento/` state reconstruct the presentation; generated HTML is optional to commit.
- **Standalone HTML:** editable but independent after distribution; future `qbento import` reconciles changes instead of silently syncing other people's copies.
- **Collaboration:** upstream Bento CRDT is not our QMD merge engine; disable collaborative editing in the first slice.
- **Security:** sanitize source/HTML/SVG; sandbox interactive widgets; avoid leaking collaboration credentials into exported copies.

## Verified integration facts and limits (2026-10-09)

- On local **Quarto 1.10.19**, a throwaway `check-html` custom format with `output-ext: bento.html` successfully generated `demo.bento.html`; this establishes extension/output naming only, **not** a working Bento shell. The unsuffixed `check` format name failed in the same test. The temporary test files were removed.
- Official Quarto [custom-format docs](https://quarto.org/docs/extensions/formats.html) use base-format suffixes such as `-html`; `format: bento` should be treated as an aspirational alias, not an existing supported key. A separate `qbento` CLI does not imply a `quarto bento` subcommand.
- Quarto [pre/post-render scripts](https://quarto.org/docs/projects/scripts.html) can run TypeScript (using Quarto's Deno), R, Python or Lua in project workflows. They provide hooks but do not by themselves solve native Bento HTML assembly, semantic mapping or live sync. The output path and guard against overwriting edited HTML need real integration tests. Vendor required runtime assets for reliable offline builds.
- Upstream Bento exposes document read/replace APIs (`window.bento.doc`, `loadDoc`, `serialize`) and can save the HTML with its `#bento-doc` data block. This supports **explicit read-back** of locally edited HTML. Its internal `Store` has change events, but a stable public subscribe API has not been confirmed; this is the Studio-integration risk.

## Tentative stack and interface

Core/Studio/CLI: **TypeScript**, runtime **Deno**; Quarto hooks **Lua + TypeScript**; **JSON Schema** contracts; packaged multi-OS CLI. Test on Linux first, target macOS and Windows as well.

Planned CLI: `qbento edit`, `render`, `status`, `diff`, `sync`, `validate`, `doctor`. Structured operations may include `deck.get`, `element.patch`, `slide.create`, `slide.move`, `sync.preview` and `sync.apply`. MCP later wraps the same core (not a separate implementation).

Exact repo layout, APIs, schema versions, asset encoding and binary distribution are still to be validated.
