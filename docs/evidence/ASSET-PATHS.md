# Asset path guard review

On 2026-10-11 an independent, read-only review found that the local image
adapter rejected URL schemes and `//` paths but did not reject Windows UNC paths
written with backslashes. Installed Quarto preserved such an image target in its
AST, and `node:path.win32.resolve` confirmed that the target resolves to a UNC
path. Calling `realPath` before checking containment could therefore contact a
Windows share before the adapter refused it. No share was contacted and no
credential negotiation was tested; this was a conditional Windows finding
supported by source and path-resolution evidence.

The adapter now refuses any leading pair of slashes or backslashes, including
mixed separators and Windows device paths, before filesystem access. It also
checks lexical containment before calling `realPath`. The existing canonical
containment check remains after `realPath` to reject symlinks escaping the
permitted source/build roots.

`tests/asset_paths_test.ts` runs each refusal with filesystem read permission
disabled. URL, UNC, device and mixed-separator targets must produce
`EXTERNAL_ASSET`; a lexical parent-directory escape must produce
`MISSING_ASSET`. A premature filesystem lookup would instead fail the test on
permission denial. These are platform-independent guard regressions executed on
Linux, not native Windows acceptance or a general filesystem sandbox for
user-supplied Quarto code.

The same bounded review found no concrete bypass of Studio's token/Host/Origin
checks or its 25 MB streaming body limit. It did not complete a browser security
test or a comprehensive audit of the pinned upstream dependencies.

## Project resource persistence guard

The upstream JSON format also permits remote image/media URLs, temporary `blob:`
URLs and references to absent assets. Those can satisfy the native schema while
failing to reopen or rebuild in an offline project. The project
save/capture/publication gate now refuses these direct resource dependencies
instead of reporting them as durably saved.

Images, media/posters and custom fonts must resolve to embedded `data:` bytes.
Referenced asset keys for SVG, embeds and code extensions must exist, including
objects in native reusable layouts. The exact two built-in font keys from the
pinned shell remain supported (`builtin:fraunces-900` and
`builtin:instrument-sans`); an explicit asset with either key takes precedence
and must itself be embedded. URI scheme matching accepts uppercase `DATA:` as
the pinned font resolver does. An independent review caught and revalidated both
font compatibility cases before integration. Outgoing web hyperlinks are
unchanged, and validation does not prune unused assets or mutate the document.

`tests/project_resources_test.ts` covers these direct references and verifies a
real Quarto save failure leaves QMD, state and generated HTML byte-identical.
Embedding the resource then permits save and rebuild without the old HTML; the
decorative image and its bytes survive. Together with existing native contract
and capture regressions, **25 tests pass**. That first guard did not inspect
nested SVG resources. The following extension closes the identified native SVG
dependency gap; neither slice decodes arbitrary media or constitutes a
comprehensive upstream security audit.

## Native SVG and embed snapshot dependencies

A follow-up independent review found four native forms which satisfied the
project schema but lost their picture in the isolated offline shell:
`svg.markup`, `svg.asset` pointing to raw SVG in `assets`, `embed.view` inline
SVG, and `embed.view` pointing to an asset. Each SVG contained an `image href`
targeting `https://audit.invalid`. At pinned Bento revision
`3d6f7f1fcdf2308e875345ce4f1e0ec0820c914b`, Slides `render.ts` resolves those
fields and passes markup through its SVG sanitizer. Its image/feImage href
policy permits web images. Native Save and capture previously accepted all four
forms.

The independent Chromium repro observed all four URLs in the rendered DOM. With
`OFFLINE_CSP` there were four `img-src` policy violations and no requests;
without CSP, routes intercepted and aborted all four attempted requests, with
DNS disabled. No external service received a request. This establishes actual
native dependency/lost-content behavior, not an XSS finding.

The project gate now inspects the resolved native markup and extra SVG CSS on
both slides and native layout templates. A bounded pure tokenizer checks href
attributes, CSS `url()`/imports/resource functions, numeric/reference entities
and CSS escapes. Embedded SVG image data is decoded and inspected recursively
(up to four levels, eight MiB per inspected SVG/CSS). External/relative/blob
resource dependencies and unsupported ambiguous forms fail with a property path
and instructions to embed the resource or import a self-contained snapshot.
There is no network access, DOM execution, content repair or silent stripping.
Direct SVG/view fields must contain markup, as the pinned renderer expects,
rather than an SVG data URI or a URL. The inspection follows the native asset
precedence: an explicit SVG asset supplies the rendered markup.

Local gradient/filter/clip/use fragments, embedded raster data, self-contained
nested SVG image data, native empty placeholders, and HTTP(S) SVG anchor links
remain supported. Anchor hyperlinks are user navigation, not fetched resources.
CSS comments and literal strings do not trigger resource checks. Ordinary public
SVG 1.1 DOCTYPE declarations remain valid: the pinned HTML parser does not fetch
the DTD. Entity subsets/stylesheet instructions are refused explicitly. This is
resource persistence inspection for the pinned native renderer; it is not a full
XML/CSS parser, general SVG sanitizer, media decoder or proof of all future
browser/upstream semantics. Unsupported resource-bearing syntax requires an
explicit self-contained snapshot.

Focused validation:

```sh
deno test --allow-read --allow-write --allow-env --allow-run tests/project_resources_test.ts tests/document_contract_test.ts tests/capture_test.ts
```

The focused run and its independent rerun passed **28 tests, 0 failures** (the
implementation run took seven seconds). An independent twenty-case matrix also
matched the expected admissions/refusals. Type checking, lint, formatting and
whitespace checks passed.

These tests cover external and encoded references across the four forms, CSS
field/style markup, reusable layouts, gradients/raster data and local links.
Real Quarto tests prove both Save and downloaded HTML capture refuse atomically:
QMD, state, generated HTML and the retained downloaded file remain
byte-identical. A valid decorative native SVG then saves and survives rebuilding
without the old HTML. The entire repository suite was not run for this focused
guard change. The independent reviewer also confirmed standard public DOCTYPE,
harmless comments containing declaration-like text and unescaped query-string
anchor links render natively with zero attempted requests and their content
retained.
