import {
  readProjectRegistry,
  saveProjectRegistry,
} from "../src/core/design-registry.ts";
import {
  readProject,
  renderProjectFromAst,
  saveProject,
} from "../src/core/project.ts";
import { hashSource } from "../src/source/mod.ts";
import { startStudio } from "../src/studio/server.ts";
import {
  MAX_DESIGN_REGISTRY_BYTES,
  readDesignRegistry,
} from "../src/render/registry.ts";
function assert(value: unknown, message = "assertion failed"): asserts value {
  if (!value) throw new Error(message);
}
async function rejects(fn: () => Promise<unknown>, code: string) {
  try {
    await fn();
  } catch (error) {
    assert(
      String(error).includes(code) ||
        (error as { code?: string }).code === code,
      String(error),
    );
    return;
  }
  throw new Error("expected " + code);
}
async function fixture() {
  const dir = await Deno.makeTempDir({ prefix: "qbento-registry-editor-" });
  const source = dir + "/deck.qmd",
    text = "## Slide {#slide}\n\n::: {#body}\nText\n:::\n";
  await Deno.writeTextFile(source, text);
  const rendered = await renderProjectFromAst(source, {
    ast: {
      meta: {},
      blocks: [
        { t: "Header", c: [2, ["slide", [], []], [{ t: "Str", c: "Slide" }]] },
        {
          t: "Div",
          c: [["body", [], []], [{ t: "Para", c: [{ t: "Str", c: "Text" }] }]],
        },
      ],
    },
    sourceHash: hashSource(text),
    assetDirectories: [dir],
  });
  return { dir, source, text, rendered };
}
const registry = {
  schemaVersion: 1 as const,
  layouts: { three: { columns: 3, gap: 20, padding: 10 } },
  themes: {
    forest: {
      background: "#e8fff0",
      color: "#123a24",
      accent: "#26734a",
      fontFamily: "Arial, sans-serif",
    },
  },
  activeTheme: "forest",
};
const request = (
  snapshot: Awaited<ReturnType<typeof readProjectRegistry>>,
) => ({
  expectedDocId: snapshot.docId,
  expectedRevision: snapshot.revision,
  expectedHash: snapshot.hash,
  registry,
});
Deno.test("registry editor persists named data with byte CAS and identity/revision checks without touching pending source or output", async () => {
  const f = await fixture();
  try {
    const edited = structuredClone(f.rendered.state.emitted);
    edited.slides[0].elements[1].html = "Pending literal edit";
    edited.slides[0].elements[1].x = 170;
    await saveProject(f.source, edited, f.rendered.state.revision);
    const stateBefore = await Deno.readTextFile(f.dir + "/.qbento/state.json"),
      outputBefore = await Deno.readTextFile(f.rendered.output);
    const empty = await readProjectRegistry(f.source);
    assert(empty.hash === null && empty.registry.schemaVersion === 1);
    const saved = await saveProjectRegistry(f.source, request(empty));
    assert(
      saved.hash && saved.registry.activeTheme === "forest" &&
        saved.revision === empty.revision,
    );
    assert(await Deno.readTextFile(f.source) === f.text);
    assert(
      await Deno.readTextFile(f.dir + "/.qbento/state.json") === stateBefore,
    );
    assert(await Deno.readTextFile(f.rendered.output) === outputBefore);
    assert((await readProject(f.source)).pending.length === 1);
    await rejects(
      () => saveProjectRegistry(f.source, request(empty)),
      "DESIGN_REGISTRY_CHANGED",
    );
    await rejects(
      () =>
        saveProjectRegistry(f.source, {
          ...request(saved),
          expectedDocId: "different",
        }),
      "DOC_ID_CHANGED",
    );
    await rejects(
      () =>
        saveProjectRegistry(f.source, {
          ...request(saved),
          expectedRevision: saved.revision - 1,
        }),
      "STALE_REVISION",
    );
    const current = await Deno.readTextFile(f.dir + "/.qbento/design.json");
    await Deno.writeTextFile(f.dir + "/.qbento/design.json", current + " \n");
    await rejects(
      () => saveProjectRegistry(f.source, request(saved)),
      "DESIGN_REGISTRY_CHANGED",
    );
    const refreshed = await readProjectRegistry(f.source);
    const renamed = {
      ...registry,
      layouts: { triad: registry.layouts.three },
      themes: { green: registry.themes.forest },
      activeTheme: "green",
    };
    const renamedReceipt = await saveProjectRegistry(f.source, {
      ...request(refreshed),
      registry: renamed,
    });
    assert(
      renamedReceipt.registry.layouts?.triad &&
        !renamedReceipt.registry.layouts?.three &&
        renamedReceipt.registry.activeTheme === "green",
    );
    const cleared = await saveProjectRegistry(f.source, {
      ...request(renamedReceipt),
      registry: { schemaVersion: 1 },
    });
    assert(Object.keys(cleared.registry).join(",") === "schemaVersion");
    assert(
      await Deno.readTextFile(f.dir + "/.qbento/state.json") === stateBefore,
    );
    assert(await Deno.readTextFile(f.rendered.output) === outputBefore);
    const histories = [];
    for await (const entry of Deno.readDir(f.dir + "/.qbento/history")) {
      if (entry.name.startsWith("design-")) histories.push(entry.name);
    }
    assert(histories.length === 3);
    for (const name of histories) {
      assert(
        (await Deno.stat(`${f.dir}/.qbento/history/${name}/after.json`)).isFile,
      );
      assert(
        (await Deno.stat(`${f.dir}/.qbento/history/${name}/receipt.json`))
          .isFile,
      );
      assert(
        (await Deno.stat(`${f.dir}/.qbento/history/${name}/committed.json`))
          .isFile,
      );
    }
    assert((await Deno.lstat(f.dir + "/.qbento/design.json")).nlink === 1);
  } finally {
    await Deno.remove(f.dir, { recursive: true });
  }
});
Deno.test("registry editor refuses invalid schema unsafe paths missing-file races and write failures without replacing project bytes", async () => {
  const f = await fixture();
  try {
    const empty = await readProjectRegistry(f.source);
    const before = await Deno.readTextFile(f.dir + "/.qbento/state.json");
    const target = f.dir + "/.qbento/design.json";
    await rejects(
      () =>
        saveProjectRegistry(f.source, {
          ...request(empty),
          registry: { ...registry, schemaVersion: 2 } as never,
        }),
      "INVALID_DESIGN_REGISTRY",
    );
    await Deno.writeTextFile(
      target,
      '{"schemaVersion":2,"futureField":"retain me"}',
    );
    await rejects(
      () => readProjectRegistry(f.source),
      "INVALID_DESIGN_REGISTRY",
    );
    await rejects(
      () => saveProjectRegistry(f.source, request(empty)),
      "INVALID_DESIGN_REGISTRY",
    );
    assert(
      await Deno.readTextFile(target) ===
        '{"schemaVersion":2,"futureField":"retain me"}',
    );
    await Deno.remove(target);
    await Deno.writeTextFile(f.dir + "/outside.json", '{"schemaVersion":1}');
    await Deno.symlink(f.dir + "/outside.json", target);
    await rejects(
      () => saveProjectRegistry(f.source, request(empty)),
      "UNSAFE_DESIGN_REGISTRY",
    );
    await Deno.remove(target);
    await Deno.writeTextFile(target, '{"schemaVersion":1}');
    await rejects(
      () => saveProjectRegistry(f.source, request(empty)),
      "DESIGN_REGISTRY_CHANGED",
    );
    await Deno.remove(target);
    await Deno.mkdir(f.dir + "/.qbento/history", { recursive: true });
    if (Deno.build.os !== "windows") {
      await Deno.chmod(f.dir + "/.qbento/history", 0o500);
      try {
        await rejects(
          () => saveProjectRegistry(f.source, request(empty)),
          "PermissionDenied",
        );
      } finally {
        await Deno.chmod(f.dir + "/.qbento/history", 0o700);
      }
    }
    assert((await readDesignRegistry(f.dir)).hash === null);
    assert(await Deno.readTextFile(f.source) === f.text);
    assert(await Deno.readTextFile(f.dir + "/.qbento/state.json") === before);
  } finally {
    await Deno.remove(f.dir, { recursive: true });
  }
});
const canServe =
  (await Deno.permissions.query({ name: "net", host: "127.0.0.1" })).state ===
    "granted";
