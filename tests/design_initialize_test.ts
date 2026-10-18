import { initializeDesignPackage } from "../src/core/design-initialize.ts";
import { readProject, renderProjectFromAst } from "../src/core/project.ts";
import { reusableTheme } from "./fixtures/reusable-design.ts";
import { readDesignRegistry } from "../src/render/registry.ts";
import { hashSource } from "../src/source/mod.ts";
import { equal } from "../src/state/mod.ts";

function assert(value: unknown, message = "assertion failed"): asserts value {
  if (!value) throw new Error(message);
}
async function rejects(action: () => Promise<unknown>, code: string) {
  try {
    await action();
  } catch (error) {
    assert(
      String(error).includes(code) ||
        (error as { code?: string }).code === code,
      String(error),
    );
    return;
  }
  throw new Error("Expected " + code);
}
async function names(path: string) {
  const entries = [];
  for await (const entry of Deno.readDir(path)) entries.push(entry.name);
  return entries.sort();
}
const design = () => ({
  format: "qbento/design",
  version: 1,
  name: "Course",
  registry: {
    schemaVersion: 1,
    themes: { course: structuredClone(reusableTheme) },
    activeTheme: "course",
  },
});
async function fixture() {
  const directory = await Deno.makeTempDir({ prefix: "qbento-design-init-" });
  const source = directory + "/deck.qmd";
  const text =
    '## Section {#slide bento-variant="section"}\n\n::: {#body bento-style="caption"}\nFresh course content.\n:::\n';
  await Deno.writeTextFile(source, text);
  return { directory, source, text };
}

Deno.test("new presentation initializes its design before the first render with named style and variant selectors", async () => {
  const f = await fixture();
  try {
    const result = await initializeDesignPackage(f.source, design());
    assert(result.initialized && result.renderNeeded);
    assert(result.sourceHash === hashSource(f.text));
    assert(equal(result.registry, design().registry));
    assert(/^[a-f0-9]{64}$/.test(result.hash));
    assert(
      equal(await names(f.directory + "/.qbento"), [
        "design.json",
        "project.json",
      ]),
    );
    assert(await Deno.readTextFile(f.source) === f.text);
    const sibling = f.directory + "/other.qmd";
    await Deno.writeTextFile(sibling, f.text);
    await rejects(() => readProject(sibling), "PROJECT_SOURCE_MISMATCH");
    const rendered = await renderProjectFromAst(f.source, {
      sourceHash: hashSource(f.text),
      assetDirectories: [f.directory],
      ast: {
        meta: {},
        blocks: [
          {
            t: "Header",
            c: [2, ["slide", [], [["bento-variant", "section"]]], [{
              t: "Str",
              c: "Section",
            }]],
          },
          {
            t: "Div",
            c: [["body", [], [["bento-style", "caption"]]], [{
              t: "Para",
              c: [{ t: "Str", c: "Fresh course content." }],
            }]],
          },
        ],
      },
    });
    assert(
      rendered.state.emitted.slides[0].background ===
        reusableTheme.variants!.section.background,
    );
    assert(
      rendered.state.emitted.slides[0].elements.some((element) =>
        element.fontSize === 18
      ),
    );
    assert(
      JSON.parse(await Deno.readTextFile(f.directory + "/.qbento/project.json"))
        .source === "deck.qmd",
    );
    await rejects(
      () => initializeDesignPackage(f.source, design()),
      "DESIGN_INITIALIZATION_OUTPUT_EXISTS",
    );
  } finally {
    await Deno.remove(f.directory, { recursive: true });
  }
});

