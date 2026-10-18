# Reusable theme rendering receipt

Validated locally on Linux on 2026-10-18 with Quarto 1.10.19, Deno 2.9.7, and
the unchanged pinned Bento 1.2.6 schema and shell at revision
`3d6f7f1fcdf2308e875345ce4f1e0ec0820c914b`.

This receipt covers the rendering layer of reusable course designs. It does not
establish automatic Reveal.js CSS conversion, exact font availability,
foreground browser appearance or other-platform acceptance.

## Bounded registry data

`DesignRegistry.schemaVersion` remains 1. Its existing required four theme
properties remain compatible. A selected theme can additionally declare:

- `styles`: defaults for `title`, `heading`, `body`, `code`, and `card`.
- `namedStyles`: up to 64 safe names, each with `target` (`text`, `code` or
  `card`) and `properties`.
- `variants`: up to 32 safe names, each accepting `background`, `title`
  typography, `titleFrame`, `contentFrame`, and `decorations`.
- `defaultVariant`: an explicit reference to a declared variant, used for
  ordinary slides without a specific variant.

Text properties are `fontSize`, `fontFamily`, `fontWeight`, `lineHeight`,
`letterSpacing`, `color`, `align`, and `valign`. Code excludes `fontWeight` and
`letterSpacing`. Card styles additionally accept `fill`, `stroke`,
`strokeWidth`, `radius`, and `opacity`; these five fields style its background.
Card typography supplies defaults for children. Code children exclude the two
unsupported text metrics from inherited card defaults. Geometry belongs to
variant frames or explicit source/native geometry, not named styles.

Each frame is exactly `{x,y,w,h}` and fits the 1280 × 720 canvas. A variant can
provide up to 32 rectangular decorations, each with a safe unique `id`, `x`,
`y`, `w`, `h`, `fill`, and optional `stroke`, `strokeWidth`, `radius`, and
`opacity`. All numeric values are JSON numbers with bounded native values;
colors and font stacks use the existing literal safe vocabulary. No semantic
content, arbitrary CSS, URLs, executable code or native `themeRefs` is accepted
in these new registry fields.

Select named styles with `bento-style="question"` on an explicitly identified
`.bento-card`, or on an identified heading, displayed code fence or div
containing exactly one compatible text/code object. Select a slide variant with
`bento-variant="section"` on an explicitly identified top-level level-2 heading.
The KPI `bento-role` syntax retains its independent meaning.

Styles apply before card row measurement and placement. In increasing precedence
the layers are: base theme, inherited card typography, semantic role defaults,
named text/code style, explicit QMD properties, retained native visual
overrides. Explicit source fields retain their source ownership; registry
defaults do not acquire it. Child colors and font families survive composition
into surrounding cards. Source styles and variants are recovered from original
QMD if Quarto removes those attributes; changed or forged executed selectors
refuse.

A variant applies its frames and background to the new slide, with a fresh
context for the following slide. Decorations have deterministic IDs of the form
`<slide>/qb-theme/<variant>/<decoration>` and `designOnly` provenance. Origin
validation checks the original slide heading, selected explicit/default variant,
exact deterministic identity and the complete bounded fresh rectangle. Native
BentoDoc `theme` receives only its four base properties; the reusable registry
structures never leak into that native theme.

A default variant with decorations requires the original content to begin under
a slide heading. Content before the first heading refuses before Quarto executes
with `THEME_INTRO_HEADING_REQUIRED`, instructing the author to start with, for
example, `## Introduction {#introduction}`. This does not broaden the existing
bounded source mapping for an implicit `qb-introduction` slide. Ordinary
undecorated theme preflight retains its prior behavior.

## Verification

`tests/reusable_design_test.ts` checks valid/invalid schema data, unknown names,
target compatibility, source identity and scope, restored original selectors,
explicit QMD precedence, native schema fields, section-context reset, decoration
provenance rejection, retained native typography/decorations after changing
registry defaults, and displayed-code measurement at the explicit final size.

`tests/reusable_design_execution_test.ts` executes an actual QMD through Quarto
and R, then projects and validates its original source. It verifies a default
dark title bar, a magenta section slide, a pink question card, preserved heading
role, caption typography plus explicit local color, styled displayed R code,
computed output from the R producer, zero overflow diagnostics and byte-exact
unchanged QMD. Local fonts are not installed or downloaded; fallback stacks
remain explicit.

The themed-introduction regression also invokes `renderProject` on an actual QMD
containing an R producer with a filesystem marker. It verifies the guard runs
before that producer, with unchanged QMD and no output/state publication.

## Follow-up measurement correction (2026-10-19)

Displayed-code wrappers (`.bento-code`) are now transparent to row measurement.
Their named code typography is measured before computed figures receive the
remaining card height, just as for a plain wrapper around the same displayed
code. This does not execute displayed code or change its source ownership. The
subsequent regression and its separate validation are recorded in
[the integrated receipt](REUSABLE-DESIGNS.md#follow-up-review-corrections-2026-10-19);
the original 2026-10-18 evidence above is unchanged.
