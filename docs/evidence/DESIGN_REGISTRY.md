# Registry, palette and motion acceptance

This bounded slice was tested on Linux with Deno 2.9.6, Quarto 1.10.19 and Bento
1.2.6 at pinned revision `3d6f7f1fcdf2308e875345ce4f1e0ec0820c914b`. It covers
the [local registry contract](../DESIGN_REGISTRY.md), deterministic projection
with retained native visual state, and concrete native playback.

Focused validation command:

```sh
deno test --allow-read --allow-write --allow-run --allow-env --allow-net=127.0.0.1 tests/registry_test.ts tests/registry_execution_test.ts tests/components_execution_test.ts tests/design_test.ts
```

The combined focused run passed **20 tests, 0 failures** in 50 seconds. Type
checking, lint and formatting checks passed.

The registry tests validate bounded JSON/schema/name/value rules, exact-byte and
absence compare-and-swap, symlink/size rejection, a real three-column Quarto
projection, explicit QMD color authority, native theme/palette/code-palette
retention and motion fields. A project copy containing QMD, registry and state
rebuilds without generated HTML/build files to the same emitted JSON and
`docId`. Invalid registries refuse before an R producer runs in both CLI and
installed ordinary Quarto hooks. A producer changing the registry aborts
publication. Source-owned palette references remain pending and block recompute;
semantic references on slides, template layouts and elements refuse without
changing the state revision or QMD. The whole-map ownership boundary is
deliberate: any explicit QMD design attribute makes that object's entire
`themeRefs` map owned.

An independent reviewer reproduced the original same-color bypass against the
pinned native palette resolver: adding `themeRefs.color` could override explicit
QMD color after an accent change without pending state. The corrected public
Save/render flow retains that edit pending and refuses `UNMAPPED_DESIGN`.
Independent runtime checks also reject semantic/resource references on slide
notes, layout notes, layout-element HTML, image src, SVG asset and media poster.
The review found no other concrete open issue in this bounded slice.

## Native editor and playback

The fixture at `/tmp/qbento-registry-native/deck.qmd` was rendered with Quarto
and opened through Studio in Chromium using the pinned native editor. Its two
slides use three named registry columns and identified cards. Actual UI edits
changed Theme Accent to `#aa3377`; selected source bodies through Layers;
assigned both bodies Morph id `alpha-pair`; selected `fade-up`, Count up `on`
and Reveal step `1` on the first; moved the second body's X to `200`; and
selected the second slide's `morph` transition. Studio Save and Recompute
retained these changes with stable `docId`, revision 3 and zero pending changes.
Palette accent is independent from unreferenced card stroke literals, as
documented in the registry contract.

The following screenshots were actually inspected:

- `output/playwright/registry-native-after-recompute.png`: native editor with
  readable three-column cards and retained native accent after recomputation.
- `output/playwright/registry-native-morph-destination.png`: native slideshow
  destination, with the paired text at its retained destination position.

Playback was triggered with the native Slideshow UI and actual ArrowRight keys.
A DOM-only `requestAnimationFrame` sampler observed 110 frames for the first
reveal: text started hidden, became visible, counted from 0 through intermediate
values to 42, opacity moved from 0 to 1, and vertical translation moved from 16
pixels to none. A second sampler observed 89 frames on the destination element,
including 40 distinct X positions from approximately 114 to final 200 and a
transient translation returning to none. These are concrete runtime proofs of
reveal/count-up/fade-up and paired morph interpolation after Save/Recompute; the
still images alone do not establish animation.

The core retention test also checks `present.morphSeconds`, controls and slide
number configuration; custom duration was not separately exercised through the
native UI. No universal animation, all-symbol morph, nonlinear path, native
registry editing, platform parity or full release acceptance is claimed. The
entire repository suite was not run for this isolated slice.
