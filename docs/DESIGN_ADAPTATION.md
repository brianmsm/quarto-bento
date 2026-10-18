# Adapt an existing Reveal design once

A Reveal theme is CSS for Reveal's DOM. Bento uses native objects and their
design properties. Reusing the CSS file directly does not translate one
representation to the other.

The optional local adaptation helper samples selected elements from an existing
**rendered HTML** reference and produces a portable native design package plus a
separate provenance report. Review the native result once, then use the package
for subsequent sessions. The helper does not modify the reference presentation
or its course files.

## Explicit reference mapping

`adaptRevealDesign(html, mapping)` in `src/core/design-adaptation.ts` accepts
HTML text and a versioned mapping. `readRevealReferenceFile(path)` reads a
regular UTF-8 HTML file up to 16 MiB. No external CSS, images, scripts or
network resources are loaded. For a reference with linked local CSS, prepare a
separate copy with the reviewed CSS inlined; the original file remains
unchanged. The output report explicitly counts excluded linked stylesheets and
CSS imports.

A mapping identifies one element for each role. Every selector must match
exactly one element; missing, ambiguous and invalid selectors fail. Use stable
IDs or scoped selectors, including `:first-child` or `:nth-of-type()` when an
explicit representative is intended. This requirement prevents arbitrary
first-match guesses from becoming the course design.

```json
{
  "version": 1,
  "name": "spp-bifactor",
  "canvas": ".reveal",
  "title": "#reference-content h2",
  "body": "#reference-content > p:first-of-type",
  "accent": "#b42b5c",
  "code": "#reference-code pre",
  "namedStyles": {
    "question": {
      "selector": "#reference-question",
      "target": "text"
    },
    "course-card": {
      "selector": "#reference-card",
      "target": "card"
    }
  },
  "variants": {
    "section": {
      "selector": "#reference-section",
      "title": "#reference-section h2",
      "titleFrame": { "x": 60, "y": 220, "w": 1160, "h": 160 },
      "contentFrame": { "x": 60, "y": 420, "w": 1160, "h": 220 },
      "decorations": [
        {
          "id": "rule",
          "x": 60,
          "y": 410,
          "w": 1160,
          "h": 3,
          "fill": "#ffffff"
        }
      ]
    }
  }
}
```

Required roles are `canvas`, `title` and `body`. `accent` is an explicit
supported literal color; when omitted, the selected title color is used and this
fallback is reported. Named styles target `text`, `code` or `card`. Optional
variants sample a slide background and title typography; their frames and
bounded decorations are supplied explicitly rather than inferred from arbitrary
grids or CSS geometry. `defaultVariant`, when supplied, must name a declared
variant.

## What is sampled

An installed Chromium resolves the inline CSS cascade, variables and
`!important` rules at a fixed 1280 × 720 viewport. Reveal canvas/slides
dimensions are normalized to that size and animations/transitions disabled. The
helper captures supported text color, family, font size, numeric weight,
line-height ratio, letter spacing and alignment. Code uses the supported code
subset. Cards additionally capture uniform borders, uniform pixel corner radii,
fill and opacity. Effective canvas and variant backgrounds are composed through
their ancestors over white.

The package contains only validated native design data: no selectors, HTML, CSS,
scripts, reference paths, source text or presentation state. The separate report
contains the reference SHA-256, browser version, selected properties, excluded
resources, unembedded font families and sampling warnings. Keep the report as
review evidence if desired; it is not required to apply the package.

## Security and fidelity boundaries

The browser starts with a fresh private profile and an empty document whose CSP
disables scripts, connections, images, frames and objects before any reference
is parsed. Network URLs are blocked. Reference scripts, event attributes, links
and active content are stripped from an inert parsed document before adoption.
Original JavaScript never runs. The bounded browser lifetime and HTML read limit
protect this optional operation from unbounded inputs; a stalled browser fails
with its existing timeout.

This is a style sampling tool, not a Reveal renderer or general format
converter. It deliberately excludes external stylesheets and imports, custom
scripts, images, SVG, MathML, runtime slide state, interactive widgets and
arbitrary content/layout conversion. Gradients and images are reported and
omitted. Asymmetric card borders, relative/nonuniform radii and shadows require
native review. `normal` line heights use the Bento default and are reported for
review.

Fonts are **not embedded** in the resulting package. A family selected by CSS
can be unavailable to Chromium or to the next author. Supply fonts through the
project's supported resource workflow and inspect the native preview; a retained
family name alone does not prove matching glyphs or metrics. Original graph
images retain their execution-produced design and are not recolored by this
helper.

Review at least a title slide, section separator, body slide, card, code sample
and executed figure in native Bento before adopting a course design. Keep
per-session native edits in each session's state. Reuse the validated design
package across sessions rather than copying `.qbento` state or native document
identities.
