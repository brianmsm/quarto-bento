/** Pinned Bento shape checks, without coercion, mutation or network access. */
import schemaJson from "../../vendor/bento/slides.schema.json" with {
  type: "json",
};
import { assertJson } from "../state/json.ts";

type RecordValue = Record<string, unknown>;
interface Schema {
  $ref?: string;
  $defs?: Record<string, Schema>;
  type?: string;
  const?: unknown;
  enum?: unknown[];
  required?: string[];
  properties?: Record<string, Schema>;
  additionalProperties?: boolean | Schema;
  items?: Schema;
  anyOf?: Schema[];
  oneOf?: Schema[];
  minimum?: number;
  maximum?: number;
  maxLength?: number;
  pattern?: string;
  minItems?: number;
  maxItems?: number;
  maxProperties?: number;
}
const schema = schemaJson as Schema;
export const BENTO_CONTRACT_REVISION =
  "3d6f7f1fcdf2308e875345ce4f1e0ec0820c914b";
export interface ContractFinding {
  path: string;
  message: string;
}
export class BentoContractError extends Error {
  readonly code = "BENTO_CONTRACT";
  constructor(readonly details: ContractFinding[]) {
    super(details.map((f) => `${f.path || "/"}: ${f.message}`).join("; "));
    this.name = "BentoContractError";
  }
}
const isObject = (value: unknown): value is RecordValue =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const pointer = (parent: string, key: string | number) =>
  parent + "/" + String(key).replaceAll("~", "~0").replaceAll("/", "~1");
function reject(path: string, message: string): never {
  throw new BentoContractError([{ path, message }]);
}

/** Implements only the keywords present in the checked-in upstream schema. */
function check(value: unknown, rule: Schema, path: string) {
  if (rule.$ref) {
    if (!rule.$ref.startsWith("#/$defs/")) {
      reject(path, "Unsupported schema reference");
    }
    const referenced = schema.$defs?.[rule.$ref.slice(8)];
    if (!referenced) reject(path, "Missing pinned schema definition");
    check(value, referenced, path);
  }
  for (
    const [mode, alternatives] of [["anyOf", rule.anyOf], [
      "oneOf",
      rule.oneOf,
    ]] as const
  ) {
    if (!alternatives) continue;
    let successes = 0;
    for (const candidate of alternatives) {
      try {
        check(value, candidate, path);
        successes++;
      } catch (error) {
        if (!(error instanceof BentoContractError)) throw error;
      }
    }
    if (!successes || (mode === "oneOf" && successes !== 1)) {
      // Element union: report the matching type's property instead of nine alternatives.
      if (isObject(value) && typeof value.type === "string" && rule.oneOf) {
        const selected = schema.$defs?.[value.type];
        if (
          selected &&
          alternatives.some((r) => r.$ref === `#/$defs/${value.type}`)
        ) {
          check(value, selected, path);
        }
      }
      reject(path, `Value does not match ${mode} in the pinned Bento schema`);
    }
  }
  if (Object.hasOwn(rule, "const") && value !== rule.const) {
    reject(path, `Expected ${JSON.stringify(rule.const)}`);
  }
  if (rule.enum && !rule.enum.includes(value)) {
    reject(path, "Unsupported enum value");
  }
  if (rule.type) {
    const matches = rule.type === "object"
      ? isObject(value)
      : rule.type === "array"
      ? Array.isArray(value)
      : rule.type === "integer"
      ? typeof value === "number" && Number.isInteger(value)
      : rule.type === "string"
      ? typeof value === "string"
      : rule.type === "number"
      ? typeof value === "number"
      : rule.type === "boolean"
      ? typeof value === "boolean"
      : false;
    if (!matches) {
      reject(path, `Expected ${rule.type}; values are never coerced`);
    }
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) reject(path, "Expected a finite number");
    if (rule.minimum !== undefined && value < rule.minimum) {
      reject(path, `Below minimum ${rule.minimum}`);
    }
    if (rule.maximum !== undefined && value > rule.maximum) {
      reject(path, `Above maximum ${rule.maximum}`);
    }
  }
  if (typeof value === "string") {
    // The pinned gate uses JS length, not Unicode scalar count.
    if (rule.maxLength !== undefined && value.length > rule.maxLength) {
      reject(path, `Exceeds ${rule.maxLength} characters`);
    }
    if (rule.pattern && !new RegExp(rule.pattern).test(value)) {
      reject(path, "Does not match the pinned property pattern");
    }
  }
  if (Array.isArray(value)) {
    if (rule.minItems !== undefined && value.length < rule.minItems) {
      reject(path, "Too few items");
    }
    if (rule.maxItems !== undefined && value.length > rule.maxItems) {
      reject(path, "Too many items");
    }
    if (rule.items) {
      value.forEach((item, i) => check(item, rule.items!, pointer(path, i)));
    }
  }
  if (isObject(value)) {
    if (
      rule.maxProperties !== undefined &&
      Object.keys(value).length > rule.maxProperties
    ) reject(path, "Too many properties");
    for (const key of rule.required ?? []) {
      if (!Object.hasOwn(value, key)) {
        reject(pointer(path, key), "Required property missing");
      }
    }
    for (const [key, child] of Object.entries(value)) {
      const property = rule.properties?.[key];
      if (property) check(child, property, pointer(path, key));
      else if (rule.additionalProperties === false) {
        reject(pointer(path, key), "Unknown property at the pinned revision");
      } else if (isObject(rule.additionalProperties)) {
        check(child, rule.additionalProperties as Schema, pointer(path, key));
      }
    }
  }
}

