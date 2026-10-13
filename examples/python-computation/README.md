# Python executed through Quarto/knitr

This example executes real Python through Quarto's `knitr` engine and the R
`reticulate` package. It requires installed Quarto, R with `knitr`/`reticulate`,
and a compatible Python with `matplotlib`. The CSV reader is part of Python.
`qbento` does not install or manage these dependencies. This example does not
qualify Quarto's Jupyter engine; Jupyter needs its own installed packages.

From the repository root, select your existing Python interpreter and render:

```sh
RETICULATE_PYTHON=/absolute/path/to/python3 RETICULATE_USE_MANAGED_VENV=no \
  deno task qbento render examples/python-computation/deck.qmd
deno task qbento edit examples/python-computation/deck.qmd
```

To use ordinary `quarto render` with the reviewed local integration:

```sh
deno task qbento init examples/python-computation/deck.qmd
cd examples/python-computation
RETICULATE_PYTHON=/absolute/path/to/python3 RETICULATE_USE_MANAGED_VENV=no \
  quarto render deck.qmd
```

This setup copies the local extension; it does not install packages or execution
engines. Subsequent renders must retain the explicit selection of the same
Python.

In Studio, move or style the figure, edit the literal paragraph, save the
project, and review/apply synchronization. Change `data.csv` to values `1`,
`20`, and `30`, then render again: the line changes and the total goes from
`6.0` to `51.0`, retaining saved design. The number and displayed code have
computed provenance and do not synchronize back to Python as authored text.

The chunk fixes an SVG metadata date and a reproducible SVG-ID salt through
`SOURCE_DATE_EPOCH` and `svg.hashsalt`. Matplotlib otherwise introduces dates
and IDs that vary between runs; a reconciliation plan is refused if outputs
change before apply. These settings are output choices in the example code.

Execution through `qbento render` records each chunk's producer before hooks or
options alter displayed code. A temporary R-process adapter carries that receipt
alongside its result; the original QMD and cache options are unmarked. This
supports multiple cells, partial echo, and figures with stdout and `echo: false`
without inferring provenance from proximity or echoed text. The knitr cache
retains its key and each render captures a fresh receipt, including when output
comes from cache.

User filters on computed QMD are refused before execution because they can
change producer boundaries. Inherited configuration is also checked. The
ordinary Quarto route uses separate receipt activation; see the
[activation evidence](../../docs/evidence/PRODUCER-ACTIVATION.md) for checks and
limits on Quarto 1.10.19.

Explicitly enable this cycle's regression tests in a compatible environment:

```sh
QBENTO_PYTHON_EXECUTION_TEST=1 QBENTO_TEST_PYTHON=/absolute/path/to/python3 \
  deno test --allow-read --allow-write --allow-env --allow-run \
  --allow-net=127.0.0.1 tests/python_execution_test.ts tests/python_quarto_execution_test.ts
```

The test selects that existing interpreter, disables reticulate's automatic
environment creation, and uses a temporary Matplotlib cache. An absent
dependency makes an enabled test fail with a diagnostic; the test does not
install it.
