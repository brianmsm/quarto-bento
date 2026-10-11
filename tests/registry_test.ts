import {
  assertDesignRegistryUnchanged,
  loadDesignRegistry,
  registryDefaults,
  validateDesignRegistry,
} from "../src/render/registry.ts";
function assert(v: unknown, message = "assertion failed"): asserts v {
  if (!v) throw new Error(message);
}
async function refuses(fn: () => unknown | Promise<unknown>, code: string) {
  try {
    await fn();
  } catch (error) {
    assert(String(error).includes(code), String(error));
    return;
  }
  throw new Error(`expected ${code}`);
}
const theme = {
  background: "#f0fff5",
  color: "#172a35",
  accent: "#26734a",
  fontFamily: "Arial, sans-serif",
};
Deno.test("registry v1 validates named local defaults without source geometry or executable fields", () => {
  const config = {
    schemaVersion: 1,
    layouts: { three: { columns: 3, gap: 20, padding: 10 } },
    themes: { forest: theme },
    activeTheme: "forest",
  };
  assert(
    registryDefaults(validateDesignRegistry(config)).theme?.accent ===
      "#26734a",
  );
  for (
    const value of [
      { ...config, schemaVersion: 2 },
      { ...config, url: "https://example.com" },
      { ...config, themes: { forest: null } },
      { ...config, activeTheme: "missing" },
      { ...config, activeTheme: undefined },
      {
        ...config,
        layouts: { "two-column": { columns: 3, gap: 20, padding: 10 } },
      },
      { ...config, layouts: { bad: { columns: 7, gap: 20, padding: 10 } } },
      { ...config, themes: { forest: { ...theme, background: "url(a)" } } },
    ]
  ) {
    try {
      validateDesignRegistry(value);
      throw new Error("invalid registry accepted");
    } catch (error) {
      assert(String(error) !== "Error: invalid registry accepted");
    }
  }
});
Deno.test("registry exact-byte and absence CAS rejects changes, symlinks and oversized files", async () => {
  const dir = await Deno.makeTempDir({ prefix: "qbento-registry-schema-" });
  try {
    const missing = await loadDesignRegistry(dir);
    assert(missing.hash === null);
    await Deno.mkdir(`${dir}/.qbento`);
    await Deno.writeTextFile(
      `${dir}/.qbento/design.json`,
      JSON.stringify({
        schemaVersion: 1,
        themes: { forest: theme },
        activeTheme: "forest",
      }),
    );
    await refuses(
      () => assertDesignRegistryUnchanged(dir, null),
      "DESIGN_REGISTRY_CHANGED",
    );
    const loaded = await loadDesignRegistry(dir);
    assert(
      loaded.hash?.length === 64 &&
        loaded.defaults.theme?.background === theme.background,
    );
    await assertDesignRegistryUnchanged(dir, loaded.hash);
    await Deno.writeTextFile(
      `${dir}/.qbento/design.json`,
      JSON.stringify({ schemaVersion: 1 }),
    );
    await refuses(
      () => assertDesignRegistryUnchanged(dir, loaded.hash),
      "DESIGN_REGISTRY_CHANGED",
    );
    await Deno.remove(`${dir}/.qbento/design.json`);
    await Deno.writeTextFile(`${dir}/elsewhere.json`, "{}");
    await Deno.symlink(`${dir}/elsewhere.json`, `${dir}/.qbento/design.json`);
    await refuses(() => loadDesignRegistry(dir), "UNSAFE_DESIGN_REGISTRY");
    await Deno.remove(`${dir}/.qbento/design.json`);
    await Deno.writeTextFile(`${dir}/.qbento/design.json`, " ".repeat(262145));
    await refuses(() => loadDesignRegistry(dir), "DESIGN_REGISTRY_TOO_LARGE");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