Deno.test("initialization validates original selectors and refuses unsafe or missing source without creating directories", async () => {
  const f = await fixture();
  try {
    await Deno.writeTextFile(
      f.source,
      f.text.replace('bento-style="caption"', 'bento-style="missing"'),
    );
    await rejects(
      () => initializeDesignPackage(f.source, design()),
      "UNKNOWN_STYLE",
    );
    assert(equal(await names(f.directory), ["deck.qmd"]));
    await Deno.writeTextFile(
      f.source,
      f.text.replace('bento-variant="section"', 'bento-variant="missing"'),
    );
    await rejects(
      () => initializeDesignPackage(f.source, design()),
      "UNKNOWN_VARIANT",
    );
    await Deno.remove(f.source);
    await Deno.writeTextFile(f.directory + "/real.qmd", f.text);
    await Deno.symlink(f.directory + "/real.qmd", f.source);
    await rejects(
      () => initializeDesignPackage(f.source, design()),
      "UNSAFE_INITIALIZATION_SOURCE",
    );
    await Deno.remove(f.source);
    await Deno.mkdir(f.source);
    await rejects(
      () => initializeDesignPackage(f.source, design()),
      "UNSAFE_INITIALIZATION_SOURCE",
    );
    await Deno.remove(f.source);
    await rejects(
      () => initializeDesignPackage(f.source, design()),
      "NotFound",
    );
    assert(equal(await names(f.directory), ["real.qmd"]));
  } finally {
    await Deno.remove(f.directory, { recursive: true });
  }
});

Deno.test("initialization never adopts existing state recovery directories symlinks or generated sibling outputs", async () => {
  const f = await fixture();
  try {
    const stateDir = f.directory + "/.qbento";
    await Deno.mkdir(stateDir);
    await Deno.writeTextFile(
      stateDir + "/state.previous.json",
      "Retain recovery",
    );
    await rejects(
      () => initializeDesignPackage(f.source, design()),
      "DESIGN_INITIALIZATION_EXISTS",
    );
    assert(
      await Deno.readTextFile(stateDir + "/state.previous.json") ===
        "Retain recovery",
    );
    assert(equal(await names(stateDir), ["state.previous.json"]));
    await Deno.remove(stateDir, { recursive: true });
    await Deno.mkdir(f.directory + "/foreign");
    await Deno.symlink(f.directory + "/foreign", stateDir);
    await rejects(
      () => initializeDesignPackage(f.source, design()),
      "DESIGN_INITIALIZATION_EXISTS",
    );
    assert(equal(await names(f.directory + "/foreign"), []));
    await Deno.remove(stateDir);
    for (
      const filename of [
        "deck.bento.html",
        "sibling.bento.html",
        "deck.bento.html.pending-recovery",
      ]
    ) {
      await Deno.writeTextFile(
        f.directory + "/" + filename,
        "Recoverable output",
      );
      await rejects(
        () => initializeDesignPackage(f.source, design()),
        "DESIGN_INITIALIZATION_OUTPUT_EXISTS",
      );
      assert(
        await Deno.readTextFile(f.directory + "/" + filename) ===
          "Recoverable output",
      );
      await Deno.remove(f.directory + "/" + filename);
    }
    await Deno.writeTextFile(stateDir, "Foreign file");
    await rejects(
      () => initializeDesignPackage(f.source, design()),
      "DESIGN_INITIALIZATION_EXISTS",
    );
    assert(await Deno.readTextFile(stateDir) === "Foreign file");
  } finally {
    await Deno.remove(f.directory, { recursive: true });
  }
});

Deno.test("concurrent initialization has one exclusive winner and no overwrite", async () => {
  const f = await fixture();
  try {
    const first = design(), second = design();
    second.registry.themes.course.background = "#002244";
    const attempts = await Promise.allSettled([
      initializeDesignPackage(f.source, first),
      initializeDesignPackage(f.source, second),
    ]);
    assert(
      attempts.filter((attempt) => attempt.status === "fulfilled").length === 1,
    );
    const winner = attempts.find((attempt) => attempt.status === "fulfilled")!;
    assert(winner.status === "fulfilled");
    assert(
      equal(
        JSON.parse(
          await Deno.readTextFile(f.directory + "/.qbento/design.json"),
        ),
        winner.value.registry,
      ),
    );
    const loser = attempts.find((attempt) => attempt.status === "rejected")!;
    assert(
      loser.status === "rejected" &&
        (loser.reason as { code: string }).code ===
          "DESIGN_INITIALIZATION_EXISTS",
    );
    assert(
      equal(await names(f.directory + "/.qbento"), [
        "design.json",
        "project.json",
      ]),
    );
  } finally {
    await Deno.remove(f.directory, { recursive: true });
  }
});

