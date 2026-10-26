# Default static figure formats

Local Linux evidence, 2026-10-27, against Quarto 1.10.19 and the unchanged pinned
Bento shell. This records static R figure generation; interactive Plotly and
WebGL fallbacks have separate adapter evidence.

The installed `qbento-html` format already declares `fig-format: svg` as a format
default. Direct `qbento render` previously used ordinary HTML's retina PNG
default. It now reuses the existing producer-filter preflight's Quarto inspection
to select SVG only when applicable document/project metadata has not declared a
figure format. No QMD or project configuration is rewritten.

Explicit `fig-format` in document or applicable HTML format metadata, inherited
project configuration, chunk `dev`/`fig-format`, YAML `knitr.opts_chunk.dev` and
programmatic `knitr::opts_chunk$set(dev=...)` retain their normal Quarto/knitr
precedence. External `metadata-file`/`metadata-files` configurations remain under
Quarto's control, including when their chosen value equals its ordinary default;
the adapter does not replace that choice with a guessed SVG default.

SVG is not a conversion to individually editable native chart data. Raster
images remain raster images, and explicit unsupported devices still surface the
producer's error rather than silently substituting or installing a device.

`tests/figure_format_execution_test.ts` covers nine fresh direct-render projects:
the SVG default, chunk device and format, document/format/project PNG, YAML and
programmatic knitr device selection, and external metadata explicitly requesting
retina output. Two fresh installed-extension projects check the SVG default and
an explicit project PNG override through ordinary `quarto render`. Every source
is byte-identical afterward; explicit project configuration is unchanged.
An unavailable explicit R device fails with the prior HTML/state publication
byte-identical and the requested source option retained.

The final combined run passed **4 tests, zero failures**. It additionally covers
private build-path protection. Source type checking, focused lint/format and Git
whitespace checks passed.

```sh
deno test --allow-read --allow-write --allow-env --allow-run \
  --allow-net=127.0.0.1 \
  tests/figure_format_execution_test.ts tests/build_path_security_test.ts
```

This is execution/asset-format evidence, not a foreground visual acceptance,
full-suite result, portable-package rebuild, other-platform qualification or npm
publication.
