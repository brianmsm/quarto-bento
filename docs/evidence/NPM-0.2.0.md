# npm 0.2.0 publication

## Authorization and current state — 2026-10-27

The owner explicitly authorized versioning and publishing
`@brianmsm/quarto-bento@0.2.0`. This is a Linux development release, not stable
v1. The owner subsequently authorized and personally completed a global mise
update, recorded separately below. The presentation/plugin and pinned Bento
assets remain unchanged.

After a fresh owner-completed web login, `npm whoami` verified publisher
`brianmsm`. Publication required a separate web/2FA approval: the initial
automated attempt returned `EOTP`, and the owner completed the standard publish
command interactively. Its npm record confirms the approved archive shasum,
HTTP **202**, process exit **0** and npm's processing notice.

The first anonymous version request still returned HTTP 404, `latest` remained
0.1.1, and the first public install probe returned `ETARGET`. Those attempts are
not counted as passing checks. No duplicate publication was submitted.
After npm processing, anonymous metadata verified version **0.2.0** and
**`latest: 0.2.0`**. Fresh public npm and mise installations and exact archive
integrity checks subsequently passed.

## Qualification and artifact boundary

The implementation qualification is recorded separately in
[the composition/interactivity receipt](COMPOSITION-INTERACTIVITY-0.2.0.md):
705 tests and four steps passed, with zero failures and one ignored optional
upstream-source comparison. That receipt's dirty-source local review tarball
is historical and will not be submitted to npm.

## Clean publication artifact

The archive was staged from committed source
`5b17bf6acda597c3403ee6abf6ba4d396eba7ad6`, with manifest provenance
`dirty: false`. GitHub `main` was fast-forwarded from `1b7e265` to this commit,
and the annotated [v0.2.0 tag](https://github.com/brianmsm/quarto-bento/tree/v0.2.0)
resolves to that exact source. The experimental branch was not published.
The tag is annotated, not cryptographically signed.

| Property | Observed value |
|---|---|
| Archive | `brianmsm-quarto-bento-0.2.0.tgz` |
| Bytes | 952960 |
| Regular archive files | 137 |
| Manifest payloads | 132 |
| SHA256 | `39642c60c27c0765f6d1e625423a0853cd7bec5389c87ea1b91daf5677ba58ba` |
| npm shasum | `b8fef9b23b946c672218ba9fbddfc81d0b1e0118` |
| npm integrity | `sha512-7hMjp+qu4OuVqld+oe9Mw0nyfkpmQJc++kMQcOIFFAMvcnAxkif4Kr5WshD9T/8zdJt1H6B2CWvLKGj5hyz82w==` |

The retained archive, stage and `artifact-audit.json` are under the local ignored
directory `output/npm/release-0.2.0/`. The archive contains only the explicit
payload; every manifest size/hash and executable flag passed. It has no hooks
or npm dependencies. The source-root package remains `private: true`; only the
guarded staging directory removes that flag.

All 132 payload paths match the earlier qualified review archive. Only
`PACKAGING.md` changed after the 705-test runtime qualification; program bytes
remain identical. The standalone npm README now selects 0.2.0 and the qualified
Node/Deno versions instead of the historical 0.1.1 instructions.

## Clean-source local checks

- Source type checks, lint over 248 files, source/script formatting over 111
  files, and both guarded npm staging tests passed.
- The changed documentation/handoff link check covered 21 files and 383 real
  inline relative links, with no missing targets or anchors. Illustrative code
  is excluded; an initial checker incorrectly treated an inline example image
  path as a real documentation link and was corrected, not the document.
- The offline npm smoke passed version, doctor, render/validate, reviewed
  patch/selected sync, sibling-source refusals and source-plus-state rebuilding
  without old HTML or the staging directory. It retained identity/design and
  cleared the one pending edit only after verified post-sync render.
- Mise 2026.10.19 installed this exact archive through its default npm backend
  against a temporary loopback registry: version/doctor and all 132 installed
  runtime hashes passed. This local check does not establish public availability.
- The owner's ordinary CLI still reported `qbento 0.1.1` before publication.

## Anonymous public verification

Fresh empty user/global npm configuration, separate caches/prefixes and unrelated
caller directories were used without publisher credentials or a local registry.
The downloaded public archive matches every prepared byte, SHA256, npm shasum
and SHA512 integrity above.

Both the normal public npm installation, with lifecycle scripts enabled, and
the default public mise npm backend passed all 137 installed archive-file
comparisons and all 132 runtime hashes. The root README and Node launcher match
the archive. Both CLIs reported `qbento 0.2.0`; doctor verified Deno 2.9.8,
Quarto 1.10.19, R 4.6.1 and Chromium 155.0.8059.84 on Linux.

Both installed CLIs performed a real render and validation with unchanged QMD.
The npm consumer also passed reviewed visual/authored patching, source-plus-state
rebuilding without old HTML, selected sync and verified rendering: document
identity, authored content and geometry survived, with one pending edit before
sync and zero only after its verified render. The isolated checks removed their
own temporary directories and changed no global configuration.

The observed public result is retained locally as
`output/npm/release-0.2.0/public-check.json`.

## Owner-performed global mise update

While publication was processing, the owner requested a global local-archive
update. Once npm exposed the version, the owner personally used the public
package instead:

```sh
mise use -g node@26.12.0 deno@2.9.8 \
  'npm:@brianmsm/quarto-bento[allow_low_downloads=true]@0.2.0'
```

Mise reported Deno and the package installed, with Node already installed. This
command also pins Node/Deno; it is not a claim that only the qbento setting
changed. No additional global installation or configuration change was performed
by the assistant.

Subsequent checks through `mise exec -- qbento` verified version/doctor and a
real render/validation with zero pending changes and unchanged QMD. The selected
installation matches all 137 archive files and all 132 manifest payload hashes,
including the clean source provenance. Mise's selected shell wrapper declares a
virtual-store target rather than being a package-root symlink; an initial
inspector's root assumption was corrected without weakening any comparison.

The selected entry is
`~/.local/share/mise/installs/npm-brianmsm-quarto-bento/0.2.0/node_modules/.bin/qbento`.
The observed result is retained locally as
`output/npm/release-0.2.0/mise-global-verify.json`.

The final published-documentation/handoff link check covered 22 files and 381
real inline relative links, with no missing targets or anchors.

No credentials, authentication links or one-time codes belong in this receipt.
Historical licensing-source gaps and upstream build-only advisories remain as
documented in [the publication policy](../PUBLICATION.md). The Linux development
release does not declare stable v1, hosted CI success, a GitHub binary release
or cross-platform acceptance.
