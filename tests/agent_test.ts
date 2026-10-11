import {
  getAgentDeck,
  MAX_AGENT_PATCH_BYTES,
  patchAgentDeck,
  readAgentPatchFile,
} from "../src/core/agent.ts";
import {
  projectPaths,
  readProject,
  renderProject,
} from "../src/core/project.ts";
import { canonical, sha256, targetKey } from "../src/state/mod.ts";

function assert(value: unknown, message = "assertion failed"): asserts value {
  if (!value) throw new Error(message);
}
async function refuses(action: () => Promise<unknown>, code: string) {
  try {
    await action();
  } catch (error) {
    assert(
      (error as { code?: string }).code === code ||
        String(error).includes(code),
      String(error),
    );
    return;
  }
  throw new Error(`Expected ${code}`);
}
const decoder = new TextDecoder();
const canRun =
  (await Deno.permissions.query({ name: "run" })).state === "granted";
async function cli(args: string[]) {
  const output = await new Deno.Command(Deno.execPath(), {
    args: [
      "run",
      "--no-config",
      "--allow-read",
      "--allow-write",
      "--allow-run",
      "--allow-env",
      new URL("../src/cli.ts", import.meta.url).pathname,
      ...args,
    ],
    stdout: "piped",
    stderr: "piped",
  }).output();
  return {
    ...output,
    result: JSON.parse(
      decoder.decode(output.success ? output.stdout : output.stderr),
    ),
  };
}
async function payload(directory: string, value: unknown) {
  const path = directory + "/patch.json";
  await Deno.writeTextFile(path, JSON.stringify(value));
  return path;
}

Deno.test({
  name:
    "agent CLI get/patch/status/sync/render uses saved state and preserves provenance/design",
  ignore: !canRun,
  fn: async () => {
    const directory = await Deno.makeTempDir({ prefix: "qbento-agent-" });
    try {
      for (const file of ["presentation.qmd", "data.csv"]) {
        await Deno.copyFile(
          new URL("../fixtures/basic/" + file, import.meta.url),
          directory + "/" + file,
        );
      }
      const source = directory + "/presentation.qmd";
      await Deno.writeTextFile(
        source,
        await Deno.readTextFile(source) +
          "\n::: {#speaker .notes}\nOriginal note.\n:::\n",
      );
      const original = await Deno.readTextFile(source);
      const initial = (await renderProject(source)).state;
      let output = await cli(["get", source]);
      assert(output.success, canonical(output.result));
      const snapshot = output.result;
      assert(
        snapshot.docId === initial.docId &&
          snapshot.revision === initial.revision,
      );
      assert(
        snapshot
          .provenance[
            targetKey({ slideId: "results", elementId: "fig-values" })
          ].origin === "computed",
      );
      const before =
        snapshot.deck.slides[0].elements.find((el: { id: string }) =>
          el.id === "fig-values"
        ).src;
      const patch = {
        version: 1,
        docId: snapshot.docId,
        expectedRevision: snapshot.revision,
        operations: [
          {
            op: "element.patch",
            slideId: "results",
            elementId: "fig-values",
            fields: { x: 333, w: 640 },
          },
          {
            op: "element.patch",
            slideId: "results",
            elementId: "finding/paragraph:1",
            fields: { html: "Edited by an agent." },
          },
          {
            op: "slide.patch",
            slideId: "conclusion",
            fields: { background: "#eef5f0", notes: "Check the result." },
          },
          { op: "slide.move", slideId: "conclusion", afterId: null },
        ],
      };
      output = await cli(["patch", source, await payload(directory, patch)]);
      assert(output.success, canonical(output.result));
      assert(
        output.result.revision === initial.revision + 1 &&
          output.result.sourceUnchanged,
      );
      assert(await Deno.readTextFile(source) === original);
      assert(
        canonical(
          output.result.deck.slides.map((s: { id: string }) => s.id),
        ) === canonical(["conclusion", "results"]),
      );
      output = await cli(["status", source]);
      assert(
        output.success &&
          output.result.pending.some((p: { path: string[] }) =>
            p.path[0] === "html"
          ),
      );
      output = await cli(["sync", source]);
      assert(output.success, canonical(output.result));
      const plan = output.result;
      assert(
        plan.result.includes("Edited by an agent.") &&
          plan.result.includes("Check the result"),
        plan.result,
      );
      assert(
        await Deno.readTextFile(source) === original,
        "preview wrote source",
      );
      const planPath = directory + "/plan.json";
      await Deno.writeTextFile(planPath, JSON.stringify(plan));
      output = await cli(["sync", source, "--apply", planPath]);
      assert(output.success, canonical(output.result));
      await Deno.writeTextFile(
        directory + "/data.csv",
        "x,y\n1,9\n2,3\n3,1\n4,5\n",
      );
      output = await cli(["render", source]);
      assert(output.success, canonical(output.result));
      const refreshed = await getAgentDeck(source);
      const figure = refreshed.deck.slides.find((s) => s.id === "results")!
        .elements.find((el) => el.id === "fig-values")!;
      assert(figure.x === 333 && figure.w === 640 && figure.src !== before);
      assert(
        refreshed.docId === initial.docId && refreshed.pending.length === 0,
      );
      assert(
        refreshed.deck.slides[0].id === "conclusion" &&
          refreshed.deck.slides[0].background === "#eef5f0",
      );
      assert(refreshed.deck.slides[0].notes === "Check the result.");
      assert(
        refreshed.deck.slides[1].elements.find((el) =>
          el.id === "finding/paragraph:1"
        )?.html === "Edited by an agent.",
      );
      const sourceAfter = await Deno.readTextFile(source);
      output = await cli([
        "patch",
        source,
        await payload(directory, {
          version: 1,
          docId: refreshed.docId,
          expectedRevision: refreshed.revision,
          operations: [{
            op: "element.patch",
            slideId: "results",
            elementId: "fig-values",
            fields: { src: before },
          }],
        }),
      ]);
      assert(output.success, canonical(output.result));
      assert(
        output.result.pending.some((p: { origin: string; status: string }) =>
          p.origin === "computed" && p.status === "conflict"
        ),
      );
      output = await cli(["sync", source]);
      assert(
        !output.success && output.result.error === "SYNC_CONFLICT",
        canonical(output.result),
      );
      output = await cli(["render", source]);
      assert(
        !output.success && output.result.error === "MERGE_CONFLICT",
        canonical(output.result),
      );
      assert(
        await Deno.readTextFile(source) === sourceAfter,
        "computed edit wrote source",
      );
    } finally {
      await Deno.remove(directory, { recursive: true });
    }
  },
});

