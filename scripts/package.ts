import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export interface PackageFile {
  path: string;
  bytes: number;
  sha256: string;
  executable: boolean;
}
export interface PackageManifest {
  schemaVersion: 2;
  kind: "development-portable";
  qbentoSource: QbentoSourceProvenance;
  bento: {
    revision: string;
    version: string;
    shellSha256: string;
    runtimeDependencyInventorySha256: string;
  };
  files: PackageFile[];
}
export type QbentoSourceProvenance =
  | { kind: "git"; commit: string; dirty: boolean }
  | {
    kind: "unknown";
    reason:
      | "git-execution-unavailable"
      | "not-a-git-checkout"
      | "source-root-not-git-root"
      | "git-revision-unavailable"
      | "git-status-unavailable";
    commit?: string;
  };
interface VendoredUpstreamArtifact {
  sourcePath: string;
  vendoredPath?: string;
  sha256: string;
}
interface FontLicenseArtifact {
  repository: string;
  revision: string;
  sourcePath: string;
  sourceUrl: string;
  vendoredPath: string;
  sha256: string;
}
interface BentoPin {
  repository: string;
  revision: string;
  version: string;
  shellSha256: string;
  upstreamArtifacts: Record<string, VendoredUpstreamArtifact>;
  runtimeDependencyInventory: { vendoredPath: string; sha256: string };
  fontNotices: { vendoredPath: string; sha256: string };
  fontLicenseArtifacts: Record<string, FontLicenseArtifact>;
}
const root = fileURLToPath(new URL("../", import.meta.url));
const fixedFiles = [
  "vendor/bento/shell.html",
  "vendor/bento/slides.schema.json",
  "vendor/bento/pin.json",
  "vendor/bento/LICENSE",
  "vendor/bento/THIRD_PARTY_NOTICES.md",
  "vendor/bento/FONT_NOTICES.md",
  "vendor/bento/font-licenses/fraunces-OFL.txt",
  "vendor/bento/font-licenses/instrument-sans-OFL.txt",
  "vendor/bento/runtime-dependencies.json",
  "vendor/bento/provenance/slides.package.json",
  "vendor/bento/provenance/slides.package-lock.json",
  "_extensions/qbento/_extension.yml",
  "_extensions/qbento/pre.ts",
  "_extensions/qbento/post.ts",
  "_extensions/qbento/capture.lua",
  "_extensions/qbento/guard.lua",
];
function inside(parent: string, child: string) {
  const path = relative(parent, child);
  return !isAbsolute(path) && path !== ".." && !path.startsWith(`..${sep}`);
}
async function hash(bytes: Uint8Array) {
  return [
    ...new Uint8Array(
      await crypto.subtle.digest("SHA-256", new Uint8Array(bytes)),
    ),
  ]
    .map((b) => b.toString(16).padStart(2, "0")).join("");
}
async function filesIn(directory: string): Promise<string[]> {
  const info = await Deno.lstat(directory);
  if (info.isSymlink || !info.isDirectory) {
    throw new Error(
      `UNSAFE_PACKAGE_INPUT: expected real directory ${directory}`,
    );
  }
  const entries = [];
  for await (const entry of Deno.readDir(directory)) entries.push(entry);
  entries.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  const files: string[] = [];
  for (const entry of entries) {
    const path = resolve(directory, entry.name);
    const stat = await Deno.lstat(path);
    if (stat.isSymlink) {
      throw new Error(`UNSAFE_PACKAGE_INPUT: symbolic link ${path}`);
    }
    if (stat.isDirectory) files.push(...await filesIn(path));
    else if (stat.isFile && /\.(ts|js|html|lua)$/.test(entry.name)) {
      files.push(path);
    } else {
      throw new Error(`UNSAFE_PACKAGE_INPUT: unexpected runtime file ${path}`);
    }
  }
  return files;
}
async function regularBytes(path: string): Promise<Uint8Array> {
  // Reject symlinks in every parent as well as in the selected file.
  for (let parent = dirname(path);; parent = dirname(parent)) {
    if ((await Deno.lstat(parent)).isSymlink) {
      throw new Error(`UNSAFE_PACKAGE_INPUT: symbolic link ${parent}`);
    }
    if (parent === dirname(parent)) break;
  }
  const stat = await Deno.lstat(path);
  if (stat.isSymlink || !stat.isFile) {
    throw new Error(`UNSAFE_PACKAGE_INPUT: expected regular file ${path}`);
  }
  return await Deno.readFile(path);
}
function mismatch(message: string): never {
  throw new Error(`BENTO_PIN_MISMATCH: ${message}`);
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function sortedEntries(value: Record<string, unknown>): [string, unknown][] {
  return Object.entries(value).sort(([left], [right]) =>
    left < right ? -1 : left > right ? 1 : 0
  );
}
function normalizedDependencyRows(
  value: unknown,
  fields: string[],
): string[][] | undefined {
  if (!Array.isArray(value)) return undefined;
  const rows: string[][] = [];
  for (const item of value) {
    if (!isRecord(item)) return undefined;
    const row: string[] = [];
    for (const field of fields) {
      const fieldValue = item[field];
      if (typeof fieldValue !== "string") return undefined;
      row.push(fieldValue);
    }
    rows.push(row);
  }
  return rows;
}
async function pinnedBytes(
  payload: { path: string; bytes: Uint8Array }[],
  path: string,
  expectedSha256: string,
): Promise<Uint8Array> {
  if (!/^[0-9a-f]{64}$/.test(expectedSha256)) {
    mismatch(`invalid SHA-256 for ${path}`);
  }
  const item = payload.find((file) => file.path === path);
  if (!item || await hash(item.bytes) !== expectedSha256) {
    mismatch(`${path} does not match the pinned upstream bytes`);
  }
  return item.bytes;
}
async function verifyBentoInventory(
  payload: { path: string; bytes: Uint8Array }[],
): Promise<{
  pin: BentoPin;
  runtimeDependencyInventorySha256: string;
}> {
  const decoder = new TextDecoder();
  let parsedPin: unknown;
  try {
    parsedPin = JSON.parse(decoder.decode(
      payload.find((file) => file.path === "runtime/vendor/bento/pin.json")!
        .bytes,
    ));
  } catch {
    return mismatch("pin.json is not valid JSON");
  }
  if (!isRecord(parsedPin)) mismatch("pin.json must be a JSON object");
  const pin = parsedPin as unknown as BentoPin;
  if (
    !/^[0-9a-f]{40}$/.test(pin.revision) || typeof pin.version !== "string" ||
    pin.version.length === 0 ||
    !/^[0-9a-f]{64}$/.test(pin.shellSha256) ||
    typeof pin.repository !== "string" ||
    !isRecord(pin.upstreamArtifacts) ||
    !isRecord(pin.runtimeDependencyInventory)
  ) {
    mismatch("pin.json is missing required provenance fields");
  }
  await pinnedBytes(
    payload,
    "runtime/vendor/bento/shell.html",
    pin.shellSha256,
  );
  if (
    !pin.fontNotices || pin.fontNotices.vendoredPath !== "FONT_NOTICES.md"
  ) {
    mismatch("pin.json has no pinned font notice path");
  }
  await pinnedBytes(
    payload,
    "runtime/vendor/bento/FONT_NOTICES.md",
    pin.fontNotices.sha256,
  );
  const artifacts = [
    {
      key: "schema",
      sourcePath: "schema/slides-1.2.6.json",
      vendoredPath: "slides.schema.json",
    },
    {
      key: "license",
      sourcePath: "LICENSE",
      vendoredPath: "LICENSE",
    },
    {
      key: "thirdPartyNotices",
      sourcePath: "THIRD_PARTY_NOTICES.md",
      vendoredPath: "THIRD_PARTY_NOTICES.md",
    },
    {
      key: "packageManifest",
      sourcePath: "slides/package.json",
      vendoredPath: "provenance/slides.package.json",
    },
    {
      key: "packageLock",
      sourcePath: "slides/package-lock.json",
      vendoredPath: "provenance/slides.package-lock.json",
    },
  ];
  const artifactBytes = new Map<string, Uint8Array>();
  for (const artifact of artifacts) {
    const pinArtifact = pin.upstreamArtifacts[artifact.key];
    if (
      !pinArtifact || pinArtifact.sourcePath !== artifact.sourcePath ||
      pinArtifact.vendoredPath !== artifact.vendoredPath
    ) {
      mismatch(`pin.json has an unexpected ${artifact.key} source path`);
    }
    const bytes = await pinnedBytes(
      payload,
      `runtime/vendor/bento/${artifact.vendoredPath}`,
      pinArtifact.sha256,
    );
    artifactBytes.set(artifact.key, bytes);
  }
  const fontSource = pin.upstreamArtifacts.fontSource;
  if (
    !fontSource || fontSource.sourcePath !== "slides/src/fontdata.ts" ||
    !/^[0-9a-f]{64}$/.test(fontSource.sha256)
  ) {
    mismatch("pin.json has no pinned Bento font source provenance");
  }
  const expectedFontLicenseSources = [
    {
      key: "fraunces",
      repository: "https://github.com/undercasetype/Fraunces",
      revision: "284bc5ea73b1233a05d6ec644e641b9404cba8a0",
      sourcePath: "OFL.txt",
      sourceUrl:
        "https://raw.githubusercontent.com/undercasetype/Fraunces/284bc5ea73b1233a05d6ec644e641b9404cba8a0/OFL.txt",
      vendoredPath: "font-licenses/fraunces-OFL.txt",
    },
    {
      key: "instrumentSans",
      repository: "https://github.com/Instrument/instrument-sans",
      revision: "24690a4ab2f92d45aa23246abeba515712145d75",
      sourcePath: "OFL.txt",
      sourceUrl:
        "https://raw.githubusercontent.com/Instrument/instrument-sans/24690a4ab2f92d45aa23246abeba515712145d75/OFL.txt",
      vendoredPath: "font-licenses/instrument-sans-OFL.txt",
    },
  ];
  const fontLicenseArtifacts = new Map<string, FontLicenseArtifact>();
  for (const expected of expectedFontLicenseSources) {
    const artifact = pin.fontLicenseArtifacts?.[expected.key];
    if (
      !artifact || artifact.repository !== expected.repository ||
      artifact.revision !== expected.revision ||
      artifact.sourcePath !== expected.sourcePath ||
      artifact.sourceUrl !== expected.sourceUrl ||
      artifact.vendoredPath !== expected.vendoredPath ||
      !/^[0-9a-f]{64}$/.test(artifact.sha256)
    ) {
      mismatch(`pin.json has unexpected ${expected.key} license provenance`);
    }
    await pinnedBytes(
      payload,
      `runtime/vendor/bento/${expected.vendoredPath}`,
      artifact.sha256,
    );
    fontLicenseArtifacts.set(expected.key, artifact);
  }
  const inventoryPath = pin.runtimeDependencyInventory.vendoredPath;
  if (inventoryPath !== "runtime-dependencies.json") {
    mismatch("pin.json has an unexpected runtime dependency inventory path");
  }
  const inventoryBytes = await pinnedBytes(
    payload,
    `runtime/vendor/bento/${inventoryPath}`,
    pin.runtimeDependencyInventory.sha256,
  );
  let packageManifestValue: unknown;
  let packageLockValue: unknown;
  let inventoryValue: unknown;
  try {
    packageManifestValue = JSON.parse(
      decoder.decode(artifactBytes.get("packageManifest")!),
    );
    packageLockValue = JSON.parse(
      decoder.decode(artifactBytes.get("packageLock")!),
    );
    inventoryValue = JSON.parse(decoder.decode(inventoryBytes));
  } catch {
    return mismatch("vendored Bento provenance JSON is invalid");
  }
  if (
    !isRecord(packageManifestValue) || !isRecord(packageLockValue) ||
    !isRecord(inventoryValue)
  ) {
    mismatch("vendored Bento provenance JSON must contain objects");
  }
  const packageManifest = packageManifestValue;
  const packageLock = packageLockValue;
  const inventory = inventoryValue;
  if (
    inventory.schemaVersion !== 1 || !isRecord(inventory.bento) ||
    inventory.bento.repository !== pin.repository ||
    inventory.bento.revision !== pin.revision ||
    inventory.bento.version !== pin.version || !isRecord(inventory.source) ||
    inventory.source.packageManifestPath !== "slides/package.json" ||
    inventory.source.packageManifestVersion !== "1.2.6" ||
    inventory.source.packageLockPath !== "slides/package-lock.json" ||
    inventory.source.packageLockRootVersion !== "1.1.0" ||
    inventory.source.versionMetadataNote !==
      'The pinned upstream package.json declares 1.2.6, while the package-lock.json root packages[""].version declares 1.1.0. Both original files are preserved and independently hash-pinned.' ||
    inventory.source.packageManifestSha256 !==
      pin.upstreamArtifacts.packageManifest.sha256 ||
    inventory.source.packageLockSha256 !==
      pin.upstreamArtifacts.packageLock.sha256 ||
    inventory.source.fontSourcePath !== fontSource.sourcePath ||
    inventory.source.fontSourceSha256 !== fontSource.sha256 ||
    inventory.source.selectionMethod !== "npm-lockfile-v3-dev-not-true" ||
    typeof inventory.source.selectionScope !== "string" ||
    !inventory.source.selectionScope.includes("not proof")
  ) {
    mismatch("runtime dependency inventory provenance does not match pin.json");
  }
  if (
    packageLock.lockfileVersion !== 3 ||
    !Array.isArray(inventory.embeddedFonts) ||
    inventory.embeddedFonts.length !== 2 ||
    !isRecord(inventory.embeddedFonts[0]) ||
    !isRecord(inventory.embeddedFonts[1])
  ) {
    mismatch("runtime dependency inventory has an unsupported schema");
  }
  const fonts = inventory.embeddedFonts as Record<string, unknown>[];
  const expectedFonts = [
    {
      name: "Fraunces",
      asset: "FRAUNCES_900",
      subset: "Latin",
      format: "WOFF2",
      assetBytes: 34632,
      assetSha256:
        "628051c1bd196ee82e88cb02015e46b8fc30f505215b424d29627ec613395a0d",
      versionEvidence:
        "No upstream font release identifier is recorded for this WOFF2 data in the pinned Bento source.",
      licenseCopyrightNotice: "Copyright 2018 The Fraunces Project Authors",
      bentoNoticeCopyrightNotice: "Copyright 2020 The Fraunces Project Authors",
      licenseKey: "fraunces",
      licensePath: "font-licenses/fraunces-OFL.txt",
    },
    {
      name: "Instrument Sans",
      asset: "INSTRUMENT_VAR",
      subset: "Latin",
      format: "WOFF2",
      assetBytes: 29904,
      assetSha256:
        "6219bc4bfdfc5d9b2201dcdf046218b122a758f932e25ed5f168f929b7ca2311",
      versionEvidence:
        "No upstream font release identifier is recorded for this WOFF2 data in the pinned Bento source.",
      licenseCopyrightNotice:
        "Copyright 2022 The Instrument Sans Project Authors",
      bentoNoticeCopyrightNotice:
        "Copyright 2022 The Instrument Sans Project Authors",
      licenseKey: "instrumentSans",
      licensePath: "font-licenses/instrument-sans-OFL.txt",
    },
  ];
  for (const [index, expected] of expectedFonts.entries()) {
    const font = fonts[index];
    const license = fontLicenseArtifacts.get(expected.licenseKey);
    if (
      font.name !== expected.name || font.asset !== expected.asset ||
      font.subset !== expected.subset || font.format !== expected.format ||
      font.assetBytes !== expected.assetBytes ||
      font.assetSha256 !== expected.assetSha256 || font.version !== null ||
      font.versionEvidence !== expected.versionEvidence ||
      font.licenseDeclared !== "SIL Open Font License 1.1" ||
      font.licenseCopyrightNotice !== expected.licenseCopyrightNotice ||
      font.bentoNoticeCopyrightNotice !==
        expected.bentoNoticeCopyrightNotice ||
      font.licenseKey !== expected.licenseKey ||
      font.licensePath !== expected.licensePath ||
      font.licenseSha256 !== license?.sha256 ||
      font.licenseSourceUrl !== license?.sourceUrl ||
      font.sourcePath !== fontSource.sourcePath ||
      font.sourceSha256 !== fontSource.sha256
    ) {
      mismatch("embedded font inventory does not match pinned source metadata");
    }
  }
  if (
    !isRecord(inventory.noticeReview) ||
    inventory.noticeReview.status !==
      "font-texts-pinned-review-incomplete" ||
    inventory.noticeReview.scopeNote !==
      "The complete official OFL texts for the two named embedded font assets are included and integrity-pinned. This is not a complete legal audit; the exact upstream font release identifiers remain unknown." ||
    !Array.isArray(inventory.noticeReview.pending) ||
    inventory.noticeReview.pending.length !== 2 ||
    inventory.noticeReview.pending[0] !==
      "The exact upstream release identifiers for both embedded font WOFF2 assets remain unknown." ||
    inventory.noticeReview.pending[1] !==
      "A complete review of all Bento third-party notices and Quarto-Bento licensing has not been performed."
  ) {
    mismatch(
      "font notice scope and remaining review limits must stay explicit",
    );
  }
  const manifestDependencies = packageManifest.dependencies;
  const packages = packageLock.packages;
  const lockRoot = isRecord(packages) ? packages[""] : undefined;
  const lockRootDependencies = isRecord(lockRoot)
    ? lockRoot.dependencies
    : undefined;
  if (
    !isRecord(manifestDependencies) || !isRecord(lockRootDependencies) ||
    !isRecord(lockRoot) || packageManifest.name !== "bento-slides" ||
    packageManifest.version !== pin.version ||
    lockRoot.name !== packageManifest.name ||
    packageManifest.version !== inventory.source.packageManifestVersion ||
    lockRoot.version !== inventory.source.packageLockRootVersion ||
    JSON.stringify(sortedEntries(manifestDependencies)) !==
      JSON.stringify(sortedEntries(lockRootDependencies))
  ) {
    mismatch("Bento package.json roots do not match the package-lock root");
  }
  if (!isRecord(packages)) mismatch("Bento package-lock has no packages map");
  const expectedRoots = sortedEntries(manifestDependencies).map(
    ([name, range]) => {
      if (typeof range !== "string") {
        mismatch(`invalid root dependency range: ${name}`);
      }
      const packageLockPath = `node_modules/${name}`;
      const locked = packages[packageLockPath];
      if (!isRecord(locked) || typeof locked.version !== "string") {
        mismatch(`root dependency is not locked: ${name}`);
      }
      return {
        name,
        range,
        resolvedVersion: locked.version,
        licenseDeclared: typeof locked.license === "string"
          ? locked.license
          : "not-declared",
        packageLockPath: `packages/${packageLockPath}`,
      };
    },
  );
  const expectedPackages = Object.entries(packages)
    .filter(([path, entry]) =>
      path.startsWith("node_modules/") &&
      isRecord(entry) && entry.dev !== true
    )
    .map(([path, entry]) => {
      if (!isRecord(entry) || typeof entry.version !== "string") {
        mismatch(`invalid production lock entry: ${path}`);
      }
      const marker = "/node_modules/";
      const nested = path.lastIndexOf(marker);
      const name = nested >= 0
        ? path.slice(nested + marker.length)
        : path.slice("node_modules/".length);
      return {
        name,
        version: entry.version,
        licenseDeclared: typeof entry.license === "string"
          ? entry.license
          : "not-declared",
        packageLockPath: `packages/${path}`,
      };
    })
    .sort((left, right) =>
      left.packageLockPath < right.packageLockPath
        ? -1
        : left.packageLockPath > right.packageLockPath
        ? 1
        : 0
    );
  const actualRoots = normalizedDependencyRows(inventory.rootDependencies, [
    "name",
    "range",
    "resolvedVersion",
    "licenseDeclared",
    "packageLockPath",
  ]);
  const actualPackages = normalizedDependencyRows(inventory.runtimePackages, [
    "name",
    "version",
    "licenseDeclared",
    "packageLockPath",
  ]);
  const expectedRootRows = expectedRoots.map((item) => [
    item.name,
    item.range,
    item.resolvedVersion,
    item.licenseDeclared,
    item.packageLockPath,
  ]);
  const expectedPackageRows = expectedPackages.map((item) => [
    item.name,
    item.version,
    item.licenseDeclared,
    item.packageLockPath,
  ]);
  if (
    !actualRoots ||
    JSON.stringify(actualRoots) !== JSON.stringify(expectedRootRows) ||
    !actualPackages ||
    JSON.stringify(actualPackages) !== JSON.stringify(expectedPackageRows)
  ) {
    mismatch(
      "runtime component inventory does not match pinned package roots and lockfile",
    );
  }
  return {
    pin,
    runtimeDependencyInventorySha256: pin.runtimeDependencyInventory.sha256,
  };
}
async function qbentoSourceProvenance(
  sourceRoot: string,
): Promise<QbentoSourceProvenance> {
  const runGit = async (args: string[]) => {
    return await new Deno.Command("git", {
      args: ["-C", sourceRoot, ...args],
      stdout: "piped",
      stderr: "null",
    }).output();
  };
  let rootResult: Deno.CommandOutput;
  try {
    rootResult = await runGit(["rev-parse", "--show-toplevel"]);
  } catch {
    return { kind: "unknown", reason: "git-execution-unavailable" };
  }
  if (!rootResult.success) {
    return { kind: "unknown", reason: "not-a-git-checkout" };
  }
  let gitRoot: string;
  try {
    gitRoot = await Deno.realPath(
      new TextDecoder().decode(rootResult.stdout).replace(/\r?\n$/, ""),
    );
    const realSourceRoot = await Deno.realPath(sourceRoot);
    const samePath = Deno.build.os === "windows"
      ? gitRoot.toLowerCase() === realSourceRoot.toLowerCase()
      : gitRoot === realSourceRoot;
    if (!samePath) {
      return { kind: "unknown", reason: "source-root-not-git-root" };
    }
  } catch {
    return { kind: "unknown", reason: "not-a-git-checkout" };
  }
  let revisionResult: Deno.CommandOutput;
  try {
    revisionResult = await runGit(["rev-parse", "--verify", "HEAD^{commit}"]);
  } catch {
    return { kind: "unknown", reason: "git-execution-unavailable" };
  }
  const commit = new TextDecoder().decode(revisionResult.stdout).trim();
  if (
    !revisionResult.success || !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(commit)
  ) {
    return { kind: "unknown", reason: "git-revision-unavailable" };
  }
  let statusResult: Deno.CommandOutput;
  try {
    statusResult = await runGit([
      "status",
      "--porcelain=v1",
      "--untracked-files=all",
      "--ignore-submodules=none",
    ]);
  } catch {
    return {
      kind: "unknown",
      reason: "git-status-unavailable",
      commit,
    };
  }
  if (!statusResult.success) {
    return {
      kind: "unknown",
      reason: "git-status-unavailable",
      commit,
    };
  }
  return { kind: "git", commit, dirty: statusResult.stdout.length > 0 };
}
/** Build an offline directory, refusing existing destinations and unknown inputs. */
export async function buildDevelopmentPackage(options: {
  destination: string;
  sourceRoot?: string;
}): Promise<PackageManifest> {
  const sourceRoot = resolve(options.sourceRoot ?? root);
  const destination = resolve(options.destination);
  for (
    const tree of ["src", "vendor", "_extensions", "bin", "scripts", "docs"]
  ) {
    if (inside(resolve(sourceRoot, tree), destination)) {
      throw new Error(
        "UNSAFE_PACKAGE_DESTINATION: destination overlaps inputs",
      );
    }
  }
  if (inside(destination, sourceRoot)) {
    throw new Error(
      "UNSAFE_PACKAGE_DESTINATION: destination contains source root",
    );
  }
  const payload: { path: string; bytes: Uint8Array; executable: boolean }[] =
    [];
  for (const path of await filesIn(resolve(sourceRoot, "src"))) {
    const name = relative(sourceRoot, path).split(sep).join("/");
    payload.push({
      path: `runtime/${name}`,
      bytes: await regularBytes(path),
      executable: false,
    });
  }
  for (const name of fixedFiles) {
    payload.push({
      path: `runtime/${name}`,
      bytes: await regularBytes(resolve(sourceRoot, name)),
      executable: false,
    });
  }
  for (const name of ["bin/qbento", "bin/qbento.cmd", "docs/PACKAGING.md"]) {
    const bytes = await regularBytes(resolve(sourceRoot, name));
    payload.push({
      path: name === "docs/PACKAGING.md" ? "PACKAGING.md" : name,
      // Keep source diffs clean while shipping native batch-file line endings.
      bytes: name === "bin/qbento.cmd"
        ? new TextEncoder().encode(
          new TextDecoder().decode(bytes).replace(/\r?\n/g, "\r\n"),
        )
        : bytes,
      executable: name === "bin/qbento",
    });
  }
  payload.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  const { pin, runtimeDependencyInventorySha256 } = await verifyBentoInventory(
    payload,
  );
  const manifest: PackageManifest = {
    schemaVersion: 2,
    kind: "development-portable",
    qbentoSource: await qbentoSourceProvenance(sourceRoot),
    bento: {
      revision: pin.revision,
      version: pin.version,
      shellSha256: pin.shellSha256,
      runtimeDependencyInventorySha256,
    },
    files: await Promise.all(payload.map(async (f) => ({
      path: f.path,
      bytes: f.bytes.length,
      sha256: await hash(f.bytes),
      executable: f.executable,
    }))),
  };
  // Exclusive directory creation prevents replacing user content. Failed builds
  // remove only the directory created by this invocation.
  await Deno.mkdir(destination, { mode: 0o755 });
  try {
    for (const file of payload) {
      const target = resolve(destination, file.path);
      await Deno.mkdir(dirname(target), { recursive: true, mode: 0o755 });
      await Deno.writeFile(target, file.bytes, {
        createNew: true,
        mode: file.executable ? 0o755 : 0o644,
      });
      if (Deno.build.os !== "windows") {
        await Deno.chmod(target, file.executable ? 0o755 : 0o644);
      }
    }
    await Deno.writeTextFile(
      resolve(destination, "manifest.json"),
      JSON.stringify(manifest, null, 2) + "\n",
      { createNew: true, mode: 0o644 },
    );
  } catch (error) {
    await Deno.remove(destination, { recursive: true });
    throw error;
  }
  return manifest;
}
if (import.meta.main) {
  try {
    if (Deno.args.length !== 1) {
      throw new Error(
        "USAGE: deno run --no-config --allow-read --allow-write [--allow-run=git for Git provenance] scripts/package.ts <new-directory>",
      );
    }
    const manifest = await buildDevelopmentPackage({
      destination: Deno.args[0],
    });
    console.log(JSON.stringify(
      {
        destination: resolve(Deno.args[0]),
        kind: manifest.kind,
        files: manifest.files.length,
        bento: manifest.bento,
      },
      null,
      2,
    ));
  } catch (error) {
    console.error(String(error));
    Deno.exitCode = 1;
  }
}
