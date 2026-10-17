import { getAgentDeck } from "../src/core/agent.ts";
import { readGraphRelations } from "../src/core/graph-relations.ts";
import {
  assertProjectBinding,
  captureProject,
  readProject,
  readProjectDiagnostics,
  renderProject,
  saveProject,
  withProject,
} from "../src/core/project.ts";
import { canonical, createState, StateStore } from "../src/state/mod.ts";

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
async function files(directory: string): Promise<unknown> {
  const entries = [];
  for await (const entry of Deno.readDir(directory)) {
    const path = directory + "/" + entry.name;
    const info = await Deno.lstat(path);
    entries.push([
      entry.name,
      info.isSymlink
        ? ["link", await Deno.readLink(path)]
        : info.isDirectory
        ? await files(path)
        : [
          "file",
          Array.from(await Deno.readFile(path)),
          info.mtime?.getTime(),
        ],
    ]);
  }
  return entries.sort((a, b) => String(a[0]).localeCompare(String(b[0])));
}
async function fixture() {
  const directory = await Deno.makeTempDir({ prefix: "qbento-binding-" });
  const source = directory + "/deck.qmd", stateDir = directory + "/.qbento";
  await Deno.writeTextFile(source, "## Slide {#slide}\n");
  await Deno.writeTextFile(directory + "/other.qmd", "## Other {#other}\n");
  const state = await new StateStore(stateDir).save(createState({
    format: "bento/slides",
    version: 1,
    docId: "bound-deck",
    title: "Bound deck",
    size: { width: 1280, height: 720 },
    theme: {
      background: "#ffffff",
      color: "#000000",
      accent: "#123456",
      fontFamily: "Arial",
    },
    slides: [{
      id: "slide",
      elements: [],
      notes: "",
      background: "#ffffff",
      transition: "fade",
    }],
  }));
  await Deno.writeTextFile(
    stateDir + "/project.json",
    JSON.stringify({ version: 1, source: "deck.qmd" }),
  );
  return { directory, source, stateDir, state };
}
const readers = [
  assertProjectBinding,
  readProject,
  getAgentDeck,
  readGraphRelations,
  readProjectDiagnostics,
];

Deno.test("saved project readers verify QMD identity without touching source, state or locks", async () => {
  const f = await fixture();
  try {
    const before = canonical(await files(f.directory));
    assert(canonical(await readProject(f.source)) === canonical(f.state));
    assert((await getAgentDeck(f.source)).docId === f.state.docId);
    assert((await readGraphRelations(f.source)).docId === f.state.docId);
    assert((await readProjectDiagnostics(f.source)).length === 0);
    for (const reader of readers) {
      for (const sibling of ["other.qmd", "missing.qmd"]) {
        await refuses(
          () => reader(f.directory + "/" + sibling),
          "PROJECT_SOURCE_MISMATCH",
        );
      }
    }
    assert(
      canonical(await files(f.directory)) === before,
      "read changed files",
    );
  } finally {
    await Deno.remove(f.directory, { recursive: true });
  }
});

