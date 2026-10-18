import {
  applyDesignImport,
  exportDesignPackage,
  previewDesignImport,
  readDesignImportPlanFile,
  readDesignJsonFile,
  readDesignPackageFile,
  validateDesignPackage,
} from "../src/core/design-package.ts";
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
import { equal } from "../src/state/mod.ts";
import { MAX_DESIGN_REGISTRY_BYTES } from "../src/render/registry.ts";
import { largeDesignPackage } from "./fixtures/reusable-design.ts";

function assert(value: unknown, message = "assertion failed"): asserts value {
  if (!value) throw new Error(message);
}
async function rejects(action: () => unknown | Promise<unknown>, code: string) {
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
async function fixture(secret = "Private content") {
  const directory = await Deno.makeTempDir({
    prefix: "qbento-design-package-",
  });
  const source = directory + "/deck.qmd";
  const text = `## Slide {#slide}\n\n::: {#body}\n${secret}\n:::\n`;
  await Deno.writeTextFile(source, text);
  const ast = {
    meta: {},
    blocks: [
      { t: "Header", c: [2, ["slide", [], []], [{ t: "Str", c: "Slide" }]] },
      {
        t: "Div",
        c: [["body", [], []], [{ t: "Para", c: [{ t: "Str", c: secret }] }]],
      },
    ],
  };
  const rendered = await renderProjectFromAst(source, {
    ast,
    sourceHash: hashSource(text),
    assetDirectories: [directory],
  });
  return { directory, source, text, rendered };
}
const sample = () =>
  validateDesignPackage({
    format: "qbento/design",
    version: 1,
    name: "SPP · Bifactor",
    registry: {
      schemaVersion: 1,
      layouts: { triad: { columns: 3, gap: 20, padding: 10 } },
      themes: {
        spp: {
          background: "#fcfcfc",
          color: "#123456",
          accent: "#aa3377",
          fontFamily: "Arial, sans-serif",
        },
      },
      activeTheme: "spp",
    },
  });
async function files(
  directory: string,
  prefix = "",
): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  for await (const entry of Deno.readDir(directory)) {
    const relative = prefix + entry.name;
    if (entry.isDirectory) {
      Object.assign(
        result,
        await files(directory + "/" + entry.name, relative + "/"),
      );
    } else {result[relative] = hashSource(
        await Deno.readTextFile(directory + "/" + entry.name),
      );}
  }
  return result;
}

Deno.test("design export captures only document base theme plus registered definitions, never deck identity or content", async () => {
  const f = await fixture("Content must never travel");
  try {
    await applyDesignImport(
      f.source,
      await previewDesignImport(f.source, sample()),
    );
    const state = await readProject(f.source);
    const edited = structuredClone(state.emitted);
    edited.theme = {
      ...(edited.theme as object),
      background: "#ffeeee",
      color: "#332244",
      accent: "#c00077",
      fontFamily: "Georgia, serif",
    };
    edited.slides[0].elements[1].x = 177;
    edited.slides[0].elements[1].html = "Pending secret";
    await saveProject(f.source, edited, state.revision);
    const before = await files(f.directory);
    const exported = await exportDesignPackage(f.source, "Course identity");
    assert(equal(before, await files(f.directory)));
    assert(exported.registry.activeTheme === "spp");
    assert(exported.registry.themes?.spp.background === "#ffeeee");
    assert(exported.registry.themes?.spp.fontFamily === "Georgia, serif");
    assert(exported.registry.layouts?.triad.columns === 3);
    const json = JSON.stringify(exported);
    for (
      const forbidden of [
        state.docId,
        "Content must never travel",
        "Pending secret",
        "provenance",
        '"slides"',
        '"pending"',
        '"x"',
      ]
    ) assert(!json.includes(forbidden), forbidden);
  } finally {
    await Deno.remove(f.directory, { recursive: true });
  }
});

