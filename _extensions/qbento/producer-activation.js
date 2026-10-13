import { producerEnvironment } from "./runtime/src/render/producer-environment.ts";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Quarto 1.10.19's public engine initializer runs in its parent process. This
// narrowly scoped compatibility adapter leaves the selected engine as knitr.
const directory = fileURLToPath(new URL("../../", import.meta.url));
const profile = fileURLToPath(
  new URL("./runtime/src/render/producer-profile.R", import.meta.url),
);
const manifestPath = resolve(
  directory,
  ".qbento/quarto-stage/producer-manifest.json",
);
const receiptPath = resolve(directory, ".qbento/quarto-run.json");
const activation = Symbol.for("quarto-bento.producer-activation");

export default {
  name: "qbento-producer-activation",
  // The R launcher adapter is accepted against this exact installed revision.
  quartoRequired: "=1.10.19",
  defaultExt: ".qmd",
  defaultYaml: () => [],
  defaultContent: () => [],
  validExtensions: () => [],
  claimsFile: () => false,
  claimsLanguage: () => false,
  canFreeze: false,
  generatesFigures: false,
  init(quarto) {
    if (Deno.env.get("QBENTO_INTERNAL_RENDER") === "1") return;
    const original = quarto.system?.execProcess;
    if (
      typeof original !== "function" ||
      typeof quarto.path?.resource !== "function"
    ) {
      throw new Error(
        "UNSUPPORTED_QUARTO_PRODUCER_ADAPTER: expected Quarto's shared R launcher API",
      );
    }
    if (original[activation] === directory) return;
    if (original[activation]) {
      throw new Error(
        "UNSUPPORTED_QUARTO_PRODUCER_ADAPTER: another project already activated the R launcher",
      );
    }
    const rmdScript = quarto.path.resource("rmd/rmd.R");
    const adapter = async function (options, stdin, ...rest) {
      if (
        !(options.args ?? []).includes(rmdScript) || typeof stdin !== "string"
      ) return original.call(this, options, stdin, ...rest);

      const request = JSON.parse(stdin);
      if (request.action !== "execute") {
        return original.call(this, options, stdin, ...rest);
      }
      const input = request.params?.input;
      if (
        typeof input !== "string" || !input.endsWith(".qmd") ||
        dirname(resolve(input)) !== resolve(directory)
      ) return original.call(this, options, stdin, ...rest);

      const run = JSON.parse(Deno.readTextFileSync(receiptPath));
      if (
        run.version !== 1 || run.source !== resolve(input) ||
        run.process?.pid !== Deno.pid ||
        typeof run.producerHash !== "string" ||
        !/^[a-f0-9]{64}$/.test(run.producerHash)
      ) {
        throw new Error(
          "INVALID_PRODUCER_RECEIPT: the R execution has no current guarded source receipt",
        );
      }
      const manifest = JSON.parse(Deno.readTextFileSync(manifestPath));
      if (manifest.chunks.length === 0) {
        return original.call(this, options, stdin, ...rest);
      }
      const startup = await producerEnvironment({
        cwd: options.cwd ?? directory,
        command: options.cmd,
        args: options.args,
        env: options.env,
      });
      const selected = startup.originalProfile;
      // These values affect this R subprocess only. Inspection, user scripts,
      // other engines and the user's shell keep their original environment.
      return original.call(
        this,
        {
          ...options,
          args: ["--no-environ", ...startup.args],
          env: {
            ...startup.effective,
            R_PROFILE_USER: profile,
            ...(startup.args.includes("--no-site-file") ? {} : {
              R_PROFILE: fileURLToPath(
                new URL(
                  "./runtime/src/render/producer-site-profile.R",
                  import.meta.url,
                ),
              ),
            }),
            QBENTO_ORIGINAL_R_SITE_SET:
              startup.effective.R_PROFILE === undefined ? "0" : "1",
            QBENTO_ORIGINAL_R_SITE: startup.effective.R_PROFILE ?? "",
            QBENTO_PRODUCER_PROFILE: profile,
            QBENTO_ORIGINAL_R_PROFILE_SET: selected === undefined ? "0" : "1",
            QBENTO_ORIGINAL_R_PROFILE_USER: selected ?? "",
            QBENTO_PRODUCER_MANIFEST: manifestPath,
          },
        },
        stdin,
        ...rest,
      );
    };
    adapter[activation] = directory;
    quarto.system.execProcess = adapter;
    if (quarto.system.execProcess !== adapter) {
      throw new Error(
        "UNSUPPORTED_QUARTO_PRODUCER_ADAPTER: Quarto's R launcher cannot be activated",
      );
    }
  },
  launch() {
    throw new Error(
      "UNSUPPORTED_QUARTO_PRODUCER_ADAPTER: producer activation must not replace an execution engine",
    );
  },
};
