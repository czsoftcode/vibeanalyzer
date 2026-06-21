import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AI_KEY_ENV, AI_PROVIDERS } from "./analyze/aiStatus.js";
import { run } from "./cli.js";

// End-to-end: skutečný běh CLI nad fixturou. Hlídá KONTRAKT mezi cli.ts a JSON –
// že reálné process.env opravdu protéká do pole `ai` (souhrn dvou režimů). Unit testy
// testují jen builder s mockem; tady ověřujeme zapojení. Mutace
// detectAiStatus(process.env) → detectAiStatus({}) musí shodit "s klíčem" větev.
process.env.VIBE_ANALYSIS_INPROCESS = "1";

let proj: string;

beforeEach(async () => {
  proj = await mkdtemp(path.join(tmpdir(), "vibe-cli-ai-"));
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  // Hermetičnost: reálný ZAI_API_KEY v prostředí jinak protéká do detectAiStatus a u
  // "bez klíče" větví přidá nápovědu "nalezen ZAI_API_KEY – přidej --ai-model=glm?",
  // takže testy gating na Anthropic byly nedeterministické. Default = žádný alt klíč;
  // test, který glm klíč chce, ať si ho stubne explicitně.
  vi.stubEnv(AI_PROVIDERS.glm.keyEnv, "");
});

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  await rm(proj, { recursive: true, force: true }).catch(() => {});
});

interface AiStatusShape {
  kind: string;
  model?: string;
  findings?: unknown[];
  usage?: { inputTokens: number; outputTokens: number };
  costUsd?: number;
  reason?: string;
}

async function readJson(outDir: string): Promise<{ md: string; index: { ai: { nonGoal: AiStatusShape; code: AiStatusShape; logic: AiStatusShape } } }> {
  const files = await readdir(outDir);
  const mdName = files.find((f) => f.endsWith(".md"));
  const jsonName = files.find((f) => f.endsWith(".json"));
  expect(mdName).toBeDefined();
  expect(jsonName).toBeDefined();
  const md = await readFile(path.join(outDir, mdName as string), "utf8");
  const index = JSON.parse(await readFile(path.join(outDir, jsonName as string), "utf8"));
  return { md, index };
}

