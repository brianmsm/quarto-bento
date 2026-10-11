import { MAX_AGENT_PATCH_BYTES, patchAgentDeck } from "../src/core/agent.ts";
import {
  projectPaths,
  readProject,
  renderProject,
  saveProject,
} from "../src/core/project.ts";
import {
  type BentoSlide,
  canonical,
  sha256,
  targetKey,
} from "../src/state/mod.ts";

function assert(value: unknown, message = "assertion failed"): asserts value {
  if (!value) throw new Error(message);
}
async function refuses(action: () => Promise<unknown>, code: string) {
  try {
    await action();
  } catch (error) {
    assert((error as { code?: string }).code === code, String(error));
    return;
  }
  throw new Error(`Expected ${code}`);
}
const canRun =
  (await Deno.permissions.query({ name: "run" })).state === "granted";
const original =
  "---\ntitle: Agent source\n---\n\n## A {#a}\n\n::: {#body}\nOriginal.\n:::\n\n## B {#b}\n\n::: {#other}\nOther.\n:::\n\n";
function created(id = "created"): BentoSlide {
  return {
    id,
    background: "#eef5f0",
    transition: "fade",
    notes: "",
    elements: [
      {
        id: id + "-title",
        type: "text",
        html: "Created β title",
        x: 80,
        y: 52,
        w: 1120,
        h: 90,
        fontSize: 42,
      },
      {
        id: id + "-body",
        type: "text",
        html: "New <strong>body</strong>.",
        x: 80,
        y: 166,
        w: 1120,
        h: 90,
        fontSize: 26,
      },
      {
        id: id + "-arrow",
        type: "shape",
        shape: "arrow",
        fill: "#156f65",
        x: 77,
        y: 299,
        w: 100,
        h: 33,
      },
    ],
  };
}
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
      new TextDecoder().decode(output.success ? output.stdout : output.stderr),
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
    "agent CLI create/patch/move syncs exact source and retains native design on render/reopen",
  ignore: !canRun,
  fn: async () => {
    const directory = await Deno.makeTempDir({
      prefix: "qbento-agent-create-",
    });
    try {
      const source = directory + "/deck.qmd";
      await Deno.writeTextFile(source, original);
      let output = await cli(["render", source]);
      assert(output.success, canonical(output.result));
      output = await cli(["get", source]);
      const snapshot = output.result;
      assert(output.success, canonical(snapshot));
      const html = await Deno.readTextFile(projectPaths(source).output);
      output = await cli([
        "patch",
        source,
        await payload(directory, {
          version: 1,
          docId: snapshot.docId,
          expectedRevision: snapshot.revision,
          operations: [
            {
              op: "slide.create",
              slideId: "created",
              afterId: "a",
              slide: created(),
            },
            {
              op: "element.patch",
              slideId: "created",
              elementId: "created-body",
              fields: { x: 411, w: 540, html: "Reviewed <b>body</b>." },
            },
            { op: "slide.move", slideId: "created", afterId: null },
          ],
        }),
      ]);
      assert(output.success, canonical(output.result));
      assert(output.result.revision === snapshot.revision + 1);
      assert(output.result.docId === snapshot.docId);
      assert(
        output.result.deck.slides.map((s: { id: string }) => s.id).join() ===
          "created,a,b",
      );
      const creation = output.result.pending.find((p: { kind: string }) =>
        p.kind === "create-slide"
      );
      assert(creation && creation.origin === "authored");
      assert(
        output.result.pending.filter((p: { kind: string }) =>
          p.kind === "create-slide"
        ).length === 1,
      );
      assert(
        !output.result.pending.some((p: { origin: string }) =>
          p.origin === "computed"
        ),
      );
      assert(await Deno.readTextFile(source) === original);
      assert(
        await Deno.readTextFile(projectPaths(source).output) === html,
        "patch executed or rewrote output",
      );
      const patched = output.result;
      output = await cli(["status", source]);
      assert(output.success, canonical(output.result));
      assert(output.result.revision === patched.revision);
      assert(canonical(output.result.pending) === canonical(patched.pending));
      output = await cli(["sync", source]);
      assert(output.success, canonical(output.result));
      const plan = output.result;
      const section =
        '## Created β title {#created bento-title-id="created-title" .qbento-design}\n\n::: {#created-text-1 bento-element-id="created-body"}\nReviewed **body**.\n:::\n\n';
      assert(
        plan.result === original.replace("## A {#a}", section + "## A {#a}"),
        "source plan changed unrelated bytes: " + JSON.stringify(plan.result),
      );
      assert(plan.creationChangeIds.length === 1);
      assert(await Deno.readTextFile(source) === original);
      const planPath = directory + "/plan.json";
      await Deno.writeTextFile(planPath, JSON.stringify(plan));
      output = await cli(["sync", source, "--apply", planPath]);
      assert(output.success, canonical(output.result));
      assert(await Deno.readTextFile(source) === plan.result);
      assert(
        (await readProject(source)).pending.length === patched.pending.length,
      );
      output = await cli(["render", source]);
      assert(output.success, canonical(output.result));
      output = await cli(["get", source]);
      assert(output.success, canonical(output.result));
      const reopened = output.result;
      assert(
        reopened.docId === snapshot.docId && reopened.pending.length === 0,
      );
      assert(
        reopened.deck.slides.map((s: { id: string }) => s.id).join() ===
          "created,a,b",
      );
      const slide = reopened.deck.slides[0];
      assert(
        slide.elements.map((e: { id: string }) => e.id).join() ===
          "created-title,created-body,created-arrow",
      );
      assert(
        slide.elements[1].html === "Reviewed <b>body</b>." &&
          slide.elements[1].x === 411 && slide.elements[1].w === 540,
      );
      assert(canonical(slide.elements[2]) === canonical(created().elements[2]));
      assert(slide.background === "#eef5f0");
      assert(
        reopened
          .provenance[
            targetKey({ slideId: "created", elementId: "created-body" })
          ].origin === "authored",
      );
      assert(await Deno.readTextFile(source) === plan.result);
    } finally {
      await Deno.remove(directory, { recursive: true });
    }
  },
});

