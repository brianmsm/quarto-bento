# Studio: editable project layouts and themes

Implemented locally on Linux, 2026-10-11. This is a bounded editor for the
existing version 1 `.qbento/design.json` contract, not a universal Bento theme
or layout editor. It does not change the ownership rules in DESIGN_REGISTRY.md.

## Supported interaction

Studio's **Diseños y temas** dialog offers named layouts (columns, gap and
padding), named themes (background, text color, accent and font family), and an
explicit active theme selection. Names can be edited; entries can be added and
removed. The built-in `two-column` remains available. Renaming/deleting a layout
does not patch its `bento-layout-name` references in QMD; the dialog explains
that those references must be reviewed before recalculation.

**Guardar diseños** validates and saves only the registry. It does not execute
Quarto, rewrite QMD, update the deck revision, or publish HTML. **Recalcular**
applies the selected registry values through the existing projection, retaining
saved visual changes and pending semantic edits. QMD's explicit design remains
source-owned. Native palette/theme references retain their existing constraints.

Closing the dialog preserves a dirty draft in the tab. Reopening a clean dialog
loads a fresh snapshot, including the revision after recalculation.
Discard/reload is explicit, and its inputs/actions are disabled during the
request. A stale save shows an error and retains the edited draft. Closing the
browser with unsaved registry edits triggers its standard unsaved-changes
protection.

## Persistence and freshness

GET/POST `/api/design-registry` use Studio's existing token, Host and Origin
checks. POST requires JSON and limits the streamed envelope to 266,240 bytes;
the validated registry itself is limited to 262,144 bytes. Strict schema
validation refuses unknown fields/versions instead of silently replacing them.

Read and save use the project lock. Save checks document identity, deck revision
and the exact raw registry hash, including absence, under that lock. An external
byte change, even whitespace, invalidates the snapshot. Paths must be regular
files in the verified `.qbento` directory; symlinks and multiply linked registry
files are refused.

Each save retains a unique `.qbento/history/design-<UUID>/` receipt and
candidate. A hardlink capability probe occurs before touching the existing
registry. A fixed durable `.qbento/design-save.json` marker is published before
moving the original to `before.json`. Directory and file fsyncs cover the
transaction, original move and candidate publication on Linux. Publication
creates the target only if absent, so a concurrent replacement is not
overwritten. Rollback uses a separate durable copy and retains `before.json`
unchanged, then checks the restored target before removing the marker.
Incomplete publication/rollback leaves the marker and all recovery evidence.
Registry reads and rendering fail closed with
`DESIGN_REGISTRY_RECOVERY_REQUIRED`; an interrupted save is never interpreted as
a legitimate missing registry. The shared `assertDesignRegistryReady(directory)`
gate is available to other raw registry readers; their integration is a separate
acceptance step.

Version `.qbento/design.json` alongside QMD and the project's normal durable
state. Ignore history, the active marker, `.design-stage-*.json` and
`.design-link-probe-*` in Git. Ignoring recovery artifacts does not authorize
their deletion. Preserve them when copying a project for recovery.

## Manual recovery of a registry transaction

The existing `qbento recover` command does **not** handle this registry journal.
Do not delete the marker simply to suppress the error.

1. Stop Studio and other writers. Copy the whole project, including `.qbento`,
   generated HTML, downloads and recovery files, to a separate backup.
2. Read `.qbento/design-save.json` and its history receipt. Locate the matching
   `.qbento/history/design-<UUID>/` inside this project. Inspect paths instead
   of blindly executing absolute paths recorded in a receipt.
3. Compare SHA-256 of the current `design.json` (if present), `before.json` and
   `after.json` against `beforeHash`/`afterHash`. On Linux `sha256sum FILE`
   checks the exact bytes. `beforeHash: null` means the prior registry was
   absent. `after.json` is the proposed new registry. Keep any stage files as
   evidence.
4. Choose explicitly: restore verified prior bytes, finish the verified
   candidate, or retain a concurrent replacement after reviewing it. If current
   bytes match neither hash, preserve them separately; never overwrite that file
   implicitly.
5. With writers stopped, move any existing target to a new, non-overwriting
   recovery backup. Copy the chosen verified snapshot to `.qbento/design.json`
   as a regular, single-link file; do not use a symbolic/hard link. For an
   explicit rollback to prior absence, leave the target absent after backing it
   up. Keep history snapshots intact.
6. Recheck the installed bytes and hash (or explicitly chosen absence), then
   remove `.qbento/design-save.json` **last**. Open a fresh Studio session and
   load the registry. Retain history and the project backup. None of these steps
   calls for changing QMD, state or generated HTML.

If the filesystem refuses the initial hardlink probe, the original registry
remains readable and unchanged. Studio saving requires that capability; manual
editing of validated `design.json` is still available. Native Windows saving,
Windows directory durability, crash/power-loss testing and universal filesystem
compatibility are not claimed.

