/** Bounded resource dependency inspection. No DOM, fetch, mutation or SVG repair. */
export class ResourceDependencyError extends Error {}
const maximum = 8 * 1024 * 1024;
// Browser schemes ignore ASCII whitespace/control characters.
// deno-lint-ignore no-control-regex
const controls = /[\u0000-\u0020\u007f]/g;
function fail(reason: string): never {
  throw new ResourceDependencyError(
    `${reason}; embed the resource in the SVG or import a self-contained local snapshot before saving`,
  );
}
function entities(value: string, literalUnknown = false): string {
  const named: Record<string, string> = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
    colon: ":",
    sol: "/",
    bsol: "\\",
    Tab: "\t",
    NewLine: "\n",
    num: "#",
    lpar: "(",
    rpar: ")",
    period: ".",
    comma: ",",
    semi: ";",
    equals: "=",
    percnt: "%",
    plus: "+",
    quest: "?",
    commat: "@",
  };
  return value.replace(
    /&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);?/gi,
    (whole, name: string) => {
      if (name.startsWith("#")) {
        const n = name[1].toLowerCase() === "x"
          ? parseInt(name.slice(2), 16)
          : Number(name.slice(1));
        if (!Number.isSafeInteger(n) || n <= 0 || n > 0x10ffff) {
          fail(
            "Unsupported reference entity",
          );
        }
        return String.fromCodePoint(n);
      }
      if (!Object.hasOwn(named, name)) {
        if (literalUnknown) return whole;
        fail(
          `Unsupported reference entity ${whole}`,
        );
      }
      return named[name];
    },
  );
}
function cssEscapes(value: string): string {
  return value.replace(
    /\\(?:([0-9a-f]{1,6})(?:\r\n|[\t\n\r\f ])?|([\s\S]))/gi,
    (_m, hex: string, char: string) => {
      if (hex) {
        const n = parseInt(hex, 16);
        return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : "\ufffd";
      }
      return /[\n\r\f]/.test(char) ? "" : char;
    },
  );
}
function dataSvg(value: string): string | null {
  if (!/^data:image\/svg\+xml(?:[;,])/i.test(value)) return null;
  const comma = value.indexOf(",");
  if (comma < 0) fail("Malformed embedded SVG data");
  try {
    const header = value.slice(0, comma), payload = value.slice(comma + 1);
    return /;base64$/i.test(header)
      ? new TextDecoder("utf-8", { fatal: true }).decode(
        Uint8Array.from(atob(payload), (c) => c.charCodeAt(0)),
      )
      : decodeURIComponent(payload);
  } catch {
    fail("Malformed embedded SVG data");
  }
}
function reference(value: string, depth: number, navigation = false): void {
  const target = value.trim();
  if (!target || target.startsWith("#")) return;
  const normalized = target.replace(controls, "");
  if (navigation && /^https?:\/\/[^\s<>"']+$/i.test(normalized)) return;
  const svg = dataSvg(normalized);
  if (svg !== null) {
    assertOfflineSvg(svg, depth + 1);
    return;
  }
  if (
    /^data:(?:image\/(?:png|jpe?g|gif|webp|avif|bmp|x-icon)|font\/(?:woff2?|ttf|otf)|application\/(?:font-woff|x-font-ttf|x-font-opentype))(?:;[^,]*)?,/i
      .test(normalized)
  ) return;
  fail("External, transient or unresolved SVG resource reference");
}
/** Inspect CSS resources before the pinned renderer would strip declarations. */
export function assertOfflineSvgCss(css: string, depth = 0): void {
  if (css.length > maximum) fail("SVG CSS exceeds the inspection bound");
  function stringEnd(start: number): number {
    const quote = css[start];
    let i = start + 1;
    for (; i < css.length; i++) {
      if (css[i] === "\\") {
        i++;
        continue;
      }
      if (css[i] === quote) return i;
    }
    fail("Unclosed SVG CSS string");
  }
  function skipTrivia(start: number): number {
    let i = start;
    while (i < css.length) {
      if (/\s/.test(css[i])) {
        i++;
        continue;
      }
      if (css.startsWith("/*", i)) {
        const end = css.indexOf("*/", i + 2);
        if (end < 0) return css.length;
        i = end + 2;
        continue;
      }
      break;
    }
    return i;
  }
  const identifier =
    /^(?:[-\w]|\\(?:[0-9a-f]{1,6}(?:\r\n|[\t\n\r\f ])?|[\s\S]))+/i;
  let i = 0;
  while (i < css.length) {
    i = skipTrivia(i);
    if (i >= css.length) break;
    if (css[i] === '"' || css[i] === "'") {
      i = stringEnd(i) + 1;
      continue;
    }
    const at = css[i] === "@";
    if (at) i++;
    const match = identifier.exec(css.slice(i));
    if (!match) {
      i++;
      continue;
    }
    const name = cssEscapes(match[0]).toLowerCase();
    i += match[0].length;
    if (at && name === "import") fail("SVG CSS imports another stylesheet");
    const open = skipTrivia(i);
    if (css[open] !== "(") continue;
    if (
      [
        "image-set",
        "-webkit-image-set",
        "image",
        "cross-fade",
        "-webkit-cross-fade",
        "paint",
      ].includes(name)
    ) {
      fail(
        "SVG CSS image/resource functions require a self-contained snapshot",
      );
    }
    if (name !== "url") continue;
    const start = skipTrivia(open + 1);
    let end: number;
    if (css[start] === '"' || css[start] === "'") {
      end = stringEnd(start);
      const target = cssEscapes(css.slice(start + 1, end));
      i = skipTrivia(end + 1);
      if (css[i] !== ")") fail("Malformed SVG CSS resource reference");
      reference(target, depth);
    } else {
      end = start;
      while (end < css.length) {
        if (css[end] === "\\") {
          end += 2;
          continue;
        }
        if (css[end] === ")") break;
        end++;
      }
      if (end === css.length) fail("Unclosed SVG CSS resource reference");
      reference(cssEscapes(css.slice(start, end)), depth);
      i = end;
    }
    i++;
  }
}
/** Both inline SVG and asset-backed SVG use the pinned HTML SVG renderer. */
export function assertOfflineSvg(markup: string, depth = 0): void {
  if (markup.length > maximum || depth > 4) {
    fail("SVG exceeds the inspection size/depth bound");
  }
  if (!markup.trim()) return; // Native empty SVG/embed placeholders are retained.
  if (/^\s*data:/i.test(markup)) {
    const decoded = dataSvg(markup.trim());
    if (decoded === null) {
      fail("SVG view requires inline SVG markup, not a resource URL");
    }
    // svg.markup/embed.view are markup, not data URI inputs in pinned render.ts.
    fail("SVG view requires decoded inline SVG markup, not a data URI");
  }
  if (!/<\s*svg(?:\s|\/?>)/i.test(markup)) {
    fail("SVG view requires inline SVG markup");
  }
  // Entity declarations and stylesheet instructions cannot be inspected as data.
  const declarations = markup.replace(
    /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>/g,
    "",
  );
  if (
    /<!\s*ENTITY\b|<!\s*DOCTYPE[^>]*\[|<\?xml-stylesheet\b/i.test(declarations)
  ) {
    fail("SVG external declarations are unsupported");
  }
  const tag =
    /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[^>]*\?>|<\/?([a-z][\w:.-]*)/gi;
  let match: RegExpExecArray | null;
  while ((match = tag.exec(markup))) {
    if (!match[1] || match[0].startsWith("</")) continue;
    const name = match[1].toLowerCase();
    let i = tag.lastIndex;
    for (;;) {
      while (i < markup.length && /\s/.test(markup[i])) i++;
      if (markup[i] === "/" && markup[i + 1] === ">") {
        i += 2;
        break;
      }
      if (markup[i] === ">") {
        i++;
        break;
      }
      const attr = /^[^\s/>=]+/.exec(markup.slice(i));
      if (!attr) fail("Malformed SVG attribute boundary");
      const key = attr[0].toLowerCase();
      i += attr[0].length;
      while (i < markup.length && /\s/.test(markup[i])) i++;
      if (markup[i] !== "=") continue;
      i++;
      while (i < markup.length && /\s/.test(markup[i])) i++;
      const quote = markup[i] === '"' || markup[i] === "'" ? markup[i++] : "";
      const start = i;
      while (
        i < markup.length &&
        (quote ? markup[i] !== quote : !/[\s>]/.test(markup[i]))
      ) i++;
      if (i === markup.length) fail("Unclosed SVG resource attribute");
      const raw = markup.slice(start, i);
      if (quote) i++;
      if (
        ["href", "xlink:href", "src", "poster", "data", "srcset"].includes(key)
      ) {
        reference(
          entities(raw, true),
          depth,
          name === "a" && /href$/.test(key),
        );
      } else if (key === "xml:base" && raw.trim()) {
        fail("SVG base changes resource resolution");
      } else if (
        key === "style" || /(?:url\s*\(|\\|@)/i.test(entities(raw, true))
      ) {
        assertOfflineSvgCss(entities(raw, true), depth);
      }
    }
    if (name === "style") {
      const close = /<\/style\s*>/gi;
      close.lastIndex = i;
      const end = close.exec(markup);
      if (!end) fail("Unclosed SVG stylesheet");
      const css = markup.slice(i, end.index).replace(
        /<!\[CDATA\[([\s\S]*?)\]\]>/g,
        "$1",
      );
      assertOfflineSvgCss(entities(css), depth);
    }
    tag.lastIndex = i;
  }
}
/** Raster image fields can also contain SVG data; inspect those nested bytes. */
export function assertOfflineSvgData(uri: string): void {
  const svg = dataSvg(uri);
  if (svg !== null) assertOfflineSvg(svg, 1);
}
