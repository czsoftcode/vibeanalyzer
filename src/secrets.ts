import { readdir, readFile, stat } from "node:fs/promises";
import * as path from "node:path";
import type { Finding, Severity } from "./findings.js";
import { isMinifiedName } from "./minified.js";
import type { FileEntry } from "./scan.js";

/**
 * Detektor tajemství: čistá funkce nad textem. Záměrně KONZERVATIVNÍ – hledá jen
 * známé, jednoznačné tvary (privátní klíče, cloud/SaaS tokeny podle veřejného
 * prefixu), NE obecnou entropii. Důvod: entropická detekce zaplaví report
 * falešnými poplachy (hashe, base64 data, UUID) a uživatel jí přestane věřit.
 * Radši míň nálezů, ale důvěryhodných.
 *
 * KLÍČOVÝ kontrakt: výstup NIKDY nenese celou hodnotu tajemství – jen veřejný
 * prefix vzoru + délku (`masked`). Report je commitovaný `.md`/JSON a nesmí sám
 * tajemství unést dál.
 */

/** Jeden zásah detektoru. `masked` je BEZPEČNÝ k zobrazení (nikdy celá hodnota). */
export interface SecretHit {
  /** identifikátor vzoru, např. "aws-access-key-id" */
  rule: string;
  /** lidský název typu tajemství pro report, např. "AWS Access Key ID" */
  label: string;
  severity: Severity;
  /** 1-based číslo řádku, kde zásah je */
  line: number;
  /** bezpečný náznak: veřejný prefix + délka, NIKDY náhodné tělo klíče */
  masked: string;
}

/**
 * Jeden vzor v katalogu. `regex` NESMÍ být globální (`/g`) – testuje se opakovaně
 * a globální regex by si nesl `lastIndex` mezi voláními a tiše přeskakoval zásahy.
 * `prefixLen` = kolik prvních znaků nalezené hodnoty je VEŘEJNÝ marker (smí se
 * ukázat); zbytek se zamaskuje. `prefixLen: "whole"` = celá shoda je veřejná
 * (PEM marker `-----BEGIN ... PRIVATE KEY-----` žádné tajné tělo na řádku nemá).
 */
interface Pattern {
  rule: string;
  label: string;
  severity: Severity;
  regex: RegExp;
  prefixLen: number | "whole";
}

/**
 * Katalog vzorů. Pořadí nehraje roli (každý vzor se testuje samostatně, jeden
 * zásah na vzor a řádek). Rozšiřuje se sem – nový tvar = nový záznam, ne nová
 * větev v detektoru.
 */
const PATTERNS: readonly Pattern[] = [
  {
    rule: "private-key",
    label: "Privátní klíč (PEM)",
    severity: "error",
    // RSA/EC/OPENSSH/DSA/PGP i holý "PRIVATE KEY". Marker je veřejný, tělo klíče
    // je na DALŠÍCH řádcích (base64) – ohlásíme jen tenhle řádek.
    regex: /-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----/,
    prefixLen: "whole",
  },
  {
    rule: "aws-access-key-id",
    label: "AWS Access Key ID",
    severity: "error",
    regex: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/,
    prefixLen: 4,
  },
  {
    rule: "github-token",
    label: "GitHub token",
    severity: "error",
    // ghp_ (personal), gho_ (oauth), ghu_/ghs_ (app), ghr_ (refresh).
    regex: /\bgh[posru]_[A-Za-z0-9]{36,}\b/,
    prefixLen: 4,
  },
  {
    rule: "google-api-key",
    label: "Google API key",
    severity: "error",
    regex: /\bAIza[0-9A-Za-z_-]{35}\b/,
    prefixLen: 4,
  },
  {
    rule: "slack-token",
    label: "Slack token",
    severity: "error",
    // Segmentovaný tvar reálného tokenu: xox?-<čísla>-<čísla>-<alfanum tělo>.
    // Volnější `xox?-[0-9A-Za-z-]+` by chytal i dokumentační placeholdery
    // (`xoxb-your-token-here`) – to jde proti cíli konzervativnosti.
    regex: /\bxox[baprs]-\d{10,}-\d{10,}-[A-Za-z0-9]{24,}\b/,
    prefixLen: 5,
  },
  {
    rule: "stripe-secret-key",
    label: "Stripe secret key",
    severity: "error",
    regex: /\bsk_live_[0-9A-Za-z]{24,}\b/,
    prefixLen: 8,
  },
];

/**
 * Zamaskuje nalezenou hodnotu na bezpečný náznak. Ukáže jen veřejný prefix vzoru
 * a délku – NIKDY náhodné tělo. `whole` = celá shoda je veřejná (PEM marker).
 */
