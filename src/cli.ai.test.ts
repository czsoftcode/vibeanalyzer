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

  it("--ai-check + klíč + ping resolve (fake) → JSON ai=verified, .md hlásí 'ověřeno'", async () => {
    vi.stubEnv(AI_KEY_ENV, "sk-ant-super-secret");
    await writeFile(path.join(proj, "a.ts"), "export const x = 1;\n", "utf8");

    const ping = vi.fn(async () => {}); // fake: žádná síť, jen resolve
    const outDir = path.join(proj, "report");
    const code = await run([proj, "--out", outDir, "--ai-check"], proj, {
      aiPingFn: ping,
      aiClassifyFn: () => null,
    });
    expect(code).toBe(0);
    expect(ping).toHaveBeenCalledOnce();

    const { md, index } = await readJson(outDir);
    expect(index.ai).toEqual({ kind: "verified" });
    expect(md).toContain("AI ověřeno (testovací dotaz na API proběhl");
    expect(JSON.stringify(index)).not.toContain("super-secret");
  });

  it("--ai-check bez klíče → ai=skipped, ping se nezavolá, na stderr hláška jak klíč nastavit, exit 0", async () => {
    vi.stubEnv(AI_KEY_ENV, ""); // bez klíče
    await writeFile(path.join(proj, "a.ts"), "export const x = 1;\n", "utf8");

    const ping = vi.fn(async () => {});
    const outDir = path.join(proj, "report");
    const code = await run([proj, "--out", outDir, "--ai-check"], proj, {
      aiPingFn: ping,
      aiClassifyFn: () => null,
    });
    expect(code).toBe(0); // selhání AI nesmí shodit exit kód – strojový report se vyrobí
    expect(ping).not.toHaveBeenCalled(); // bez klíče se vůbec nevolá síť

    const { index } = await readJson(outDir);
    expect(index.ai).toEqual({ kind: "skipped", reason: "chybí ANTHROPIC_API_KEY" });

    // Hláška „jak nastavit klíč" jde na stderr (ne do reportu) a zmiňuje env i --env-file.
    const errs = vi.mocked(console.error).mock.calls.map((c) => String(c[0])).join("\n");
    expect(errs).toContain("ANTHROPIC_API_KEY");
    expect(errs).toContain("--env-file");
  });

  it("--ai s klíčem (fake analyze) → JSON ai=analyzed, prompt nesl kód+non-goal, cena na stderr", async () => {
    vi.stubEnv(AI_KEY_ENV, "sk-ant-super-secret");
    await writeFile(path.join(proj, "a.ts"), "export const x = 1;\n", "utf8");
    await writeFile(
      path.join(proj, "project.md"),
      "## What I'm building\nCLI nástroj.\n\n## Non-goals\n- Do not run code.\n",
      "utf8",
    );

    const seen: { system: string; prompt: string }[] = [];
    const analyze = vi.fn(async (_key: string, _model: string, system: string, prompt: string) => {
      seen.push({ system, prompt });
      return {
        rawText: JSON.stringify({
          findings: [{ file: "a.ts", line: 1, nonGoalIndex: 0, severity: "error", message: "spouští kód" }],
        }),
        usage: { inputTokens: 1500, outputTokens: 80 },
        stopReason: "end_turn",
      };
    });

    const outDir = path.join(proj, "report");
    const code = await run([proj, "--out", outDir, "--ai"], proj, {
      aiAnalyzeFn: analyze,
      aiClassifyFn: () => null,
    });
    expect(code).toBe(0);
    expect(analyze).toHaveBeenCalledOnce();
    // Prompt skutečně nese poslaný kód i deklarovaný non-goal (kontrakt zapojení).
    expect(seen[0].prompt).toContain("export const x = 1;");
    expect(seen[0].prompt).toContain("Do not run code.");

    const { md, index } = await readJson(outDir);
    const ai = index.ai as { kind: string; model: string; findings: unknown[]; usage: { inputTokens: number; outputTokens: number }; costUsd: number };
    expect(ai.kind).toBe("analyzed");
    expect(ai.model).toBe("opus");
    expect(ai.findings).toHaveLength(1);
    expect(ai.usage).toEqual({ inputTokens: 1500, outputTokens: 80 });
    // opus: 1500/1e6*5 + 80/1e6*25 = 0.0075 + 0.002 = 0.0095
    expect(ai.costUsd).toBeCloseTo(0.0095, 6);
    expect(md).toContain("AI analýza non-goalů");
    expect(md).toContain("spouští kód");

    // Cena na stderr; klíč ani v reportu, ani na stderr.
    const errs = vi.mocked(console.error).mock.calls.map((c) => String(c[0])).join("\n");
    expect(errs).toContain("odhad ceny ~$0.0095");
    expect(errs).not.toContain("super-secret");
    expect(JSON.stringify(index)).not.toContain("super-secret");
    expect(md).not.toContain("super-secret");
  });

  it("--ai bez klíče → ai=skipped, analyze se nezavolá, hláška na stderr, exit 0", async () => {
    vi.stubEnv(AI_KEY_ENV, "");
    await writeFile(path.join(proj, "a.ts"), "export const x = 1;\n", "utf8");

    const analyze = vi.fn(async () => ({ rawText: "{}", usage: { inputTokens: 0, outputTokens: 0 }, stopReason: "end_turn" }));
    const outDir = path.join(proj, "report");
    const code = await run([proj, "--out", outDir, "--ai"], proj, {
      aiAnalyzeFn: analyze,
      aiClassifyFn: () => null,
    });
    expect(code).toBe(0);
    expect(analyze).not.toHaveBeenCalled(); // bez klíče se ani nečte projekt, ani nevolá API

    const { index } = await readJson(outDir);
    expect(index.ai).toEqual({ kind: "skipped", reason: "chybí ANTHROPIC_API_KEY" });
    const errs = vi.mocked(console.error).mock.calls.map((c) => String(c[0])).join("\n");
    expect(errs).toContain("ANTHROPIC_API_KEY");
  });
});