Deno.test("design export uses newly saved and imported registry defaults before recalculation while retaining only true native theme overrides", async () => {
  const f = await fixture();
  try {
    const dark = sample();
    dark.registry.themes!.spp.background = "#181818";
    dark.registry.themes!.spp.color = "#f4f4f4";
    const snapshot = await readProjectRegistry(f.source);
    await saveProjectRegistry(f.source, {
      expectedDocId: snapshot.docId,
      expectedRevision: snapshot.revision,
      expectedHash: snapshot.hash,
      registry: dark.registry,
    });
    assert(
      equal((await readProject(f.source)).emitted, f.rendered.state.emitted),
    );
    const savedExport = await exportDesignPackage(
      f.source,
      "Newly saved dark theme",
    );
    assert(equal(savedExport.registry, dark.registry));
    const imported = structuredClone(dark);
    imported.registry.themes!.spp.background = "#242424";
    await applyDesignImport(
      f.source,
      await previewDesignImport(f.source, imported),
    );
    const importedExport = await exportDesignPackage(
      f.source,
      "Newly imported dark theme",
    );
    assert(equal(importedExport.registry, imported.registry));
    const state = await readProject(f.source);
    const native = structuredClone(state.emitted);
    native.theme = { ...(native.theme as object), accent: "#ee55aa" };
    await saveProject(f.source, native, state.revision);
    const nativeExport = await exportDesignPackage(
      f.source,
      "Native accent on current dark design",
    );
    assert(nativeExport.registry.themes!.spp.background === "#242424");
    assert(nativeExport.registry.themes!.spp.color === "#f4f4f4");
    assert(nativeExport.registry.themes!.spp.accent === "#ee55aa");
    assert(equal(nativeExport.registry.layouts, imported.registry.layouts));
    assert((await readProject(f.source)).pending.length === 0);
  } finally {
    await Deno.remove(f.directory, { recursive: true });
  }
});

Deno.test("design import checks source changes during publication and restores the prior registry through its journal", async () => {
  const f = await fixture();
  const originalRename = Deno.rename;
  try {
    await applyDesignImport(
      f.source,
      await previewDesignImport(f.source, sample()),
    );
    const candidate = sample();
    candidate.registry.themes!.spp.background = "#000000";
    const plan = await previewDesignImport(f.source, candidate);
    const before = await files(f.directory);
    let injected = false;
    Deno.rename = async (oldPath, newPath) => {
      await originalRename(oldPath, newPath);
      // Mutation after the backup rename exercises the final source check and
      // recovery path, rather than merely detecting a stale preview up front.
      if (
        !injected && String(oldPath) === f.directory + "/.qbento/design.json"
      ) {
        injected = true;
        await Deno.writeTextFile(
          f.source,
          f.text + "\nChanged during registry publication\n",
        );
      }
    };
    await rejects(() => applyDesignImport(f.source, plan), "STALE_SOURCE");
    assert(injected);
    const after = await files(f.directory);
    for (
      const path of [
        ".qbento/design.json",
        ".qbento/state.json",
        "deck.bento.html",
      ]
    ) assert(before[path] === after[path], path);
    assert(
      await Deno.readTextFile(f.source) ===
        f.text + "\nChanged during registry publication\n",
    );
    assert(!Object.keys(after).includes(".qbento/design-save.json"));
  } finally {
    Deno.rename = originalRename;
    await Deno.remove(f.directory, { recursive: true });
  }
});

Deno.test("shared design imports by value into independent projects with reviewed replacement and recoverable journal", async () => {
  const a = await fixture("Session one"), b = await fixture("Session two");
  try {
    const exported = await exportDesignPackage(a.source, "Course default");
    assert(exported.registry.activeTheme === "exported");
    const state = await readProject(b.source);
    assert(state.docId !== a.rendered.state.docId);
    const edited = structuredClone(state.emitted);
    edited.slides[0].elements[1].html = "Pending semantic edit";
    edited.slides[0].elements[1].x = 171;
    await saveProject(b.source, edited, state.revision);
    await applyDesignImport(
      b.source,
      await previewDesignImport(b.source, sample()),
    );
    const before = await files(b.directory);
    const plan = await previewDesignImport(b.source, exported);
    assert(equal(plan, await previewDesignImport(b.source, exported)));
    assert(equal(before, await files(b.directory)));
    assert(
      plan.changes.operation === "replace-registry" &&
        plan.changes.renderNeeded,
    );
    assert(
      equal(plan.changes.removed, { layouts: ["triad"], themes: ["spp"] }),
    );
    const receipt = await applyDesignImport(b.source, plan);
    assert(receipt.renderNeeded && receipt.docId === state.docId);
    const after = await files(b.directory);
    for (
      const path of [
        "deck.qmd",
        "deck.bento.html",
        ".qbento/state.json",
        ".qbento/project.json",
      ]
    ) assert(before[path] === after[path], path);
    const current = await readProject(b.source);
    assert(current.pending.length === 1 && current.overrides.length > 0);
    assert(equal(current.emitted, edited));
    assert(
      (await readProjectRegistry(b.source)).registry.activeTheme === "exported",
    );
    exported.registry.themes!.exported.background = "#000000";
    assert(
      (await readProjectRegistry(b.source)).registry.themes!.exported
        .background !== "#000000",
    );
    const committed = Object.keys(after).filter((path) =>
      /history\/design-[^/]+\/committed.json$/.test(path)
    );
    assert(committed.length === 2);
    assert(
      Object.keys(after).some((path) =>
        /history\/design-[^/]+\/before.json$/.test(path)
      ),
    );
    assert(!Object.keys(after).includes(".qbento/design-save.json"));
  } finally {
    await Deno.remove(a.directory, { recursive: true });
    await Deno.remove(b.directory, { recursive: true });
  }
});

