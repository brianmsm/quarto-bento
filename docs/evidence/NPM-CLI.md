# npm CLI publication and Linux installation evidence

The latest published correction is `0.1.1` (2026-10-17). Its exact archive,
anonymous registry/npm/mise checks and owner-requested global mise update are
recorded in [the current correction receipt](SYNC-SELECTION-0.1.1.md). The
following sections preserve the initial `0.1.0` evidence.

## Historical first public registry publication: 2026-10-16

The owner superseded preparation-only authorization and authorized public npm
publication. The publisher was authenticated as `brianmsm`. The exact staged
archive was accepted by `npm publish --access public --ignore-scripts` after
browser authorization, with exit status 0. npm initially returned HTTP 202 and
reported processing; public requests briefly returned 404 and then exposed only
its `0.0.0-stage` placeholder. The actual `0.1.0` version subsequently became
available. No second version or duplicate publication was submitted.

Published package:
[`@brianmsm/quarto-bento@0.1.0`](https://www.npmjs.com/package/@brianmsm/quarto-bento/v/0.1.0),
with `latest` pointing to `0.1.0` at that date. This is a Linux development CLI,
not stable v1.

| Artifact property          | Verified value                                                                                    |
| -------------------------- | ------------------------------------------------------------------------------------------------- |
| Clean staging source       | `05e70bbefebad5f540083bba25444dda0caef0d8`, dirty `false`                                         |
| Archive bytes              | 893813                                                                                            |
| Archive entries            | 122 regular files; no links                                                                       |
| Installed runtime payloads | 117, all sizes and SHA256 values matched                                                          |
| SHA256                     | `4fcd9d3c578735f43265861405108c7f37545353eb59d103fa30a04a01299bcb`                                |
| npm shasum                 | `cc42f2d4713662670874945abc8fd7ad6f0f134c`                                                        |
| npm integrity              | `sha512-jHGxooe/7kCZ1Fecx/MnRt7OfaED/ZISwI4SE1mCyMVOY1CWByXSvNcFk7gOmlF2qiHRapIhKTFHNSzgNGxsRg==` |

Anonymous HTTPS requests to registry.npmjs.org verified exact-version metadata,
the `latest` tag, complete tarball bytes, shasum/integrity and the registry root
README against the archive. Authentication was not used for those reads or for
either installation test.

Both public-registry installations passed `qbento --version` (`qbento 0.1.0`),
`qbento doctor`, all 117 payload hashes and a real render of the literal README
QMD example. Each output was a 986962-byte `.bento.html`, with no diagnostics,
zero pending edits and unchanged QMD bytes. The tests used an unrelated caller
directory with spaces, empty separate user/global npmrc files, fresh temporary
prefix/cache and isolated mise config/data/cache/state. Deno used a fresh cache
and `QUARTO_RUN_NO_NETWORK=true` during the ordinary render. Existing runtimes
were used; the smoke did not install Node, Deno or Quarto or test computation.

The tested host had Node 26.10.0, npm 11.19.1, Deno 2.9.6, Quarto 1.10.19 and
mise 2026.10.11. Unlike the earlier loopback test with mise 2026.10.7, current
mise initially refused this newly registered package under its reputation
policy. After anonymous artifact/publisher verification, the successful test
used the package-specific option `allow_low_downloads=true`. It did not disable
checks globally, allow lifecycle scripts or change the user's configuration.

Installation commands used by the isolated smoke, with temporary prefix/config
paths supplied through flags and environment:

```sh
npm install --global --prefix /temporary/prefix --ignore-scripts \
  --no-audit --no-fund @brianmsm/quarto-bento@0.1.0
mise install 'npm:@brianmsm/quarto-bento[allow_low_downloads=true]@0.1.0'
mise exec 'npm:@brianmsm/quarto-bento[allow_low_downloads=true]@0.1.0' \
  -- qbento doctor
```

The immutable archive contains `distribution/PACKAGING.md` from clean staging
commit `05e70bb`; its final paragraph predates publication and says npm/mise
installation is pending. The archived root README also predates the approval
required by current mise for new packages. Use
[the current npm guide](../NPM.md) for installation. The archive and its
recorded hashes remain unchanged; future package versions can refresh those
bundled documentation snapshots.

Eleven focal packaging tests passed again before publication. An independent
review checked inventory, notices and publication scope. The existing four
historical license-source gaps remain documented, and no GitHub binary release,
hosted CI success or Windows/macOS qualification is claimed. The local detailed
receipt is `output/npm/release-0.1.0/public-check.json`; this tracked summary
records the relevant results without depending on that ignored local file.

## Historical local preparation: 2026-10-13

Date: 2026-10-13. Package: `@brianmsm/quarto-bento@0.1.0`. The owner requested
npm CLI preparation and explicitly deferred registry publication. This receipt
covers local packaging and installation. No package was published to npm, no
binary release was attached to GitHub, and no user global installation or
configuration was changed.

## Package contract

The private source-root metadata describes the package template. The stager
validates its fixed identity, executable mapping, explicit file list, Linux
scope, Node requirement and public registry setting. It refuses dependencies,
lifecycle hooks, alias inputs and existing/overlapping destinations. Only the
staged metadata loses `private: true`. The portable builder verifies the pinned
Bento assets and notices before copying its complete payload into
`distribution/`.

The npm tarball has 122 files: 117 portable payload files, their manifest, and
root metadata, standalone README, LICENSE and launcher. The Node launcher
resolves its installed location through npm/mise links, keeps caller cwd and
argument boundaries, and invokes external Deno without remote/npm resolution or
caller Deno configuration. It reports missing Deno with exit 127 and forwards
termination to the child. No runtime or computation environment is installed
automatically. Node >=22 is declared; Node 26.10.0 and npm 11.19.1 were tested.
The application baseline remains Deno 2.9.6 and Quarto 1.10.19 on Linux.

Adding npm metadata changes Deno's default source-checkout module discovery.
`deno.json` therefore explicitly sets `nodeModulesDir: "none"`, preserving the
source workflow without requiring `npm install` or a node_modules tree. The core
application sources and upstream pin are unchanged by npm packaging.

## Validation

- Eleven focused tests passed: three npm launcher tests, two npm staging tests,
  four portable package tests and two bounded launcher-argument tests.
- Core, scripts and test types passed; lint covered 207 files. Runtime/scripts
  and changed packaging/test files passed targeted formatting and whitespace
  checks.
- `scripts/npm-check.ts` packed the explicit inventory, installed offline into a
  temporary npm prefix and checked all 117 payload hashes. After relocating that
  prefix, version/doctor/render/validate/get/patch worked from an unrelated
  directory with spaces, Unicode and an incompatible caller Deno config.
- A clean QMD + project/state rebuild retained document identity, exact saved
  geometry/typography, pending authored text and unchanged QMD bytes after the
  original HTML/project and staging directory were removed. Failure exit status
  was preserved. The npm smoke needs no browser or computation engine.
- Real mise 2026.10.7 installed the scoped package through its default npm
  backend using a minimal temporary loopback registry. Version and doctor
  passed, and all 117 installed payload hashes matched. Only scoped metadata and
  the local tarball were requested. This is a fixture-registry proof, not public
  npm publication or a hosted-CI result.
- Independent review found no concrete packaging/launcher blocker. It identified
  a relative link in the guide copied into the portable payload; the link now
  uses its public GitHub URL.

## Reproduction and limits

See [NPM.md](../NPM.md) for stage/pack/local-install commands. Run
`scripts/npm-check.ts` for the actual npm relocation/rebuild smoke and
`scripts/mise-npm-check.py <prepared-tarball>` for the isolated mise check. The
mise helper uses an empty npmrc and isolated data/config/cache/state paths,
preserves HOME, starts its own loopback server and removes its temporary tree.
Installed Node/Deno/Quarto are provided by the caller. Local socket access is
required; restricted command sandboxes may need a host-permission run.

The earlier 578-test application suite belongs to runtime `2ee7974`; it is not
relabeled as a full-suite rerun of these packaging changes. The same bounded
codecs, four historical license-source gaps and upstream build-only advisory
limits remain documented. Linux is the only npm package platform currently
declared. macOS/Windows, stable v1, registry publication and global user
installation are separate future actions.

## Clean prepared artifact

The final local tarball was built from clean source commit
`02ac65f9909d754f96d7e6269d6572217a51e8c9`; its distribution manifest records
that exact commit with `dirty: false`.
`output/npm/brianmsm-quarto-bento-0.1.0.tgz` contains 122 files and is 893786
bytes, SHA-256
`6e5904d06b7236d646e0f16df43fb78b3125a284cf6075af2a622486a0b945e9`. This ignored
local artifact is not a registry publication or a GitHub release.

The clean-commit npm smoke passed again. Its local receipt is
`output/npm/check-02ac65f.json`, SHA-256
`0223afbdc1d05981fc6a29204a0dc9563f35bd67ea78559e3297ddec0bec9719`. The mise
helper installed that exact final tarball, checked its archive hash and all 117
installed payloads, and passed version/doctor. Its local receipt is
`output/npm/mise-02ac65f.json`, SHA-256
`dd4e565cd65799769667cebe308a3b82d4adf5d2aed2c63cb74135d6aa7daf54`.