describe("run – e2e AI vrstva (souhrn dvou režimů v reálném výstupu)", () => {
  it("default běh bez klíče: oba režimy skipped, .md hlásí 'chybí ANTHROPIC_API_KEY'", async () => {
    vi.stubEnv(AI_KEY_ENV, ""); // prázdný klíč = jako by nebyl
    await writeFile(path.join(proj, "a.ts"), "export const x = 1;\n", "utf8");

    const outDir = path.join(proj, "report");
    const code = await run([proj, "--out", outDir], proj);
    expect(code).toBe(0);

    const { md, index } = await readJson(outDir);
    expect(index.ai.nonGoal).toEqual({ kind: "skipped", reason: "chybí ANTHROPIC_API_KEY" });
    expect(index.ai.code).toEqual({ kind: "skipped", reason: "chybí ANTHROPIC_API_KEY" });
    expect(md).toContain("Přeskočeno: chybí ANTHROPIC_API_KEY");
  });

  it("default běh s klíčem: oba ready, .md hlásí 'připraveno' a hodnota klíče NEunikne", async () => {
    vi.stubEnv(AI_KEY_ENV, "sk-ant-super-secret");
    await writeFile(path.join(proj, "a.ts"), "export const x = 1;\n", "utf8");

    const outDir = path.join(proj, "report");
    const code = await run([proj, "--out", outDir], proj);
    expect(code).toBe(0);

    const { md, index } = await readJson(outDir);
    // Mutace cli.ts na detectAiStatus({}) by tady dala skipped → test padne.
    expect(index.ai.nonGoal).toEqual({ kind: "ready" });
    expect(index.ai.code).toEqual({ kind: "ready" });
    expect(md).toContain("Připraveno (klíč nalezen, dotaz zatím neproběhl)");
    expect(md).not.toContain("super-secret");
    expect(JSON.stringify(index)).not.toContain("super-secret");
  });

  it("--ai-check + klíč + ping resolve (fake) → oba režimy verified, .md hlásí 'ověřeno'", async () => {
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
    expect(index.ai.nonGoal).toEqual({ kind: "verified" });
    expect(index.ai.code).toEqual({ kind: "verified" });
    expect(md).toContain("Ověřeno (testovací dotaz na API proběhl");
    expect(JSON.stringify(index)).not.toContain("super-secret");
  });

  it("--ai-check bez klíče → oba skipped, ping se nezavolá, na stderr hláška jak klíč nastavit, exit 0", async () => {
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
    expect(index.ai.nonGoal).toEqual({ kind: "skipped", reason: "chybí ANTHROPIC_API_KEY" });
    expect(index.ai.code).toEqual({ kind: "skipped", reason: "chybí ANTHROPIC_API_KEY" });

    const errs = vi.mocked(console.error).mock.calls.map((c) => String(c[0])).join("\n");
    expect(errs).toContain("ANTHROPIC_API_KEY");
    expect(errs).toContain("--env-file");
  });

  it("--ai-non-goal s klíčem → nonGoal=analyzed, code zůstane ready (nevyžádán), prompt nesl kód+non-goal", async () => {
    vi.stubEnv(AI_KEY_ENV, "sk-ant-super-secret");
    await writeFile(path.join(proj, "a.ts"), "export const x = 1;\n", "utf8");
    await writeFile(
      path.join(proj, "project.md"),
      "## What I'm building\nCLI nástroj.\n\n## Non-goals\n- Do not run code.\n",
      "utf8",
    );

    const seen: { system: string; prompt: string; schema: Record<string, unknown> }[] = [];
    const analyze = vi.fn(async (_key: string, _model: string, system: string, prompt: string, schema: Record<string, unknown>) => {
      seen.push({ system, prompt, schema });
      return {
        rawText: JSON.stringify({
          findings: [{ file: "a.ts", line: 1, nonGoalIndex: 0, severity: "error", message: "spouští kód" }],
        }),
        usage: { inputTokens: 1500, outputTokens: 80 },
        stopReason: "end_turn",
      };
    });

    const outDir = path.join(proj, "report");
    const code = await run([proj, "--out", outDir, "--ai-non-goal"], proj, {
      aiAnalyzeFn: analyze,
      aiClassifyFn: () => null,
    });
    expect(code).toBe(0);
    expect(analyze).toHaveBeenCalledOnce(); // jen non-goal režim
    expect(seen[0].prompt).toContain("export const x = 1;");
    expect(seen[0].prompt).toContain("Do not run code.");

    const { md, index } = await readJson(outDir);
    expect(index.ai.nonGoal.kind).toBe("analyzed");
    expect(index.ai.nonGoal.model).toBe("opus");
    expect(index.ai.nonGoal.findings).toHaveLength(1);
    expect(index.ai.nonGoal.usage).toEqual({ inputTokens: 1500, outputTokens: 80 });
    expect(index.ai.nonGoal.costUsd).toBeCloseTo(0.0095, 6); // 1500/1e6*5 + 80/1e6*25
    expect(index.ai.code).toEqual({ kind: "ready" }); // code nevyžádán
    expect(md).toContain("Porušení non-goalů (--ai-non-goal)");
    expect(md).toContain("spouští kód");

    const errs = vi.mocked(console.error).mock.calls.map((c) => String(c[0])).join("\n");
    expect(errs).toContain("odhad ceny ~$0.0095");
    expect(errs).not.toContain("super-secret");
    expect(JSON.stringify(index)).not.toContain("super-secret");
    expect(md).not.toContain("super-secret");
  });

  it("--ai-logic s klíčem a záměrem → logic=analyzed, ostatní ready; prompt nese záměr, NE non-goaly; report přizná aproximaci", async () => {
    vi.stubEnv(AI_KEY_ENV, "sk-ant-secret-logic");
    await writeFile(path.join(proj, "a.ts"), "export const x = 1;\n", "utf8");
    await writeFile(
      path.join(proj, "project.md"),
      "## What I'm building\nCLI co umí Y.\n\n## Non-goals\n- Do not run code.\n",
      "utf8",
    );

    const seen: { system: string; prompt: string; schema: Record<string, unknown> }[] = [];
    const analyze = vi.fn(async (_key: string, _model: string, system: string, prompt: string, schema: Record<string, unknown>) => {
      seen.push({ system, prompt, schema });
      return {
        rawText: JSON.stringify({
          findings: [{ kind: "chybí funkčnost", severity: "error", message: "neumí slíbené Y" }],
        }),
        usage: { inputTokens: 500, outputTokens: 30 },
        stopReason: "end_turn",
      };
    });

    const outDir = path.join(proj, "report");
    const code = await run([proj, "--out", outDir, "--ai-logic"], proj, {
      aiAnalyzeFn: analyze,
      aiClassifyFn: () => null,
    });
    expect(code).toBe(0);
    expect(analyze).toHaveBeenCalledOnce();
    // logic posílá záměr, ale NE non-goaly (ty řeší --ai-non-goal)
    expect(seen[0].prompt).toContain("What I'm building");
    expect(seen[0].prompt).toContain("CLI co umí Y.");
    expect(seen[0].prompt).not.toContain("Do not run code.");
    // logic schéma: file/line nepovinné, BEZ nonGoalIndex
    const items = (seen[0].schema as { properties: { findings: { items: { required: string[]; properties: Record<string, unknown> } } } }).properties.findings.items;
    expect(items.required).not.toContain("file");
    expect(items.properties.nonGoalIndex).toBeUndefined();

    const { md, index } = await readJson(outDir);
    expect(index.ai.logic.kind).toBe("analyzed");
    expect(index.ai.logic.findings).toHaveLength(1);
    expect(index.ai.logic.usage).toEqual({ inputTokens: 500, outputTokens: 30 });
    expect(index.ai.nonGoal).toEqual({ kind: "ready" }); // non-goal nevyžádán
    expect(index.ai.code).toEqual({ kind: "ready" }); // code nevyžádán
    expect(md).toContain("Logika vs záměr (--ai-logic)");
    expect(md).toContain("neúplná APROXIMACE");
    expect(md).toContain("neumí slíbené Y");
    expect(JSON.stringify(index)).not.toContain("secret-logic");
    expect(md).not.toContain("secret-logic");
  });

  it("--ai-logic bez záměru (project.md chybí) → logic=skipped s důvodem, žádné volání API", async () => {
    vi.stubEnv(AI_KEY_ENV, "sk-ant-key");
    await writeFile(path.join(proj, "a.ts"), "export const x = 1;\n", "utf8");
    // ŽÁDNÝ project.md → bez záměru

    const analyze = vi.fn(async () => ({ rawText: "{}", usage: { inputTokens: 1, outputTokens: 1 }, stopReason: "end_turn" }));
    const outDir = path.join(proj, "report");
    const code = await run([proj, "--out", outDir, "--ai-logic"], proj, {
      aiAnalyzeFn: analyze,
      aiClassifyFn: () => null,
    });
    expect(code).toBe(0); // bez záměru se logic čistě přeskočí, exit 0
    expect(analyze).not.toHaveBeenCalled(); // brána na záměru → žádný drahý dotaz
    const { index } = await readJson(outDir);
    expect(index.ai.logic.kind).toBe("skipped");
    expect(index.ai.logic.reason).toContain("záměr");
  });

  it("--ai-code s klíčem → code=analyzed (s druhem problému), nonGoal zůstane ready; prompt NEnese non-goaly", async () => {
    vi.stubEnv(AI_KEY_ENV, "sk-ant-secret-code");
    await writeFile(path.join(proj, "a.ts"), "export const x = 1;\n", "utf8");
    await writeFile(
      path.join(proj, "project.md"),
      "## What I'm building\nCLI nástroj.\n\n## Non-goals\n- Do not run code.\n",
      "utf8",
    );

    const seen: { system: string; prompt: string; schema: Record<string, unknown> }[] = [];
    const analyze = vi.fn(async (_key: string, _model: string, system: string, prompt: string, schema: Record<string, unknown>) => {
      seen.push({ system, prompt, schema });
      return {
        rawText: JSON.stringify({
          findings: [{ file: "a.ts", line: 1, kind: "riskantní vzorec", severity: "warning", message: "nebezpečné přiřazení" }],
        }),
        usage: { inputTokens: 900, outputTokens: 40 },
        stopReason: "end_turn",
      };
    });

    const outDir = path.join(proj, "report");
    const code = await run([proj, "--out", outDir, "--ai-code"], proj, {
      aiAnalyzeFn: analyze,
      aiClassifyFn: () => null,
    });
    expect(code).toBe(0);
    expect(analyze).toHaveBeenCalledOnce();
    // code režim posílá kód, ale NE non-goaly (je na nich nezávislý)
    expect(seen[0].prompt).toContain("export const x = 1;");
    expect(seen[0].prompt).not.toContain("Do not run code.");
    // REGRESE (reálný běh): code dotaz MUSÍ dostat CODE schéma (s kind, bez nonGoalIndex),
    // ne non-goal schéma – jinak model vrátí tvar, který parseCodeFindings odmítne.
    const items = (seen[0].schema.properties as { findings: { items: { properties: Record<string, unknown> } } }).findings.items;
    expect(items.properties.kind).toBeDefined();
    expect(items.properties.nonGoalIndex).toBeUndefined();

    const { md, index } = await readJson(outDir);
    expect(index.ai.code.kind).toBe("analyzed");
    expect(index.ai.code.findings).toHaveLength(1);
    expect(index.ai.code.usage).toEqual({ inputTokens: 900, outputTokens: 40 });
    expect(index.ai.nonGoal).toEqual({ kind: "ready" }); // non-goal nevyžádán
    expect(md).toContain("Kvalita a rizika kódu (--ai-code)");
    expect(md).toContain("nebezpečné přiřazení");
    expect(md).toContain("kód: riskantní vzorec");
  });

  it("--ai-non-goal --ai-code naráz → oba analyzed, analyze volán 2× (každý vlastní dotaz), payload čten jednou", async () => {
    vi.stubEnv(AI_KEY_ENV, "sk-ant-key");
    await writeFile(path.join(proj, "a.ts"), "export const x = 1;\n", "utf8");
    await writeFile(
      path.join(proj, "project.md"),
      "## What I'm building\nCLI.\n\n## Non-goals\n- Do not run code.\n",
      "utf8",
    );

    // oba režimy vracejí prázdný seznam (validní pro oba parsery) – ověřujeme zapojení
    const analyze = vi.fn(async () => ({
      rawText: JSON.stringify({ findings: [] }),
      usage: { inputTokens: 500, outputTokens: 10 },
      stopReason: "end_turn",
    }));

    const outDir = path.join(proj, "report");
    // --ai-yes: dva režimy na opusu mají worst-case odhad > práh ($0.80) → bez potvrzení
    // by je brána přeskočila. Tady testujeme zapojení analýzy, ne bránu, proto cenu potvrdíme.
    const code = await run([proj, "--out", outDir, "--ai-non-goal", "--ai-code", "--ai-yes"], proj, {
      aiAnalyzeFn: analyze,
      aiClassifyFn: () => null,
    });
    expect(code).toBe(0);
    expect(analyze).toHaveBeenCalledTimes(2); // dva nezávislé dotazy = dvojí cena

    const { md, index } = await readJson(outDir);
    expect(index.ai.nonGoal.kind).toBe("analyzed");
    expect(index.ai.code.kind).toBe("analyzed");
    expect(md).toContain("Žádné porušení deklarovaných non-goalů nenalezeno");
    expect(md).toContain("Žádné závažné problémy kódu nenalezeny");
  });

  it("--ai-non-goal bez klíče → oba skipped, analyze se nezavolá, hláška na stderr, exit 0", async () => {
    vi.stubEnv(AI_KEY_ENV, "");
    await writeFile(path.join(proj, "a.ts"), "export const x = 1;\n", "utf8");

    const analyze = vi.fn(async () => ({ rawText: "{}", usage: { inputTokens: 0, outputTokens: 0 }, stopReason: "end_turn" }));
    const outDir = path.join(proj, "report");
    const code = await run([proj, "--out", outDir, "--ai-non-goal"], proj, {
      aiAnalyzeFn: analyze,
      aiClassifyFn: () => null,
    });
    expect(code).toBe(0);
    expect(analyze).not.toHaveBeenCalled(); // bez klíče se ani nečte projekt, ani nevolá API

    const { index } = await readJson(outDir);
    expect(index.ai.nonGoal).toEqual({ kind: "skipped", reason: "chybí ANTHROPIC_API_KEY" });
    expect(index.ai.code).toEqual({ kind: "skipped", reason: "chybí ANTHROPIC_API_KEY" });
    const errs = vi.mocked(console.error).mock.calls.map((c) => String(c[0])).join("\n");
    expect(errs).toContain("ANTHROPIC_API_KEY");
  });
});
