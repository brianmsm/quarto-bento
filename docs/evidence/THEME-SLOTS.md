# Named slide slots and variant styles — Linux source receipt

Validated locally on 2026-10-27 with Quarto 1.10.19 and Deno 2.9.7. The pinned
Bento 1.2.6 vendor bytes are unchanged. See the
[feature contract](../features/THEME_SLOTS.md) for syntax, ownership and bounds.

The new tests exercise bounded slot/variant validation, exact original-source
selector recovery and refusal of forged selectors. Missing slots, repeated slot
uses, nested absolute slots, unsupported targets, incompatible named styles,
unsafe properties, impossible gaps and code exceeding its slot refuse.

A real Quarto/R test creates two independent QMD projects using the same
package. It verifies matching named task/citation/code positions, two-column and
repeated row composition, zero native overflow diagnostics and different
document IDs. After a native position edit, a theme change and changed CSV
input, recalculation preserves the native position, applies the unoverridden
citation size and changes the computed sum from 3 to 30. Both QMD sources remain
byte-identical. Export retains the slot definitions without transferring deck
identity. Another test checks dark body/code defaults reset on the following
slide, and a card slot preserves its explicit source radius without acquiring
source-owned geometry.

Executed commands:

```sh
deno test --allow-read --allow-write --allow-env --allow-run \
  --allow-net=127.0.0.1 tests/theme_slots_test.ts \
  tests/reusable_design_test.ts tests/design_package_test.ts \
  tests/design_initialize_test.ts tests/design_studio_client_test.ts

deno test --allow-read --allow-write --allow-env --allow-run \
  --allow-net=127.0.0.1 tests/theme_slots_test.ts \
  tests/reusable_design_execution_test.ts

deno task check
deno lint src/render/design.ts src/render/theme-styles.ts \
  src/render/project.ts tests/theme_slots_test.ts
deno fmt --check src/render/design.ts src/render/theme-styles.ts \
  src/render/project.ts tests/theme_slots_test.ts
```

The first selected run passed 37 tests before the final additional card/overflow
case. The second run passed all 11 tests, including that additional case and the
existing real-Quarto theme regressions, with zero failures in 32 seconds. Types,
changed-file lint and formatting passed. A final five-test slot rerun after
scoping a card slot style to its own source component also passed, zero failures
in 14 seconds. This receipt is not a complete-suite, foreground-browser,
portable rebuild or other-platform acceptance claim. No npm publication, global
installation, course presentation or plugin change occurred.
