# npm 0.2.0 publication

## Authorization and current state — 2026-10-27

The owner explicitly authorized versioning and publishing
`@brianmsm/quarto-bento@0.2.0`. This is a Linux development release, not stable
v1. The authorization does not update the owner's global CLI or mise setup,
modify the separate presentation/plugin, or change the pinned Bento assets.

Publication is being prepared. Anonymous npm metadata currently reports
`0.1.1` as `latest`. The existing npm session returned HTTP 401; the owner
completed a fresh interactive login, and `npm whoami` verified publisher
`brianmsm`. No successful publication or public 0.2.0 installation is claimed
at this stage.

## Qualification and artifact boundary

The implementation qualification is recorded separately in
[the composition/interactivity receipt](COMPOSITION-INTERACTIVITY-0.2.0.md):
705 tests and four steps passed, with zero failures and one ignored optional
upstream-source comparison. That receipt's dirty-source local review tarball
is historical and will not be submitted to npm.

The publication artifact must be rebuilt from committed clean source with the
existing guarded staging command. The source-root package remains private;
only the explicitly assembled archive is publishable. Its source commit,
manifest, archive hashes, clean provenance and final installation observations
will be recorded here after they are observed. Registry publication must use
that exact verified archive with public access and the `latest` tag.

No credentials, authentication links or one-time codes belong in this receipt.
Public source follows the existing main-only convention; experimental branches
are not published. Historical licensing-source gaps and upstream build-only
advisories remain as documented in [the publication policy](../PUBLICATION.md).
