import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runIsolated } from "./runIsolated.js";

// Harness testujeme drobnými .mjs fixturami (ne reálným analyzátorem): node je
// spustí přímo, bez tsx, deterministicky a rychle. Reálný běh tsc/ESLint přes
// fork (analyzeChild) ověřují cli.tsc.test.ts / cli.eslint.test.ts (happy-path).

const dirs: string[] = [];
async function fixture(name: string, body: string): Promise<string> {
  const d = await mkdtemp(path.join(tmpdir(), "vibe-iso-"));
  dirs.push(d);
  const p = path.join(d, name);
  await writeFile(p, body);
  return p;
}
afterEach(async () => {
  for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true });
});

describe("runIsolated", () => {
  it("ok: vrátí výsledek dítěte a předtím relayuje 'started'", async () => {
    const child = await fixture(
      "ok.mjs",
      `process.on('message', (m) => {
         process.send({ type: 'started', fileCount: 7 });
         process.send({ type: 'result', payload: { echoed: m.x } }, () => process.exit(0));
       });`,
    );
    let started = -1;
    const outcome = await runIsolated({
      childPath: child,
      payload: { x: 42 },
      timeoutMs: 10_000,
      onStarted: (m) => {
        started = m.fileCount;
      },
    });
    expect(started).toBe(7);
    expect(outcome).toEqual({ kind: "ok", value: { echoed: 42 } });
  }, 15_000);

  it("oom: dítě vyčerpá paměť → 'oom' (NE 'crashed')", async () => {
    // tight-loop alokace JS polí v old space; --max-old-space-size=64 ho rychle sekne
    const child = await fixture(
      "oom.mjs",
      `process.on('message', () => {
         const sink = [];
         while (true) sink.push(new Array(1_000_000).fill(7));
       });`,
    );
    const outcome = await runIsolated({
      childPath: child,
      execArgv: ["--max-old-space-size=64"],
      payload: {},
      timeoutMs: 15_000,
    });
    // klíčové rozlišení: paměť, ne obecný pád ani timeout
    expect(outcome.kind).toBe("oom");
  }, 20_000);

  it("timeout: dítě se zasekne → 'timeout' (NE 'oom'/'crashed')", async () => {
    const child = await fixture(
      "hang.mjs",
      `process.on('message', () => { setInterval(() => {}, 1_000_000); });`, // nikdy nepošle result
    );
    const outcome = await runIsolated({
      childPath: child,
      payload: {},
      timeoutMs: 1_200, // ne moc těsné: fork + start dítěte musí stihnout naběhnout, ať neměříme závod
    });
    expect(outcome.kind).toBe("timeout");
  }, 15_000);

  it("crash: dítě spadne z jiného důvodu → 'crashed' se stderr (NE lživé 'oom'/'timeout')", async () => {
    const child = await fixture(
      "boom.mjs",
      `process.on('message', () => { process.stderr.write('rozbil jsem se\\n'); process.exit(1); });`,
    );
    const outcome = await runIsolated({
      childPath: child,
      payload: {},
      timeoutMs: 10_000,
    });
    expect(outcome.kind).toBe("crashed");
    if (outcome.kind !== "crashed") return;
    expect(outcome.detail).toContain("rozbil jsem se");
  }, 15_000);

  it("crash: chybný child skript (fork selže nebo hned umře) → 'crashed', ne hang", async () => {
    const outcome = await runIsolated({
      childPath: path.join(tmpdir(), "vibe-neexistuje-xyz.mjs"),
      payload: {},
      timeoutMs: 5_000,
    });
    expect(outcome.kind).toBe("crashed");
  }, 10_000);
});
