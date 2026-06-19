import { execFile } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import { access, copyFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { ANALYSIS_TIMEOUT_MS } from "./analyze/limits.js";
import type { Finding, Severity } from "./findings.js";

/**
 * Audit závislostí přes `npm audit --json`. Vědomě OPT-IN a síťová operace –
 * volá se jen s `--audit`, jinak se vrstva přeskočí. Bezpečnostní jádro je v
 * IZOLACI: npm NEspouštíme v cizí složce. Zkopírujeme jen `package.json` + lockfile
 * do dočasného adresáře a audit pustíme TAM s vynuceným oficiálním registry a
 * sanitovaným prostředím. Tím se cizí `.npmrc`/proxy nikdy nepřečte (obrana proti
 * registry-hijacku) a drží se slib „čte, nespouští" (npm se cizího stromu netkne).
 */

/** Oficiální npm registry – vždy vynucené, ať nás cizí konfigurace nepřesměruje. */
export const OFFICIAL_REGISTRY = "https://registry.npmjs.org/";

/** Lockfily, které `npm audit` umí. yarn.lock/pnpm-lock NEpodporujeme (npm je nečte). */
const LOCKFILES = ["package-lock.json", "npm-shrinkwrap.json"] as const;

/**
 * Výsledek SPUŠTĚNÍ npm (ne parsování). Exit kód se ZÁMĚRNĚ ignoruje: `npm audit`
 * vrací nenulový kód, KDYŽ NAJDE zranitelnosti – to není selhání. `output` tedy
 * nese stdout bez ohledu na exit; selhání je jen nemožnost npm spustit / timeout.
 */
export type NpmRunOutcome =
  | { kind: "output"; stdout: string }
  | { kind: "spawn-failed"; reason: string }
  | { kind: "timeout" };

/** Vstup pro spouštěč npm auditu. */
export interface NpmAuditInput {
  cwd: string;
  /** true → přidá `--omit=dev` (jen produkční závislosti) */
  omitDev: boolean;
  registry: string;
  timeoutMs: number;
}

/** Injektovatelný spouštěč (testy podstrčí fake bez sítě). */
export type NpmAuditRunner = (input: NpmAuditInput) => Promise<NpmRunOutcome>;

/**
 * Prostředí pro npm se zbavené konfigurace, kterou by mohl ovlivnit cizí projekt
 * nebo přesměrovat odchozí spojení: `npm_config_*` (vč. registry) a `*_proxy`.
 * Uživatelovo vlastní `~/.npmrc` zůstává (to je důvěryhodné – běží na jeho stroji);
 * hrozbou je jen analyzovaný projekt, a ten je odstřižen tím, že běžíme v temp dir.
 */
function sanitizedEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (/^npm_config_/i.test(k)) continue;
    if (/_proxy$/i.test(k)) continue;
    env[k] = v;
  }
  return env;
}

/**
 * Spustí příkaz a zachytí stdout, výstup mapuje na NpmRunOutcome. NIKDY nerejectuje.
 * KLÍČOVÉ: nenulový exit kód NEBERE jako selhání – když je na stdoutu obsah, vrátí
 * ho jako `output` (npm audit s nálezy končí nenulově, ale JSON je validní). Selhání
 * je jen ENOENT (binárka chybí) nebo timeout (zabití procesu). Vyčleněno z runneru
 * kvůli testovatelnosti té pasti bez sítě (test pustí `node` se simulovaným exitem).
 */