Deno.test("design import refuses changed package plan source registry revision and foreign source without mutation", async () => {
  const f = await fixture();
  try {
    const plan = await previewDesignImport(f.source, sample());
    const tampered = structuredClone(plan);
    tampered.package.registry.themes!.spp.accent = "#ff0000";
    const renamed = structuredClone(plan);
    renamed.package.name = "Tampered package name";
    const before = await files(f.directory);
    await rejects(
      () => applyDesignImport(f.source, renamed),
      "STALE_DESIGN_IMPORT",
    );
    await rejects(
      () => applyDesignImport(f.source, tampered),
      "STALE_DESIGN_IMPORT",
    );
    await rejects(
      () => applyDesignImport(f.source, { ...plan, extra: "unreviewed" }),
      "STALE_DESIGN_IMPORT",
    );
    assert(equal(before, await files(f.directory)));
    const foreign = f.directory + "/other.qmd";
    await Deno.writeTextFile(foreign, f.text);
    await rejects(
      () => previewDesignImport(foreign, sample()),
      "PROJECT_SOURCE_MISMATCH",
    );
    await Deno.writeTextFile(f.source, f.text + "\n");
    await rejects(
      () => applyDesignImport(f.source, plan),
      "STALE_DESIGN_IMPORT",
    );
    await Deno.writeTextFile(f.source, f.text);
    const snapshot = await readProjectRegistry(f.source);
    await saveProjectRegistry(f.source, {
      expectedDocId: snapshot.docId,
      expectedRevision: snapshot.revision,
      expectedHash: snapshot.hash,
      registry: { schemaVersion: 1 },
    });
    await rejects(
      () => applyDesignImport(f.source, plan),
      "STALE_DESIGN_IMPORT",
    );
    const revisionPlan = await previewDesignImport(f.source, sample());
    const edited = structuredClone(f.rendered.state.emitted);
    edited.slides[0].elements[1].x = 190;
    await saveProject(f.source, edited, f.rendered.state.revision);
    await rejects(
      () => applyDesignImport(f.source, revisionPlan),
      "STALE_DESIGN_IMPORT",
    );
  } finally {
    await Deno.remove(f.directory, { recursive: true });
  }
});