Deno.test({
  name:
    "agent creation rejects identity/content/size errors and invalid combined batches atomically",
  ignore: !canRun,
  fn: async () => {
    const directory = await Deno.makeTempDir({
      prefix: "qbento-agent-create-invalid-",
    });
    try {
      const source = directory + "/deck.qmd";
      const text = original +
        "\n::: {#created-text-1}\nRetained source identity.\n:::\n";
      await Deno.writeTextFile(source, text);
      const state = (await renderProject(source)).state;
      const statePath = projectPaths(source).stateDir + "/state.json";
      const before = await Deno.readTextFile(statePath);
      const html = await Deno.readTextFile(projectPaths(source).output);
      const operation = {
        op: "slide.create",
        slideId: "fresh",
        afterId: null,
        slide: created("fresh"),
      };
      const request = {
        version: 1,
        docId: state.docId,
        expectedRevision: state.revision,
        operations: [operation],
      };
      const modify = (changes: Record<string, unknown>) => ({
        ...operation,
        slide: { ...created("fresh"), ...changes },
      });
      const cases: [unknown, string][] = [
        [{ ...request, docId: "foreign" }, "UNRELATED_DOCUMENT"],
        [
          { ...request, expectedRevision: state.revision - 1 },
          "STALE_REVISION",
        ],
        [
          { ...request, operations: [{ ...operation, slideId: "mismatch" }] },
          "AGENT_INVALID_TARGET",
        ],
        [{
          ...request,
          operations: [{
            ...operation,
            slideId: "bad/id",
            slide: created("bad/id"),
          }],
        }, "AGENT_INVALID_TARGET"],
        [{
          ...request,
          operations: [{ ...operation, slideId: "a", slide: created("a") }],
        }, "AGENT_ID_COLLISION"],
        [{
          ...request,
          operations: [{
            ...operation,
            slideId: "body",
            slide: created("body"),
          }],
        }, "AGENT_ID_COLLISION"],
        [{
          ...request,
          operations: [{ ...operation, slideId: "created", slide: created() }],
        }, "AGENT_ID_COLLISION"],
        [{
          ...request,
          operations: [
            modify({
              elements: created("fresh").elements.map((e, i) =>
                i === 1 ? { ...e, id: "a-title" } : e
              ),
            }),
          ],
        }, "AGENT_ID_COLLISION"],
        [{
          ...request,
          operations: [
            modify({
              elements: created("fresh").elements.map((e) => ({
                ...e,
                id: "same",
              })),
            }),
          ],
        }, "BENTO_CONTRACT"],
        [
          { ...request, operations: [modify({ elements: [] })] },
          "AGENT_INVALID_REQUEST",
        ],
        [{
          ...request,
          operations: [
            modify({
              elements: [
                ...created("fresh").elements,
                ...Array.from(
                  { length: 48 },
                  (_, i) => ({
                    id: "decor-" + i,
                    type: "shape",
                    shape: "rect",
                  }),
                ),
              ],
            }),
          ],
        }, "AGENT_INVALID_REQUEST"],
        [
          { ...request, operations: [modify({ notes: "`r 1 + 1`" })] },
          "COMPUTED_NOTES_UNSUPPORTED",
        ],
        [
          { ...request, operations: [modify({ title: "Separate title" })] },
          "AGENT_UNSUPPORTED_CREATION",
        ],
        [
          { ...request, operations: [modify({ unknownField: true })] },
          "BENTO_CONTRACT",
        ],
        ...["line", "arrow", "path"].map((type): [unknown, string] => [
          {
            ...request,
            operations: [modify({
              elements: [...created("fresh").elements, {
                id: "alias-decoration",
                type,
              }],
            })],
          },
          "AGENT_UNSUPPORTED_CREATION",
        ]),
        [{
          ...request,
          operations: [modify({
            elements: created("fresh").elements.map((e, i) =>
              i === 1 ? { ...e, html: "A | B" } : e
            ),
          })],
        }, "invalid-slide"],
        [
          { ...request, operations: [modify({ producer: "invented" })] },
          "AGENT_UNSUPPORTED_CREATION",
        ],
        [{
          ...request,
          operations: [
            modify({
              elements: [{
                id: "fake",
                type: "image",
                src: "data:image/png;base64,eA==",
              }],
            }),
          ],
        }, "AGENT_UNSUPPORTED_CREATION"],
        [{
          ...request,
          operations: [modify({
            elements: created("fresh").elements.map((e, i) =>
              i === 1 ? { ...e, html: "$$x^2$$" } : e
            ),
          })],
        }, "AGENT_UNSUPPORTED_CREATION"],
        [{
          ...request,
          operations: [
            modify({
              elements: [{
                id: "title",
                type: "text",
                html: "Text",
                origin: "computed",
              }],
            }),
          ],
        }, "AGENT_UNSUPPORTED_CREATION"],
        [{
          ...request,
          operations: [
            modify({
              elements: [{
                id: "title",
                type: "text",
                html: "Title",
                x: "wrong",
              }],
            }),
          ],
        }, "BENTO_CONTRACT"],
        [{
          ...request,
          operations: [
            modify({
              elements: [{
                id: "title",
                type: "text",
                html: "Title",
                x: Infinity,
              }],
            }),
          ],
        }, "INVALID_JSON"],
        [
          JSON.parse(
            JSON.stringify(request).replace(
              '"background":"#eef5f0"',
              '"__proto__":{}',
            ),
          ),
          "UNSAFE_KEY",
        ],
        [{
          ...request,
          operations: [
            modify({
              elements: [{
                id: "title",
                type: "text",
                html: "x".repeat(MAX_AGENT_PATCH_BYTES),
              }],
            }),
          ],
        }, "AGENT_INPUT_TOO_LARGE"],
        [{
          ...request,
          operations: [operation, {
            op: "slide.move",
            slideId: "fresh",
            afterId: "missing",
          }],
        }, "AGENT_TARGET_NOT_FOUND"],
        [
          { ...request, operations: [operation, operation] },
          "AGENT_ID_COLLISION",
        ],
        [{
          ...request,
          operations: [operation, {
            op: "slide.patch",
            slideId: "fresh",
            fields: { notes: "`r 1 + 1`" },
          }],
        }, "COMPUTED_NOTES_UNSUPPORTED"],
        [{
          ...request,
          operations: [operation, {
            op: "element.patch",
            slideId: "fresh",
            elementId: "fresh-body",
            fields: { html: "<ul><li>Unsupported body</li></ul>" },
          }],
        }, "UNSUPPORTED_HTML"],
      ];
      for (const [input, code] of cases) {
        await refuses(() => patchAgentDeck(source, input), code);
        assert(
          await Deno.readTextFile(statePath) === before,
          "invalid batch changed saved state",
        );
        assert(await Deno.readTextFile(source) === text);
        assert(await Deno.readTextFile(projectPaths(source).output) === html);
      }
      // Pending creation reserves its native IDs and future QMD paragraph IDs.
      const saved = await patchAgentDeck(source, request);
      const savedBytes = await Deno.readTextFile(statePath);
      await refuses(
        () =>
          patchAgentDeck(source, {
            ...request,
            expectedRevision: saved.revision,
            operations: [{
              op: "slide.create",
              slideId: "fresh-text-1",
              afterId: "fresh",
              slide: created("fresh-text-1"),
            }],
          }),
        "AGENT_ID_COLLISION",
      );
      assert(await Deno.readTextFile(statePath) === savedBytes);
      // A removed native slide still retains its generated native identities.
      const changed = structuredClone(saved.deck);
      changed.slides = changed.slides.filter((s) => s.id !== "b");
      const removed = await saveProject(source, changed, saved.revision);
      const retained = await Deno.readTextFile(statePath);
      await refuses(
        () =>
          patchAgentDeck(source, {
            ...request,
            expectedRevision: removed.revision,
            operations: [{
              op: "slide.create",
              slideId: "b-title",
              afterId: null,
              slide: created("b-title"),
            }],
          }),
        "AGENT_ID_COLLISION",
      );
      assert(await Deno.readTextFile(statePath) === retained);
      // A source change before patch must not admit a creation tied to stale order.
      const sectionA = "## A {#a}\n\n::: {#body}\nOriginal.\n:::\n\n";
      for (
        const staleSource of [
          text.replace(sectionA, ""),
          text.replace(sectionA, "") + sectionA,
          text.replace("Original.", "Edited before patch."),
          text.replace("{#a}", '{#a bento-title-id="future-title"}'),
        ]
      ) {
        await Deno.writeTextFile(source, staleSource);
        await refuses(
          () =>
            patchAgentDeck(source, {
              ...request,
              expectedRevision: removed.revision,
              operations: [{
                op: "slide.create",
                slideId: "future",
                afterId: "a",
                slide: created("future"),
              }],
            }),
          "STALE_SOURCE",
        );
        assert(await Deno.readTextFile(statePath) === retained);
        assert(await Deno.readTextFile(source) === staleSource);
        assert(await Deno.readTextFile(projectPaths(source).output) === html);
      }
    } finally {
      await Deno.remove(directory, { recursive: true });
    }
  },
});

