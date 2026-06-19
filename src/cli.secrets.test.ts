import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { run } from "./cli.js";

// End-to-end: skutečný běh CLI nad fixturou, čteme vygenerovaný .md i .json.
// In-process (bez forku), ať je rychlé – necílíme izolaci strojové vrstvy.
process.env.VIBE_ANALYSIS_INPROCESS = "1";

const FAKE_AWS_KEY = "AKIAIOSFODNN7EXAMPLE";

let proj: string;

beforeEach(async () => {
  proj = await mkdtemp(path.join(tmpdir(), "vibe-cli-sec-"));
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

describe("run – e2e hledání tajemství", () => {
  it("podvržený klíč v gitignorovaném .env report označí, ale plnou hodnotu NEvypíše", async () => {
    // .env je gitignorovaný → scanTree ho vynechá; najít ho musí cílený probe.
    await writeFile(path.join(proj, ".gitignore"), ".env\n", "utf8");
    await writeFile(path.join(proj, ".env"), `AWS_ACCESS_KEY_ID=${FAKE_AWS_KEY}\n`, "utf8");
    await mkdir(path.join(proj, "src"), { recursive: true });
    await writeFile(path.join(proj, "src", "index.ts"), "export const x = 1;\n", "utf8");

    const outDir = path.join(proj, "report");
    const code = await run([proj, "--out", outDir], proj);
    expect(code).toBe(0);

    const { md, json } = await readOutputs(outDir);

    // Nález je v reportu i v JSON.
    expect(md).toContain("## Strojové nálezy (tajemství)");
    expect(md).toContain("aws-access-key-id");
    expect(md).toContain(".env");
    const index = JSON.parse(json);
    expect(index.secrets.kind).toBe("ran");
    expect(index.secrets.findings.some((f: { rule: string }) => f.rule === "aws-access-key-id")).toBe(true);

    // ÚNIK: plná hodnota klíče se NESMÍ objevit ani v .md, ani v .json.
    expect(md.includes(FAKE_AWS_KEY)).toBe(false);
    expect(json.includes(FAKE_AWS_KEY)).toBe(false);
  });

  it("čistý projekt → sekce hlásí 'čistý', ne nález a ne přeskočeno", async () => {
    await mkdir(path.join(proj, "src"), { recursive: true });
    await writeFile(
      path.join(proj, "src", "index.ts"),
      "export const id = '550e8400-e29b-41d4-a716-446655440000';\n",
      "utf8",
    );

    const outDir = path.join(proj, "report");
    const code = await run([proj, "--out", outDir], proj);
    expect(code).toBe(0);

    const { md, json } = await readOutputs(outDir);
    expect(md).toContain("_Žádná tajemství nenalezena._");
    const index = JSON.parse(json);
    expect(index.secrets.kind).toBe("ran");
    expect(index.secrets.findings).toEqual([]);
  });
});