Deno.test("initialization source changes and concurrent output preserve staging and refuse publication", async () => {
  for (const mode of ["source", "output"] as const) {
    const f = await fixture();
    const originalOpen = Deno.open;
    let changed = false;
    try {
      Deno.open = async (path, options) => {
        const file = await originalOpen(path, options);
        if (
          !changed && options?.write &&
          String(path).includes(".design-initialize-")
        ) {
          changed = true;
          if (mode === "source") {
            await Deno.writeTextFile(
              f.source,
              f.text + "\nConcurrent source edit\n",
            );
          } else {await Deno.writeTextFile(
              f.directory + "/deck.bento.html",
              "Concurrent native output",
            );}
        }
        return file;
      };
      await rejects(
        () => initializeDesignPackage(f.source, design()),
        mode === "source"
          ? "STALE_SOURCE"
          : "DESIGN_INITIALIZATION_OUTPUT_EXISTS",
      );
      assert(changed);
      const artifacts = await names(f.directory + "/.qbento");
      assert(
        artifacts.length === 3 && artifacts.includes("design-save.json") &&
          artifacts.includes("project.json"),
      );
      await rejects(
        () => readDesignRegistry(f.directory),
        "DESIGN_REGISTRY_RECOVERY_REQUIRED",
      );
      assert(
        equal(
          JSON.parse(
            await Deno.readTextFile(
              f.directory + "/.qbento/" +
                artifacts.find((name) =>
                  name.startsWith(".design-initialize-")
                ),
            ),
          ),
          design().registry,
        ),
      );
      if (mode === "source") {
        assert(
          await Deno.readTextFile(f.source) ===
            f.text + "\nConcurrent source edit\n",
        );
      } else {assert(
          await Deno.readTextFile(f.directory + "/deck.bento.html") ===
            "Concurrent native output",
        );}
    } finally {
      Deno.open = originalOpen;
      await Deno.remove(f.directory, { recursive: true });
    }
  }
});

Deno.test("directory replacement preserves concurrent artifacts without writing through a replaced directory", async () => {
  const f = await fixture();
  const originalOpen = Deno.open;
  try {
    await Deno.mkdir(f.directory + "/foreign");
    let replaced = false;
    Deno.open = async (path, options) => {
      const file = await originalOpen(path, options);
      if (
        !replaced && options?.write &&
        String(path).includes(".design-initialize-")
      ) {
        replaced = true;
        await Deno.rename(f.directory + "/.qbento", f.directory + "/retained");
        await Deno.symlink(f.directory + "/foreign", f.directory + "/.qbento");
      }
      return file;
    };
    await rejects(
      () => initializeDesignPackage(f.source, design()),
      "UNSAFE_INITIALIZATION_DIRECTORY",
    );
    assert(equal(await names(f.directory + "/foreign"), []));
    assert(
      (await names(f.directory + "/retained")).some((name) =>
        name.startsWith(".design-initialize-")
      ),
    );
  } finally {
    Deno.open = originalOpen;
    await Deno.remove(f.directory, { recursive: true });
  }
});

Deno.test("initialization never overwrites a registry created concurrently before publication", async () => {
  const f = await fixture();
  const originalLink = Deno.link;
  const target = f.directory + "/.qbento/design.json";
  try {
    let injected = false;
    Deno.link = async (oldPath, newPath) => {
      if (!injected && String(newPath) === target) {
        injected = true;
        await Deno.writeTextFile(target, "Concurrent registry bytes", {
          createNew: true,
        });
      }
      return originalLink(oldPath, newPath);
    };
    await rejects(
      () => initializeDesignPackage(f.source, design()),
      "AlreadyExists",
    );
    assert(injected);
    assert(await Deno.readTextFile(target) === "Concurrent registry bytes");
    assert(await Deno.readTextFile(f.source) === f.text);
    assert(
      (await names(f.directory + "/.qbento")).includes("design-save.json"),
    );
    await rejects(
      () => readDesignRegistry(f.directory),
      "DESIGN_REGISTRY_RECOVERY_REQUIRED",
    );
  } finally {
    Deno.link = originalLink;
    await Deno.remove(f.directory, { recursive: true });
  }
});