Deno.test({
  name:
    "agent batches reject stale identities, unknown paths/types and invalid targets without partial writes",
  ignore: !canRun,
  fn: async () => {
    const directory = await Deno.makeTempDir({
      prefix: "qbento-agent-invalid-",
    });
    try {
      const source = directory + "/deck.qmd",
        original =
          "## A {#a}\n\n::: {#body}\nText.\n:::\n\n## B {#b}\n\nOther.\n";
      await Deno.writeTextFile(source, original);
      const state = (await renderProject(source)).state,
        request = {
          version: 1,
          docId: state.docId,
          expectedRevision: state.revision,
          operations: [{
            op: "element.patch",
            slideId: "a",
            elementId: "body/paragraph:1",
            fields: { x: 99 },
          }],
        };
      const unchanged = canonical(state),
        statePath = directory + "/.qbento/state.json",
        bytes = await Deno.readTextFile(statePath);
      for (
        const [input, code] of [
          [
            { ...request, expectedRevision: state.revision - 1 },
            "STALE_REVISION",
          ],
          [{ ...request, docId: "unrelated" }, "UNRELATED_DOCUMENT"],
          [{ ...request, extra: true }, "AGENT_INVALID_REQUEST"],
          [{ ...request, expectedRevision: "1" }, "AGENT_INVALID_REQUEST"],
          [{ ...request, operations: [] }, "AGENT_INVALID_REQUEST"],
          [{
            ...request,
            operations: [...request.operations, {
              op: "slide.move",
              slideId: "b",
              afterId: "missing",
            }],
          }, "AGENT_TARGET_NOT_FOUND"],
          [{
            ...request,
            operations: [...request.operations, {
              op: "slide.patch",
              slideId: "b",
              fields: { id: "new" },
            }],
          }, "AGENT_UNKNOWN_FIELD"],
          [{
            ...request,
            operations: [...request.operations, {
              op: "element.patch",
              slideId: "a",
              elementId: "body/paragraph:1",
              fields: { "shadow.blur": 8 },
            }],
          }, "AGENT_UNKNOWN_FIELD"],
          [{
            ...request,
            operations: [...request.operations, {
              op: "element.patch",
              slideId: "a",
              elementId: "body/paragraph:1",
              fields: { x: "wrong" },
            }],
          }, "BENTO_CONTRACT"],
          [{
            ...request,
            operations: [...request.operations, {
              op: "element.patch",
              slideId: "a",
              elementId: "body/paragraph:1",
              fields: { src: "data:image/svg+xml;base64,eA==" },
            }],
          }, "BENTO_CONTRACT"],
          [
            { ...request, operations: [{ op: "slide.delete", slideId: "a" }] },
            "AGENT_UNKNOWN_OPERATION",
          ],
          [{
            ...request,
            operations: [
              { op: "slide.hide", slideId: "a" },
              ...request.operations,
            ],
          }, "AGENT_INVALID_REQUEST"],
        ] as const
      ) {
        const output = await cli([
          "patch",
          source,
          await payload(directory, input),
        ]);
        assert(
          !output.success && output.code === 1 && output.result.error === code,
          canonical(output.result),
        );
        assert(
          await Deno.readTextFile(statePath) === bytes,
          "failed batch changed state bytes",
        );
        assert(canonical(await readProject(source)) === unchanged);
        assert(await Deno.readTextFile(source) === original);
      }
      const usage = await cli(["get", source, "extra"]);
      assert(
        !usage.success && usage.code === 1 &&
          usage.result.error === "AGENT_USAGE",
        canonical(usage.result),
      );
      assert(await Deno.readTextFile(statePath) === bytes);
      for (const value of [Infinity, NaN]) {
        await refuses(
          () =>
            patchAgentDeck(source, {
              ...request,
              operations: [{ ...request.operations[0], fields: { x: value } }],
            }),
          "INVALID_JSON",
        );
      }
      await refuses(
        () =>
          patchAgentDeck(
            source,
            JSON.parse(
              JSON.stringify(request).replace('"x":99', '"__proto__":{}'),
            ),
          ),
        "UNSAFE_KEY",
      );
      let output = await cli([
        "patch",
        source,
        await payload(directory, {
          ...request,
          operations: [{ op: "slide.hide", slideId: "a" }],
        }),
      ]);
      assert(output.success, canonical(output.result));
      assert(
        output.result.deck.slides[0].hidden === true &&
          output.result.pending.length === 0,
      );
      output = await cli([
        "patch",
        source,
        await payload(directory, {
          ...request,
          expectedRevision: output.result.revision,
          operations: [{ op: "slide.show", slideId: "a" }],
        }),
      ]);
      assert(
        output.success && !output.result.deck.slides[0].hidden,
        canonical(output.result),
      );
      assert(await Deno.readTextFile(source) === original);
      const current = await getAgentDeck(source);
      const attempts = await Promise.allSettled(
        [99, 100].map((x) =>
          patchAgentDeck(source, {
            ...request,
            expectedRevision: current.revision,
            operations: [{ ...request.operations[0], fields: { x } }],
          })
        ),
      );
      assert(
        attempts.filter((attempt) => attempt.status === "fulfilled").length ===
          1,
        "concurrent patches both committed",
      );
      const latest = await getAgentDeck(source);
      assert(latest.revision === current.revision + 1);
      const savedBytes = await Deno.readTextFile(statePath);
      await Deno.writeTextFile(
        directory + "/deck.bento.html",
        "Changed uncaptured output",
      );
      await refuses(
        () =>
          patchAgentDeck(source, {
            ...request,
            expectedRevision: latest.revision,
          }),
        "UNCAPTURED_HTML_EDITS",
      );
      assert(
        await Deno.readTextFile(statePath) === savedBytes &&
          await Deno.readTextFile(source) === original,
      );
      await refuses(
        () => getAgentDeck(directory + "/different.qmd"),
        "PROJECT_SOURCE_MISMATCH",
      );
    } finally {
      await Deno.remove(directory, { recursive: true });
    }
  },
});

