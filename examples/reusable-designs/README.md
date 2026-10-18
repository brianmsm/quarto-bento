# Reuse a course design across independent lessons

This example contains new, neutral lesson content and a native design adapted
from the owner's Metropolis/SPP reference. It includes dark title bars, magenta
section dividers, pink/teal cards, named text styles and reusable column
layouts. It does not include the course's teaching content, data, figures,
speaker notes or images.

The bundled `course.design.json` is already a native pure-data design package.
Use it for a new lesson without repeating the Reveal adaptation. Each lesson
must have its own directory and `.qbento/` state.

From the source checkout, copy `lesson/` to a new working directory, then run:

```sh
deno task qbento design init /path/to/new-lesson/deck.qmd \
  examples/reusable-designs/course.design.json
deno task qbento render /path/to/new-lesson/deck.qmd
deno task qbento edit /path/to/new-lesson/deck.qmd
```

Initialization creates a new design registry and refuses existing state. For an
existing rendered presentation use `design preview` and `design apply` instead;
see [the package guide](../../docs/DESIGN_PACKAGES.md).

The example executes a small R base plot. R and Quarto remain user supplied.
Fira Sans is requested with Arial/sans-serif fallbacks; no font is downloaded or
installed. A different local font can change text metrics. Review the native
result before delivering it.

Use the same package for a second independently rendered QMD. To update the
shared design, export from a lesson with reviewed saved definitions:

```sh
deno task qbento design export /path/to/new-lesson/deck.qmd \
  'My course design' > /path/to/course/themes/course.design.json
```

Import that package into the other lessons through the same preview/apply
workflow. Existing native overrides remain local. Changes to the package file do
not silently alter already imported lessons.

## Adapt the local SPP reference once

`spp-reference.mapping.json` records explicit sample selectors from the owner's
local session 01 HTML. Reference-specific frames and bars are supplied as
reviewed native template definitions. The mapping alone contains no course
content or external file locations.

```sh
deno task qbento design adapt /path/to/rendered/sesion_01.html \
  examples/reusable-designs/spp-reference.mapping.json > /tmp/adaptation.json
# To emit only its native package for later import:
deno task qbento design adapt /path/to/rendered/sesion_01.html \
  examples/reusable-designs/spp-reference.mapping.json --package \
  > /path/to/course/themes/spp-bifactor.design.json
```

Inspect the separate report in `adaptation.json`, then review the package on
representative native slides. Changes to reference IDs require reviewing the
selectors; an absent or ambiguous sample is refused. The optional installed
Chromium samples inline styles without executing reference scripts or fetching
external fonts/CSS. This is a bounded migration aid, not arbitrary Reveal HTML
or QMD conversion. Statistical figure themes remain defined by their execution
source. See [the adaptation guide](../../docs/DESIGN_ADAPTATION.md).
