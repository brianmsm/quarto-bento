import { applySync, previewSync } from "../src/core/sync.ts";
import {
  readProjectDiagnostics,
  renderProject,
  saveProject,
} from "../src/core/project.ts";
import { installQuartoProject } from "../src/integration/install.ts";
import { canonical } from "../src/state/mod.ts";
function eq(a: unknown, b: unknown) {
  if (canonical(a) !== canonical(b)) {
    throw new Error(`${canonical(a)} != ${canonical(b)}`);
  }
}
function assert(value: unknown, message = "assertion failed"): asserts value {
  if (!value) throw new Error(message);
}
const canRun =
  (await Deno.permissions.query({ name: "run" })).state === "granted";
const text =
  "## Título β 😀 {#result .qbento-design}\r\n\r\n::: {#body}\r\nTexto.\r\n:::\r\n";
Deno.test({
  name:
    "real Quarto missing design warns across baseline/reopen and never rewrites QMD; saved design resolves availability only",
  ignore: !canRun,
  fn: async () => {
    const dir = await Deno.makeTempDir({ prefix: "qbento-missing-design-" });
    const source = dir + "/deck.qmd";
    try {
      await Deno.writeTextFile(source, text);
      const before = await readProjectDiagnostics(source);
      eq(before.map((d) => [d.code, d.slideId, d.reference]), [[
        "MISSING_DESIGN",
        "result",
        ".qbento/",
      ]]);
      try {
        await Deno.stat(dir + "/.qbento");
        throw new Error("Read-only diagnostics created state directory");
      } catch (error) {
        if (!(error instanceof Deno.errors.NotFound)) throw error;
      }
      const first = await renderProject(source);
      eq(first.diagnostics, before);
      eq(first.state.overrides, []);
      eq(first.state.pending, []);
      eq(await readProjectDiagnostics(source), before);
      const second = await renderProject(source);
      eq(second.diagnostics, before);
      eq(second.state.docId, first.state.docId);
      const stateBytes = await Deno.readFile(dir + "/.qbento/state.json");
      eq(await readProjectDiagnostics(source), before);
      eq(
        Array.from(await Deno.readFile(dir + "/.qbento/state.json")),
        Array.from(stateBytes),
      );
      eq(await Deno.readTextFile(source), text);
      const edited = structuredClone(second.state.emitted);
      edited.slides[0].elements.find((e) => e.html === "Texto.")!.x = 222;
      await saveProject(source, edited, second.state.revision);
      eq(await readProjectDiagnostics(source), []);
      const withDesign = await renderProject(source);
      eq(withDesign.diagnostics, []);
      eq(
        withDesign.state.emitted.slides[0].elements.find((e) =>
          e.html === "Texto."
        )!.x,
        222,
      );
      eq(await Deno.readTextFile(source), text);
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
});
Deno.test({
  name:
    "real detailed registry warning persists with valid visual state and invalid registry still refuses",
  ignore: !canRun,
  fn: async () => {
    const dir = await Deno.makeTempDir({ prefix: "qbento-missing-registry-" });
    const source = dir + "/deck.qmd";
    const detailed = text.replace(
      "}\r\n",
      '}\r\n<!-- qbento-design: {"features":["overrides","theme"],"references":[".qbento/state.json",".qbento/design.json"],"slideId":"result","version":1} -->\r\n',
    );
    try {
      await Deno.writeTextFile(source, detailed);
      const first = await renderProject(source);
      const edited = structuredClone(first.state.emitted);
      edited.slides[0].elements.find((e) => e.html === "Texto.")!.x = 222;
      await saveProject(source, edited, first.state.revision);
      const expected = await readProjectDiagnostics(source);
      eq(expected.map((d) => [d.code, d.reference]), [[
        "MISSING_DESIGN",
        ".qbento/design.json",
      ]]);
      eq((await renderProject(source)).diagnostics, expected);
      eq(await readProjectDiagnostics(source), expected);
      const path = dir + "/.qbento/design.json";
      await Deno.writeTextFile(path, '{"schemaVersion":999}');
      let refused = false;
      try {
        await readProjectDiagnostics(source);
      } catch (error) {
        assert(
          String(error).includes("INVALID_DESIGN_REGISTRY"),
          String(error),
        );
        refused = true;
      }
      assert(
        refused,
        "Invalid registry was degraded into a missing-design warning",
      );
      await Deno.writeTextFile(
        path,
        JSON.stringify({
          schemaVersion: 1,
          themes: {
            restored: {
              background: "#ffffff",
              color: "#000000",
              accent: "#123456",
              fontFamily: "Arial, sans-serif",
            },
          },
          activeTheme: "restored",
        }),
      );
      eq(await readProjectDiagnostics(source), []);
      eq((await renderProject(source)).diagnostics, []);
      eq(await Deno.readTextFile(source), detailed);
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
});
Deno.test({
  name:
    "ordinary Linux Quarto emits persistent missing-design warnings through the same projection",
  ignore: !canRun || Deno.build.os !== "linux",
  fn: async () => {
    const dir = await Deno.makeTempDir({ prefix: "qbento-missing-ordinary-" });
    const source = dir + "/deck.qmd";
    try {
      await Deno.writeTextFile(source, text);
      await installQuartoProject(source);
      for (let pass = 0; pass < 2; pass++) {
        const result = await new Deno.Command("quarto", {
          cwd: dir,
          args: ["render"],
          env: {
            QUARTO_RUN_NO_NETWORK: "true",
            XDG_CACHE_HOME: dir + "/cache",
          },
          stdout: "piped",
          stderr: "piped",
        }).output();
        const log = new TextDecoder().decode(result.stdout) +
          new TextDecoder().decode(result.stderr);
        assert(result.success, log);
        assert(
          log.includes("MISSING_DESIGN") && log.includes("Git or backup"),
          log,
        );
        eq((await readProjectDiagnostics(source)).map((d) => d.code), [
          "MISSING_DESIGN",
        ]);
        eq(await Deno.readTextFile(source), text);
      }
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
});

Deno.test({
  name:
    "installed Quarto parses indented reserved reference text as literal code rather than annotations",
  ignore: !canRun,
  fn: async () => {
    const comment =
      '<!-- qbento-design: {"version":1,"slideId":"result","features":["overrides"],"references":[".qbento/state.json"]} -->';
    for (const indent of ["", " ", "  ", "   ", "    ", "\t"]) {
      const process = new Deno.Command("quarto", {
        args: ["pandoc", "--from", "markdown", "--to", "json"],
        stdin: "piped",
        stdout: "piped",
        stderr: "piped",
      }).spawn();
      const output = process.output();
      const writer = process.stdin.getWriter();
      await writer.write(
        new TextEncoder().encode(`## T {#result}\n\n${indent}${comment}\n`),
      );
      await writer.close();
      const result = await output;
      assert(result.success, new TextDecoder().decode(result.stderr));
      const ast = JSON.parse(new TextDecoder().decode(result.stdout));
      if (indent.length >= 4 || indent === "\t") {
        eq(ast.blocks[1].t, "CodeBlock");
        eq(ast.blocks[1].c[1], comment);
      } else if (!indent.length) {
        eq(ast.blocks[1].t, "RawBlock");
        eq(ast.blocks[1].c, ["html", comment]);
      } else {
        // Pandoc puts a 1–3-space HTML comment in a paragraph as RawInline.
        eq(ast.blocks[1].t, "Para");
        eq(ast.blocks[1].c, [{ t: "RawInline", c: ["html", comment] }]);
      }
    }
  },
});

Deno.test({
  name:
    "real approved detailed creation promotes design without a false missing warning and source-only rebuild keeps warning",
  ignore: !canRun,
  fn: async () => {
    const dir = await Deno.makeTempDir({ prefix: "qbento-missing-created-" });
    const fresh = await Deno.makeTempDir({
      prefix: "qbento-created-source-only-",
    });
    const source = dir + "/deck.qmd";
    try {
      await Deno.writeTextFile(
        source,
        "---\nqbento-annotations: detailed\n---\n\n## T {#result}\n\n::: {#body}\nText.\n:::\n",
      );
      const first = await renderProject(source);
      const edited = structuredClone(first.state.emitted);
      const title = structuredClone(edited.slides[0].elements[0]);
      const body = structuredClone(edited.slides[0].elements[1]);
      Object.assign(title, { id: "created-title", html: "Created", x: 200 });
      Object.assign(body, {
        id: "created-body",
        html: "Created body.",
        x: 300,
      });
      edited.slides.push({
        ...edited.slides[0],
        id: "created",
        elements: [title, body, {
          id: "created-shape",
          type: "shape",
          shape: "rect",
          fill: "#156f65",
          x: 70,
          y: 80,
          w: 50,
          h: 50,
        }],
      });
      await saveProject(source, edited, first.state.revision);
      const plan = await previewSync(source);
      eq(
        plan.annotations.requests.find((r) => r.slideId === "created")
          ?.features,
        ["created-design"],
      );
      await applySync(source, plan);
      const synced = await Deno.readTextFile(source);
      eq(await readProjectDiagnostics(source), []);
      const next = await renderProject(source);
      eq(next.state.pending, []);
      eq(next.diagnostics, []);
      eq(await readProjectDiagnostics(source), []);
      const created = next.state.emitted.slides.find((s) =>
        s.id === "created"
      )!;
      eq(created.elements.find((e) => e.id === "created-title")!.x, 200);
      eq(created.elements.find((e) => e.id === "created-body")!.x, 300);
      eq(
        created.elements.find((e) => e.id === "created-shape"),
        edited.slides[1].elements[2],
      );
      eq(await Deno.readTextFile(source), synced);
      await Deno.writeTextFile(fresh + "/deck.qmd", synced);
      const absent = await renderProject(fresh + "/deck.qmd");
      eq(
        absent.diagnostics.filter((d) => d.slideId === "created").map((d) =>
          d.code
        ),
        ["MISSING_DESIGN"],
      );
      eq(
        (await readProjectDiagnostics(fresh + "/deck.qmd")).filter((d) =>
          d.slideId === "created"
        ).map((d) => d.code),
        ["MISSING_DESIGN"],
      );
      eq(await Deno.readTextFile(fresh + "/deck.qmd"), synced);
    } finally {
      await Deno.remove(dir, { recursive: true });
      await Deno.remove(fresh, { recursive: true });
    }
  },
});
Deno.test({
  name:
    "unresolved registry transaction blocks diagnostics and source sync even when design.json is absent",
  ignore: !canRun,
  fn: async () => {
    const dir = await Deno.makeTempDir({
      prefix: "qbento-missing-registry-gate-",
    });
    const source = dir + "/deck.qmd";
    const original = text.replace(" .qbento-design", "");
    const refuses = async (fn: () => Promise<unknown>) => {
      let refused = false;
      try {
        await fn();
      } catch (error) {
        assert(
          String(error).includes("DESIGN_REGISTRY_RECOVERY_REQUIRED"),
          String(error),
        );
        refused = true;
      }
      assert(
        refused,
        "Unresolved registry transaction was degraded to default/missing design",
      );
    };
    try {
      await Deno.writeTextFile(source, original);
      const first = await renderProject(source);
      const edited = structuredClone(first.state.emitted);
      edited.slides[0].elements.find((e) => e.html === "Texto.")!.html =
        "Edited.";
      await saveProject(source, edited, first.state.revision);
      const plan = await previewSync(source);
      const stateBytes = await Deno.readFile(dir + "/.qbento/state.json");
      const registryPath = dir + "/.qbento/design.json";
      for (const available of [false, true]) {
        if (available) {
          await Deno.writeTextFile(registryPath, '{"schemaVersion":1}');
        }
        await Deno.writeTextFile(dir + "/.qbento/design-save.json", "{}");
        await refuses(() => readProjectDiagnostics(source));
        await refuses(() => previewSync(source));
        await refuses(() => applySync(source, plan));
        eq(await Deno.readTextFile(source), original);
        eq(
          Array.from(await Deno.readFile(dir + "/.qbento/state.json")),
          Array.from(stateBytes),
        );
        await Deno.remove(dir + "/.qbento/design-save.json");
      }
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
});