export function runProcessForAudit(
  command: string,
  args: string[],
  opts: { cwd: string; timeoutMs: number; env?: NodeJS.ProcessEnv },
): Promise<NpmRunOutcome> {
  return new Promise<NpmRunOutcome>((resolve) => {
    execFile(
      command,
      args,
      {
        cwd: opts.cwd,
        timeout: opts.timeoutMs,
        killSignal: "SIGKILL",
        maxBuffer: 64 * 1024 * 1024,
        env: opts.env,
        windowsHide: true,
      },
      (err, stdout) => {
        if (err) {
          const e = err as NodeJS.ErrnoException & { killed?: boolean; signal?: string };
          if (e.code === "ENOENT") {
            resolve({ kind: "spawn-failed", reason: "npm nenalezen v PATH" });
            return;
          }
          // Přetečení maxBuffer (ořízne stdout) – kontroluj PŘED killed/signal, ať se
          // nepřevleče za timeout. Honest důvod, ne „nevalidní JSON".
          if (e.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") {
            resolve({ kind: "spawn-failed", reason: "npm audit vrátil příliš velký výstup (> 64 MB) – přeskočeno" });
            return;
          }
          // Timeout pozná JEN `killed === true` (to nastaví Node, když proces zabil
          // SÁM kvůli timeoutu). Externí SIGKILL/SIGTERM (typicky OOM killer) má
          // `killed === false` – NESMÍ se vydávat za „timeout/pomalá síť" (lživý důvod).
          if (e.killed === true) {
            resolve({ kind: "timeout" });
            return;
          }
          if (e.signal === "SIGKILL" || e.signal === "SIGTERM") {
            resolve({ kind: "spawn-failed", reason: `npm audit byl ukončen signálem ${e.signal} (možná docházela paměť)` });
            return;
          }
          // Nenulový exit kód = npm audit našel zranitelnosti → stdout MÁ JSON.
          if (typeof stdout === "string" && stdout.trim().length > 0) {
            resolve({ kind: "output", stdout });
            return;
          }
          resolve({ kind: "spawn-failed", reason: `npm audit selhal: ${e.message}` });
          return;
        }
        resolve({ kind: "output", stdout });
      },
    );
  });
}

/**
 * Reálný spouštěč: `npm audit --json` s vynuceným oficiálním registry a sanitovaným
 * prostředím. Stojí na runProcessForAudit (viz tam past s exit kódem).
 */
export const defaultNpmAuditRunner: NpmAuditRunner = (input) => {
  const args = ["audit", "--json", `--registry=${input.registry}`];
  if (input.omitDev) args.push("--omit=dev");
  return runProcessForAudit("npm", args, {
    cwd: input.cwd,
    timeoutMs: input.timeoutMs,
    env: sanitizedEnv(),
  });
};

/** Surový výstup auditu pro parser, nebo důvod přeskočení (rozlišitelně). */
export type AuditOutput =
  | { kind: "output"; stdout: string }
  | { kind: "skipped"; reason: string };

async function exists(p: string): Promise<boolean> {
  try {
    await access(p, fsConstants.R_OK);
    return true;
  } catch {
    return false;
  }
}

/** Najde první existující lockfile z `LOCKFILES`, nebo null. */
async function findLockfile(projectRoot: string): Promise<string | null> {
  for (const name of LOCKFILES) {
    if (await exists(path.join(projectRoot, name))) return name;
  }
  return null;
}

export interface CollectAuditOptions {
  /** true = zahrnout i vývojové závislosti; false = jen produkční (`--omit=dev`) */
  dev: boolean;
  /** injektovatelný spouštěč npm; default reálný */
  runner?: NpmAuditRunner;
  /** timeout; default ANALYSIS_TIMEOUT_MS */
  timeoutMs?: number;
}

/**
 * Připraví izolovaný běh `npm audit` a vrátí surový stdout, NEBO důvod skipu.
 * Kroky: ověř `package.json` + lockfile (jinak skip s důvodem) → zkopíruj je do
 * temp dir → spusť (injektovaný) runner s oficiálním registry → temp dir VŽDY ukliď.
 * Parsování stdoutu řeší volající (parseAuditJson) – tady jen běh a izolace.
 */
