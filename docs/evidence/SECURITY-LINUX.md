# Linux-local security and dependency closure, 2026-10-13

This receipt covers the owner's current Linux-only implementation objective. It
does not freeze public v1, certify third-party licensing, validate hosted CI or
qualify native macOS/Windows execution.

## Audited baseline

Codex Security scan `e590ec97-2d00-401f-a707-5c7493202b79` is sealed against
`7ce569c36e0fa70230f21143c4d30d7a2cb93a17`, before the fixes below. Its local
report is retained under
`~/.codex/state/plugins/codex-security/scans/quarto-bento/7ce569c36e0fa70230f21143c4d30d7a2cb93a17_20261013T133023Z_9_51rx7l/report.md`.
The source review used independent implementation-area reviews, a pinned Bento
runtime check, a native Chromium reproduction and a real Quarto path
reproduction. It reported three findings and partial coverage: the full 1.4 MB
vendored Bento runtime and every documentation/test file were not reviewed line
by line. This is a scoped local code audit, not a claim that no other
vulnerabilities exist.

| Finding                             | Baseline proof                                                                                                                                                                                         | Mitigation in this change                                                                                                                                                                                                                                                                        |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Stored chart-tooltip XSS, high      | A chart option color containing `red"><img ... onerror=...>` passed project validation; native slideshow hover executed the marker in headless Chromium.                                               | Reject unsafe chart color strings at project ingress. Patch the exact reviewed tooltip sink after inflating the integrity-checked pinned runtime, so a native dropped document is guarded before project validation. Fail closed if the pinned sink changes.                                     |
| Aliased `.qbento/build`, medium     | A symlinked build root redirected trusted plain-QMD render output and logs into a separate writable directory. A real build root with a symlinked `cache` child likewise created external cache files. | Check the generated tree before Quarto execution or mutation. Refuse aliases resolving outside it and hardlinked files, while allowing Fontconfig's resolved internal cache-file aliases. Recovery checks `history` and `quarto-stage` identities before backup reads, rename or restore writes. |
| Historical manual bridge probe, low | The documented developer-only loopback server accepted unauthenticated `POST /save` to its chosen snapshot file.                                                                                       | Retire the obsolete runnable probe. Preserve its historical observations in [S2](S2.md); current Studio and native browser tests supply executable coverage.                                                                                                                                     |

The browser regression submits the hostile document directly to the native
renderer, enters slideshow and hovers real SVG bars. It requires that the
handler remain unexecuted, no injected image appear, bars still render and the
guard survive native self-serialization. A separate assertion requires the
project validator to reject the exact nested series and palette color paths. The
path test checks that a redirected build root, cache child or file alias writes
nothing outside, then renders successfully with a real build directory and an
internal cache-file alias. The recovery test alternately aliases `history` and
`quarto-stage`, verifies refusal without output/receipt loss, then recovers
normally. The earlier leaf-log alias candidate was disproved by Quarto cleanup
and is not claimed as a fixed exploit.

## Dependency scope

The production npm inventory contains 25 exact package archives, pinned by
SHA-512 in the Bento lockfile and covered by the notice inventory. A local
`npm audit --package-lock-only --omit=dev --json` against an exact temporary
copy of `vendor/bento/provenance/slides.package-lock.json` returned zero
reported vulnerabilities for 26 production entries (the root plus 25 runtime
packages) on 2026-10-13. That lockfile's SHA-256 was
`109e3d5f3ce502ea5ba11979d96569e99247db8235f3e2fb71a09ccad846729b`. It did not
install or execute packages. The raw JSON receipts are retained locally as
`output/verification/security-linux/npm-audit-production.json` (SHA-256
`984f843ce7f8854a56505dfb6bb8d87ca3e2bfdd07cfc5dadbf303ef13b57965`) and
`npm-audit-all.json` (SHA-256
`4a8577c9bc8b97ff4f87a5c15b5aceb1caae7dca001bdf5f82b6491c1adfc5ac`). The
advisory result is time-dependent and does not analyze the bundled JavaScript or
prove that the runtime is safe. The bundled Plotly 2.25.2 version is the patched
version for
[GHSA-wjc4-73q6-gv3m](https://github.com/advisories/GHSA-wjc4-73q6-gv3m). The
same lockfile audited **without** `--omit=dev` returned four high-severity
package entries in the upstream build graph: `braces@3.0.3` and its
`micromatch`/`vite-plugin-singlefile` chain, plus `source-map-js@1.2.1`. The
underlying advisories are
[GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) and
[GHSA-68fv-2mgg-jv7q](https://github.com/advisories/GHSA-68fv-2mgg-jv7q). These
packages are absent from the 25-package production archive inventory and the
portable Quarto-Bento runtime. The local workflow consumes the pinned built
shell without running upstream's npm build; this finding remains for any future
upstream rebuild or public distribution review. It does not justify changing the
pinned revision or imply a demonstrated runtime exploit. An upstream build using
this lockfile should not process untrusted glob/source-map inputs. The four
unresolved full-license-source cases remain recorded in
[the exact-version source audit](RUNTIME-LICENSE-SOURCE-AUDIT.md) and are public
distribution follow-up, not Linux runtime acceptance evidence.

## Verification

Focused Linux tests passed for hostile native tooltip hover, project color
validation, Quarto build aliases and recovery directory aliases. The full
host-permission Linux suite passed **578 tests (4 steps), 0 failed, in 19m09s**.
Its exact log is retained as `output/verification/security-linux/full-suite.log`
(SHA-256 `8eeef9be1e25aa109777fbe45ddf7acd184e7a61cd5d30309c88f96d12f76bfc`).
`deno check src/**/*.ts`, `deno lint src tests scripts` (202 files), targeted
`deno fmt --check` (8 changed source/test/evidence files) and `git diff --check`
passed. Chromium in this host requires the local test command outside the Codex
command sandbox: inside it, `setsockopt` is denied and the browser exits before
opening its DevTools endpoint. The same eight focused chart and Chromium tests
pass with host permissions. This is a test-environment permission boundary, not
an application behavior change. The portable-check smoke passed on Linux with
Deno 2.9.6 and Quarto 1.10.19: 117 package files, CLI
doctor/render/validate/get/patch/init, and an ordinary Quarto reconstruction
from QMD plus `.qbento/{project.json,state.json}` without previous HTML. Its log
is retained as `output/verification/security-linux/portable-check.log` (SHA-256
`be43136bc2d813c45fe0cf5204d9f7b95a196cc2376effd3d60ffee6c560b826`). The smoke
validates authored source, CLI, document and state assertions; it does not
exercise Chromium or a computation engine. The complete suite above provides
separate coverage for native browser and computation workflows. Runtime
validation here is local Linux with installed Quarto, Chromium, R and Python; no
other-platform or hosted-CI result is inferred.