const cssBreakout = /["'<>{};]/;
const colorCharacters = /^[#a-zA-Z0-9(),.%\s/-]+$/;
const colorTricks = /url\s*\(|expression|@|\\/i;
const localPaint = /^url\(\s*(?:"#[\w.:-]+"|'#[\w.:-]+'|#[\w.:-]+)\s*\)$/;
const pathData = /^[MmLlHhVvCcSsQqTtAaZz0-9\s,.+\-eE]*$/;
const webUrl = /^https?:\/\/[^\s\x22\x27<>]+$/i;
const slots = new Set([
  "bg1",
  "tx1",
  "bg2",
  "tx2",
  "accent1",
  "accent2",
  "accent3",
  "accent4",
  "accent5",
  "accent6",
  "hlink",
  "folHlink",
]);
function css(value: unknown, path: string) {
  if (typeof value !== "string" || cssBreakout.test(value)) {
    reject(path, "Bento would drop this CSS/identity value");
  }
}
function color(value: unknown, path: string, paint = false, empty = false) {
  if (typeof value !== "string") reject(path, "Expected a colour string");
  const trimmed = value.trim();
  if (empty && value === "") return;
  if (paint && localPaint.test(trimmed)) return;
  if (!trimmed || !colorCharacters.test(trimmed) || colorTricks.test(trimmed)) {
    reject(path, "Bento would drop or clear this colour/paint");
  }
}
function boundedData(value: unknown, path: string) {
  let nodes = 20_000;
  const visit = (item: unknown, at: string, depth: number) => {
    if (--nodes < 0 || depth < 0) {
      reject(at, "Bento would drop this data object (20,000 nodes / depth 12)");
    }
    if (typeof item === "string" && item.length > 65_536) {
      reject(at, "Bento would drop this data object (string exceeds 64 KiB)");
    }
    if (Array.isArray(item)) {
      item.forEach((child, i) => visit(child, pointer(at, i), depth - 1));
    } else if (isObject(item)) {
      for (const [key, child] of Object.entries(item)) {
        if (key.length > 200) {
          reject(pointer(at, key), "Data key exceeds 200 characters");
        }
        visit(child, pointer(at, key), depth - 1);
      }
    }
  };
  visit(value, path, 12);
}
/** Descriptive schema fields omit a few checks implemented by untrusted.ts. */
function supplementary(value: unknown, rule: Schema, path: string) {
  if (rule.$ref) {
    const reference = schema.$defs![rule.$ref.slice(8)];
    if (rule.$ref === "#/$defs/prop-option") boundedData(value, path);
    if (rule.$ref === "#/$defs/prop-doc") {
      if (typeof value === "string") css(value, path);
      else if (isObject(value)) {
        boundedData(value, path);
        for (const field of ["collab", "docId"]) {
          if (Object.hasOwn(value, field)) {
            reject(
              pointer(path, field),
              "Bento strips embedded document identity/credentials; resolve explicitly",
            );
          }
        }
      }
    }
    if (rule.$ref === "#/$defs/prop-themeRefs" && isObject(value)) {
      if (!Object.keys(value).length) {
        reject(path, "Bento drops an empty themeRefs map");
      }
      for (const [key, token] of Object.entries(value)) {
        const segments = key.split(".");
        const match = typeof token === "string"
          ? /^\s*([A-Za-z][A-Za-z0-9]*)\s*(?:([+-])\s*(\d{1,3})\s*%)?\s*$/.exec(
            token,
          )
          : null;
        if (
          key.length > 200 || !segments.every((s) =>
            /^[A-Za-z_$][A-Za-z0-9_$]*$|^\d+$/.test(s)
          ) || segments.some((s) =>
            ["__proto__", "constructor", "prototype"].includes(s)
          ) || typeof token !== "string" || token.length > 200 || !match ||
          !slots.has(match[1])
        ) reject(pointer(path, key), "Bento would drop this palette reference");
      }
    }
    supplementary(value, reference, path);
    return;
  }
  if (rule.oneOf || rule.anyOf) {
    for (const candidate of rule.oneOf ?? rule.anyOf!) {
      try {
        check(value, candidate, path);
      } catch (error) {
        if (error instanceof BentoContractError) continue;
        throw error;
      }
      supplementary(value, candidate, path);
      break;
    }
  }
  // These descriptions are pinned schema metadata, not caller-supplied hints.
  const description = (rule as Schema & { description?: string }).description ??
    "";
  if (description === "CSS colour or url(#local-id)") color(value, path, true);
  if (description === "CSS colour; no url()") color(value, path);
  if (
    description === "SVG path data" &&
    (typeof value !== "string" || !pathData.test(value))
  ) reject(path, "Bento would drop invalid SVG path data");
  if (
    description === "data: URI, asset:<key> or URL" && typeof value === "string"
  ) {
    if (/^[a-z][a-z0-9+.-]*:/i.test(value)) {
      if (!/^(?:data|asset|blob|https?):/i.test(value)) {
        reject(path, "Bento would drop this resource scheme");
      }
    } else css(value, path);
  }
  if (
    description === "slide id or http(s) URL" && typeof value === "string" &&
    !(value.length <= 2048 && webUrl.test(value))
  ) css(value, path);
  if (Array.isArray(value) && rule.items) {
    value.forEach((child, i) =>
      supplementary(child, rule.items!, pointer(path, i))
    );
  }
  if (isObject(value)) {
    for (const [key, child] of Object.entries(value)) {
      const property = rule.properties?.[key];
      if (property) supplementary(child, property, pointer(path, key));
      else if (isObject(rule.additionalProperties)) {
        supplementary(
          child,
          rule.additionalProperties as Schema,
          pointer(path, key),
        );
      }
    }
  }
}

/** Validate before saving/capturing/importing. Never repairs or discards a field. */
export function assertBentoContract(doc: unknown): void {
  try {
    assertJson(doc);
  } catch (error) {
    reject("", `Expected safe finite plain JSON: ${(error as Error).message}`);
  }
  check(doc, schema, "");
  const object = doc as RecordValue;
  if (object.version !== 1) {
    reject(
      "/version",
      "Only Bento format version 1 is supported by this pinned shell",
    );
  }
  if (typeof object.docId !== "string" || !object.docId) {
    reject("/docId", "A project requires a stable nonempty document identity");
  }
  supplementary(doc, schema, "");
  for (const collection of ["slides", "layouts"]) {
    if (!Array.isArray(object[collection])) continue;
    const seenSlides = new Set();
    (object[collection] as RecordValue[]).forEach((slide, i) => {
      const at = `/${collection}/${i}`;
      if (!slide.id || seenSlides.has(slide.id)) {
        reject(at + "/id", "Empty or duplicate slide identity");
      }
      seenSlides.add(slide.id);
      if (!Array.isArray(slide.elements)) {
        reject(
          at + "/elements",
          "Project slides require an explicit elements array",
        );
      }
      if (slide.background !== undefined) {
        color(slide.background, at + "/background", false, true);
      }
      const seenElements = new Set();
      slide.elements.forEach((element, j) => {
        const e = element as RecordValue, p = at + `/elements/${j}`;
        if (!e.id || seenElements.has(e.id)) {
          reject(
            p + "/id",
            "Empty or duplicate element identity within a slide",
          );
        }
        seenElements.add(e.id);
        if (
          e.fontFamily !== undefined && /[<>{};]/.test(e.fontFamily as string)
        ) reject(p + "/fontFamily", "Bento would drop this font stack");
        if (
          e.type === "embed" && e.url !== undefined &&
          (!(e.url as string).match(webUrl) || (e.url as string).length > 2048)
        ) reject(p + "/url", "Bento accepts only bounded http(s) web URLs");
        if (
          e.pathBox !== undefined &&
          (e.pathBox as number[]).some((n) => n < -1e6 || n > 1e6)
        ) reject(p + "/pathBox", "Bento would drop pathBox outside ±1,000,000");
      });
    });
  }
  if (isObject(object.theme) && object.theme.background !== undefined) {
    color(object.theme.background, "/theme/background", false, true);
  }
  if (isObject(object.assets)) {
    for (const key of Object.keys(object.assets)) {
      if (!key || key.length > 200) {
        reject(pointer("/assets", key), "Bento would drop this asset identity");
      }
      css(key, pointer("/assets", key));
    }
  }
  if (Array.isArray(object.fonts)) {
    object.fonts.forEach((font: RecordValue, i: number) => {
      if (!font.asset) {
        reject(
          `/fonts/${i}/asset`,
          "A font requires a nonempty asset reference",
        );
      }
      for (const field of ["asset", "weight", "style"]) {
        if (font[field] !== undefined) {
          css(font[field], `/fonts/${i}/${field}`);
        }
      }
      if (/[<>{};]/.test(font.family as string)) {
        reject(`/fonts/${i}/family`, "Bento would drop this font family");
      }
    });
  }
  if (isObject(object.blobs)) {
    for (const [key, entry] of Object.entries(object.blobs)) {
      const at = pointer("/blobs", key);
      if (
        key.length > 200 || !isObject(entry) || typeof entry.key !== "string" ||
        entry.key.length > 200 || typeof entry.mime !== "string" ||
        entry.mime.length > 100 || typeof entry.size !== "number" ||
        !Number.isFinite(entry.size) || Object.keys(entry).some((k) =>
          !["key", "mime", "size"].includes(k)
        )
      ) {
        reject(at, "Bento would drop or trim this blob reference");
      }
    }
  }
}

/** A saved project must retain its identity when the upstream shell opens it. */
export function assertProjectDocument(doc: unknown): void {
  assertBentoContract(doc);
  const value = doc as RecordValue;
  // A valid upstream reference can still depend on a browser session or the
  // network. Project saves must not report success for resources that disappear
  // on reopen. Outgoing hyperlinks are deliberately not resource references.
  const assets = isObject(value.assets) ? value.assets : {};
  const asset = (key: string, path: string): string => {
    if (!Object.hasOwn(assets, key) || typeof assets[key] !== "string") {
      reject(
        path,
        `Missing embedded asset ${
          JSON.stringify(key)
        }; embed the resource before saving this offline project`,
      );
    }
    return assets[key] as string;
  };
  const embedded = (ref: string, path: string) => {
    if (!ref) return; // An explicit empty native placeholder has no resource.
    const resolved = ref.startsWith("asset:") ? asset(ref.slice(6), path) : ref;
    if (!/^data:/i.test(resolved)) {
      reject(
        path,
        "Project image, media and font resources must be embedded data, not remote URLs, relative paths or temporary blob URLs; import the local file before saving",
      );
    }
  };
  for (const collection of ["slides", "layouts"]) {
    if (!Array.isArray(value[collection])) continue;
    (value[collection] as RecordValue[]).forEach((slide, i) => {
      (slide.elements as RecordValue[]).forEach((element, j) => {
        const at = `/${collection}/${i}/elements/${j}`;
        if (element.type === "image" || element.type === "media") {
          if (typeof element.src === "string") {
            embedded(element.src, at + "/src");
          }
          if (typeof element.poster === "string") {
            embedded(element.poster, at + "/poster");
          }
        }
        if (element.type === "svg" && element.asset) {
          asset(element.asset as string, at + "/asset");
        }
        if (element.type === "code") {
          for (const key of ["grammarAssetId", "themeAssetId"]) {
            if (element[key]) asset(element[key] as string, at + "/" + key);
          }
        }
        if (element.type === "embed") {
          for (const key of ["view", "doc"]) {
            const ref = element[key];
            if (typeof ref === "string" && ref.startsWith("asset:")) {
              asset(ref.slice(6), at + "/" + key);
            }
          }
        }
      });
    });
  }
  if (Array.isArray(value.fonts)) {
    (value.fonts as RecordValue[]).forEach((font, i) => {
      const at = `/fonts/${i}/asset`;
      // Exact keys from fonts.ts at BENTO_CONTRACT_REVISION. The shell ships
      // these bytes, and native serialization adopts the built-in references.
      // An explicit asset table entry takes precedence in the upstream resolver.
      if (
        !Object.hasOwn(assets, font.asset as string) &&
        ["builtin:fraunces-900", "builtin:instrument-sans"].includes(
          font.asset as string,
        )
      ) return;
      embedded("asset:" + font.asset, at);
    });
  }
  if (value.template === true) {
    reject(
      "/template",
      "Instantiate a template as an independent project before saving; native template loading creates a new document identity",
    );
  }
  if (value.collab !== undefined) {
    const c = value.collab;
    if (
      !isObject(c) || c.room !== "" || c.key !== "" || c.on !== false ||
      Object.keys(c).sort().join(",") !== "key,on,room"
    ) {
      reject(
        "/collab",
        "Project editing requires the explicit credential-free disabled collaboration sentinel",
      );
    }
  }
}
