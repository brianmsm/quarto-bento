# Public source publication

The owner authorized a public GitHub repository on 2026-10-13:
[brianmsm/quarto-bento](https://github.com/brianmsm/quarto-bento). The
publication scope is the tracked development source, examples, tests, English
documentation and existing pinned vendor assets with their notices and
provenance. Local generated output, execution caches, private scan artifacts and
worktrees are excluded. Source is published on `main` with the annotated,
unsigned `v0.2.0` tag targeting `5b17bf6`; local experimental branches
are not part of the publication.

## Status and validated baseline

**Status (2026-10-27):** the owner-authorized `0.2.0` Linux npm release is published.
Current source qualification passed 705 tests and four steps with zero failures,
with one optional pinned-upstream-source math comparison ignored, plus a 132-file
portable and 137-file offline npm archive with 132 runtime hashes. See the
[prepublication qualification](evidence/COMPOSITION-INTERACTIVITY-0.2.0.md).
Its dirty local review archive remains historical, distinct from the clean
published archive. Exact anonymous public archive integrity and npm/mise
installation passed in [the release receipt](evidence/NPM-0.2.0.md).

The original Linux implementation closeout at runtime `2ee7974` passed 578 tests
and four steps with zero failures and a 117-file portable relocation/state-only
rebuild smoke. Those historical results remain in the
[implementation ledger](IMPLEMENTATION_STATUS.md),
[completion audit](COMPLETION_AUDIT.md) and
[security receipt](evidence/SECURITY-LINUX.md), not as current-suite counts.

Public source availability is not a versioned v1 declaration. No binary release,
installer or portable archive is attached by this publication. Linux is the
tested platform; macOS and Windows remain future work outside the completed
objective. Studio currently has Spanish control labels documented in the English
usage guide. Arbitrary widgets/HTML, broad multi-QMD editing, live collaboration
and independently distributed-copy reconciliation remain outside the implemented
scope.

The GitHub workflow can be manually dispatched to run the Linux portable smoke.
It does not run automatically on publication, and no hosted result is inferred
from its configuration. It does not install R, test all computation engines or
reproduce the complete native-browser acceptance suite.

## npm development CLI publication

`@brianmsm/quarto-bento@0.2.0` is publicly available, with `latest` pointing
to it. The exact clean archive was staged from
`5b17bf6acda597c3403ee6abf6ba4d396eba7ad6` (`dirty: false`), with 137 files,
132 runtime hashes and SHA256
`39642c60c27c0765f6d1e625423a0853cd7bec5389c87ea1b91daf5677ba58ba`.
Anonymous metadata, README/launcher, exact bytes and SHA1/SHA512/SHA256 checks
passed, as did actual npm and mise version, doctor and rendering with unchanged
QMD. The npm consumer also passed reviewed patch, selected sync and state-only
rebuild checks, preserving geometry/docId and retiring pending work only after
verified render. See [the release receipt](evidence/NPM-0.2.0.md).

Separately, the owner personally ran the authorized global mise update selecting
`0.2.0`, Node 26.12.0 and Deno 2.9.8. This also pins Node/Deno, with Node
already installed. Subsequent selected-CLI version/doctor, all 137 archive
files/132 runtime hashes and a real render with unchanged QMD passed. These
owner-installation checks are separate from the anonymous public consumer proof.

The historical correction release, `@brianmsm/quarto-bento@0.1.1`, was published
on 2026-10-17 from the exact validated archive. Anonymous registry metadata,
README, archive bytes and isolated npm/mise installations passed. Public-package selected sync
preserved excluded work and design through render. The owner-requested mise
update selected `0.1.1` globally and verified all 117 runtime hashes, doctor and
rendering without changing unrelated mise configuration. See
[the historical correction receipt](evidence/SYNC-SELECTION-0.1.1.md).

For the initial release, on 2026-10-16 the owner authorized and completed
publication of
[`@brianmsm/quarto-bento@0.1.0`](https://www.npmjs.com/package/@brianmsm/quarto-bento/v/0.1.0).
The exact archive was staged from clean commit
`05e70bbefebad5f540083bba25444dda0caef0d8`. Anonymous registry metadata, tarball
bytes and package README matched the staged artifact. Real public npm and mise
installs passed version, doctor, rendering and all 117 runtime payload hash
checks using temporary configuration and prefixes. See
[the publication receipt](evidence/NPM-CLI.md) and [installation guide](NPM.md).

The package includes a Node launcher, bundled application source/assets and
notices; external Deno executes the application and Quarto remains separately
installed. It has no lifecycle hooks or npm dependencies. It targets Linux and
is a development release, not stable v1. No GitHub binary release or hosted CI
result is implied by this npm publication.

## Licenses and unresolved provenance

The project's own code and documentation use MIT, copyright (c) 2026 Brian
Norman Peña Calero. The root LICENSE applies to that authored material;
third-party code and fonts retain their own terms. The upstream Bento MIT text,
notices, available exact package texts, font OFL texts and integrity inventories
are preserved under `vendor/bento/` and carried by locally generated output.

The [exact-version investigation](evidence/RUNTIME-LICENSE-SOURCE-AUDIT.md)
retains four unresolved missing or discrepant full package-source texts:
`@cfcs/core@0.0.6`, `croact@1.0.4`, `croact-css-styled@1.1.9` and
`keycon@1.4.0`. Existing upstream notices and archive metadata are preserved.
This public source publication does not certify complete third-party licensing
or replace those facts with inferred authorship or newer upstream files. Further
binary-release review must address these open provenance items.

The [security receipt](evidence/SECURITY-LINUX.md) also records two advisories
in Bento's upstream build graph. The committed runtime uses its pinned built
shell and does not invoke that npm graph during ordinary operation. A future
upstream rebuild needs a fresh dependency review. Reports are welcome through
[SECURITY.md](../SECURITY.md).

## Documentation and evidence policy

The README and usage guide describe current behavior. The product target,
architecture and accepted decisions describe the longer-term contracts; sample
target syntax is not automatically an implemented command or schema. The
[evidence index](evidence/README.md) distinguishes committed receipts from
historical local-only logs and screenshots. Paths under `output/verification/`
or temporary directories in older receipts identify the original local
observations; they are not downloadable files in this public repository.
Historical counts, failed attempts and version-specific observations remain
dated rather than rewritten as current results.

## Historical source publication validation (2026-10-13)

The original source-publication changes updated documentation and the manual
workflow; runtime code remained at the validated `2ee7974` baseline. Local
pre-publication checks
passed core/portable type checks, runtime and script lint/format checks, the
portable inventory regression and two launcher-argument tests. The portable
smoke passed again with the updated packaged guide, and the literal README
quick-start QMD rendered successfully. A local Markdown check covered every
non-vendor documentation file and found no missing relative targets or heading
anchors. An independent documentation review checked current claims and scope.
These checks are separate from the earlier complete 578-test acceptance run.

## Published repository verification

On 2026-10-13, the initial source publication put commit
`e9f6eb0a7d8c099346a2f9842076b108680ccc29` on public `main` at
[brianmsm/quarto-bento](https://github.com/brianmsm/quarto-bento). GitHub's API
reported `private: false`, visibility `public`, and default branch `main`. An
unauthenticated request for the raw README returned HTTP 200 and matched the
reviewed local bytes exactly (SHA-256
`40ad3afd1b44dc7d358ff53fed102a66e7ce9737e81236dae30193f0a28638aa`). Private
vulnerability reporting is enabled, issues are enabled and the wiki is disabled.
No hosted workflow run was present after the initial push. This receipt is a
later documentation update; the initial snapshot remains available in Git
history. That initial publication snapshot contained source only. The later npm
package preparation and 2026-10-16 registry publication do not alter this
historical source-only receipt. No GitHub release or binary attachment has been
created.
