import { initializeDesignPackage } from "../src/core/design-initialize.ts";
import {
  applyDesignImport,
  exportDesignPackage,
  previewDesignImport,
} from "../src/core/design-package.ts";
import { previewDesignPackage } from "../src/core/design-preview.ts";
import {
  readProject,
  renderProject,
  saveProject,
} from "../src/core/project.ts";
import { previewSelectedSync } from "../src/core/sync.ts";
import { extractDocument } from "../src/render/html.ts";
import { startStudio } from "../src/studio/server.ts";

function assert(value: unknown, message = "assertion failed"): asserts value {
  if (!value) throw new Error(message);
}
const example = new URL("../examples/reusable-designs/", import.meta.url);
async function design() {
  return JSON.parse(
    await Deno.readTextFile(new URL("course.design.json", example)),
  );
}
async function fixture() {
  const directory = await Deno.makeTempDir({
    prefix: "qbento-design-workflow-",
  });
  const source = directory + "/deck.qmd";
  const text = await Deno.readTextFile(new URL("lesson/deck.qmd", example));
  await Deno.writeTextFile(source, text);
  await initializeDesignPackage(source, await design());
  return { directory, source, text };
}

Deno.test("course design reuse preserves independent identities, pending content and native design across package updates and changed data", async () => {
  const a = await fixture(), b = await fixture();
  try {
    const first = await renderProject(a.source),
      second = await renderProject(b.source);
    assert(first.state.docId !== second.state.docId);
    const native = structuredClone(first.state.emitted);
    const content = native.slides.find((slide) => slide.id === "explanations")!;
    const body = content.elements.find((element) =>
      String(element.html).includes("One explanation")
    )!;
    assert(body && body.type === "text");
    body.html = "A saved authored explanation.";
    body.x = Number(body.x) + 18;
    const decoration = content.elements.find((element) =>
      element.id.includes("/qb-theme/")
    )!;
    decoration.fill = "#111111";
    const imageBefore = native.slides.at(-1)!.elements.find((element) =>
      element.type === "image"
    )!;
    assert(imageBefore?.src);
    const saved = await saveProject(a.source, native, first.state.revision);
    assert(saved.pending.length === 1);
    const stateBefore = await Deno.readTextFile(
      a.directory + "/.qbento/state.json",
    );
    const outputBefore = await Deno.readTextFile(first.output);
    const updated = await design();
    updated.registry.themes["spp-classroom"].background = "#ffffff";
    await applyDesignImport(
      a.source,
      await previewDesignImport(a.source, updated),
    );
    assert(
      await Deno.readTextFile(a.directory + "/.qbento/state.json") ===
        stateBefore,
    );
    assert(await Deno.readTextFile(first.output) === outputBefore);
    const rebuilt = await renderProject(a.source);
    assert(
      rebuilt.state.docId === first.state.docId &&
        rebuilt.state.pending.length === 1,
    );
    const kept = rebuilt.state.emitted.slides.find((slide) =>
      slide.id === "explanations"
    )!;
    const keptBody = kept.elements.find((element) => element.id === body.id)!;
    assert(keptBody.html === body.html && keptBody.x === body.x);
    assert(
      kept.elements.find((element) => element.id === decoration.id)!.fill ===
        "#111111",
    );
    assert(rebuilt.state.emitted.slides[0].background === "#f0f1eb");
    assert(kept.background === "#ffffff");
    assert(await Deno.readTextFile(a.source) === a.text);
    const changed = a.text.replace(
      "values <- c(2, 4, 6)",
      "values <- c(3, 4, 7)",
    );
    // Replace the executable occurrence too; the first occurrence is displayed code.
    await Deno.writeTextFile(
      a.source,
      changed.replace("values <- c(2, 4, 6)", "values <- c(3, 4, 7)"),
    );
    const recomputed = await renderProject(a.source);
    const imageAfter = recomputed.state.emitted.slides.at(-1)!.elements.find((
      element,
    ) => element.type === "image")!;
    assert(imageAfter.src !== imageBefore.src, "R figure did not recompute");
    assert(recomputed.state.docId === first.state.docId);
    assert(
      recomputed.state.emitted.slides[1].elements.find((element) =>
        element.id === body.id
      )!.html === body.html,
    );
    const portable = await exportDesignPackage(a.source, "Shared course");
    assert(portable.registry.themes!["spp-classroom"].variants?.section);
    assert(!JSON.stringify(portable).includes("A saved authored explanation."));
    assert(!JSON.stringify(portable).includes(first.state.docId));
    const rejected = await design();
    delete rejected.registry.themes["spp-classroom"].namedStyles;
    let failure: unknown;
    try {
      await previewDesignImport(a.source, rejected);
    } catch (error) {
      failure = error;
    }
    assert(String(failure).includes("UNKNOWN_STYLE"), String(failure));
    const missingLayout = await design();
    delete missingLayout.registry.layouts.pair;
    failure = undefined;
    try {
      await previewDesignImport(a.source, missingLayout);
    } catch (error) {
      failure = error;
    }
    assert(String(failure).includes("UNKNOWN_LAYOUT"), String(failure));
  } finally {
    await Deno.remove(a.directory, { recursive: true });
    await Deno.remove(b.directory, { recursive: true });
  }
});