## Focused evidence

The author ran:

```sh
deno test --allow-read --allow-write --allow-env --allow-run --allow-net=127.0.0.1 \
  tests/studio_registry_test.ts tests/registry_test.ts tests/studio_body_test.ts \
  tests/studio_test.ts tests/registry_execution_test.ts
```

14 tests passed. The three execution tests invoke real installed Quarto and
cover registry defaults, sparse native overrides, motion/morph retention, QMD
ownership, ordinary Quarto preflight rejection and checked publication. The
editor tests cover pending-edit preservation, byte/absence CAS,
identity/revision conflicts, strict schema/path validation, body/security gates,
failed writes and injected publication/rollback races. They check QMD/state/HTML
bytes remain unchanged on refusal. Failure injection is runtime evidence, not a
simulated machine crash.

Independent Astra review reproduced and then rechecked closure of unsupported
hardlink recovery, a replacement during rollback, and typing during asynchronous
reload. The restored original remains available in history; subsequent reads
reject unresolved recovery; reload prevents new input from being discarded.

Author Chromium headless smoke uses the actual Studio and pinned native Bento
shell against a real Quarto-generated temporary deck. It exercises form editing,
rename/active-theme following, explicit save, stale-draft refusal/retention and
clean reopening. Screenshots at 1280 and 960 pixels are inspected visually;
header/editor geometry is also measured. Parent integration performs a further
native acceptance pass. This is focused coverage, not a full regression suite.

The temporary deck was `/tmp/qbento-studio-registry-native/deck.qmd`. Before and
after the explicit form Save, SHA-256 stayed identical for QMD
(`5a3e8527…cba5cb`), state (`8ae99a66…576ea`) and HTML (`a9863312…152db`).
Native form rename followed the active theme from `forest` to `woodland`. An
external whitespace edit caused `DESIGN_REGISTRY_CHANGED`; the draft gap of 27
stayed visible after refusal and after closing/reopening. Explicit reload
restored the saved gap of 20. Recalculation displayed the selected `#e8fff0`
background/`#123a24` text/`#26734a` accent in the native shell; reopening clean
then saving succeeded against the new deck revision. At 960 pixels,
`scrollWidth=960` and `headerBottom=editorTop=102`, so the wrapped header did
not overlap the editor. Images are local ignored review artifacts in
`output/playwright/studio-registry-1280.png`, `studio-registry-960-stale.png`,
and `studio-registry-theme-recalculated.png`. The console retained the existing
favicon refusal and upstream release-check CSP refusals; there was no registry
form pattern error after escaping the name pattern for Chromium's HTML
validation mode.

## Integrated pending-content acceptance

The coordinator repeated the native flow at integrated `bf32f8d` using
`/tmp/qbento-studio-design-native-final/deck.qmd` and Chromium headless at
1280 × 720. A native double-click edit changed the left card's literal paragraph
to “Texto editado en Bento, pendiente de sincronizar.” **Guardar proyecto**
produced revision 2 with one pending authored edit. The registry form then
changed the `balanced` layout gap from 24 to 40 and renamed the active theme
from `forest` to `ocean`, with background `#eef2ff`, text `#24376c` and accent
`#4169b1`.

**Guardar diseños** retained byte-identical QMD, state and generated HTML:

- QMD SHA-256: `f7b48dcb6b8ce9c6cb3109947159c79daf4d710e346f035f9309ad218697ede2`.
- State SHA-256: `6b433d5d6dc82d4e2ab3b5517a8bb966e3d98e0d4a7a9185003bb8a67ff5f13f`.
- HTML SHA-256: `1798be35da771f431acb461662d51e892c6f729f4ee5b7ed4160add1b8153a77`.

**Recalcular** produced revision 3 with the same
`docId=34dd476f-1342-469b-8960-5bbb8390a39f`, exact original QMD and the same
pending edit identity, before/after content and `bento-ahead` status. Reconciliation
added its current source value to the pending record. The emitted native slide
retained the edited paragraph. The two card widths changed from 536 to 528;
the second card moved from x=652 to x=660, making the requested 40-pixel gap.
The explicit QMD fill `#eefaff` on the first card remained intact while the
second card and slide used the new theme background.

The actual form and regenerated native canvas screenshots were inspected:
`output/playwright/studio-registry-parent-saved.png` and
`studio-registry-parent-recalculated.png`. Both cards and their text are readable,
with the pending count visible in Studio. The console contained only the
existing favicon refusal and CSP-blocked upstream release checks. This proves
the save/registry/recompute interaction with pending text; it does not claim
native operating-system dialog or other-platform validation.

The same Studio session then previewed and explicitly applied the authored text
patch plus the optional `.qbento-design` heading class. The exact source diff
contained those two changes only. A final **Recalcular** reached revision 5,
zero pending changes and the same document identity. Neither the selected
theme nor layout required copying coordinates into QMD.
