import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runIsolated, STDERR_CAP } from "./runIsolated.js";

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

  it("strop stderr: upovídané dítě s OOM signaturou na KONCI → stále 'oom'", async () => {
    // dítě vychrlí >strop balastu a OOM signaturu napíše až NAKONEC. Head-only strop
    // by FATAL ERROR zahodil → 'crashed'. Tail-preserving ho zachová → 'oom'.
    // writeSync(2,…): synchronní zápis na fd 2 zaručí, že balast i koncová signatura
    // dorazí rodiči ještě před process.exit (na rozdíl od asynchronního stderr.write).
    const child = await fixture(
      "verbose-oom.mjs",
      `import { writeSync } from 'node:fs';
       process.on('message', () => {
         const line = 'x'.repeat(1024) + '\\n';
         for (let i = 0; i < 200; i++) writeSync(2, line); // ~200 KiB balastu (> strop)
         writeSync(2, 'FATAL ERROR: Ineffective mark-compacts near heap limit Allocation failed - JavaScript heap out of memory\\n');
         process.exit(1); // ne OOM exit kód: detekce MUSÍ stát na stderru
       });`,
    );
    const outcome = await runIsolated({ childPath: child, payload: {}, timeoutMs: 10_000 });
    expect(outcome.kind).toBe("oom");
  }, 15_000);

  it("strop stderr: balast dítěte je oříznut na STDERR_CAP (ne neomezené hromadění)", async () => {
    // dítě vychrlí ~500 KiB stderru a spadne BEZ OOM signatury → 'crashed' s detailem.
    // detail = "kód 3\\n" + stderr; stderr musí být oříznutý na strop. Bez stropu by
    // detail měl ~500 KiB a tento assert padl.
    const child = await fixture(
      "verbose-crash.mjs",
      `import { writeSync } from 'node:fs';
       process.on('message', () => {
         const line = 'y'.repeat(1024) + '\\n';
         for (let i = 0; i < 500; i++) writeSync(2, line); // ~500 KiB
         process.exit(3); // plain pád, žádná OOM signatura
       });`,
    );
    const outcome = await runIsolated({ childPath: child, payload: {}, timeoutMs: 10_000 });
    expect(outcome.kind).toBe("crashed");
    if (outcome.kind !== "crashed") return;
    expect(outcome.detail).not.toContain("memory"); // OOM signatura tu nesmí být (falešné 'oom')
    expect(outcome.detail.length).toBeLessThanOrEqual(STDERR_CAP + 16); // "kód 3\\n" prefix se vejde do rezervy
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