function mask(value: string, prefixLen: number | "whole"): string {
  if (prefixLen === "whole") return value;
  // Pojistka: kdyby hodnota byla kratší než deklarovaný prefix (nemělo by nastat,
  // ale ať nevypíšeme víc, než chceme), prefix zkrátíme na délku hodnoty.
  const n = Math.min(prefixLen, value.length);
  return `${value.slice(0, n)}…(${value.length} znaků)`;
}

/**
 * Najde v textu známá tajemství. Prochází po řádcích (1-based čísla), na každý
 * řádek pustí každý vzor (max jeden zásah na vzor a řádek – víc shod stejného
 * typu na řádku je vzácné a první stačí jako signál). Vrací zásahy v pořadí
 * řádek → pořadí vzoru v katalogu.
 *
 * Splituje na `\n` i `\r\n` (CR strhneme), aby čísla řádků seděla na obojím.
 */
export function detectSecrets(text: string): SecretHit[] {
  const hits: SecretHit[] = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = (lines[i] ?? "").replace(/\r$/, "");
    for (const p of PATTERNS) {
      const m = p.regex.exec(line);
      if (m) {
        hits.push({
          rule: p.rule,
          label: p.label,
          severity: p.severity,
          line: i + 1,
          masked: mask(m[0], p.prefixLen),
        });
      }
    }
  }
  return hits;
}

// ---------------------------------------------------------------------------
// Skener nad soubory: spojí detektor s reálným čtením souborů z projektu.
// ---------------------------------------------------------------------------

/**
 * Výsledek skeneru tajemství. Stejný kontrakt jako TscResult/EslintResult:
 * "ran s 0 nálezy" (čistý projekt) se NESMÍ splést s "skipped" (skener vůbec
 * neproběhl) – sloučení obojího do "nic v reportu" = tichý falešný úspěch.
 */
/**
 * Počty souborů ZÁMĚRNĚ vyřazených z prohledávání (balast, ne chyba). Kategorie
 * jsou mutuálně výlučné: jeden soubor padne do první kategorie podle pořadí
 * kontrol ve `scanSecrets`, ne do více najednou. I/O selhání (nečitelný soubor,
 * `stat` selhal) sem ZÁMĚRNĚ NEpatří – to není filtr balastu, ale chyba čtení,
 * a `scanTree` ji hlásí zvlášť. Smysl: žádné tiché vynechání (zásada fází 25/26).
 */
// Pořadí polí odpovídá pořadí kontrol ve `scanSecrets` (jméno → velikost → NUL
// bajt → dlouhý řádek); soubor splňující víc důvodů padne do té první.
export interface SecretsSkipped {
  /** vyřazeno podle jména souboru (`.min.*` apod.) přes `isMinifiedName` */
  minified: number;
  /** vyřazeno kvůli velikosti > 1 MiB */
  large: number;
  /** vyřazeno jako binárka (obsahuje NUL bajt) */
  binary: number;
  /** vyřazeno kvůli extrémně dlouhému řádku (bundle/minifikát bez `.min.`) */
  longLine: number;
}

export type SecretsResult =
  | { kind: "skipped"; reason: string }
  | {
      kind: "ran";
      findings: Finding[];
      /** počet souborů, jejichž OBSAH se skutečně přečetl a prohledal */
      fileCount: number;
      /** počty záměrně přeskočených souborů podle důvodu (žádné tiché vynechání) */
      skipped: SecretsSkipped;
    };

/** Strop velikosti čteného souboru (1 MiB). Zdrojáky jsou drobné; větší soubor
 *  je skoro jistě generovaná data/bundle – číst ho jen plýtvá a šumí. */
const MAX_FILE_SIZE = 1024 * 1024;

/** Řádek delší než tohle = nejspíš minifikát/bundle (signál/šum). Obsahová záloha
 *  ke jménnému testu `isMinifiedName` (sdílený modul) – chytí i bundly bez `.min.`
 *  přípony, které jménný filtr mine (`bundle.js`). Tady ji děláme, protože obsah
 *  stejně čteme; ESLint vrstva obsah nečte, tak jen jméno. */
const MAX_LINE_LENGTH = 5000;

/**
 * Soubory, do kterých nahlížíme CÍLENĚ i kdyby je `.gitignore` schoval – tady
 * tajemství reálně bydlí (`.env` je skoro vždy gitignorovaný). Probe běží nad
 * kořenem projektu; `.env` zahrabané v gitignore-prořezané podsložce se proto
 * nenajde (do složky se nevstoupí) – report to musí přiznat.
 */
