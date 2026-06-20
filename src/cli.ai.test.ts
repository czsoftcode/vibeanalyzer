import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AI_KEY_ENV } from "./analyze/aiStatus.js";
import { run } from "./cli.js";

// End-to-end: skutečný běh CLI nad fixturou. Hlídá KONTRAKT mezi cli.ts a JSON –
// že reálné process.env opravdu protéká do pole `ai`. Unit testy testují jen
// builder s mockem; tady ověřujeme zapojení. Mutace detectAiStatus(process.env)
// → detectAiStatus({}) musí shodit "s klíčem" větev (jinak by AI vrstva v
// provozu vždy hlásila "přeskočeno" bez ohledu na prostředí a nikdo by to nechytl).
process.env.VIBE_ANALYSIS_INPROCESS = "1";

let proj: string;

beforeEach(async () => {
  proj = await mkdtemp(path.join(tmpdir(), "vibe-cli-ai-"));
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  await rm(proj, { recursive: true, force: true }).catch(() => {});
});

async function readJson(outDir: string): Promise<{ md: string; index: { ai: unknown } }> {
  const files = await readdir(outDir);
  const mdName = files.find((f) => f.endsWith(".md"));
  const jsonName = files.find((f) => f.endsWith(".json"));
  expect(mdName).toBeDefined();
  expect(jsonName).toBeDefined();
  const md = await readFile(path.join(outDir, mdName as string), "utf8");
  const index = JSON.parse(await readFile(path.join(outDir, jsonName as string), "utf8"));
  return { md, index };
}

describe("run – e2e AI vrstva (brána klíče v reálném výstupu)", () => {
  it("bez klíče: JSON ai=skipped a .md hlásí 'AI přeskočeno: chybí ANTHROPIC_API_KEY'", async () => {
    vi.stubEnv(AI_KEY_ENV, ""); // prázdný klíč = jako by nebyl
    await writeFile(path.join(proj, "a.ts"), "export const x = 1;\n", "utf8");

    const outDir = path.join(proj, "report");
    const code = await run([proj, "--out", outDir], proj);
    expect(code).toBe(0);

    const { md, index } = await readJson(outDir);
    expect(index.ai).toEqual({ kind: "skipped", reason: "chybí ANTHROPIC_API_KEY" });
    expect(md).toContain("AI přeskočeno: chybí ANTHROPIC_API_KEY");
  });

  it("s klíčem: JSON ai=ready, .md hlásí 'připraveno' a hodnota klíče NEunikne", async () => {
    vi.stubEnv(AI_KEY_ENV, "sk-ant-super-secret");
    await writeFile(path.join(proj, "a.ts"), "export const x = 1;\n", "utf8");

    const outDir = path.join(proj, "report");
    const code = await run([proj, "--out", outDir], proj);
    expect(code).toBe(0);

    const { md, index } = await readJson(outDir);
    // Mutace cli.ts na detectAiStatus({}) by tady dala skipped → test padne.
    expect(index.ai).toEqual({ kind: "ready" });
    expect(md).toContain("AI připraveno (klíč nalezen, dotaz zatím neproběhl)");
    // Tajemství se nesmí dostat do perzistovaných artefaktů.
    expect(md).not.toContain("super-secret");
    expect(JSON.stringify(index)).not.toContain("super-secret");
  });
});