Deno.test("package boundaries reject unsupported fields, resources, unsafe file kinds and oversized JSON", async () => {
  const directory = await Deno.makeTempDir();
  try {
    for (
      const value of [
        { ...sample(), docId: "foreign" },
        { ...sample(), version: 2 },
        { ...sample(), name: "\u0000" },
        { ...sample(), name: " " },
        { ...sample(), name: "a".repeat(121) },
      ]
    ) {
      await rejects(
        () => validateDesignPackage(value),
        "INVALID_DESIGN_PACKAGE",
      );
    }
    await rejects(
      () =>
        validateDesignPackage({
          ...sample(),
          registry: {
            schemaVersion: 1,
            source: "https://remote.example/design.json",
          },
        }),
      "INVALID_DESIGN_REGISTRY",
    );
    await rejects(
      () => validateDesignPackage({ ...sample(), name: "x".repeat(262145) }),
      "DESIGN_PACKAGE_TOO_LARGE",
    );
    const path = directory + "/course.design.json";
    await Deno.writeTextFile(path, JSON.stringify(sample()));
    assert(equal(await readDesignPackageFile(path), sample()));
    await rejects(
      () => readDesignPackageFile(directory),
      "UNSAFE_DESIGN_PACKAGE",
    );
    await Deno.symlink(path, directory + "/linked.json");
    await rejects(
      () => readDesignPackageFile(directory + "/linked.json"),
      "UNSAFE_DESIGN_PACKAGE",
    );
    await Deno.link(path, directory + "/hard.json");
    await rejects(() => readDesignPackageFile(path), "UNSAFE_DESIGN_PACKAGE");
    await Deno.remove(directory + "/hard.json");
    await Deno.writeTextFile(path, " ".repeat(262145));
    await rejects(
      () => readDesignPackageFile(path),
      "DESIGN_PACKAGE_TOO_LARGE",
    );
    const mapping = { styles: { heading: ".reveal h2" } };
    await Deno.writeTextFile(path, JSON.stringify(mapping));
    assert(equal(await readDesignJsonFile(path), mapping));
    await Deno.writeTextFile(path, "invalid JSON");
    await rejects(() => readDesignPackageFile(path), "INVALID_DESIGN_PACKAGE");
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("design package and plan readers retain a deterministic JSON round trip", async () => {
  const f = await fixture();
  try {
    const plan = await previewDesignImport(f.source, sample());
    const path = f.directory + "/plan.json";
    await Deno.writeTextFile(path, JSON.stringify(plan));
    const read = await readDesignImportPlanFile(path);
    assert(equal(read, plan));
    await applyDesignImport(f.source, read);
    await rejects(
      () => applyDesignImport(f.source, read),
      "STALE_DESIGN_IMPORT",
    );
  } finally {
    await Deno.remove(f.directory, { recursive: true });
  }
});

Deno.test("large design CLI export and preview files can be read and applied unchanged", async () => {
  const f = await fixture();
  try {
    const pkg = largeDesignPackage();
    const bytes = (value: unknown) =>
      new TextEncoder().encode(JSON.stringify(value, null, 2) + "\n").length;
    assert(bytes(pkg.registry) <= MAX_DESIGN_REGISTRY_BYTES);
    assert(bytes(pkg) > MAX_DESIGN_REGISTRY_BYTES);
    const snapshot = await readProjectRegistry(f.source);
    await saveProjectRegistry(f.source, {
      expectedDocId: snapshot.docId,
      expectedRevision: snapshot.revision,
      expectedHash: snapshot.hash,
      registry: pkg.registry,
    });
    const cli = async (...args: string[]) => {
      const output = await new Deno.Command(Deno.execPath(), {
        args: [
          "run",
          "--allow-read",
          "--allow-env",
          new URL("../src/cli.ts", import.meta.url).pathname,
          "design",
          ...args,
        ],
      }).output();
      assert(output.success, new TextDecoder().decode(output.stderr));
      return output.stdout;
    };
    const path = f.directory + "/large.design.json";
    const exported = await cli("export", f.source, pkg.name);
    assert(
      exported.length <= MAX_DESIGN_REGISTRY_BYTES,
      "Export exceeds its reader limit",
    );
    await Deno.writeFile(path, exported);
    assert(equal(await readDesignPackageFile(path), pkg));
    assert(
      equal(
        JSON.parse(new TextDecoder().decode(await cli("inspect", path))),
        pkg,
      ),
    );
    const planPath = f.directory + "/large.plan.json";
    await Deno.writeFile(planPath, await cli("preview", f.source, path));
    const plan = await readDesignImportPlanFile(planPath);
    await applyDesignImport(f.source, plan);
    assert(equal((await readProjectRegistry(f.source)).registry, pkg.registry));
    assert(await Deno.readTextFile(f.source) === f.text);
  } finally {
    await Deno.remove(f.directory, { recursive: true });
  }
});

Deno.test("design preview and export perform no writes, including for an unrendered destination", async () => {
  const f = await fixture();
  const empty = await Deno.makeTempDir();
  const unrendered = empty + "/deck.qmd";
  await Deno.writeTextFile(unrendered, f.text);
  const original = {
    mkdir: Deno.mkdir,
    writeTextFile: Deno.writeTextFile,
    writeFile: Deno.writeFile,
    rename: Deno.rename,
    remove: Deno.remove,
    open: Deno.open,
  };
  const refuse = () => {
    throw new Error("Read operation attempted a filesystem write");
  };
  try {
    Deno.mkdir = refuse;
    Deno.writeTextFile = refuse;
    Deno.writeFile = refuse;
    Deno.rename = refuse;
    Deno.remove = refuse;
    Deno.open = (path, options) => {
      if (
        options?.write || options?.append || options?.create ||
        options?.createNew || options?.truncate
      ) refuse();
      return original.open(path, options);
    };
    const design = await exportDesignPackage(f.source, "Read-only design");
    const plan = await previewDesignImport(f.source, design);
    assert(plan.docId === f.rendered.state.docId);
    await rejects(() => previewDesignImport(unrendered, design), "NO_BASELINE");
    await rejects(
      () => exportDesignPackage(unrendered, "Not initialized"),
      "NO_BASELINE",
    );
  } finally {
    Object.assign(Deno, original);
    await Deno.remove(f.directory, { recursive: true });
    await Deno.remove(empty, { recursive: true });
  }
});