function isTargetedSecretFile(name: string): boolean {
  if (name === ".env" || name.startsWith(".env.")) return true;
  if (name.endsWith(".pem")) return true;
  if (/^id_(rsa|dsa|ecdsa|ed25519)$/.test(name)) return true;
  return false;
}

/** Nejdelší řádek v textu (na rozpoznání minifikátu bez plného splitu detektoru). */
function longestLineLength(text: string): number {
  let max = 0;
  let cur = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\n") {
      if (cur > max) max = cur;
      cur = 0;
    } else {
      cur++;
    }
  }
  return cur > max ? cur : max;
}

interface Candidate {
  relPath: string;
  absPath: string;
  /** velikost ze scanu, když ji známe; u probe souborů undefined → dostatíme stat */
  sizeKnown?: number;
}

/**
 * Sesbírá cílené soubory (`.env`, `*.pem`, `id_rsa`…) z KOŘENE projektu, které
 * ještě nejsou v `already` (ze scanu). Čte jen jméno z readdir, nestatuje a
 * nesleduje symlinky. Když kořen nejde přečíst, vrátí prázdno (skener pak jede
 * jen nad soubory ze scanu) – ne pád.
 */
async function probeTargetedFiles(root: string, already: Set<string>): Promise<Candidate[]> {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: Candidate[] = [];
  for (const ent of entries) {
    if (ent.isSymbolicLink() || ent.isDirectory()) continue;
    if (!isTargetedSecretFile(ent.name)) continue;
    if (already.has(ent.name)) continue; // už pokrytý scanem (není gitignorovaný)
    out.push({ relPath: ent.name, absPath: path.join(root, ent.name) });
  }
  return out;
}

/**
 * Projde obsah souborů projektu a vyrobí nálezy tajemství.
 *
 * - REUSE, ne re-walk: bere `files` ze `scanTree` (už respektují `.gitignore`,
 *   skip složky, výstupní artefakty, symlinky). Navíc cílený probe nad kořenem
 *   (`.env`/PEM) i mimo `.gitignore`.
 * - Přeskakuje balast: velké (`size` > 1 MiB), minifikáty (`.min.*` / extrémně
 *   dlouhý řádek), binárky (NUL bajt).
 * - Nečitelný soubor jen přeskočí a jede dál (ne pád, ne tiché spadnutí celé
 *   vrstvy). Programovou chybu nemaskuje – chytá se jen `readFile`/`stat`.
 *
 * Vždy `kind:"ran"` (i s 0 nálezy) – skener je čistě lokální čtení, nemá důvod
 * se "skipnout". `skipped` je v unionu kvůli symetrii s ostatními vrstvami a
 * pro budoucí použití (např. vypnutí), ale tady ho neprodukujeme.
 */
export async function scanSecrets(root: string, files: FileEntry[]): Promise<SecretsResult> {
  const candidates: Candidate[] = [];
  const seen = new Set<string>();

  for (const f of files) {
    if (f.type !== "file") continue;
    seen.add(f.path);
    candidates.push({ relPath: f.path, absPath: path.join(root, f.path), sizeKnown: f.size });
  }

  for (const probe of await probeTargetedFiles(root, seen)) {
    candidates.push(probe);
  }

  const findings: Finding[] = [];
  let fileCount = 0;
  const skipped: SecretsSkipped = { minified: 0, large: 0, binary: 0, longLine: 0 };

  for (const c of candidates) {
    const name = c.relPath.split("/").pop() ?? c.relPath;
    if (isMinifiedName(name)) {
      skipped.minified++;
      continue;
    }

    let size = c.sizeKnown;
    if (size === undefined) {
      try {
        size = (await stat(c.absPath)).size;
      } catch {
        continue; // probe soubor zmizel/nedá se statovat → přeskoč (I/O, nepočítá se)
      }
    }
    if (size > MAX_FILE_SIZE) {
      skipped.large++;
      continue;
    }

    let content: string;
    try {
      content = await readFile(c.absPath, "utf8");
    } catch {
      continue; // nečitelný → přeskoč (I/O, scanTree nečitelné stejně hlásí zvlášť)
    }

    if (content.includes("\u0000")) {
      skipped.binary++;
      continue; // binárka
    }
    if (longestLineLength(content) > MAX_LINE_LENGTH) {
      skipped.longLine++;
      continue; // minifikát/bundle
    }

    fileCount++;
    for (const hit of detectSecrets(content)) {
      findings.push({
        source: "secret",
        severity: hit.severity,
        file: c.relPath,
        line: hit.line,
        rule: hit.rule,
        message: `Možné tajemství (${hit.label}): ${hit.masked}`,
      });
    }
  }

  return { kind: "ran", findings, fileCount, skipped };
}
