import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { run } from "./cli.js";

// End-to-end: skutečný běh CLI nad fixturou, čteme vygenerovaný .md i .json.
// In-process (bez forku), ať je rychlé – necílíme izolaci strojové vrstvy.
process.env.VIBE_ANALYSIS_INPROCESS = "1";

let proj: string;

beforeEach(async () => {
  proj = await mkdtemp(path.join(tmpdir(), "vibe-cli-mgraph-"));
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(async () => {
  vi.restoreAllMocks();
  await rm(proj, { recursive: true, force: true }).catch(() => {});
});

async function readOutputs(outDir: string): Promise<{ md: string; json: string }> {
  const files = await readdir(outDir);
  const mdName = files.find((f) => f.endsWith(".md"));
  const jsonName = files.find((f) => f.endsWith(".json"));
  expect(mdName).toBeDefined();
  expect(jsonName).toBeDefined();
  return {
    md: await readFile(path.join(outDir, mdName as string), "utf8"),
    json: await readFile(path.join(outDir, jsonName as string), "utf8"),
  };
}

describe("run – e2e graf modulů", () => {
  it("HLAVNÍ PAST: ./b.js z a.ts se v reportu napojí na b.ts", async () => {
    await mkdir(path.join(proj, "src"), { recursive: true });
    await writeFile(path.join(proj, "src", "a.ts"), `import { b } from "./b.js";\nexport const a = b;\n`, "utf8");
    await writeFile(path.join(proj, "src", "b.ts"), `export const b = 1;\n`, "utf8");
    await writeFile(path.join(proj, "src", "lonely.ts"), `export const x = 1;\n`, "utf8");

    const outDir = path.join(proj, "report");
    const code = await run([proj, "--out", outDir], proj);
    expect(code).toBe(0);

    const { md, json } = await readOutputs(outDir);

    // Report má sekci grafu a Mermaid hranu.
    expect(md).toContain("## Graf modulů");
    expect(md).toContain('["src/a.ts"]');
    expect(md).toContain('["src/b.ts"]');
    expect(md).toMatch(/n\d+ --> n\d+/);
    // lonely.ts je osamělý → ve výpisu, ne v grafu.
    expect(md).toContain("`src/lonely.ts`");

    // JSON nese graf 1:1 s vyřešenou hranou .js → .ts.
    const index = JSON.parse(json);
    expect(index.version).toBe(7);
    expect(index.moduleGraph.kind).toBe("ran");
    expect(index.moduleGraph.edges).toEqual([{ from: "src/a.ts", to: "src/b.ts" }]);
    expect(index.moduleGraph.isolated).toEqual(["src/lonely.ts"]);
  });

  it("nečekané selhání builderu → vrstva 'skipped', report i tak vznikne (exit 0)", async () => {
    await mkdir(path.join(proj, "src"), { recursive: true });
    await writeFile(path.join(proj, "src", "a.ts"), `export const a = 1;\n`, "utf8");

    const outDir = path.join(proj, "report");
    const code = await run([proj, "--out", outDir], proj, {
      moduleGraphFn: async () => {
        throw new Error("bum");
      },
    });
    expect(code).toBe(0); // jeden problém neshodí celý report

    const { md, json } = await readOutputs(outDir);
    expect(md).toContain("Graf modulů přeskočen");
    const index = JSON.parse(json);
    expect(index.moduleGraph.kind).toBe("skipped");
    expect(console.error).toHaveBeenCalled(); // selhání nahlášeno na stderr
  });
});
