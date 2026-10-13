/** Offline shell with readable notices retained by native Bento self-save. */
export const SHELL_NOTICES_ID = "qbento-third-party-notices";
export interface ShellNotices {
  schemaVersion: 1;
  scope: "pinned-bento-and-two-embedded-fonts";
  files: { path: string; sha256: string; text: string }[];
}

async function sha256(text: string): Promise<string> {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)),
    ),
    (n) => n.toString(16).padStart(2, "0"),
  ).join("");
}

/** Keep the vendored shell unchanged; add notices before its pristine capture.
 * The inert data block is outside BentoDoc, never a runtime-owned transient.
 * The pinned kernel therefore retains it through native serialization/save.
 * This preserves supplied texts; it does not decide the project's license or
 * certify complete third-party coverage.
 */
export async function loadBentoShell(): Promise<string> {
  const vendor = new URL("../../vendor/bento/", import.meta.url);
  const pin = JSON.parse(
    await Deno.readTextFile(new URL("pin.json", vendor)),
  );
  const readPinned = async (path: string, expected: unknown) => {
    const text = await Deno.readTextFile(new URL(path, vendor));
    const digest = await sha256(text);
    if (typeof expected !== "string" || digest !== expected) {
      throw new Error(
        `BENTO_NOTICE_INTEGRITY: pinned bytes differ for ${path}`,
      );
    }
    return { path, sha256: digest, text };
  };
  const [shell, ...files] = await Promise.all([
    readPinned("shell.html", pin.shellSha256),
    readPinned("LICENSE", pin.upstreamArtifacts?.license?.sha256),
    readPinned(
      "THIRD_PARTY_NOTICES.md",
      pin.upstreamArtifacts?.thirdPartyNotices?.sha256,
    ),
    readPinned("FONT_NOTICES.md", pin.fontNotices?.sha256),
    readPinned(
      "font-licenses/fraunces-OFL.txt",
      pin.fontLicenseArtifacts?.fraunces?.sha256,
    ),
    readPinned(
      "font-licenses/instrument-sans-OFL.txt",
      pin.fontLicenseArtifacts?.instrumentSans?.sha256,
    ),
  ]);
  const notices: ShellNotices = {
    schemaVersion: 1,
    scope: "pinned-bento-and-two-embedded-fonts",
    files,
  };
  // Escaping '<' also makes future supplied text containing script-close tokens
  // safe. JSON decoding recovers the full original text, including newlines.
  const body = JSON.stringify(notices).replaceAll("<", "\\u003c");
  return shell.text.replace(
    /<head([^>]*)>/i,
    (_match, attributes) =>
      `<head${attributes}><script id="${SHELL_NOTICES_ID}" type="application/json">${body}</script>`,
  );
}
