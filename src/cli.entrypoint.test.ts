import { execFileSync } from "node:child_process";
import { chmod, copyFile, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Reálné integrační testy spustitelnosti binárky. Po zrušení isEntrypoint drží
// dvě záruky: (1) CLI se po instalaci přes symlink opravdu spustí, (2) procesní
// launcher bin.ts převede pád run() na nenulový exit. Oboje běží proti reálnému
// zkompilovanému dist/bin.js, ne přes tsx.
const projectRoot = path.resolve(fileURLToPath(import.meta.url), "..", "..");
const distBin = path.join(projectRoot, "dist", "bin.js");

// Jeden build pro celý soubor – ať se dva testy neperou o zápis do dist/.
beforeAll(() => {
  execFileSync("npm", ["run", "build"], { cwd: projectRoot, stdio: "ignore" });
}, 120000);

describe("CLI vstupní bod přes symlink (npm bin)", () => {
  let linkDir: string;
  let link: string;

  // POZOR (nález 3-5): npm volá binárku JMÉNEM a spoléhá na (1) shebang
  // '#!/usr/bin/env node' a (2) execute bit. `node <symlink>` ten mechanismus
  // NEOVĚŘÍ (obejde shebang i +x). Proto symlink spouštíme i PŘÍMO – po chmod +x,
  // který reálně přidává až `npm install` (bin-links), v repu chybí.
  beforeAll(async () => {
    await chmod(distBin, 0o755); // simulace npm bin-links (tsc execute bit nedá)
    linkDir = await mkdtemp(path.join(tmpdir(), "vibe-bin-"));
    link = path.join(linkDir, "vibeanalyzer");
    await symlink(distBin, link);
  });

  afterAll(async () => {
    await rm(linkDir, { recursive: true, force: true }).catch(() => {});
  });

  it("dist/bin.js má korektní shebang (jinak přímé spuštění selže)", async () => {
    const firstLine = (await readFile(distBin, "utf8")).split("\n", 1)[0];
    expect(firstLine).toBe("#!/usr/bin/env node");
  });

  it("modul se spustí pod node přes symlink (izoluje korektnost modulu)", () => {
    const out = execFileSync("node", [link, "--help"], { encoding: "utf8" });
    expect(out.trim().length).toBeGreaterThan(0);
    expect(out).toContain("VibeAnalyzer");
  });

  it("binárku lze spustit PŘÍMO jménem – shebang + execute bit (npm-bin mechanismus)", () => {
    // bez +x nebo s rozbitým shebangem tohle padne 'Permission denied' / exec error
    const out = execFileSync(link, ["--help"], { encoding: "utf8" });
    expect(out).toContain("VibeAnalyzer");
  });
});

// Nález 3-6: procesní launcher bin.ts má převést nezachycenou výjimku z run() na
// 'Neočekávaná chyba' + nenulový exit (a jinak věrně propsat návratový kód).
// run() svoje chyby chytá sám a scanTree je defenzivní, takže pád přes reálný
// vstup deterministicky nevyvoláme. Místo toho spustíme REÁLNÝ dist/bin.js
// (zkopírovaný, ne ručně přepsaný) vedle PODVRŽENÉ ./cli.js, kterou si bin.js
// natáhne relativním importem – tím launcher izolujeme od skutečného run().
describe("bin.ts launcher – chování při běhu run()", () => {
  // Spustí kopii reálného bin.js vedle dané (podvržené) cli.js a vrátí výsledek.
  async function runLauncherWith(cliBody: string): Promise<{ status: number | null; stderr: string; stdout: string }> {
    const dir = await mkdtemp(path.join(tmpdir(), "vibe-launch-"));
    try {
      await writeFile(path.join(dir, "cli.js"), cliBody, "utf8");
      // bin.js importuje i ./readlineAsk.js – v izolaci ho musíme podvrhnout, ať
      // se ESM import vyřeší. V neinteraktivním běhu (stdio pipe) se nevolá, jen
      // musí existovat, aby launcher vůbec naběhl.
      await writeFile(
        path.join(dir, "readlineAsk.js"),
        "export function createReadlineAsk() { return { ask: undefined, close() {} }; }\n",
        "utf8",
      );
      await copyFile(distBin, path.join(dir, "bin.js")); // reálný shipovaný launcher
      try {
        // stdio pipe: stderr zachytit do proměnné, ne nechat protéct do logu testů
        const stdout = execFileSync("node", [path.join(dir, "bin.js")], {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
        });
        return { status: 0, stderr: "", stdout };
      } catch (e: unknown) {
        const ex = e as { status?: number | null; stderr?: string; stdout?: string };
        return { status: ex.status ?? null, stderr: ex.stderr ?? "", stdout: ex.stdout ?? "" };
      }
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  }

  it("run() hodí → exit 1 + 'Neočekávaná chyba' na stderr (ne tichý pád)", async () => {
    const { status, stderr } = await runLauncherWith(
      "export async function run() { throw new Error('výbuch z testu (3-6)'); }\n",
    );
    expect(status).toBe(1);
    expect(stderr).toContain("Neočekávaná chyba");
    expect(stderr).toContain("výbuch z testu (3-6)");
  });

  it("run() vrátí nenulový kód → launcher ho věrně propíše do exit kódu", async () => {
    const { status } = await runLauncherWith("export async function run() { return 3; }\n");
    expect(status).toBe(3);
  });

  it("run() vrátí 0 → exit 0 (happy path launcheru)", async () => {
    const { status } = await runLauncherWith("export async function run() { return 0; }\n");
    expect(status).toBe(0);
  });
});