export async function collectAuditOutput(
  projectRoot: string,
  options: CollectAuditOptions,
): Promise<AuditOutput> {
  const runner = options.runner ?? defaultNpmAuditRunner;
  const timeoutMs = options.timeoutMs ?? ANALYSIS_TIMEOUT_MS;

  if (!(await exists(path.join(projectRoot, "package.json")))) {
    return { kind: "skipped", reason: "v projektu není package.json" };
  }
  const lockfile = await findLockfile(projectRoot);
  if (lockfile === null) {
    return {
      kind: "skipped",
      reason: "není package-lock.json ani npm-shrinkwrap.json (audit umí jen npm lockfile, ne yarn/pnpm)",
    };
  }

  const tmp = await mkdtemp(path.join(tmpdir(), "vibe-audit-"));
  try {
    await copyFile(path.join(projectRoot, "package.json"), path.join(tmp, "package.json"));
    await copyFile(path.join(projectRoot, lockfile), path.join(tmp, lockfile));

    const outcome = await runner({
      cwd: tmp,
      omitDev: !options.dev,
      registry: OFFICIAL_REGISTRY,
      timeoutMs,
    });

    if (outcome.kind === "timeout") {
      return { kind: "skipped", reason: "npm audit překročil časový limit (možná pomalá/nedostupná síť)" };
    }
    if (outcome.kind === "spawn-failed") {
      return { kind: "skipped", reason: outcome.reason };
    }
    return { kind: "output", stdout: outcome.stdout };
  } finally {
    // Úklid VŽDY – i při výjimce z copyFile/runneru. Žádný osiřelý temp adresář.
    await rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Parser npm audit JSON → strojové nálezy.
// ---------------------------------------------------------------------------

/** Počty zranitelností po závažnosti (z metadata, nebo dopočtené z nálezů). */
export interface AuditCounts {
  critical: number;
  high: number;
  moderate: number;
  low: number;
  info: number;
  total: number;
}

/**
 * Výsledek audit vrstvy. Stejný kontrakt jako Tsc/Eslint/SecretsResult: „ran s 0
 * nálezy" (čistý projekt) se NESMÍ splést se „skipped" (vrstva neproběhla / nešlo
 * parsovat). `skipped.reason` je konkrétní (nevyžádán / bez lockfilu / bez sítě /
 * neznámý formát …), aby report netvrdil „čisto" tam, kde se nic neměřilo.
 */
export type AuditResult =
  | { kind: "skipped"; reason: string }
  | { kind: "ran"; findings: Finding[]; counts: AuditCounts };

/** Mapování npm závažnosti na naši škálu. Neznámé → "info" (radši slabší než pád). */
function mapSeverity(npmSeverity: unknown): Severity {
  switch (npmSeverity) {
    case "critical":
    case "high":
      return "error";
    case "moderate":
      return "warning";
    default:
      return "info"; // low, info, i neznámé
  }
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

/** Z `url` advisory vytáhne GHSA id, jinak vrátí undefined. */
function ghsaFromUrl(url: unknown): string | undefined {
  if (typeof url !== "string") return undefined;
  const m = /GHSA-[0-9a-z-]+/i.exec(url);
  return m ? m[0] : undefined;
}

/** Lidský popis dostupnosti opravy (BEZ příkazu k auto-fixu – non-goal). */
function fixText(fixAvailable: unknown): string {
  if (fixAvailable === true) return "oprava: ano";
  if (fixAvailable === false || fixAvailable === undefined) return "oprava: ne";
  if (isObject(fixAvailable)) {
    const name = typeof fixAvailable.name === "string" ? fixAvailable.name : "?";
    const version = typeof fixAvailable.version === "string" ? fixAvailable.version : "?";
    const major = fixAvailable.isSemVerMajor === true ? ", major (breaking)" : "";
    return `oprava: ano (${name}@${version}${major})`;
  }
  return "oprava: ?";
}

/**
 * Z jednoho záznamu `vulnerabilities[name]` vyrobí Finding. `via` je pole, kde
 * položka je BUĎ string (jméno jiné zranitelné závislosti v řetězu) NEBO objekt
 * (konkrétní advisory s title/url/severity) – ošetřujeme obojí.
 */
function vulnToFinding(name: string, vuln: Record<string, unknown>): Finding {
  const severity = mapSeverity(vuln.severity);
  const range = typeof vuln.range === "string" ? vuln.range : "*";

  const viaArr = Array.isArray(vuln.via) ? vuln.via : [];
  const advisory = viaArr.find(isObject) as Record<string, unknown> | undefined;
  const title = advisory && typeof advisory.title === "string" ? advisory.title : undefined;
  const rule = advisory ? ghsaFromUrl(advisory.url) : undefined;

  let detail: string;
  if (title) {
    detail = title;
  } else {
    // Čistě tranzitivní: zranitelné kvůli závislosti(em) uvedeným jako string.
    const viaNames = viaArr.filter((x): x is string => typeof x === "string");
    detail =
      viaNames.length > 0
        ? `zranitelné přes ${viaNames.join(", ")}`
        : "zranitelná závislost (bez detailu advisory)";
  }

  return {
    source: "audit",
    severity,
    file: "package-lock.json",
    rule,
    message: `${name}@${range} – ${detail} (závažnost: ${String(vuln.severity ?? "neznámá")}); ${fixText(vuln.fixAvailable)}`,
  };
}

/** Spočítá counts z metadata, nebo (když chybí) dopočítá z nálezů podle severity. */
function readCounts(parsed: Record<string, unknown>, findings: Finding[]): AuditCounts {
  const meta = isObject(parsed.metadata) ? parsed.metadata : undefined;
  const mv = meta && isObject(meta.vulnerabilities) ? meta.vulnerabilities : undefined;
  if (mv) {
    const num = (k: string): number => (typeof mv[k] === "number" ? (mv[k] as number) : 0);
    return {
      critical: num("critical"),
      high: num("high"),
      moderate: num("moderate"),
      low: num("low"),
      info: num("info"),
      total: num("total"),
    };
  }
  // metadata chybí → hrubý odhad z našich nálezů (1 nález = 1 balík).
  return {
    critical: 0,
    high: 0,
    moderate: 0,
    low: 0,
    info: 0,
    total: findings.length,
  };
}

/**
 * Parsuje stdout `npm audit --json`. Vrací `ran` (i s 0 nálezy = čisto) nebo
 * `skipped` s důvodem. Skip nastane u: nevalidního JSON, top-level `error`
 * (síť/ENOAUDIT), a u jiného formátu než auditReportVersion 2 (npm v6 má
 * `advisories` – v1 nepodporujeme). Past s exit kódem řeší runner výš; sem chodí
 * stdout bez ohledu na kód.
 */
export function parseAuditJson(stdout: string): AuditResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return { kind: "skipped", reason: "npm audit vrátil nevalidní JSON (neočekávaný výstup)" };
  }
  if (!isObject(parsed)) {
    return { kind: "skipped", reason: "npm audit vrátil neočekávaný tvar výstupu" };
  }

  // npm hlásí provozní chybu (typicky síť: ENOTFOUND/ENOAUDIT) v `error`.
  if (isObject(parsed.error)) {
    const code = typeof parsed.error.code === "string" ? parsed.error.code : "neznámý kód";
    const summary = typeof parsed.error.summary === "string" ? parsed.error.summary : "";
    return { kind: "skipped", reason: `npm audit selhal (${code})${summary ? `: ${summary}` : ""}` };
  }

  if (parsed.auditReportVersion !== 2) {
    const ver = parsed.auditReportVersion ?? (isObject(parsed.advisories) ? "v6 (advisories)" : "neznámá");
    return {
      kind: "skipped",
      reason: `nepodporovaný formát npm audit (${String(ver)}); podporujeme jen auditReportVersion 2`,
    };
  }

  const vulns = isObject(parsed.vulnerabilities) ? parsed.vulnerabilities : {};
  const findings: Finding[] = [];
  for (const [name, raw] of Object.entries(vulns)) {
    if (isObject(raw)) findings.push(vulnToFinding(name, raw));
  }

  return { kind: "ran", findings, counts: readCounts(parsed, findings) };
}

/**
 * Veřejné API pro CLI: provede izolovaný `npm audit` a naparsuje výsledek.
 * Skládá `collectAuditOutput` (běh + izolace + skip důvody) a `parseAuditJson`.
 */
export async function auditDependencies(
  projectRoot: string,
  options: CollectAuditOptions,
): Promise<AuditResult> {
  const out = await collectAuditOutput(projectRoot, options);
  if (out.kind === "skipped") return out;
  return parseAuditJson(out.stdout);
}