Deno.test({
  name: "agent create admits exactly 50 valid elements including decorations",
  ignore: !canRun,
  fn: async () => {
    const directory = await Deno.makeTempDir({
      prefix: "qbento-agent-create-limit-",
    });
    try {
      const source = directory + "/deck.qmd";
      await Deno.writeTextFile(source, original);
      const state = (await renderProject(source)).state;
      const slide = created("bounded");
      slide.elements = [
        ...slide.elements.slice(0, 2),
        ...Array.from(
          { length: 48 },
          (_, i) => ({
            id: "bounded-decor-" + i,
            type: "shape",
            shape: "rect",
            x: i * 10,
            y: 320,
            w: 8,
            h: 8,
            fill: "#156f65",
          }),
        ),
      ];
      const result = await patchAgentDeck(source, {
        version: 1,
        docId: state.docId,
        expectedRevision: state.revision,
        operations: [{
          op: "slide.create",
          slideId: "bounded",
          afterId: null,
          slide,
        }],
      });
      assert(result.deck.slides[0].elements.length === 50);
      assert(
        result.pending.filter((p) => p.kind === "create-slide").length === 1,
      );
      assert(await Deno.readTextFile(source) === original);
    } finally {
      await Deno.remove(directory, { recursive: true });
    }
  },
});

