import { withHeadlessChromium } from "../src/browser/chromium.ts";
import {
  ISOLATION_BOOTSTRAP,
  OFFLINE_CSP,
  prepareIsolatedDocument,
} from "../src/bridge/isolation.ts";
import { designTheme } from "../src/render/design.ts";
import { extractDocument, spliceDocument } from "../src/render/html.ts";
import {
  loadBentoShell,
  SHELL_NOTICES_ID,
  type ShellNotices,
} from "../src/render/shell.ts";
import { createDeckPresenter } from "../src/widgets/deck.ts";
import type { BentoDoc } from "../src/render/types.ts";
import type { BentoDoc as StateDoc } from "../src/state/types.ts";

function assert(value: unknown, message = "assertion failed"): asserts value {
  if (!value) throw new Error(message);
}
function readNotices(html: string): ShellNotices {
  const matches = [...html.matchAll(
    /<script\b[^>]*\bid="qbento-third-party-notices"[^>]*>([\s\S]*?)<\/script>/g,
  )];
  assert(matches.length === 1, "expected exactly one supplied notice block");
  return JSON.parse(matches[0][1]);
}
function fixture(): BentoDoc {
  return prepareIsolatedDocument({
    format: "bento/slides",
    version: 1,
    docId: "qbento-standalone-notices",
    title: "Standalone notice preservation",
    size: { width: 1280, height: 720 },
    theme: designTheme(),
    fonts: [{ family: "Fraunces", asset: "builtin:fraunces-900" }],
    slides: [{
      id: "slide",
      background: "#ffffff",
      transition: "fade",
      notes: "",
      elements: [{
        id: "text",
        type: "text",
        x: 80,
        y: 80,
        w: 600,
        h: 100,
        html: "A font-bearing standalone copy",
        fontFamily: "Fraunces",
        fontSize: 24,
      }],
    }],
  });
}

Deno.test("standalone and isolated Presenter carry exact supplied notices outside BentoDoc", async () => {
  const original = await Deno.readTextFile(
    new URL("../vendor/bento/shell.html", import.meta.url),
  );
  assert(
    !original.includes(SHELL_NOTICES_ID),
    "vendored shell stays unchanged",
  );
  const shell = await loadBentoShell();
  const notices = readNotices(shell);
  assert(notices.schemaVersion === 1 && notices.files.length === 6);
  for (const file of notices.files) {
    const supplied = await Deno.readTextFile(
      new URL(`../vendor/bento/${file.path}`, import.meta.url),
    );
    assert(file.text === supplied, `full text differs: ${file.path}`);
  }
  const production = JSON.parse(
    notices.files.find((file) => file.path === "runtime-licenses.json")!.text,
  );
  assert(production.packages.length === 25);
  assert(
    JSON.stringify(production.missingFullLicenseTexts) ===
      JSON.stringify(["@cfcs/core", "croact", "croact-css-styled", "keycon"]),
  );
  const keycode = production.packages.find((row: { name: string }) =>
    row.name === "keycode"
  );
  assert(
    keycode.texts.some((file: { text: string }) =>
      file.text.includes("Copyright (c) 2014 Tim Oxley")
    ),
  );
  const agent = production.packages.find((row: { name: string }) =>
    row.name === "@egjs/agent"
  );
  assert(
    agent.texts.some((file: { text: string }) =>
      file.text.includes("NAVER Corp.")
    ),
  );
  assert(
    agent.texts.some((file: { sources: { archivePath: string }[] }) =>
      file.sources.some((source) => source.archivePath === "package/NOTICE")
    ),
  );
  const doc = fixture();
  const standalone = spliceDocument(
    shell,
    doc,
    ISOLATION_BOOTSTRAP,
    OFFLINE_CSP,
  );
  assert(JSON.stringify(extractDocument(standalone)) === JSON.stringify(doc));
  const noticeStart = original.indexOf("<!--\n      NOTICE");
  const noticeEnd = original.indexOf("    -->", noticeStart);
  assert(noticeStart >= 0 && noticeEnd > noticeStart);
  assert(standalone.includes(original.slice(noticeStart, noticeEnd)));
  const presenter = await createDeckPresenter(doc as unknown as StateDoc, []);
  const payload = presenter.match(
    /<script id="qb-presenter-data" type="application\/json">([\s\S]*?)<\/script>/,
  );
  assert(payload);
  const deck = JSON.parse(payload[1]).deck;
  assert(JSON.stringify(readNotices(deck)) === JSON.stringify(notices));
});

Deno.test({
  name:
    "native Bento serialization and reopen retain full notices with unchanged deck content",
  ignore: Deno.env.get("QBENTO_STUDIO_BROWSER_TEST") !== "1",
  fn: async () => {
    const doc = fixture();
    const html = spliceDocument(
      await loadBentoShell(),
      doc,
      ISOLATION_BOOTSTRAP,
      OFFLINE_CSP,
    );
    const expected = readNotices(html);
    let current = html;
    let firstSavedDocument: BentoDoc | undefined;
    // Each cycle gets a fresh browser/profile/realm. setDocumentContent alone
    // could retain an old window.bento API and its earlier pristine clone.
    for (let cycle = 0; cycle < 2; cycle++) {
      await withHeadlessChromium({}, async (browser) => {
        const tree = await browser.send<
          { frameTree: { frame: { id: string } } }
        >(
          "Page.getFrameTree",
        );
        await browser.send("Page.setDocumentContent", {
          frameId: tree.frameTree.frame.id,
          html: current,
        });
        const response = await browser.send<{
          result: { value?: string };
          exceptionDetails?: unknown;
        }>("Runtime.evaluate", {
          expression: `(async () => {
            for(let i=0;i<200&&!window.bento?.serialize;i++) await new Promise(r=>setTimeout(r,25));
            if(!window.bento?.serialize) throw new Error('native runtime unavailable');
            return window.bento.serialize();
          })()`,
          awaitPromise: true,
          returnByValue: true,
        });
        assert(!response.exceptionDetails, JSON.stringify(response));
        assert(typeof response.result.value === "string");
        current = response.result.value;
        assert(
          JSON.stringify(readNotices(current)) === JSON.stringify(expected),
        );
        const saved = extractDocument(current);
        assert(saved.docId === doc.docId);
        assert(JSON.stringify(saved.slides) === JSON.stringify(doc.slides));
        const fonts =
          (saved as unknown as { fonts: { asset: string }[] }).fonts;
        assert(fonts?.[0].asset === "builtin:fraunces-900");
        assert(!JSON.stringify(saved).includes(SHELL_NOTICES_ID));
        if (firstSavedDocument) {
          assert(JSON.stringify(saved) === JSON.stringify(firstSavedDocument));
        } else firstSavedDocument = saved;
      });
    }
  },
});
