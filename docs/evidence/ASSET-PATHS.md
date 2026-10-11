# Asset path guard review

On 2026-10-11 an independent, read-only review found that the local image
adapter rejected URL schemes and `//` paths but did not reject Windows UNC
paths written with backslashes. Installed Quarto preserved such an image target
in its AST, and `node:path.win32.resolve` confirmed that the target resolves to
a UNC path. Calling `realPath` before checking containment could therefore
contact a Windows share before the adapter refused it. No share was contacted
and no credential negotiation was tested; this was a conditional Windows
finding supported by source and path-resolution evidence.

The adapter now refuses any leading pair of slashes or backslashes, including
mixed separators and Windows device paths, before filesystem access. It also
checks lexical containment before calling `realPath`. The existing canonical
containment check remains after `realPath` to reject symlinks escaping the
permitted source/build roots.

`tests/asset_paths_test.ts` runs each refusal with filesystem read permission
disabled. URL, UNC, device and mixed-separator targets must produce
`EXTERNAL_ASSET`; a lexical parent-directory escape must produce
`MISSING_ASSET`. A premature filesystem lookup would instead fail the test on
permission denial. These are platform-independent guard regressions executed
on Linux, not native Windows acceptance or a general filesystem sandbox for
user-supplied Quarto code.

The same bounded review found no concrete bypass of Studio's token/Host/Origin
checks or its 25 MB streaming body limit. It did not complete a browser security
test or a comprehensive audit of the pinned upstream dependencies.
