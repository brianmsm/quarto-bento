# Security policy

Quarto-Bento is a public development project with a locally tested Linux
runtime. There is no declared stable release line or support SLA. Reports
against the current `main` branch are welcome; include the exact commit and
installed dependencies so the behavior can be reproduced.

## Reporting a vulnerability

Use
[GitHub private vulnerability reporting](https://github.com/brianmsm/quarto-bento/security/advisories/new)
to report a suspected vulnerability to the repository owner. Include the
affected command or surface, a minimal synthetic reproduction, expected security
boundary, actual impact and any relevant versions. Keep credentials, personal
data and sensitive exploit details out of public issues. Ordinary non-sensitive
bugs can use the issue tracker.

## System and trust boundaries

The CLI reads QMD, project state and local assets, executes Quarto and installed
computation tools, and writes project output. Studio runs on IPv4 loopback and
uses checked document identity/revision and an authenticated local bridge for
mutations. Standalone HTML contains the pinned Bento runtime; supported
interactive widgets use separate isolated views.

QMD and executable chunks are trusted code selected by the user. Running an
untrusted QMD, TeX program or computation package is outside the application's
safe-data boundary. Runtime parsing, BentoDoc/state ingestion, native edited
HTML, local resources, source patches and Studio requests still require their
documented checks. Loopback binding alone is not authorization. Studio is not
designed to be exposed as an internet or shared-network service.

## Security invariants

- Save retains checked visual and pending semantic state without implicitly
  rewriting source. Sync revalidates the reviewed source plan before writing.
- Computed output cannot be reverse-written as executable code or fabricated
  provenance. Native document data must not become active markup through a
  rendering sink.
- State, source and generated-output path checks must prevent unintended writes
  through supplied external aliases. Recoverable work must survive guarded
  refusal and failed execution.
- Ordinary workflow uses local pinned runtime assets. Supported widget scripts
  stay outside the pure-data deck and project resources must pass path checks.

Source/data loss, identity or revision bypass, unauthenticated local mutation,
unexpected active content and demonstrated escapes from checked path boundaries
are reportable. Describe their reachability and impact; development/test-only
surfaces should be identified as such rather than presented as deployed
services.

## Known limits and evidence

The [Linux security receipt](docs/evidence/SECURITY-LINUX.md) records a scoped
pre-fix review, three confirmed issues and their mitigations. It is not an
exhaustive audit or a guarantee that the vendored runtime is vulnerability-free.
The pinned production npm audit reported no advisories on 2026-10-13; the
upstream build-only graph retains two advisories. Do not use that graph to
process untrusted build inputs without reviewing those findings.

Third-party package license-source gaps are recorded in the
[exact-version source investigation](docs/evidence/RUNTIME-LICENSE-SOURCE-AUDIT.md).
macOS/Windows and additional execution engines lack native qualification.
Filesystem races involving a concurrent hostile local process, physical
power-loss durability and universal widget/HTML isolation are not established by
the present tests. These evidence limits do not suppress a reproducible finding
against an implemented control.
