import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadTypescript } from "./loadTypescript.js";

const dirs: string[] = [];
async function tmp(): Promise<string> {
  // mimo strom NAŠEHO repa (tmpdir), ať resolve nechytí náš vlastní typescript
  const d = await mkdtemp(path.join(tmpdir(), "vibe-loadts-"));
  dirs.push(d);
  return d;
}
afterEach(async () => {
  for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true });
});

describe("loadTypescript", () => {
  it("bez node_modules projektu → přibalený (bundled), funkční createProgram", async () => {
    const root = await tmp();
    const { ts, source } = await loadTypescript(root);
    expect(source).toBe("bundled");
    expect(typeof ts.createProgram).toBe("function");
  });

  it("s typescriptem v node_modules cíle → použije jeho (project)", async () => {
    const root = await tmp();
    const tsDir = path.join(root, "node_modules", "typescript");
    await mkdir(tsDir, { recursive: true });
    await writeFile(path.join(tsDir, "package.json"), JSON.stringify({ name: "typescript", version: "0.0.0-fake", main: "index.js" }));
    // minimální fake: stačí, aby měl createProgram (loader to ověřuje)
    await writeFile(path.join(tsDir, "index.js"), "module.exports = { createProgram() { return {}; }, __fake: true };");

    const { ts, source } = await loadTypescript(root);
    expect(source).toBe("project");
    expect((ts as unknown as { __fake?: boolean }).__fake).toBe(true);
  });
});