Deno.test({
  name: "agent patches recheck docId under the lock after sidecar replacement",
  ignore: !canRun,
  fn: async () => {
    const directory = await Deno.makeTempDir({
      prefix: "qbento-agent-identity-",
    });
    const originalMkdir = Deno.mkdir;
    try {
      const text = "## A {#a}\n\n::: {#body}\nText.\n:::\n";
      for (const name of ["a", "b"]) {
        await Deno.mkdir(directory + "/" + name);
        await Deno.writeTextFile(directory + "/" + name + "/deck.qmd", text);
      }
      const source = directory + "/a/deck.qmd",
        other = directory + "/b/deck.qmd",
        stateA = (await renderProject(source)).state,
        stateB = (await renderProject(other)).state,
        paths = projectPaths(source),
        statePath = paths.stateDir + "/state.json",
        originalBytes = await Deno.readTextFile(statePath);
      assert(stateA.docId !== stateB.docId);
      assert(stateA.revision === stateB.revision);
      // A valid restored sidecar can retain a matching revision and output hash
      // while carrying another document identity. Substitute it at lock entry.
      stateB.output = {
        ...stateB.output,
        path: paths.output,
        sha256: await sha256(await Deno.readFile(paths.output)),
      };
      const replacement = JSON.stringify({
        format: "qbento-state-envelope/1",
        sha256: await sha256(canonical(stateB)),
        state: stateB,
      });
      for (
        const operation of [
          { op: "slide.hide", slideId: "a" },
          { op: "slide.show", slideId: "a" },
          {
            op: "element.patch",
            slideId: "a",
            elementId: "body/paragraph:1",
            fields: { x: 99 },
          },
        ]
      ) {
        await Deno.writeTextFile(statePath, originalBytes);
        let swapped = false;
        Deno.mkdir = async (path, options) => {
          if (!swapped && String(path) === paths.stateDir + "/operation.lock") {
            swapped = true;
            await Deno.writeTextFile(statePath, replacement);
          }
          return await originalMkdir(path, options);
        };
        try {
          await refuses(
            () =>
              patchAgentDeck(source, {
                version: 1,
                docId: stateA.docId,
                expectedRevision: stateA.revision,
                operations: [operation],
              }),
            "UNRELATED_DOCUMENT",
          );
        } finally {
          Deno.mkdir = originalMkdir;
        }
        assert(swapped, "replacement did not happen at the operation lock");
        assert(await Deno.readTextFile(statePath) === replacement);
        assert(canonical(await readProject(source)) === canonical(stateB));
        assert(await Deno.readTextFile(source) === text);
        assert(await Deno.readTextFile(other) === text);
      }
    } finally {
      Deno.mkdir = originalMkdir;
      await Deno.remove(directory, { recursive: true });
    }
  },
});

