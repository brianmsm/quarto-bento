import { missingDesignDiagnostics } from "../src/core/design-diagnostics.ts";
import {
  previewAnnotations,
  readDesignAnnotations,
} from "../src/source/annotations.ts";
import { scanSource } from "../src/source/mod.ts";
import { canonical, createState } from "../src/state/mod.ts";

function eq(a: unknown, b: unknown) {
  if (canonical(a) !== canonical(b)) {
    throw new Error(`${canonical(a)} != ${canonical(b)}`);
  }
}
const registry = { defaults: {}, hash: null };
const basic =
  "## Título β 😀 {#result .original .qbento-design}\r\n\r\n::: {#body}\r\nTexto.\r\n:::\r\n";
function state() {
  return createState({
    docId: "test-doc",
    slides: [{
      id: "result",
      elements: [{ id: "body", type: "text", html: "Texto." }],
    }],
  }, {});
}
function detailed(
  features = ["overrides"],
  references = [".qbento/state.json"],
) {
  return basic.replace(
    "}\r\n",
    `}\r\n<!-- qbento-design: ${
      JSON.stringify({
        version: 1,
        slideId: "result",
        features,
        references,
      })
    } -->\r\n`,
  );
}
Deno.test("missing minimal design remains visible after an empty baseline and preserves original CRLF bytes", () => {
  const doc = scanSource(basic), fresh = state();
  const first = missingDesignDiagnostics(doc, null, registry);
  eq(first.map((d) => [d.code, d.slideId, d.reference]), [
    ["MISSING_DESIGN", "result", ".qbento/"],
  ]);
  const snapshot = canonical(fresh);
  eq(missingDesignDiagnostics(doc, fresh, registry), first);
  eq(doc.text, basic);
  eq(canonical(fresh), snapshot);
  if (
    !first[0].message.includes("Git or backup") ||
    !first[0].message.includes("not proof")
  ) {
    throw new Error("Warning must explain recovery and historical uncertainty");
  }
});
Deno.test("detailed references warn for absent registry even when state exists and for empty state design", () => {
  const doc = scanSource(detailed(["overrides", "theme"], [
    ".qbento/state.json",
    ".qbento/design.json",
  ]));
  const existing = state();
  eq(
    missingDesignDiagnostics(doc, existing, registry).map((d) => d.reference),
    [
      ".qbento/design.json",
      ".qbento/state.json",
    ],
  );
  existing.overrides.push({
    target: { slideId: "result", elementId: "body" },
    fields: [
      { path: ["x"], value: { present: true, value: 222 } },
    ],
  });
  eq(
    missingDesignDiagnostics(doc, existing, registry).map((d) => d.reference),
    [".qbento/design.json"],
  );
  const restored = {
    hash: "verified",
    defaults: {
      theme: {
        background: "#ffffff",
        color: "#000000",
        accent: "#123456",
        fontFamily: "Arial, sans-serif",
      },
    },
  };
  eq(missingDesignDiagnostics(doc, existing, restored), []);
});
Deno.test("matching external design and explicit trace removal resolve the warning without source ownership", () => {
  const existing = state();
  existing.overrides.push({
    target: { slideId: "result", elementId: "body" },
    fields: [
      { path: ["x"], value: { present: true, value: 222 } },
    ],
  });
  const snapshot = canonical(existing);
  eq(missingDesignDiagnostics(scanSource(basic), existing, registry), []);
  eq(missingDesignDiagnostics(scanSource(detailed()), existing, registry), []);
  eq(
    missingDesignDiagnostics(
      scanSource(basic.replace(" .qbento-design", "")),
      state(),
      registry,
    ),
    [],
  );
  eq(canonical(existing), snapshot);
  eq(existing.ownership, {});
});
Deno.test("a validated registry theme can satisfy a minimal trace but cannot satisfy a detailed state reference", () => {
  const active = {
    hash: "verified",
    defaults: {
      theme: {
        background: "#ffffff",
        color: "#000000",
        accent: "#123456",
        fontFamily: "Arial, sans-serif",
      },
    },
  };
  eq(missingDesignDiagnostics(scanSource(basic), null, active), []);
  eq(
    missingDesignDiagnostics(scanSource(detailed()), null, active).map((d) =>
      d.reference
    ),
    [".qbento/state.json"],
  );
  eq(
    missingDesignDiagnostics(
      scanSource(detailed(["theme"], [".qbento/design.json"])),
      null,
      active,
    ),
    [],
  );
});
Deno.test("literal YAML code chunks math and quoted attribute values are not managed design traces", () => {
  const comment = "<!-- qbento-design: broken -->";
  const text =
    `---\r\ntitle: |\r\n  ${comment}\r\n---\r\n\r\n## T {#result data-note="a\\b .qbento-design"}\r\n\r\n\`\`\`text\r\n## Literal {#literal .qbento-design}\r\n${comment}\r\n\`\`\`\r\n\r\n\`\`\`{r}\r\n${comment}\r\n\`\`\`\r\n\r\n$$\r\n${comment}\r\n$$\r\n\r\n<!-- ordinary note: .qbento-design -->\r\n`;
  const doc = scanSource(text);
  eq(readDesignAnnotations(doc), []);
  eq(missingDesignDiagnostics(doc, null, registry), []);
  eq(doc.text, text);
});
Deno.test("malformed reserved traces produce a conservative warning while valid unmarked detailed comments are read", () => {
  const broken = "## T {#result}\n<!-- qbento-design: broken -->\n";
  eq(
    missingDesignDiagnostics(scanSource(broken), null, registry).map((d) =>
      d.code
    ),
    ["UNVERIFIABLE_DESIGN_ANNOTATION"],
  );
  eq(
    readDesignAnnotations(
      scanSource(detailed().replace(" .qbento-design", "")),
    ),
    [{
      slideId: "result",
      features: ["overrides"],
      references: [".qbento/state.json"],
    }],
  );
  eq(broken, "## T {#result}\n<!-- qbento-design: broken -->\n");
});

