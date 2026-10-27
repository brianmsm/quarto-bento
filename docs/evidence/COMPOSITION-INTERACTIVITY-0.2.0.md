# Composition and interactivity — Linux evidence

This receipt records the owner-authorized composition/interactivity source work
continued from the [OMP checkpoint](../handoffs/2026-10-27-OMP.md). It does not
publish a package, change the global installation, declare stable v1 or qualify
another operating system. The owner's presentation and separate plugin were not
modified. Historical receipts retain their original scope and results.

## Runtime and scope

- Linux; Deno 2.9.8, Quarto 1.10.19, R 4.6.1, Node 26.12.0 and npm 11.20.0.
- Bento remains 1.2.6 at `3d6f7f1fcdf2308e875345ce4f1e0ec0820c914b`.
  Pinned vendor bytes and notices are unchanged. Plotly runtime/license hashes
  remain checked before use.
- The implementation continues branch `codex/0.2.0-composition-interactivity`
  from `0d16a0e`, selectively integrating the preserved widget UI and overflow
  checkpoints. No duplicate core cherry-pick or upstream fork was introduced.
- Computation environments remain user-managed. Ordinary authoring, offline
  viewing, native Save, source synchronization and local package installation
  remain separate operations.

## Exercised integration

### Native composition and source authority

The source supports explicit variant role styles and named theme slots, native
card backgrounds, original chunk-local source/result columns, result grids and
producer-linked result slides. Text/code/table measurements reserve their full
native metrics before flexible figures share available space. Consecutive
ordinary producers reserve each other's minima instead of the first producer
consuming the whole remaining frame. Explicit/container-managed frames retain
their own authority.

A real combined source scenario used a 420 px named card slot, echoed R source,
inline Plotly3D, long stdout, a 40-row table and two static figures. It produced
four slides with no diagnostics after declaring scroll for long code/output and
an explicit 35/65 source/table split. Native code typography remained 20 px;
ordinary 2D figures were SVG and the actual 3D fallback was PNG. Changed CSV data
updated the 3D snapshot while retaining `docId`, saved image geometry and a
pending authored instruction. QMD remained byte-identical. Reconstruction from
QMD, CSV, design registry and `.qbento/project.json`/`state.json`, without the
previous HTML or widget directory, retained identity, geometry and pending work.

A separate actual Plotly `output-location: slide` run retained original source
slide `widget` in its receipt and placed the native image/inline view on
`qb-output-8b4895677011e74ebfaa401e`. It executed from the original producer;
source QMD did not acquire a synthetic heading.

### Real input, view saving and offline delivery

Actual Chromium mouse input entered a widget inside a selected native card.
Hit testing reached the iframe rather than Bento's group Moveable overlay.
Trusted child input changed the live camera from eye `(1.25, 1.25, 1.25)` to
approximately `(1.06436, -0.50742, 1.81581)` without changing native geometry or
static image data. Escape restored editor focus. Shared hit-path ownership also
permits real grouped stdout/table scrolling and releases native controls after
the last interaction exits; one provider cannot release another's masks.

The actual browser regressions exercise offline Plotly, current-rectangle
alignment, rotation/resize, explicit **Save view**, genuine native Save HTML
download and reopening of the approved camera, Studio views, context loss and
startup without WebGL. They also capture the native saved camera into its
matching project, recapture locally and render a fresh Presenter. Core camera
checks cover stale identity/revision/source/static refusal, changed-data
recomputation, state-only rebuilding and camera replacement without losing
pending/detached recovery views.

The live pinned Plotly scene camera, not its potentially stale declarative
layout input, supplies an explicit camera save. Plotly's local SVG-to-PNG export
needs blob images; only that isolated image capability was added, with network
connections still blocked. Native `loadDoc` resets its slide index, so explicit
view saving restores the same stable display slide after replacement.

Standalone camera metadata is a bounded, CRC-checked PNG ancillary text chunk
because private native Save serializes its captured shell, not dynamically
edited bootstrap scripts. It stays outside BentoDoc's property schema. Capture
treats it as a request: original generation/source/static identity are checked
and browser pixels are recaptured with the trusted local runtime. They are never
accepted as a new computation receipt or a reverse edit to R.

### Complete scroll output and combined PDF

Real mouse clicks/wheels reached the bottom of selected grouped code and table
outputs, preserving model geometry/content. The complete-output dialog retained
the final data and native font size, focused its close button and returned focus
to its originating control after Escape. Native Save/reopen retains complete
underlying data, not only the visible viewport.

The combined Presenter now prints native slide DOM and complete continuations
in the parent pagination context. It does not rely on child overflow inside a
fixed-height iframe. The actual main-browser PDF contained all four native slide
pages, static widget fallback and five complete-output continuations, with no
interactive print iframe. Its 14 PDF pages include `ROW120` and `CELL040`.
The permanent real-PDF regression also requires every stdout row and
`TABLE_FINAL40` after `pdftotext` extraction.

Local generated artifacts are retained under
`output/verification/2026-10-27-omp-020/` (not public downloadable evidence):

- `presenter.pdf`: SHA-256
  `fc2f35d5294a396c6a24bc148e0e3fdbf6d9ba295d21763c4d2b230a79c6a62f`.
- `presenter.txt`: SHA-256
  `0a1b2243b181aa4dea3e5190901c5156b8fa04909e000a279d15e3dc54676470`.
- Synthetic input QMD/CSV/design and actual 3D/last-line screenshots.

## Review findings and corrected attempts

Independent reviews found and corrected mixed figure-row overlap, widget
continuation display/source identity mismatch, obsolete camera accumulation,
HTML identifier regexp injection and artifact path check/read races. Artifact
reads now use no-follow descriptor traversal, opened-handle checks and bounded
reads. Linux procfs is required. Deno's descriptor-path permission gate needs a
fixed, data-only helper child with `--allow-all` under ordinary CLI flags; the
main process is unchanged and explicit parent read denial is checked before that
fallback. Artifact scripts are never imported or executed.