Deno.test("native theme decoration deletion cannot propose deleting its source heading", async () => {
  const f = await fixture();
  try {
    const rendered = await renderProject(f.source);
    const native = structuredClone(rendered.state.emitted),
      slide = native.slides[1];
    const decoration = slide.elements.find((element) =>
      element.id.includes("/qb-theme/")
    )!;
    slide.elements = slide.elements.filter((element) =>
      element.id !== decoration.id
    );
    const saved = await saveProject(f.source, native, rendered.state.revision);
    const deletion = saved.pending.find((change) =>
      change.target.elementId === decoration.id
    )!;
    assert(deletion?.kind === "delete-element");
    let failure: unknown;
    try {
      await previewSelectedSync(f.source, {
        version: 1,
        docId: saved.docId,
        expectedRevision: saved.revision,
        selectedChangeIds: [deletion.id],
        confirmedDeleteIds: [deletion.id],
      });
    } catch (error) {
      failure = error;
    }
    assert(failure, "A decoration was accepted as a semantic source deletion");
    assert(await Deno.readTextFile(f.source) === f.text);
    const rebuilt = await renderProject(f.source);
    assert(
      rebuilt.state.emitted.slides[1].elements.some((element) =>
        element.type === "text" &&
        String(element.html).includes("Two explanations")
      ),
    );
  } finally {
    await Deno.remove(f.directory, { recursive: true });
  }
});

Deno.test("Studio design preview returns a real isolated native sample and checked apply leaves QMD, state and output untouched", async () => {
  const f = await fixture();
  try {
    const rendered = await renderProject(f.source),
      studio = await startStudio(f.source, 0);
    try {
      const page = await (await fetch(studio.url)).text();
      const token = JSON.parse(
        /globalThis\.qbentoToken = ("[^"]+")/.exec(page)![1],
      );
      const pkg = await design();
      const post = (path: string, body: unknown, secret = token) =>
        fetch(studio.url + "/api/" + path, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-qbento-token": secret,
            Origin: studio.url,
          },
          body: JSON.stringify(body),
        });
      const forbidden = await post("design/preview", { package: pkg }, "wrong");
      assert(forbidden.status === 403);
      await forbidden.body?.cancel();
      const outputBefore = await Deno.readTextFile(rendered.output);
      const snapshot = await Deno.readTextFile(
        f.directory + "/.qbento/state.json",
      );
      const response = await post("design/preview", { package: pkg });
      assert(response.ok, await response.clone().text());
      const preview = await response.json();
      assert(
        preview.plan.docId === rendered.state.docId &&
          preview.previewUrl.startsWith("/design-preview/"),
      );
      const sample = await (await fetch(studio.url + preview.previewUrl))
        .text();
      const doc = extractDocument(sample);
      assert(
        "readonly" in doc && doc.readonly === true &&
          doc.docId !== rendered.state.docId &&
          doc.slides.length === 4,
      );
      assert(
        doc.slides[0].elements.some((element) =>
          element.id.includes("/qb-theme/")
        ),
      );
      assert(!sample.includes("One explanation belongs here."));
      const narrow = structuredClone(pkg);
      narrow.registry.themes["spp-classroom"].variants.content.contentFrame.h =
        20;
      const sampleFailure = await post("design/preview", { package: narrow });
      assert(sampleFailure.ok, await sampleFailure.clone().text());
      const stillReviewable = await sampleFailure.json();
      assert(stillReviewable.plan.docId === rendered.state.docId);
      assert(typeof stillReviewable.previewError === "string");
      assert(!stillReviewable.previewUrl);
      assert(
        stillReviewable.plan.package.registry.themes["spp-classroom"]
          .variants.content.contentFrame.h === 20,
      );
      const applied = await post("design/apply", { plan: preview.plan });
      assert(applied.ok, await applied.clone().text());
      await applied.body?.cancel();
      assert(
        await Deno.readTextFile(f.directory + "/.qbento/state.json") ===
          snapshot,
      );
      assert(await Deno.readTextFile(f.source) === f.text);
      assert(await Deno.readTextFile(rendered.output) === outputBefore);
      const exported = await post("design/export", { name: "Course" });
      assert((await exported.json()).format === "qbento/design");
      assert((await readProject(f.source)).docId === rendered.state.docId);
    } finally {
      await studio.shutdown();
    }
  } finally {
    await Deno.remove(f.directory, { recursive: true });
  }
});

Deno.test("native sample generation never writes a project or copies its content", async () => {
  const doc = extractDocument(await previewDesignPackage(await design()));
  assert("readonly" in doc && doc.readonly === true && doc.slides.length === 4);
});