Deno.test("indented standalone reference text stays literal while 0–3 spaces preserve managed comments", () => {
  const comment =
    '<!-- qbento-design: {"version":1,"slideId":"result","features":["overrides"],"references":[".qbento/state.json"]} -->';
  for (const indent of ["    ", "\t", "  \t"]) {
    const text = `## T {#result}\r\n\r\n${indent}${comment}\r\n`;
    eq(readDesignAnnotations(scanSource(text)), []);
    eq(missingDesignDiagnostics(scanSource(text), null, registry), []);
    eq(previewAnnotations(scanSource(text), "none", []).result, text);
  }
  for (const indent of ["", " ", "  ", "   "]) {
    const text = `## T {#result}\r\n${indent}${comment}\r\n`;
    eq(readDesignAnnotations(scanSource(text)).map((t) => t.slideId), [
      "result",
    ]);
    eq(
      missingDesignDiagnostics(scanSource(text), null, registry).map((d) =>
        d.code
      ),
      ["MISSING_DESIGN"],
    );
  }
});

Deno.test("detailed traces require every declared category rather than any category within a sidecar", () => {
  const existing = state();
  existing.overrides.push({
    target: { slideId: "result", elementId: "body" },
    fields: [
      { path: ["x"], value: { present: true, value: 222 } },
    ],
  });
  const doc = scanSource(detailed(["overrides", "decorations"]));
  const warnings = missingDesignDiagnostics(doc, existing, registry);
  eq(warnings.map((d) => d.reference), [".qbento/state.json"]);
  if (!warnings[0].message.includes("(decorations)")) {
    throw new Error("Missing category not identified");
  }
  existing.bentoOnly.push({
    slideId: "result",
    element: { id: "shape", type: "shape" },
  });
  eq(missingDesignDiagnostics(doc, existing, registry), []);
  const active = {
    hash: "verified",
    defaults: {
      theme: {
        background: "#ffffff",
        color: "#000000",
        accent: "#123456",
        fontFamily: "Arial, sans-serif",
      },
    },
  };
  const themed = scanSource(
    detailed(["theme", "layout"], [".qbento/design.json"]),
  );
  const missingLayout = missingDesignDiagnostics(themed, existing, active);
  eq(missingLayout.map((d) => d.reference), [".qbento/design.json"]);
  if (!missingLayout[0].message.includes("(layout)")) {
    throw new Error("Missing layout not identified");
  }
});

Deno.test("created-design traces accept retained creation effects but an empty source-only baseline keeps warning", () => {
  const doc = scanSource(detailed(["created-design"]));
  eq(missingDesignDiagnostics(doc, state(), registry).map((d) => d.code), [
    "MISSING_DESIGN",
  ]);
  const promoted = state();
  promoted.overrides.push({
    target: { slideId: "result", elementId: "body" },
    fields: [
      { path: ["x"], value: { present: true, value: 222 } },
    ],
  });
  eq(missingDesignDiagnostics(doc, promoted, registry), []);
  eq(
    missingDesignDiagnostics(
      scanSource(detailed(["created-design", "decorations"])),
      promoted,
      registry,
    ).map((d) => d.reference),
    [".qbento/state.json"],
  );
});