Deno.test("agent file input is byte bounded, UTF-8 JSON only and regular-file only", async () => {
  const directory = await Deno.makeTempDir({ prefix: "qbento-agent-file-" });
  try {
    const path = directory + "/patch.json";
    await Deno.writeTextFile(
      path,
      "{}" + " ".repeat(MAX_AGENT_PATCH_BYTES - 2),
    );
    assert(canonical(await readAgentPatchFile(path)) === "{}");
    await Deno.writeTextFile(
      path,
      "{}" + " ".repeat(MAX_AGENT_PATCH_BYTES - 1),
    );
    await refuses(() => readAgentPatchFile(path), "AGENT_INPUT_TOO_LARGE");
    await Deno.writeFile(path, new Uint8Array([0xff]));
    await refuses(() => readAgentPatchFile(path), "AGENT_INVALID_JSON");
    await Deno.writeTextFile(path, "invalid");
    await refuses(() => readAgentPatchFile(path), "AGENT_INVALID_JSON");
    await refuses(() => readAgentPatchFile(directory), "AGENT_INPUT_FILE");
    if (Deno.build.os !== "windows") {
      const symlink = directory + "/link.json";
      await Deno.symlink(path, symlink);
      await refuses(() => readAgentPatchFile(symlink), "AGENT_INPUT_FILE");
    }
    await refuses(() => getAgentDeck(directory + "/new.qmd"), "NO_BASELINE");
    try {
      await Deno.stat(directory + "/.qbento");
      throw new Error("get created project state");
    } catch (error) {
      assert(error instanceof Deno.errors.NotFound, String(error));
    }
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});
