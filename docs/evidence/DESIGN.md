# Source-side design helpers: measured contract

This slice implements helpers for source attributes and native component projection.
It does not by itself wire the CLI, Studio or complete projector: those callers must
use the returned ownership and bindings as described below. Evidence uses Bento
revision `3d6f7f1fcdf2308e875345ce4f1e0ec0820c914b`, the vendored native schema, and
actual Quarto **1.10.19** execution.

## Supported vocabulary

`parseDesignAttributes(PandocAttr)` recognizes explicit native geometry `x`, `y`,
`w`, `h`, `rotation`, `opacity`; text style `font-size`, `font-family`, `font-weight`,
`line-height`, `letter-spacing`, `color`, `align`, `valign`; and shape style `fill`,
`stroke`, `stroke-width`, `radius`. Camel-case native aliases are accepted, but
simultaneous aliases for one property are rejected. Values have finite numeric
bounds matching the pinned native fields (positive dimensions), a bounded hex/named
color vocabulary, plain font stacks, and native alignment enumerations. CSS source,
URLs, NaN, infinity, malformed values and incompatible target types are refused.

Plain Markdown and unrelated ordinary attributes are unchanged. Unknown
`.bento-*` components and unknown attributes inside a supported component produce
a diagnostic; they are not flattened silently.

Initial components require explicit stable IDs:

```markdown
:::: {#comparison .bento-layout layout="two-column"}
::: {#left .bento-card fill="#eefaff" font-size="28"}
### First finding
Meaningful authored text.
:::
::: {#right .bento-card}
### Second finding
More authored text.
:::
::::
```

A card generates one native rounded rectangle background plus grouped native
content. Its fixed initial padding is 24 and gap is 16. A layout uniformly fits each
semantic child subtree into a column, keeping figure aspect ratios and relative
subtree placement. Built-in `two-column` expects exactly two children and uses gap
32. Incorrect child counts and dimensions that cannot fit the padding are errors.
Custom reusable layouts are validated JSON `{ columns, gap, padding }` definitions,
with 1–6 columns. Unsupported component rotation refuses rather than rotating every
child incorrectly. Nested components must be applied from children outward.

## Projector/state integration seam

- `applyElementDesign(element, declaration)` returns `element`, `ownedPaths`, and
  native-field → original-attribute `bindings` for a directly mapped object.
- `applyComponentDesign(children: Element[][], declaration, defaults)` returns
  `elements`, `ownershipByElement`, `bindingsByElement`, and `decorativeIds`.
  Callers merge nested ownership and map element IDs to the slide-specific
  `targetKey({slideId, elementId})` expected by the state layer.
- Pass ownership to **both** `createState` and `compose`. Explicit QMD fields then
  become pending semantic differences on a native edit; incompatible independent
  QMD/native edits produce conflicts. Unspecified geometry/style remain sidecar
  overrides. Do not ignore the ownership result.
- Bindings must also retain the declaration's `sourceId`. Card backgrounds listed
  in `decorativeIds` must be classified as generated decoration, never as a reason
  to delete the meaningful source div when a user removes its background.
- Explicit component frames affect several native frames together. Their child
  `x/y/w/h` fields are marked owned **without** inverse bindings: moving one child
  cannot safely infer a parent attribute patch. Refuse that reverse operation and
  let the user change the parent source declaration. Likewise, a typography field
  inherited by several text children requires reconciliation as one parent
  declaration, not independent contradictory writes.
- `DesignDefaults` is serializable JSON containing optional `frame`, `theme` and
  `layouts`; `validateDesignDefaults` validates it and `designTheme` emits native
  theme defaults. The integrating project layer must persist/reload reusable
  definitions in `.qbento/`; the helpers do not create a second storage authority.
  Existing state capture/compose retains edits to emitted theme fields and layout
  element frames, as verified by tests.

## Bounded source patches

`previewAttributePatches(scanSource(text), requests)` returns a reviewable preview.
Each request contains `{blockId, attribute, value, expected?}`; `null` removes a
visual attribute. `applyAttributePatches(currentText, preview)` only accepts the
unchanged source and an exactly regenerated preview. Neither helper writes files;
the existing approved source transaction must publish the returned text.

The initial mapped subset is an existing attribute block on an identified heading,
fenced div or displayed-code fence. Original UTF-8 offsets, CRLF, quotes, other
attributes, source text and computational code are preserved. Existing values are
patched alone; insertions occur at the closing attribute brace. Duplicate/aliased
keys, altered previews, scanner structural diagnostics, changed expectations,
unpinned identities and unknown attributes are rejected.

Computed chunk option lines (`#|`) are deliberately not treated as visual
attributes. Put figure design on an identified source wrapper. Inline images,
complex escaped attribute syntax, layout-name/class mutations and arbitrary CSS
reverse mapping need separate verified source support. Attribute editing does not
rewrite Pandoc Markdown or change semantic IDs.

## Evidence and remaining validation

```sh
deno check src/render/design.ts src/source/attributes.ts
deno test --allow-read --allow-write --allow-env --allow-run tests/design_test.ts
```

Six tests cover plain content, owned-field capture/conflict behavior, source patch
safety and tampering, UTF-8/CRLF preservation, native component field compatibility,
theme/layout sidecar retention, and actual executed AST attributes around a named
R/SVG figure. These establish helper/static/execution behavior; end-to-end Studio
controls and browser visual checks remain integration work. The complete component
vocabulary in `AUTHORING.md` remains the target rather than a claim that every
component is implemented here.
