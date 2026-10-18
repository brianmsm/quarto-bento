/** Offline portable acceptance for the current reusable-design feature. */
import { join } from "node:path";
import { buildDevelopmentPackage } from "./package.ts";

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error("DESIGN_PORTABLE_CHECK_FAILED: " + message);
}
export async function reusableDesignCheck() {
  const directory = await Deno.makeTempDir({
    prefix: "qbento-design-portable-",
  });
  try {
    const built = join(directory, "built");
    const manifest = await buildDevelopmentPackage({ destination: built });
    const portable = join(directory, "portable application with spaces");
    await Deno.rename(built, portable);
    const cli = join(portable, "bin", "qbento");
    const env = {
      DENO_DIR: join(directory, "fresh-deno-cache"),
      XDG_CACHE_HOME: join(directory, "fresh-quarto-cache"),
      QUARTO_RUN_NO_NETWORK: "true",
    };
    const call = async (...args: string[]) => {
      const result = await new Deno.Command(cli, {
        args,
        cwd: directory,
        env,
        stdout: "piped",
        stderr: "piped",
      }).output();
      assert(result.success, new TextDecoder().decode(result.stderr));
      return JSON.parse(new TextDecoder().decode(result.stdout));
    };
    const project = join(directory, "new lesson with spaces");
    await Deno.mkdir(project);
    const source = join(project, "deck.qmd");
    const qmd =
      '## A lesson {#lesson}\n\n::: {#body bento-style="caption"}\nNew lesson content.\n:::\n';
    await Deno.writeTextFile(source, qmd);
    const design = JSON.parse(
      await Deno.readTextFile(
        new URL(
          "../examples/reusable-designs/course.design.json",
          import.meta.url,
        ),
      ),
    );
    const packagePath = join(directory, "course.design.json");
    await Deno.writeTextFile(packagePath, JSON.stringify(design));
    assert(
      (await call("design", "init", source, packagePath)).initialized,
      "Initialization did not complete",
    );
    const rendered = await call("render", source);
    const exported = await call("design", "export", source, "Portable course");
    assert(
      exported.registry.themes["spp-classroom"].variants.section,
      "Native templates were omitted from the package",
    );
    const plan = await call("design", "preview", source, packagePath);
    const planPath = join(directory, "checked-plan.json");
    await Deno.writeTextFile(planPath, JSON.stringify(plan));
    assert(
      (await call("design", "apply", source, planPath)).renderNeeded,
      "Apply receipt was incomplete",
    );
    assert(await Deno.readTextFile(source) === qmd, "Design reuse changed QMD");
    const relocated = join(directory, "relocated lesson");
    await Deno.rename(project, relocated);
    await Deno.remove(join(relocated, "deck.bento.html"));
    await Deno.remove(join(relocated, ".qbento", "build"), { recursive: true });
    const rebuilt = await call("render", join(relocated, "deck.qmd"));
    assert(
      rebuilt.docId === rendered.docId,
      "Relocation changed document identity",
    );
    const reference = join(directory, "reference.html");
    await Deno.writeTextFile(
      reference,
      '<style>.reveal{background:#eeeeee;font:32px Arial}.reveal h2{color:#ffffff;background:#23373b}</style><div class="reveal"><h2 id="title">Reference title</h2><p id="body">Reference body</p></div>',
    );
    const mapping = join(directory, "mapping.json");
    await Deno.writeTextFile(
      mapping,
      JSON.stringify({
        version: 1,
        name: "portable",
        canvas: ".reveal",
        title: "#title",
        body: "#body",
        accent: "#be2161",
      }),
    );
    const adaptation = await call("design", "adapt", reference, mapping);
    assert(
      adaptation.package.registry.themes.portable.styles.body.fontSize === 32,
      "Portable adaptation did not sample installed Chromium",
    );
    return {
      passed: true,
      deno: Deno.version.deno,
      platform: Deno.build.os,
      portableFiles: manifest.files.length,
      docId: rendered.docId,
      relocationPreservedIdentity: true,
      sourceUnchanged: true,
      adaptation: true,
    };
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
}
if (import.meta.main) {
  try {
    console.log(JSON.stringify(await reusableDesignCheck(), null, 2));
  } catch (error) {
    console.error(String(error));
    Deno.exitCode = 1;
  }
}
