# Prepared npm CLI and Linux installation evidence

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
