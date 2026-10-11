import { windowsBatchArguments } from "../scripts/portable-check.ts";

Deno.test("portable smoke batch invocation quotes paths and disables shell startup/expansion", () => {
  const actual = windowsBatchArguments(
    "C:\\portable distribution\\bin\\qbento.cmd",
    ["render", "slides with spaces.qmd"],
  );
  const expected = [
    "/d",
    "/s",
    "/v:off",
    "/c",
    '""C:\\portable distribution\\bin\\qbento.cmd" "render" "slides with spaces.qmd""',
  ];
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(JSON.stringify(actual));
  }
});
Deno.test("portable smoke refuses cmd syntax instead of expanding untrusted tokens", () => {
  for (
    const token of [
      "",
      'quoted"path',
      "%TEMP%",
      "!TEMP!",
      "a&b",
      "a|b",
      "a<b",
      "a>b",
      "a^b",
      "a\nb",
      "a\rb",
      "a\0b",
      "C:\\trailing\\",
    ]
  ) {
    for (const args of [[token], ["render", token]]) {
      let refused = false;
      try {
        windowsBatchArguments("C:\\portable\\qbento.cmd", args);
      } catch (error) {
        refused = String(error).includes("UNSAFE_SMOKE_ARGUMENT");
      }
      if (!refused) throw new Error(`Did not refuse ${JSON.stringify(args)}`);
    }
    let refused = false;
    try {
      windowsBatchArguments(token, ["doctor"]);
    } catch (error) {
      refused = String(error).includes("UNSAFE_SMOKE_ARGUMENT");
    }
    if (!refused) {
      throw new Error(`Did not refuse executable ${JSON.stringify(token)}`);
    }
  }
});