Deno.test("missing baseline never creates state and pre-render design diagnostics remain available", async () => {
  const directory = await Deno.makeTempDir({ prefix: "qbento-unbound-" });
  try {
    const source = directory + "/deck.qmd";
    await Deno.writeTextFile(source, "## Slide {#slide .qbento-design}\n");
    const before = canonical(await files(directory));
    for (const reader of readers.slice(0, -1)) {
      await refuses(() => reader(source), "NO_BASELINE");
    }
    assert(
      (await readProjectDiagnostics(source)).some((d) =>
        d.code === "MISSING_DESIGN"
      ),
      "fresh source lost its missing-design diagnostic",
    );
    assert(canonical(await files(directory)) === before);
    await Deno.mkdir(directory + "/.qbento");
    await Deno.writeTextFile(
      directory + "/.qbento/project.json",
      JSON.stringify({ version: 1, source: "deck.qmd" }),
    );
    for (const reader of [readProject, getAgentDeck, readGraphRelations]) {
      await refuses(() => reader(source), "NO_BASELINE");
    }
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("readers refuse saved state with absent or malformed source identity", async () => {
  const f = await fixture();
  try {
    const binding = f.stateDir + "/project.json";
    await Deno.remove(binding);
    for (const reader of readers) {
      await refuses(() => reader(f.source), "PROJECT_BINDING_MISSING");
    }
    for (
      const metadata of [
        "{broken",
        "null",
        "[]",
        JSON.stringify({ version: 2, source: "deck.qmd" }),
        JSON.stringify({ version: 1, source: "../deck.qmd" }),
      ]
    ) {
      await Deno.writeTextFile(binding, metadata);
      const before = canonical(await files(f.directory));
      for (const reader of readers) {
        await refuses(() => reader(f.source), "PROJECT_SOURCE_MISMATCH");
      }
      assert(canonical(await files(f.directory)) === before);
    }
  } finally {
    await Deno.remove(f.directory, { recursive: true });
  }
});

Deno.test("readers refuse symlinked state directories and source identity files", async () => {
  const f = await fixture();
  try {
    const identity = f.stateDir + "/project.json";
    await Deno.rename(identity, f.directory + "/identity.json");
    await Deno.symlink(f.directory + "/identity.json", identity);
    for (const reader of readers) {
      await refuses(() => reader(f.source), "UNSAFE_STATE_PATH");
    }
    await Deno.remove(identity);
    await Deno.rename(f.directory + "/identity.json", identity);
    await Deno.rename(f.stateDir, f.directory + "/saved-state");
    await Deno.symlink(f.directory + "/saved-state", f.stateDir);
    for (const reader of readers) {
      await refuses(() => reader(f.source), "UNSAFE_STATE_PATH");
    }
  } finally {
    await Deno.remove(f.directory, { recursive: true });
  }
});

const canRun =
  (await Deno.permissions.query({ name: "run" })).state === "granted";
Deno.test({
  name:
    "CLI status, diff, get and edit reject other QMDs with read-only permissions",
  ignore: !canRun,
  fn: async () => {
    const f = await fixture();
    try {
      const before = canonical(await files(f.directory));
      const invoke = (command: string, source: string) =>
        new Deno.Command(Deno.execPath(), {
          args: [
            "run",
            "--no-config",
            "--allow-read",
            "--allow-env",
            new URL("../src/cli.ts", import.meta.url).pathname,
            command,
            source,
          ],
          stdout: "piped",
          stderr: "piped",
        }).output();
      for (const command of ["status", "diff", "get", "edit"]) {
        const result = await invoke(command, f.directory + "/other.qmd");
        const error = JSON.parse(new TextDecoder().decode(result.stderr));
        assert(!result.success && error.error === "PROJECT_SOURCE_MISMATCH");
      }
      for (const command of ["status", "diff", "get"]) {
        const result = await invoke(command, f.source);
        const state = JSON.parse(new TextDecoder().decode(result.stdout));
        assert(result.success && state.docId === f.state.docId);
      }
      assert(canonical(await files(f.directory)) === before);
    } finally {
      await Deno.remove(f.directory, { recursive: true });
    }
  },
});

Deno.test("lost source binding cannot be recreated by any ordinary project mutation", async () => {
  const f = await fixture();
  try {
    await Deno.remove(f.stateDir + "/project.json");
    const before = canonical(await files(f.directory));
    for (const source of [f.source, f.directory + "/other.qmd"]) {
      let called = false;
      for (
        const operation of [
          () =>
            withProject(source, () => {
              called = true;
              return Promise.resolve();
            }),
          () => renderProject(source),
          () => captureProject(source),
          () => saveProject(source, f.state.emitted, f.state.revision),
        ]
      ) {
        await refuses(operation, "PROJECT_BINDING_MISSING");
      }
      assert(!called, "unbound mutation reached the project action");
    }
    assert(canonical(await files(f.directory)) === before);
  } finally {
    await Deno.remove(f.directory, { recursive: true });
  }
});

Deno.test("empty projects bootstrap but recovery artifacts require their original binding", async () => {
  const directory = await Deno.makeTempDir({
    prefix: "qbento-binding-bootstrap-",
  });
  const source = directory + "/deck.qmd", stateDir = directory + "/.qbento";
  try {
    await Deno.writeTextFile(source, "## New deck\n");
    await Deno.mkdir(stateDir);
    await withProject(source, async (paths, store) => {
      assert(paths.source === source && await store.load() === undefined);
    });
    assert(
      JSON.parse(await Deno.readTextFile(stateDir + "/project.json")).source ===
        "deck.qmd",
    );
    await Deno.remove(stateDir + "/project.json");
    for (
      const artifact of [
        "state.previous.json",
        "render-transaction.json",
        "sync-transaction.json",
        "sync-approved.json",
      ]
    ) {
      const path = stateDir + "/" + artifact;
      await Deno.writeTextFile(path, "preserve for explicit recovery");
      await refuses(
        () => assertProjectBinding(source),
        "PROJECT_BINDING_MISSING",
      );
      await refuses(
        () => withProject(source, async () => {}),
        "PROJECT_BINDING_MISSING",
      );
      await Deno.remove(path);
    }
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test({
  name:
    "CLI edit and render never bootstrap saved state with lost identity or execute its producer",
  ignore: !canRun || Deno.build.os === "windows",
  fn: async () => {
    const f = await fixture();
    try {
      await Deno.remove(f.stateDir + "/project.json");
      const tools = f.directory + "/producer",
        marker = f.directory + "/producer-invoked";
      await Deno.mkdir(tools);
      // A controlled producer records any unexpected entry to execution. No
      // successful render or Quarto compatibility is inferred from this fixture.
      await Deno.writeTextFile(
        tools + "/quarto",
        '#!/bin/sh\nprintf invoked > "$QBENTO_TEST_PRODUCER_MARKER"\nexit 99\n',
      );
      await Deno.chmod(tools + "/quarto", 0o700);
      const before = canonical(await files(f.directory));
      for (
        const [command, writable] of [
          ["status", false],
          ["diff", false],
          ["get", false],
          ["edit", false],
          ["edit", true],
          ["render", true],
        ] as const
      ) {
        for (const source of [f.source, f.directory + "/other.qmd"]) {
          const result = await new Deno.Command(Deno.execPath(), {
            args: [
              "run",
              "--no-config",
              "--allow-read",
              ...(writable ? ["--allow-write"] : []),
              "--allow-run",
              "--allow-env",
              new URL("../src/cli.ts", import.meta.url).pathname,
              command,
              source,
            ],
            env: {
              PATH: tools + ":" + Deno.env.get("PATH"),
              QBENTO_TEST_PRODUCER_MARKER: marker,
            },
            stdout: "piped",
            stderr: "piped",
          }).output();
          const error = JSON.parse(new TextDecoder().decode(result.stderr));
          assert(
            !result.success && error.error === "PROJECT_BINDING_MISSING",
            JSON.stringify(error),
          );
        }
      }
      assert(
        canonical(await files(f.directory)) === before,
        "CLI changed state or invoked the source producer",
      );
    } finally {
      await Deno.remove(f.directory, { recursive: true });
    }
  },
});
