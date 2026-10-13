# Exact-version source license investigation

On 2026-10-13, the coordinator investigated the four production archives whose
complete package license texts were absent from the offline extraction in
[the distribution notice receipt](DISTRIBUTION-NOTICES.md). This was public
metadata and source-file research, without installing or executing packages.
The archive-derived `vendor/bento/runtime-licenses.json` remains unchanged. The
investigation does **not** resolve the four missing full package license texts
or establish a complete third-party review.

## Exact registry identity

The npm cache contained the exact tarballs but no registry metadata for these
packages. The official exact-version endpoints were therefore read directly.
Every response's name and version agrees with its pinned lock entry, and each
`dist.integrity` agrees exactly with the SHA-512 integrity recorded in
`vendor/bento/provenance/slides.package-lock.json`. Their `dist.tarball` URLs also
agree with the lockfile. No package was downloaded, installed or executed during
this investigation. Registry signatures were retained but not independently
verified. These are registry claims linking published versions to source
commits; they do not prove reproducible package construction.

| Exact package | Official registry metadata | Reported `gitHead` |
| --- | --- | --- |
| `@cfcs/core@0.0.6` | [Exact npm metadata](https://registry.npmjs.org/@cfcs%2fcore/0.0.6) | `c81b40afa0f4fb9595512be7e431b1665e38f412` |
| `croact@1.0.4` | [Exact npm metadata](https://registry.npmjs.org/croact/1.0.4) | `0a010f0c2f4bd820a6c4d590acec87b04986c687` |
| `croact-css-styled@1.1.9` | [Exact npm metadata](https://registry.npmjs.org/croact-css-styled/1.1.9) | `8b2cb322f05db9c5eed93702864a6fd62b99eeae` |
| `keycon@1.4.0` | [Exact npm metadata](https://registry.npmjs.org/keycon/1.4.0) | `ca3ec3be8df6ce9d0efb4adbdd01a9e273af3a05` |

The four retained raw registry responses have the following bytes and SHA256:

| Local response filename | Bytes | SHA256 |
| --- | ---: | --- |
| `@cfcs_core-0.0.6-registry.json` | 2602 | `13527a3086011c53b30dd1cd129f4df4e67326afdf889eab782201ad66be4975` |
| `croact-1.0.4-registry.json` | 1652 | `0dad546b0f9ea3e9fa5091e019bf9367c151fc2252a04fc05a834c5d6f4d0135` |
| `croact-css-styled-1.1.9-registry.json` | 2061 | `a78e19fdcb5656feeb6292e52a8a8ad0f2c0e2cc7a90b37f1aa2f67af26d0d06` |
| `keycon-1.4.0-registry.json` | 2779 | `91e783929e6062b2c3fcd363263082d9b629c3acbb0546c41ea853f2676e8a5d` |

## Immutable source findings

**`@cfcs/core`:** the repository URL supplied by npm was `naver/cfcs`. Raw
requests for root `LICENSE`, `LICENSE.md`, `LICENSE.txt`, `package.json` and
`packages/core/package.json` at the reported commit returned HTTP 404. The
[exact GitHub tree endpoint](https://api.github.com/repos/naver/cfcs/git/trees/c81b40afa0f4fb9595512be7e431b1665e38f412?recursive=1)
returned HTTP 422. This establishes retrieval failure at those endpoints, rather
than proving that no source license ever existed. The full license remains
unresolved.

**`croact`:** the [exact, untruncated source tree](https://api.github.com/repos/daybrush/croact/git/trees/0a010f0c2f4bd820a6c4d590acec87b04986c687?recursive=1)
contained no path with a license filename. The [root package manifest](https://raw.githubusercontent.com/daybrush/croact/0a010f0c2f4bd820a6c4d590acec87b04986c687/package.json)
declares version `1.0.4`, agreeing with the published version; its 950 bytes have
SHA256 `e09b6db47afdf87f288188eec16b1c939cc98dfe25cca9dda2a618b5787ed2b3`.
The [README](https://raw.githubusercontent.com/daybrush/croact/0a010f0c2f4bd820a6c4d590acec87b04986c687/README.md)
contains no complete license text. Its 755 bytes have SHA256
`faf926756119c5466c73b8bd69104979d955080cb26c96251fd6f70802993367`.
The full source license remains unresolved.

**`croact-css-styled`:** a [root LICENSE at the reported commit](https://raw.githubusercontent.com/daybrush/css-styled/8b2cb322f05db9c5eed93702864a6fd62b99eeae/LICENSE)
was retrieved: 1064 bytes, SHA256
`77f98221f8531e87aa227c0a8d63c17c903dd4d36daf24bdc48296b09e06a25e`.
It contains the complete MIT text and the literal header `Copyright (c) 2019
Daybrush`. However, the [source subpackage manifest](https://raw.githubusercontent.com/daybrush/css-styled/8b2cb322f05db9c5eed93702864a6fd62b99eeae/packages/croact-css-styled/package.json)
declares `1.1.8`, while npm publishes `1.1.9`. This manifest has 1625 bytes and
SHA256 `eb7c0902c76b6871d2f2d49b49936e7658b7ee414012ebbb4a3ae32099a68b94`.
The source root manifest separately declares `1.0.1`. The registry commit link
and retrieved LICENSE are retained as evidence, with this discrepancy explicit.
This pass does not prove exact source/package identity, assign the source text
as a resolved package license, or add it to the runtime supplement.

**`keycon`:** the [exact, untruncated source tree](https://api.github.com/repos/daybrush/keycon/git/trees/ca3ec3be8df6ce9d0efb4adbdd01a9e273af3a05?recursive=1)
has one LICENSE path, `packages/vue2-keycon/LICENSE`, belonging to a sibling
subpackage. That file was read for identification and was not assigned to
`keycon`. The [keycon source manifest](https://raw.githubusercontent.com/daybrush/keycon/ca3ec3be8df6ce9d0efb4adbdd01a9e273af3a05/packages/keycon/package.json)
declares `1.3.2`, differing from registry version `1.4.0`; its 1325 bytes have
SHA256 `e332a2cc8aac5fb427d63f90ed1a2230c4ab64eaa814e164dcd71a1fef864278`.
Neither the root README nor the keycon subpackage README contains a complete
license text. The full license for the pinned keycon package remains unresolved.

No modern branch HEAD, nearby release, sibling package license or inferred
copyright was substituted. Existing archive notices remain available in the
unchanged supplement. These findings concern the four named packages only; they
do not decide Quarto-Bento's own license or establish legal conclusions.

## Local evidence and reproduction

Raw responses, successfully retrieved immutable files, tree listings, status
reports and their byte/hash inventory are retained under the ignored local
directory `output/verification/missing-runtime-licenses/`:

- `registry-check.json` records exact metadata URLs, repository identities,
  `gitHead`, tarball URLs, integrity comparisons and raw response paths.
- `immutable-source-check.json` records the first license/manifest retrievals,
  successful bytes and SHA256, source versions and HTTP 404 results.
- `tree-check.json` records GitHub tree endpoint status, the three complete
  tree listings and the unavailable cfcs revision.
- `source-additional-check.json` records bounded README/subpackage retrievals.
- `checksums.json` records the SHA256 and byte count of all 23 retained evidence
  files, excluding itself.

To repeat the identity check, read each exact npm endpoint above and compare
`name`, `version`, `dist.tarball` and `dist.integrity` with its
`packages["node_modules/<name>"]` lock entry. Use only the supplied repository
and full `gitHead` for source-file and recursive-tree requests; record HTTP
failures and source version differences explicitly. Hash raw response/file
bytes before interpreting them. The endpoint responses may change or become
unavailable, so retained hashes describe this observation rather than a future
fetch guarantee. Reproducing the original archive absence remains the separate
offline extractor workflow documented in [PACKAGING.md](../PACKAGING.md).
