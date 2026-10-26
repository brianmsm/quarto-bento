# Code and result layout

The development runtime reads these literal options from the original executable
chunk. They do not rewrite the chunk, execute it twice, or change computed
results into authored content.

````qmd
## Result {#result}

::: {#panel .bento-card}
```{r}
#| label: model-result
#| echo: true
#| output-location: column
#| bento-code-width: 40
#| dev: svg
plot(1:3)
```
:::
````

- `output-location: default` keeps source and results in execution order.
- `output-location: column` places echoed source on the left and complete
  results on the right. `bento-code-width` chooses the source percentage of the
  usable width (10–90, default 50); the columns have a 24 px gap.
- `layout-ncol` distributes multiple results in one to six columns. It applies
  to results, not the echoed source. Multiple rows retain result order.
- `output-location: slide` keeps echoed source on its original slide and adds
  one deterministic result slide associated with the original producer. It
  executes the producer once. Later authored content stays on the original
  slide. Declare this option outside cards/layouts: splitting a source component
  across slides refuses before computation.

Cards reserve source/text/table height before distributing remaining space to
figures. Figures retain `fit: contain`, with at least 100 px in each flexible
figure slot; code font sizes are not automatically shrunk. Original cell and output boundaries retain the producer of every echoed
code block, text result, figure or compatible table. A mixed code/figure producer
also receives bounded sizing outside cards. Existing plain text-only chunks keep
their ordinary projection unless layout is explicitly selected.

Explicit parent-card typography is applied before measuring its echoed code.
Native saved geometry and typography remain recoverable visual edits after a
fresh execution. Generated output slides do not add source headings or authorize
source edits. Arbitrary edits to computed content remain computed conflicts.

Literal options are checked before computation. Expressions, repeated options,
unsupported fragment locations and out-of-range values refuse with an actionable
`EXECUTION_LAYOUT` diagnostic. Other inherited/global Quarto execution options
retain their existing behavior; these new layout selectors are chunk-local.

Existing bounded table/chart/widget codecs remain in force. In particular,
multiple native tables from one producer still refuse unstable positional
identity; this layout feature does not flatten or silently discard them.
