import { renderProject, saveProject } from "../src/core/project.ts";
import { applySync, previewSync } from "../src/core/sync.ts";
import { previewPatches, scanSource } from "../src/source/mod.ts";
import { canonical } from "../src/state/mod.ts";
function ok(v: unknown, m = "assertion failed"): asserts v {
  if (!v) throw new Error(m);
}
function eq(a: unknown, b: unknown) {
  ok(canonical(a) === canonical(b), `${canonical(a)} != ${canonical(b)}`);
}
const svg = (color: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="60"><rect x="5" y="5" width="100" height="40" fill="${color}"/></svg>`;
Deno.test("plain local image and rich caption sync preserve URI, geometry and identity through fresh asset and HTML-free rebuild", async () => {
  const dir = await Deno.makeTempDir({ prefix: "qbento-plain-image-" }),
    clone = await Deno.makeTempDir({ prefix: "qbento-image-cold-" }),
    source = dir + "/deck.qmd";
  const original =
    "## Plain image\r\n\r\n![Original **β**\r\ncaption](<imagen β con espacio.svg>)\r\n\r\nA conclusion.\r\n";
  try {
    await Deno.writeTextFile(source, original);
    await Deno.writeTextFile(dir + "/imagen β con espacio.svg", svg("#156f65"));
    const first = (await renderProject(source)).state;
    const edit = structuredClone(first.emitted),
      elements = edit.slides[0].elements,
      image = elements.find((e) => e.type === "image")!,
      caption = elements.find((e) => e.id === image.id + "-caption")!;
    ok(image && caption);
    eq(caption.html, "Original <b>β</b> caption");
    image.x = 203;
    image.w = 770;
    image.rotation = 3;
    caption.x = 220;
    caption.color = "#994455";
    caption.html = "Reviewed <b>β</b> and <code>evidence</code>";
    await saveProject(source, edit, first.revision);
    eq(await Deno.readTextFile(source), original);
    const plan = await previewSync(source);
    ok(plan.identities?.requests.some((r) => r.imageNativeId === image.id));
    ok(plan.identityBindings?.some((b) => b.expectedImageHash));
    ok(plan.result.includes("](<imagen β con espacio.svg>)"));
    ok(plan.result.includes("![Reviewed **β** and `evidence`]"));
    await applySync(source, plan);
    const synced = (await renderProject(source)).state;
    eq(synced.docId, first.docId);
    eq(synced.pending, []);
    eq(synced.emitted, edit);
    await Deno.writeTextFile(dir + "/imagen β con espacio.svg", svg("#aa5544"));
    const fresh = (await renderProject(source)).state;
    const newImage = fresh.emitted.slides[0].elements.find((e) =>
      e.id === image.id
    )!;
    ok(newImage.src !== image.src);
    eq([newImage.x, newImage.w, newImage.rotation], [203, 770, 3]);
    eq(fresh.docId, first.docId);
    await Deno.writeTextFile(
      clone + "/deck.qmd",
      await Deno.readTextFile(source),
    );
    await Deno.copyFile(
      dir + "/imagen β con espacio.svg",
      clone + "/imagen β con espacio.svg",
    );
    await Deno.mkdir(clone + "/.qbento");
    for (const file of ["state.json", "project.json"]) {
      await Deno.copyFile(dir + "/.qbento/" + file, clone + "/.qbento/" + file);
    }
    const rebuilt = (await renderProject(clone + "/deck.qmd")).state;
    eq(rebuilt.emitted, fresh.emitted);
    eq(rebuilt.docId, fresh.docId);
    eq(rebuilt.pending, []);
  } finally {
    await Deno.remove(dir, { recursive: true });
    await Deno.remove(clone, { recursive: true });
  }
});
Deno.test("image caption span keeps CRLF and rejects an image-boundary injection", () => {
  const source = scanSource(
    "## One {#one}\r\n\r\n![Primera\r\nsegunda β](plot.svg)\r\n",
  );
  const block = source.blocks.find((b) => b.kind === "image")!;
  ok(block);
  eq(block.content, "Primera\r\nsegunda β");
  const plan = previewPatches(source, [{
    blockId: block.id,
    expected: block.content,
    replacement: "Reviewed **β**",
  }]);
  ok(plan.result.includes("![Reviewed **β**](plot.svg)\r\n"));
  let refused = false;
  try {
    previewPatches(source, [{
      blockId: block.id,
      replacement: "](other.svg)![injected",
    }]);
  } catch {
    refused = true;
  }
  ok(refused);
});

import { renderProjectFromAst } from "../src/core/project.ts";
import { executeQuarto } from "../src/render/quarto.ts";
import { installQuartoProject } from "../src/integration/install.ts";
async function rejects(fn: () => Promise<unknown>, code: string) {
  try {
    await fn();
  } catch (error) {
    ok(String(error).includes(code), String(error));
    return;
  }
  throw new Error("Expected " + code);
}
Deno.test("ordinary Quarto renders empty captions and synchronizes caption creation/clearing with both native identities", async () => {
  const dir = await Deno.makeTempDir({ prefix: "qbento-image-ordinary-" }),
    source = dir + "/deck.qmd";
  try {
    await Deno.writeTextFile(source, "## Ordinary\n\n![](plot.svg)\n");
    await Deno.writeTextFile(dir + "/plot.svg", svg("#156f65"));
    await installQuartoProject(source);
    const render = async () => {
      const r = await new Deno.Command("quarto", {
        cwd: dir,
        args: ["render", "deck.qmd", "--quiet"],
        stdout: "piped",
        stderr: "piped",
      }).output();
      ok(r.success, new TextDecoder().decode(r.stderr));
      return (await import("../src/core/project.ts")).readProject(source);
    };
    let state = await render();
    const docId = state.docId,
      asset = state.emitted.slides[0].elements.find((e) => e.type === "image")!,
      captionId = asset.id + "-caption";
    for (const html of ["Created <b>β</b> caption", ""]) {
      const edited = structuredClone(state.emitted);
      edited.slides[0].elements.find((e) => e.id === captionId)!.html = html;
      edited.slides[0].elements.find((e) => e.id === asset.id)!.x = 205;
      await saveProject(source, edited, state.revision);
      const plan = await previewSync(source);
      await applySync(source, plan);
      state = await render();
      eq(state.docId, docId);
      eq(state.pending, []);
      eq(state.emitted, edited);
    }
    ok((await Deno.readTextFile(source)).includes("![](plot.svg)"));
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
Deno.test("transformed, missing or duplicated authored image/caption objects refuse atomically", async () => {
  const dir = await Deno.makeTempDir({ prefix: "qbento-image-tamper-" }),
    source = dir + "/deck.qmd";
  try {
    await Deno.writeTextFile(
      source,
      "## One {#one}\n\n![Local **β**](plot.svg)\n",
    );
    await Deno.writeTextFile(dir + "/plot.svg", svg("#156f65"));
    await renderProject(source);
    const bytes = await Deno.readTextFile(dir + "/.qbento/state.json"),
      html = await Deno.readTextFile(dir + "/deck.bento.html"),
      qmd = await Deno.readTextFile(source);
    const original = await executeQuarto(source, dir + "/probe-build");
    for (const variant of ["caption", "uri", "remove", "duplicate"]) {
      const ast = structuredClone(original),
        figure = ast.blocks[1],
        children =
          (figure.c as [unknown, import("../src/render/types.ts").Node[]])[1];
      if (variant === "caption") {
        (children[2].c as import("../src/render/types.ts").Node[])[1] = {
          t: "Str",
          c: "Foreign caption",
        };
      }
      if (variant === "uri") {
        (((children[1].c as import("../src/render/types.ts").Node[])[0]
          .c as unknown[])[2] as string[])[0] = "other.svg";
      }
      if (variant === "remove") ast.blocks.splice(1, 1);
      if (variant === "duplicate") ast.blocks.push(structuredClone(figure));
      await rejects(
        () =>
          renderProjectFromAst(source, {
            ast,
            sourceHash: scanSource(qmd).hash,
            assetDirectories: [dir + "/probe-build", dir],
          }),
        "UNMAPPED_AUTHORED_IMAGE",
      );
      eq(await Deno.readTextFile(dir + "/.qbento/state.json"), bytes);
      eq(await Deno.readTextFile(dir + "/deck.bento.html"), html);
      eq(await Deno.readTextFile(source), qmd);
    }
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
Deno.test("unsafe, missing and escaped local image assets refuse before R and preserve publication", async () => {
  const dir = await Deno.makeTempDir({ prefix: "qbento-image-input-" }),
    outside = await Deno.makeTempDir({ prefix: "qbento-image-outside-" }),
    source = dir + "/deck.qmd";
  const qmd =
    '## One {#one}\n\n![Input](plot.svg)\n\n```{r}\n#| label: counter\n#| include: false\ncat("run\\n",file="counter.txt",append=TRUE)\n```\n';
  try {
    await Deno.writeTextFile(source, qmd);
    await Deno.writeTextFile(dir + "/plot.svg", svg("#156f65"));
    await renderProject(source);
    const bytes = await Deno.readTextFile(dir + "/.qbento/state.json"),
      html = await Deno.readTextFile(dir + "/deck.bento.html");
    const variants = [
      ["https://example.org/foreign.svg", "EXTERNAL_ASSET"],
      ["missing.svg", "MISSING_ASSET"],
      ["%2E%2E/escape.svg", "MISSING_ASSET"],
      ["plot.svg#view", "UNSUPPORTED_AUTHORED_IMAGE"],
      ["symlink.svg", "MISSING_ASSET"],
    ] as const;
    await Deno.writeTextFile(outside + "/escape.svg", svg("#ff0000"));
    await Deno.symlink(outside + "/escape.svg", dir + "/symlink.svg");
    for (const [target, code] of variants) {
      const changed = qmd.replace("](plot.svg)", "](" + target + ")");
      await Deno.writeTextFile(source, changed);
      await rejects(() => renderProject(source), code);
      eq(await Deno.readTextFile(source), changed);
      eq(await Deno.readTextFile(dir + "/counter.txt"), "run\n");
      eq(await Deno.readTextFile(dir + "/.qbento/state.json"), bytes);
      eq(await Deno.readTextFile(dir + "/deck.bento.html"), html);
    }
    await Deno.writeTextFile(source, qmd);
    await Deno.writeTextFile(
      dir + "/plot.svg",
      '<svg xmlns="http://www.w3.org/2000/svg"><image href="foreign.svg"/></svg>',
    );
    await rejects(() => renderProject(source), "UNSAFE_SVG");
    eq(await Deno.readTextFile(dir + "/counter.txt"), "run\n");
    eq(await Deno.readTextFile(dir + "/.qbento/state.json"), bytes);
    eq(await Deno.readTextFile(dir + "/deck.bento.html"), html);
  } finally {
    await Deno.remove(dir, { recursive: true });
    await Deno.remove(outside, { recursive: true });
  }
});
Deno.test("CLI and ordinary refuse an authored source asset changed during execution", async () => {
  for (const ordinary of [false, true]) {
    const dir = await Deno.makeTempDir({
        prefix: "qbento-image-runtime-input-",
      }),
      source = dir + "/deck.qmd";
    try {
      const qmd =
        "## One {#one}\n\n![Input](plot.svg)\n\n```{r}\n#| label: change-asset\n#| include: false\ncat('" +
        svg("#ff0000") +
        '\',file="plot.svg")\ncat("run\\n",file="counter.txt",append=TRUE)\n```\n';
      await Deno.writeTextFile(source, qmd);
      await Deno.writeTextFile(dir + "/plot.svg", svg("#156f65"));
      if (ordinary) {
        await installQuartoProject(source);
        const result = await new Deno.Command("quarto", {
          cwd: dir,
          args: ["render", "deck.qmd", "--quiet"],
          stdout: "piped",
          stderr: "piped",
        }).output();
        ok(
          !result.success &&
            new TextDecoder().decode(result.stderr).includes(
              "AUTHORED_IMAGE_ASSET_CHANGED",
            ),
          new TextDecoder().decode(result.stderr),
        );
      } else {await rejects(() =>
          renderProject(source), "AUTHORED_IMAGE_ASSET_CHANGED");}
      eq(await Deno.readTextFile(source), qmd);
      eq(await Deno.readTextFile(dir + "/counter.txt"), "run\n");
      let published = false;
      try {
        await Deno.stat(dir + "/deck.bento.html");
        published = true;
      } catch {
        // Outside fixture cleanup is best-effort after a refusal.
      }
      ok(!published, "Changed asset was published");
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  }
});

import { withHeadlessChromium } from "../src/browser/chromium.ts";
import { spliceDocument } from "../src/render/html.ts";
import {
  ISOLATION_BOOTSTRAP,
  OFFLINE_CSP,
  prepareIsolatedDocument,
} from "../src/bridge/isolation.ts";
import type { BentoDoc } from "../src/render/types.ts";
import type { BentoDoc as StateDoc } from "../src/state/types.ts";
async function nativeImage(doc: StateDoc, name: string) {
  const image = doc.slides[0].elements.find((e) => e.type === "image")!;
  const caption =
    doc.slides[0].elements.find((e) => e.id === image.id + "-caption") ??
      doc.slides[0].elements.find((e) =>
        e.type === "text" && e.groupId === image.groupId
      )!;
  const shell = await Deno.readTextFile(
    new URL("../vendor/bento/shell.html", import.meta.url),
  );
  const html = spliceDocument(
    shell,
    prepareIsolatedDocument(doc) as unknown as BentoDoc,
    ISOLATION_BOOTSTRAP,
    OFFLINE_CSP,
  );
  return await withHeadlessChromium({}, async (browser) => {
    await browser.send("Emulation.setDeviceMetricsOverride", {
      width: 1440,
      height: 1000,
      deviceScaleFactor: 1,
      mobile: false,
    });
    const tree = await browser.send<{ frameTree: { frame: { id: string } } }>(
      "Page.getFrameTree",
    );
    await browser.send("Page.setDocumentContent", {
      frameId: tree.frameTree.frame.id,
      html,
    });
    const result = await browser.send<
      {
        result: {
          value: {
            width: number;
            height: number;
            src: string;
            fit: string;
            text: string;
            rich: boolean;
            glyphFits: boolean;
          };
        };
        exceptionDetails?: unknown;
      }
    >("Runtime.evaluate", {
      expression: `(async()=>{const id=${JSON.stringify(image.id)},cid=${
        JSON.stringify(caption.id)
      }; const root=id=>document.querySelector('[data-el-id="'+id+'"]');for(let n=0;n<200&&(!root(id)?.querySelector('img')||!root(cid));n++)await new Promise(r=>setTimeout(r,25));await document.fonts.ready;for(let n=0;n<200&&document.getElementById('bento-splash');n++)await new Promise(r=>setTimeout(r,25));if(document.getElementById('bento-splash'))throw new Error('splash');const img=root(id).querySelector('img'),cap=root(cid);await img.decode();const text=cap.querySelector('[contenteditable]')||cap;const range=document.createRange();range.selectNodeContents(text);const bounds=cap.getBoundingClientRect();return {width:img.naturalWidth,height:img.naturalHeight,src:img.src,fit:getComputedStyle(img).objectFit,text:text.textContent,rich:!!text.querySelector('b,strong')&&!!text.querySelector('code'),glyphFits:[...range.getClientRects()].every(r=>r.left>=bounds.left-1&&r.right<=bounds.right+1&&r.top>=bounds.top-1&&r.bottom<=bounds.bottom+1)};})()`,
      awaitPromise: true,
      returnByValue: true,
    });
    ok(!result.exceptionDetails, JSON.stringify(result.exceptionDetails));
    const metrics = result.result.value;
    eq([metrics.width, metrics.height], [120, 60]);
    eq(metrics.src, image.src);
    eq(metrics.fit, "contain");
    eq(metrics.text, caption.html === "" ? "" : "Reviewed β and evidence");
    if (caption.html) {
      ok(metrics.rich && metrics.glyphFits, JSON.stringify(metrics));
    }
    const evidence = Deno.env.get("QBENTO_PLAIN_IMAGES_EVIDENCE");
    if (evidence) {
      await Deno.mkdir(evidence, { recursive: true });
      await Deno.writeTextFile(
        evidence + "/" + name + ".json",
        JSON.stringify({ browser: browser.version, metrics }, null, 2),
      );
      const shot = await browser.send<{ data: string }>(
        "Page.captureScreenshot",
        { format: "png" },
      );
      await Deno.writeFile(
        evidence + "/" + name + ".png",
        Uint8Array.from(atob(shot.data), (c) => c.charCodeAt(0)),
      );
    }
    return metrics;
  });
}
Deno.test("pinned native Bento displays the original local image, rich caption and empty caption without a semantic placeholder", async () => {
  const dir = await Deno.makeTempDir({ prefix: "qbento-image-native-" }),
    source = dir + "/deck.qmd";
  try {
    await Deno.writeTextFile(
      source,
      "## Images {#images}\n\n![Reviewed **β** and `evidence`](plot.svg)\n",
    );
    await Deno.writeTextFile(dir + "/plot.svg", svg("#156f65"));
    let state = (await renderProject(source)).state;
    await nativeImage(state.emitted, "rich-caption");
    const edit = structuredClone(state.emitted);
    edit.slides[0].elements.find((e) => e.id.endsWith("-caption"))!.html = "";
    await saveProject(source, edit, state.revision);
    await applySync(source, await previewSync(source));
    state = (await renderProject(source)).state;
    await nativeImage(state.emitted, "empty-caption");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