Deno.test({
  name:
    "Studio registry routes require token host origin JSON and bounded streaming body; stale editor receives conflict",
  ignore: !canServe,
  fn: async () => {
    const f = await fixture();
    let studio;
    try {
      studio = await startStudio(f.source);
      const page = await (await fetch(studio.url)).text(),
        token = JSON.parse(page.match(/qbentoToken\s*=\s*("[^"]+")/)![1]);
      assert(
        page.includes('id="designs"') && page.includes('id="registry-active"'),
      );
      const get = () =>
        fetch(studio!.url + "/api/design-registry", {
          headers: { "x-qbento-token": token },
        });
      const snapshot = await (await get()).json();
      const post = (payload: unknown, headers = {}) =>
        fetch(studio!.url + "/api/design-registry", {
          method: "POST",
          headers: {
            "x-qbento-token": token,
            "Content-Type": "application/json",
            ...headers,
          },
          body: JSON.stringify(payload),
        });
      const saved = await post(request(snapshot));
      assert(saved.status === 200);
      await saved.json();
      const stale = await post(request(snapshot));
      assert(
        stale.status === 409 &&
          (await stale.json()).error === "DESIGN_REGISTRY_CHANGED",
      );
      for (
        const headers of [{ "x-qbento-token": "" }, {
          Origin: "https://hostile.invalid",
        }]
      ) {
        const response = await post(request(snapshot), headers);
        assert(response.status === 403);
        await response.body?.cancel();
      }
      const socket = await Deno.connect({
        hostname: "127.0.0.1",
        port: Number(new URL(studio.url).port),
      });
      try {
        await socket.write(
          new TextEncoder().encode(
            "GET /api/design-registry HTTP/1.1\r\nHost: hostile.invalid\r\nConnection: close\r\n\r\n",
          ),
        );
        const received = new Uint8Array(4096);
        const count = await socket.read(received);
        assert(
          new TextDecoder().decode(received.subarray(0, count ?? 0)).includes(
            "403",
          ),
        );
      } finally {
        socket.close();
      }
      const wrongType = await post({}, { "Content-Type": "text/plain" });
      assert(wrongType.status === 415);
      await wrongType.body?.cancel();
      const large = await fetch(studio.url + "/api/design-registry", {
        method: "POST",
        headers: {
          "x-qbento-token": token,
          "Content-Type": "application/json",
        },
        body: new ReadableStream({
          start(controller) {
            controller.enqueue(
              new Uint8Array(MAX_DESIGN_REGISTRY_BYTES + 4097),
            );
            controller.close();
          },
        }),
      });
      assert(
        large.status === 413 &&
          (await large.json()).error === "Registry too large",
      );
      const js = await (await fetch(studio.url + "/registry.js")).text();
      assert(js.includes("attachRegistryEditor"));
    } finally {
      await studio?.shutdown();
      await Deno.remove(f.dir, { recursive: true });
    }
  },
});

Deno.test("registry hardlink preflight retains original; incomplete publication fails closed for reads and renders", async () => {
  for (
    const mode of [
      "unsupported",
      "publication-and-restore",
      "concurrent-replacement",
      "rollback-replacement",
    ]
  ) {
    const f = await fixture();
    const link = Deno.link;
    try {
      const first = await saveProjectRegistry(
        f.source,
        request(await readProjectRegistry(f.source)),
      );
      const original = await Deno.readTextFile(f.dir + "/.qbento/design.json");
      const state = await Deno.readTextFile(f.dir + "/.qbento/state.json"),
        html = await Deno.readTextFile(f.rendered.output);
      const external = JSON.stringify({
        schemaVersion: 1,
        layouts: { external: { columns: 2, gap: 14, padding: 0 } },
      });
      Deno.link = async (oldPath, newPath) => {
        if (mode === "unsupported") {
          throw new Deno.errors.NotSupported(
            "Injected filesystem capability refusal",
          );
        }
        if (String(newPath).includes(".design-link-probe-")) {
          return await link(oldPath, newPath);
        }
        if (
          mode === "rollback-replacement" &&
          String(oldPath).includes("-rollback.json")
        ) {
          await link(oldPath, newPath);
          const replacement = f.dir + "/.qbento/external-replacement.json";
          await Deno.writeTextFile(replacement, external);
          await Deno.rename(replacement, String(newPath));
          return;
        }
        if (mode === "concurrent-replacement") {
          await Deno.writeTextFile(f.dir + "/.qbento/design.json", external, {
            createNew: true,
          });
          throw new Deno.errors.AlreadyExists(
            "Injected external editor replacement",
          );
        }
        throw new Deno.errors.NotSupported(
          "Injected failure after successful capability probe",
        );
      };
      await rejects(
        () =>
          saveProjectRegistry(f.source, {
            ...request(first),
            registry: { schemaVersion: 1 },
          }),
        mode === "unsupported"
          ? "NotSupported"
          : "DESIGN_REGISTRY_RECOVERY_REQUIRED",
      );
      Deno.link = link;
      if (mode === "unsupported") {
        assert((await readProjectRegistry(f.source)).hash === first.hash);
        assert(
          await Deno.readTextFile(f.dir + "/.qbento/design.json") === original,
        );
      } else {
        await rejects(
          () => readProjectRegistry(f.source),
          "DESIGN_REGISTRY_RECOVERY_REQUIRED",
        );
        await rejects(
          () => readDesignRegistry(f.dir),
          "DESIGN_REGISTRY_RECOVERY_REQUIRED",
        );
        const { renderProject } = await import("../src/core/project.ts");
        await rejects(
          () => renderProject(f.source),
          "DESIGN_REGISTRY_RECOVERY_REQUIRED",
        );
        const marker = JSON.parse(
          await Deno.readTextFile(f.dir + "/.qbento/design-save.json"),
        );
        assert(
          await Deno.readTextFile(marker.transaction + "/before.json") ===
            original,
        );
        assert(
          await Deno.readTextFile(marker.transaction + "/after.json") ===
            '{\n  "schemaVersion": 1\n}\n',
        );
        if (
          mode === "concurrent-replacement" || mode === "rollback-replacement"
        ) {
          assert(
            await Deno.readTextFile(f.dir + "/.qbento/design.json") ===
              external,
          );
        }
      }
      assert(await Deno.readTextFile(f.source) === f.text);
      assert(await Deno.readTextFile(f.dir + "/.qbento/state.json") === state);
      assert(await Deno.readTextFile(f.rendered.output) === html);
    } finally {
      Deno.link = link;
      await Deno.remove(f.dir, { recursive: true });
    }
  }
});