Initial checks found missing imports/type narrowing, a malformed security
fixture and corrupt unit PNG bytes. These were corrected without weakening
runtime parsing, CRC validation or strict SVG assertions. Actual surface checks
then exposed Moveable interception, local blob-image export denial and native
slide-reset behavior; production fixes have real-input/native-Save regressions.
Opaque iframe tests use exact target identity and trusted frame-paced input,
not assumed root execution contexts or synthetic camera changes.

The initial broad run exposed the real greedy two-producer frame allocation.
It now passes with positive,
non-overlapping, equally shared figure frames while retaining saved geometry and
dynamic overflow diagnostics. The other was an English-only native Layout
selector under a Spanish host locale; the test now uses the real localized
native action, opens its accordion and exercises pseudolocalization. Each
corrected scenario passed its targeted actual-runtime run. The first full log is
preserved locally as `full-suite-before-final-fixes.log`, SHA-256
`36f8fe92142865fce5d15bee0ab28a8206717527b623a94f8842f39ce7fd3a11`.

## Verification and local package

| Complete Linux run | Passed | Steps | Failed | Ignored | Duration |
|---|---:|---:|---:|---:|---|
| Before the two broad-regression corrections | 701 | 4 | 2 | 1 | 22m35s |
| Accepted integration before metadata/encoding correction | 703 | 4 | 0 | 1 | 22m53s |
| Final 0.2.0 candidate, including exact-byte guard and metadata | 705 | 4 | 0 | 1 | 22m34s |

These runs enable Studio, relationships/layout, Python and browser workflows via
the switches documented in `CONTRIBUTING.md`, with `DENO_JOBS=2`. The ignored
case is the optional pinned upstream-source math comparison. Its separate
checkout was not available at the pinned HEAD under the host's checkout policy;
vendored pin/integrity and native-browser math checks still ran. No ignored case
is counted as passed. The accepted log is retained as
`full-suite-accepted-before-metadata.log`, SHA-256
`f3bbaf0873ba06d7d02c93ff05e4613bce8cf08786ff6b88ef0013c6f5f8fa32`.
The final candidate log is `full-suite-020-candidate.log`, SHA-256
`076e84bef9ba69086b1c10d53a9e452939d7e8dcbabd4d57ad2bec9419be7ea7`.

A final narrow integrity review found that default UTF-8 decoding could strip a
BOM or replace malformed bytes before the external artifact fingerprint. Both
reader and successful helper-output decoders now reject invalid UTF-8 and retain
the BOM, making the existing SHA-256 equal to the accepted raw artifact bytes.
Seven security tests passed, followed by the actual R-htmlwidget import case.
No parser limit, CRC check or execution-receipt boundary was weakened.

After the accepted runtime gate, package, npm validator/fixture, isolated mise
gate and extension metadata were prepared as `0.2.0`. The npm smoke now pins the
current Deno 2.9.8 qualification instead of its historical 2.9.6 expectation.
The historical `portable-check.ts` guard is intentionally unchanged.

| Local qualification | Observed result |
|---|---|
| Types, lint and source/script formatting | Passed |
| Inline relative links in changed documentation/handoff | 339 targets in 18 documents; none missing |
| Current-runtime portable relocation/rebuild/design adaptation | 132 payload files; identity and source preserved |
| npm offline install, relocation, selected sync and state-only rebuild | 137 tarball files; all 132 runtime hashes verified |
| Isolated mise 2026.10.19 default npm backend | `qbento 0.2.0`; all 132 runtime hashes verified |
| Installed archive in a prefix with spaces | Real external Plotly3D PNG, exact raw artifact hash, authored external provenance, full `INSTALLED120` scroll data, unchanged QMD and no diagnostics |

The same installed archive also explicitly saved the imported external widget's
camera, regenerated its real PNG and retained that camera through another render.
Both QMD and imported HTML remained unchanged, `docId` stayed stable, and the
external origin remained authored without a fabricated R producer receipt.
An actual installed Studio mouse rotation and **Save view** also published a
fresh PNG and stored the observed live camera in project state through the
authenticated UI operation; its screenshot and minimal project state are retained.

The retained local review archive is
`output/verification/2026-10-27-omp-020/brianmsm-quarto-bento-0.2.0.tgz`,
SHA-256 `ae96fc64f444397eac1447bf074b2464ee5079e9f8f14024e71b076e5ef22a31`.
Its manifest honestly records source commit
`b52772e7506550ea0c175dc47028bc8ebe88bc8a` with `dirty: true`; individual
payload hashes identify the complete reviewed working source. This is a local
review artifact, not an immutable clean publication archive. The root remains
`private: true`. No registry publication, tag, push or global configuration/
installation change was performed. The public 0.1.1 archive remains separate.

## Boundaries

- Only the documented single-QMD Linux codecs are qualified. No surface/mesh3d,
  arbitrary widgets/scripts, general layout DSL, environment manager, automatic
  merge or cross-platform release claim was added.
- Literal chunk options remain bounded; original explicit devices/formats win.
  Native table width/structure limits and one table per producer still apply.
  Scroll does not make arbitrary authored HTML/text a supported computed codec.
- Continuation print pages are labeled by source slide and element and append
  after native slides; no generated continuation is written into QMD.
- Native chart data/scales remain computational. Only supported palette/font/
  geometry design survives refresh; explicit detach remains separate.
- The four historical license-source gaps and upstream build-only advisories
  remain documented follow-up. A successful later exact-widget SVG run does not
  establish the cause of the earlier intermittent mismatch.
