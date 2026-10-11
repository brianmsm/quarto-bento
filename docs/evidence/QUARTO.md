# Ordinary Quarto rendering: verified integration and limits

Implemented and tested on Linux with **Quarto 1.10.19**, its bundled Deno runner,
installed R/knitr, and the repository's pinned Bento shell. This is implementation
evidence for ordinary rendering; it is **not** full v1 or cross-platform acceptance.

## Install and use

The extension has both a custom project type `qbento` and an HTML-derived format
`qbento-html`. Install from a local checkout without downloading dependencies:

```sh
deno eval 'import { installQuartoProject } from "./src/integration/install.ts"; await installQuartoProject("/absolute/project/presentation.qmd")'
cd /absolute/project
quarto render presentation.qmd
```

The installer copies the extension plus its TypeScript runtime, pinned Bento shell,
license, notices and schemas into `_extensions/qbento/`. Commit that directory
alongside QMD, inputs and the versioned `.qbento/` state to keep ordinary rendering
offline. It creates this project config only when neither `_quarto.yml` nor
`_quarto.yaml` exists:

```yaml
project:
  type: qbento
  render:
    - presentation.qmd
```

A source-level `format: html` overrides the project format. Remove that declaration
or explicitly select `format: qbento-html` in the QMD. The installer does not rewrite
the source. Existing config/extension directories are refused; callers can install
with `{ configure: false }` and deliberately merge the project type and render list.
Do not drop the pre/post hooks or substitute another project type.

Supported ordinary invocations currently are `quarto render`, `quarto render .`,
`quarto render presentation.qmd`, and those forms with `--to qbento-html` and/or
`--quiet`. One QMD must be beside `_quarto.yml`; multi-file, preview, output-directory
changes and other CLI overrides are explicitly refused. Normal output is
`presentation.bento.html`; `presentation.qbento-stage.html` is a disposable internal
Quarto artifact, not the delivery deck. Quarto's final console line names that
stage; the post hook separately prints the final Bento path.

Project and QMD paths may contain spaces and quotes. Pass a source filename as a
single argument, for example `quarto render 'slides with spaces.qmd'`. The supplied
project hooks use the fixed paths `_extensions/qbento/pre.ts` and
`_extensions/qbento/post.ts` relative to the project directory. Keep the installed
extension at that location.

**Measured Quarto 1.10.19 path issue:** bare extension hook declarations such as
`pre-render: pre.ts` were resolved to an absolute path by `readExtension`, then
split by `runScripts` through `parseShellRunCommand`. A project named
`project with spaces` consequently attempted to spawn `/tmp/.../project` and
failed before the hook ran. This was inspected in the installed
`/opt/quarto/bin/quarto.js` (hook resolution at line 79165, `runScripts` at line
137909 and `parseShellRunCommand` at line 137334) and reproduced with ordinary
rendering. Fixed project-relative hook paths avoid embedding the project path in
the command string; no shell wrapper or escaping of user-supplied paths is added.
The pre/post hook implementations and their guarded publication remain unchanged.

## Why staging and preflight are required

The format writes `.qbento-stage.html`. Its `post-quarto` Lua filter captures the
executed Pandoc AST, including actual figure references, into a token-bound receipt.
The post hook invokes `renderProjectFromAst` with the preflight source hash and state
revision. That function uses the same source identity, composition, output-edit
checks, recovery journal and no-clobber publication as `qbento render`. It does not
execute Quarto again. The internal CLI execution sets `QBENTO_INTERNAL_RENDER=1`
and inherited project hooks return immediately, preventing recursive execution.

The pre hook checks uncaptured native HTML before any chunk executes. It also
checks effective YAML through `quarto inspect`, validates the stage path is neither
a symlink nor a hardlink, takes an independent baseline copy, and creates an
exclusive `.qbento/quarto-run.json` receipt. The receipt records source hash,
revision, run token and render process identity. Overlapping ordinary renders are
refused. Changes during execution are caught again before final publication.

**Experimental discovery:** a Lua filter that rejects `--output deck.bento.html`
is too late: Pandoc can truncate the output before invoking that filter. Therefore
the pre hook additionally verifies the actual installed Quarto ancestor invocation
via bounded Linux `/proc` inspection and permits only the forms listed above.
Unsafe output, metadata and format arguments fail before execution. Unrecognized
launchers or platforms fail closed. This is a temporary technical restriction;
portable ordinary integration still requires a trustworthy pre-execution output
hook or equivalently tested invocation validation. The product's Linux/macOS/Windows
target is unchanged. Source/configuration and extension code are trusted project
inputs; removing/bypassing safeguards is outside this integration contract.

## Failure and explicit recovery

A failed Quarto computation or post-render refusal leaves the receipt and baseline
snapshot intact. After the process stops, explicitly recover:

```sh
deno eval 'import { recoverQuartoRender } from "./src/integration/quarto.ts"; console.log(await recoverQuartoRender("/absolute/project/presentation.qmd"))'
```

Recovery checks the recorded process using `ps` and refuses a still-active render.
It checks the project revision and backup hash. An unchanged valid output stays in
place. A newer valid native Bento save also stays in place for explicit capture.
If output is absent or truncated, it restores the baseline while retaining any
unexpected output under `.qbento/history/`. It then clears the external Quarto
receipt. Source and saved design are not changed. Core `render-transaction.json`
recovery remains separate and is deliberately not bypassed here.

Normal render, format and hook behavior follows the official
[custom formats](https://quarto.org/docs/extensions/formats.html),
[project types](https://quarto.org/docs/extensions/project-types.html), and
[project scripts](https://quarto.org/docs/projects/scripts.html) contracts. Actual
output ordering and script environment were tested locally rather than inferred
from those pages.

## Reproducible evidence

```sh
deno check src/integration/*.ts
deno test --allow-read --allow-write --allow-env --allow-run tests/extension_test.ts tests/quarto_paths_test.ts
```

Tests use fresh temporary projects, a scoped `XDG_CACHE_HOME`,
`QUARTO_RUN_NO_NETWORK=true`, and an R chunk that appends to an execution counter.
They verify:

- Installer preserves existing configuration/source and includes upstream licensing.
- An ordinary render executes exactly once and projects the computed SVG.
- Native edits block render before execution; explicit capture plus changed data
  updates SVG while preserving geometry and stable `docId`.
- Deleting generated HTML rebuilds with the retained sidecar; internal CLI execution
  does not recurse into ordinary-render hooks.
- Output/metadata/format overrides and unsafe YAML are rejected without touching
  final bytes or running chunks; symlink and hardlink aliases are refused.
- Failed computation retains baseline; explicit recovery permits a subsequent run.
- A native save arriving during execution survives post-render refusal and recovery;
  recovery while the renderer is still alive is rejected.
- A project path with spaces, single and double quotes, and a QMD filename with
  spaces and single quotes, renders once through both hooks. Uncaptured native
  edits and unsafe output arguments are refused before execution; changed-data
  recomputation retains captured geometry and stable `docId`.

These are Linux execution and file-persistence tests. They do not establish browser
visual fidelity, native editor interaction, macOS/Windows packaging, Quarto preview
support, or behavior after users remove the supplied hooks.