Deno.test({
  name:
    "agent create rechecks source, revision and document identity at locked save",
  ignore: !canRun,
  fn: async () => {
    const directory = await Deno.makeTempDir({
      prefix: "qbento-agent-create-race-",
    });
    const originalMkdir = Deno.mkdir;
    try {
      for (const name of ["a", "b"]) {
        await Deno.mkdir(directory + "/" + name);
        await Deno.writeTextFile(
          directory + "/" + name + "/deck.qmd",
          original,
        );
      }
      const source = directory + "/a/deck.qmd";
      const stateA = (await renderProject(source)).state;
      const stateB = (await renderProject(directory + "/b/deck.qmd")).state;
      const paths = projectPaths(source),
        statePath = paths.stateDir + "/state.json";
      const initialBytes = await Deno.readTextFile(statePath);
      stateB.output = {
        ...stateB.output,
        path: paths.output,
        sha256: await sha256(await Deno.readFile(paths.output)),
      };
      const envelope = async (state: typeof stateA) =>
        JSON.stringify({
          format: "qbento-state-envelope/1",
          sha256: await sha256(canonical(state)),
          state,
        });
      for (const scenario of ["source", "revision", "document"] as const) {
        await Deno.writeTextFile(source, original);
        await Deno.writeTextFile(statePath, initialBytes);
        const replacement = scenario === "document"
          ? await envelope(stateB)
          : scenario === "revision"
          ? await envelope({ ...stateA, revision: stateA.revision + 1 })
          : initialBytes;
        const sourceAfter = scenario === "source"
          ? original + "\n## External {#fresh}\n\nChanged externally.\n"
          : original;
        let intercepted = false;
        Deno.mkdir = async (path, options) => {
          if (
            !intercepted && String(path) === paths.stateDir + "/operation.lock"
          ) {
            intercepted = true;
            await Deno.writeTextFile(statePath, replacement);
            await Deno.writeTextFile(source, sourceAfter);
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
                operations: [{
                  op: "slide.create",
                  slideId: "fresh",
                  afterId: null,
                  slide: created("fresh"),
                }],
              }),
            scenario === "source"
              ? "STALE_SOURCE"
              : scenario === "revision"
              ? "STALE_REVISION"
              : "UNRELATED_DOCUMENT",
          );
        } finally {
          Deno.mkdir = originalMkdir;
        }
        assert(intercepted);
        assert(await Deno.readTextFile(statePath) === replacement);
        assert(await Deno.readTextFile(source) === sourceAfter);
      }
    } finally {
      Deno.mkdir = originalMkdir;
      await Deno.remove(directory, { recursive: true });
    }
  },
});
