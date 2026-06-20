import * as path from "node:path";
import type { AiReport, AiStatus } from "../analyze/aiStatus.js";
import type { ModuleEdge, ModuleGraphResult } from "../analyze/moduleGraph.js";
import type { AuditResult } from "../audit.js";
import { type EslintResult, type Finding, formatLocation, type TscResult } from "../findings.js";
import type { Intent } from "../intent.js";
import type { FileEntry } from "../scan.js";
import type { SecretsResult, SecretsSkipped } from "../secrets.js";

export interface MarkdownInput {
  root: string;
  generatedAt: string;
  files: FileEntry[];
  skippedUnreadable: string[];
  /** Záměr z project.md analyzovaného projektu; null/undefined = nedodán. */
  intent?: Intent | null;
  /** Výsledek tsc vrstvy; když chybí, sekce se vykreslí jako "přeskočeno". */
  tsc?: TscResult;
  /** Výsledek ESLint vrstvy; když chybí, sekce se vykreslí jako "přeskočeno". */
  eslint?: EslintResult;
  /** Výsledek skeneru tajemství; když chybí, sekce se vykreslí jako "přeskočeno". */
  secrets?: SecretsResult;
  /** Výsledek auditu závislostí; když chybí, sekce se vykreslí jako "přeskočeno". */
  audit?: AuditResult;
  /** Graf importních závislostí; když chybí, sekce se vykreslí jako "přeskočeno". */
  moduleGraph?: ModuleGraphResult;
  /** Souhrn AI vrstvy (dva nezávislé režimy: non-goaly + kód); když chybí, obě se
   *  vykreslí jako "přeskočeno". */
  ai?: AiReport;
}

export interface MarkdownOptions {
  /** maximální počet uzlů (složek včetně kořene) v diagramu struktury; zbytek se ořízne */
  maxDiagramNodes?: number;
  /** pojistný strop uzlů grafu modulů (záchrana před nevykreslitelným Mermaidem) */
  maxModuleNodes?: number;
  /** pojistný strop hran grafu modulů */
  maxModuleEdges?: number;
}

const DEFAULT_MAX_DIAGRAM_NODES = 1000;
// Graf modulů má uzel = soubor (ne složku), takže jich je víc. Stropy slouží JAKO
// ZÁCHRANA proti tvrdému limitu Mermaidu: jeho renderer (GitHub, VS Code, mermaid.js)
// odmítne diagram nad 500 hran s chybou "Edge limit exceeded" a `maxEdges` NEjde
// přebít zevnitř diagramu (je to "secure config", musí se volat mermaid.initialize).
// Proto strop hran držíme POD 500 – jinak by se velký graf vůbec nevykreslil. Běžný
// projekt se neořízne; při ořezu to report napíše ("zobrazeno X z Y").
const MERMAID_EDGE_LIMIT = 500; // tvrdý default rendereru Mermaidu
const DEFAULT_MAX_MODULE_EDGES = MERMAID_EDGE_LIMIT - 20; // 480, rezerva pod limitem
const DEFAULT_MAX_MODULE_NODES = 1000; // s ≤480 hranami stejně nesváže dřív než hrany

/**
 * Nahradí znaky, které by rozbily Mermaid label v hranatých závorkách.
 * Label může být jméno složky/souboru z cizího projektu; na Linuxu smí obsahovat
 * i CR/LF (rozbily by `["..."]` blok) a backtick/středník (zlozvyky v Mermaid
 * syntaxi). CR/LF → mezera, `"` → `'`, `[]`/backtick/středník pryč. Jedna funkce
 * pro strom struktury i pro uzly grafu modulů – stejná Mermaid pravidla platí pro
 * obě (dřív byl pro strom volnější escape, který nechával středník/backtick projít).
 *
 * Mazání `;` má i druhý, MÉNĚ zřejmý účel: Mermaid HTML entity mají tvar `#kód;`
 * a vyhodnotí se jen s koncovým `;`. Bez středníku zůstane `#…` neaktivní text,
 * takže `#` v labelu necháváme (běžné v názvech, např. `C#`) – ale POZOR: kdo by
 * sem `;` vrátil, otevře tím cestu k vyhodnocení entit z cizího jména souboru.
 */
function escapeLabel(s: string): string {
  return s
    .replace(/[\r\n]+/g, " ")
    .replace(/"/g, "'")
    .replace(/[[\]`;]/g, "");
}

/**
 * Zneškodní trojitý (a delší) plot z backticků v cizím textu. project.md píše
 * uživatel/jiný nástroj; kdyby v záměru byl ```` ```mermaid ````, otevřel by
 * uvnitř našeho reportu nový code fence a spolkl by zbytek (i náš diagram).
 * Trojitý backtick zkrátíme na jeden – inline kód zůstane, fence se nespustí.
 */
function neutralizeFences(line: string): string {
  return line.replace(/`{3,}/g, "`");
}

/**
 * Zploští cizí text (zpráva z tsc) do jednoho řádku odrážky: víceřádkové zprávy
 * (tsc spojuje řetězené diagnostiky `\n`) by jinak rozbily seznam, backtick by
 * otevřel/zavřel inline kód uprostřed věty. Newline → mezera, backtick → '.
 */
function sanitizeInline(text: string): string {
  return text.replace(/[\r\n]+/g, " ").replace(/`/g, "'").trim();
}

const NODE_MODULES_NOTE =
  "> Pozor: v projektu chybí `node_modules` – tsc běžel bez nainstalovaných závislostí. " +
  "Chyby typu „nenalezený modul“ (TS2307 ap.) jsou za téhle situace očekávané, ne nutně chyba projektu.";

const HOISTED_NOTE =
  "> Pozor: v kořeni chybí `node_modules`, ale leží výš (monorepo s hoisted závislostmi). " +
  "Analyzátor čte záměrně jen tuto složku (fail-closed), takže importy balíčků z nadřazeného " +
  "`node_modules` padly na „nenalezený modul“ (TS2307) – tyto nálezy jsou nejspíš artefakt analýzy, " +
  "ne chyba tvého kódu. Pozn.: pnpm monorepo s lokálním symlinkovaným `node_modules` takto nerozpoznáme.";

/** Kód tsc diagnostiky „Cannot find module“ – kontrakt s toFinding v analyze/tsc.ts. */
const TS_CANNOT_FIND_MODULE = "TS2307";

/**
 * Sekce "## Strojové nálezy (tsc)". Vykreslí TŘI stavy odlišitelně, ať se "čistý
 * projekt" neplete s "vrstva neproběhla" (tichý falešný úspěch):
 *   - skipped → "_tsc přeskočeno: důvod_"
 *   - ran, 0 nálezů → "Žádné typové chyby."
 *   - ran, N nálezů → seznam se soubor:řádek, závažností, kódem a zprávou.
 * Když tsc běžel bez node_modules, přidá upozornění (chyby nenalezených modulů).
 */
function tscSection(tsc: TscResult | undefined): string[] {
  const out: string[] = ["## Strojové nálezy (tsc)", ""];

  if (!tsc || tsc.kind === "skipped") {
    const reason = tsc?.reason ?? "typová analýza se nespustila";
    out.push(`_tsc přeskočeno: ${sanitizeInline(reason)}_`);
    out.push("");
    return out;
  }

  out.push(`tsc (TS ${tsc.tsVersion}) proběhl nad ${tsc.fileCount} soubory.`);
  out.push("");
  // Typujeme vždy přibalenou verzí (non-goal č. 1 – nespouštíme projektový TS).
  // Když projekt deklaruje JINOU verzi, přiznáme to: jeho nálezy můžou být verzním
  // rozdílem, ne reálným bugem (novější/starší syntaxe, jiné compiler defaults).
  if (tsc.projectTsVersion) {
    out.push(
      `_Pozn.: typováno přibaleným TypeScriptem ${tsc.tsVersion}; projekt používá ${tsc.projectTsVersion} – ` +
        `nálezy posuzuj s vědomím možného verzního rozdílu._`,
    );
    out.push("");
  }
  // Trojstav (vzájemně výlučné – nikdy obě poznámky naráz): kořen MÁ node_modules →
  // žádná poznámka; kořen NEMÁ, ale leží výš (hoisted) A tsc fakt nahlásil TS2307 →
  // hoisted poznámka (přesnější příčina záplavy); kořen NEMÁ ani výš → stará poznámka
  // (chybí závislosti). Hoisted se VÁŽE na reálný TS2307 (jinak by strašila bez příčiny);
  // stará zůstává nepodmíněná jako dřív. Pozn.: hoisted-bez-TS2307 = žádná poznámka
  // (nic nepadlo → není co vysvětlovat, a „chybí node_modules“ by lhalo).
  if (!tsc.nodeModulesPresent) {
    const hasMissingModule = tsc.findings.some((f) => f.rule === TS_CANNOT_FIND_MODULE);
    if (tsc.hoistedNodeModules && hasMissingModule) {
      out.push(HOISTED_NOTE);
      out.push("");
    } else if (!tsc.hoistedNodeModules) {
      out.push(NODE_MODULES_NOTE);
      out.push("");
    }
  }

  if (tsc.findings.length === 0) {
    out.push("_Žádné typové chyby._");
    out.push("");
    return out;
  }

  for (const f of tsc.findings) {
    out.push(renderFinding(f));
  }
  out.push("");
  return out;
}

/** Jedna odrážka nálezu: `- **error** `soubor:řádek:sloupec` TS2322: zpráva`. */
function renderFinding(f: Finding): string {
  // SEC-2: cesta je cizí vstup (název souboru) – sanitizujeme STEJNĚ jako zprávu.
  // Nejen backtick (ukončil by inline code span), ale i CR/LF: název souboru na
  // Linuxu smí mít newline a rozbil by odrážku / vložil falešný nadpis do reportu.
  const loc = sanitizeInline(formatLocation(f));
  const rule = f.rule ? ` ${f.rule}` : "";
  return `- **${f.severity}** \`${loc}\`${rule}: ${sanitizeInline(f.message)}`;
}

/** Krátké shrnutí stavu tsc do hlavičky reportu (rychlý přehled). */
function tscSummaryLine(tsc: TscResult | undefined): string {
  if (!tsc || tsc.kind === "skipped") return "- tsc: přeskočeno";
  if (tsc.findings.length === 0) return "- tsc: čistý (0 nálezů)";
  return `- tsc: ${tsc.findings.length} nálezů`;
}

/**
 * Sekce "## Strojové nálezy (ESLint)". Stejné tři stavy jako tsc – "čistý projekt"
 * se nesmí splést s "vrstva neproběhla". Nálezy jsou dle pravidel vibeanalyzeru
 * (projektový ESLint config se z bezpečnostních důvodů nenačítá), což report uvede.
 */
function eslintSection(eslint: EslintResult | undefined): string[] {
  const out: string[] = ["## Strojové nálezy (ESLint)", ""];

  if (!eslint || eslint.kind === "skipped") {
    const reason = eslint?.reason ?? "lint analýza se nespustila";
    out.push(`_ESLint přeskočeno: ${sanitizeInline(reason)}_`);
    out.push("");
    return out;
  }

  out.push(`ESLint zkontroloval ${eslint.fileCount} souborů (pravidla vibeanalyzeru, ne config projektu).`);
  out.push("");

  // Vynechání minifikátů NESMÍ být tiché – jinak prázdný/čistý lint vypadá jako
  // „prošel celý projekt", ač jsme bundly přeskočili. Přiznáme i v1 omezení.
  if (eslint.skippedMinified > 0) {
    out.push(
      `> Přeskočeno ${eslint.skippedMinified} minifikátů (\`*.min.*\`) – generovaný kód, nelintuje se. ` +
        "Detekce je jen podle jména, takže bundly bez přípony `.min.` (např. `bundle.js`) filtr mine a lintují se dál.",
    );
    out.push("");
  }

  if (eslint.findings.length === 0) {
    out.push("_Žádné nálezy._");
    out.push("");
    return out;
  }

  for (const f of eslint.findings) {
    out.push(renderFinding(f));
  }
  out.push("");
  return out;
}

/** Krátké shrnutí stavu ESLint do hlavičky reportu (rychlý přehled). */
function eslintSummaryLine(eslint: EslintResult | undefined): string {
  if (!eslint || eslint.kind === "skipped") return "- ESLint: přeskočeno";
  // Přeskočené minifikáty musí být vidět i v rychlém přehledu (ten lidi čtou
  // první), jinak „čistý" zatají, že N souborů ESLint vůbec neviděl.
  const skip = eslint.skippedMinified > 0 ? `, ${eslint.skippedMinified} minifikátů přeskočeno` : "";
  if (eslint.findings.length === 0) return `- ESLint: čistý (0 nálezů)${skip}`;
  return `- ESLint: ${eslint.findings.length} nálezů${skip}`;
}

/**
 * Sekce "## Strojové nálezy (tajemství)". Stejné tři stavy jako tsc/ESLint –
 * "nic nenalezeno" se nesmí splést s "skener neproběhl". Nálezy nesou jen
 * MASKOVANÝ náznak (renderFinding tiskne `f.message`, který už je maskovaný ve
 * skeneru) – report je commitovaný a nesmí tajemství unést dál.
 */
/**
 * Řádek se souhrnem ZÁMĚRNĚ přeskočených souborů (balast). Vždy se vypíše – i s
 * nulami – aby report neměl tiché vynechání (zásada fází 25/26). Rozpad podle
 * důvodu je `label: počet` schválně bez plurálové gramatiky (vyhne se i18n; stejný
 * styl jako jinde v reportu). I/O selhání tu NEjsou – nejsou to filtry balastu.
 */
function secretsSkippedLine(skipped: SecretsSkipped): string {
  const total = skipped.minified + skipped.large + skipped.longLine + skipped.binary;
  if (total === 0) return "Přeskočeno 0 souborů jako balast.";
  // Pořadí odpovídá pořadí kontrol ve scanSecrets (jméno → velikost → NUL → řádek).
  const parts = [
    `minifikáty: ${skipped.minified}`,
    `velké (>1 MiB): ${skipped.large}`,
    `binárky: ${skipped.binary}`,
    `dlouhé řádky: ${skipped.longLine}`,
  ];
  return `Přeskočeno ${total} souborů jako balast (${parts.join(", ")}). Ty se na tajemství neprohledávaly.`;
}

function secretsSection(secrets: SecretsResult | undefined): string[] {
  const out: string[] = ["## Strojové nálezy (tajemství)", ""];

  if (!secrets || secrets.kind === "skipped") {
    const reason = secrets?.reason ?? "hledání tajemství se nespustilo";
    out.push(`_Tajemství přeskočeno: ${sanitizeInline(reason)}_`);
    out.push("");
    return out;
  }

  out.push(`Prohledáno ${secrets.fileCount} souborů na známé tvary tajemství (klíče, tokeny).`);
  out.push("");
  out.push(secretsSkippedLine(secrets.skipped));
  out.push("");
  out.push(
    "> Pozor: hledají se jen známé tvary a jen u kořene projektu se nahlíží do " +
      "jinak ignorovaných souborů (`.env`, `*.pem`). Tajemství zahrabané v " +
      "`.gitignore`-prořezané podsložce nebo v neznámém tvaru se nemusí najít.",
  );
  out.push("");

  if (secrets.findings.length === 0) {
    out.push("_Žádná tajemství nenalezena._");
    out.push("");
    return out;
  }

  for (const f of secrets.findings) {
    out.push(renderFinding(f));
  }
  out.push("");
  return out;
}

/** Krátké shrnutí stavu skeneru tajemství do hlavičky reportu. */
function secretsSummaryLine(secrets: SecretsResult | undefined): string {
  if (!secrets || secrets.kind === "skipped") return "- Tajemství: přeskočeno";
  if (secrets.findings.length === 0) return "- Tajemství: čistý (0 nálezů)";
  return `- Tajemství: ${secrets.findings.length} nálezů`;
}

/**
 * Sekce "## Strojové nálezy (závislosti)". Stejné tři stavy jako ostatní vrstvy.
 * Skip nese KONKRÉTNÍ důvod (audit nevyžádán / bez lockfilu / bez sítě …), ať se
 * "nic se neměřilo" neplete s "čisto". Audit je opt-in (`--audit`), takže výchozí
 * běh tu uvidí "přeskočeno (audit nevyžádán)".
 */
function auditSection(audit: AuditResult | undefined): string[] {
  const out: string[] = ["## Strojové nálezy (závislosti)", ""];

  if (!audit || audit.kind === "skipped") {
    const reason = audit?.reason ?? "audit nevyžádán (spusť s --audit)";
    out.push(`_Audit závislostí přeskočen: ${sanitizeInline(reason)}_`);
    out.push("");
    return out;
  }

  const c = audit.counts;
  out.push(
    `npm audit našel ${c.total} zranitelností ` +
      `(kritických ${c.critical}, vysokých ${c.high}, středních ${c.moderate}, nízkých ${c.low}, informativních ${c.info}).`,
  );
  out.push("");

  if (audit.findings.length === 0) {
    out.push("_Žádné zranitelné závislosti._");
    out.push("");
    return out;
  }

  for (const f of audit.findings) {
    out.push(renderFinding(f));
  }
  out.push("");
  return out;
}

/** Krátké shrnutí stavu auditu závislostí do hlavičky reportu. */
function auditSummaryLine(audit: AuditResult | undefined): string {
  if (!audit || audit.kind === "skipped") return "- Závislosti: přeskočeno";
  if (audit.findings.length === 0) return "- Závislosti: čistý (0 nálezů)";
  return `- Závislosti: ${audit.findings.length} nálezů`;
}

/**
 * Vykreslí JEDEN AI režim (non-goal / code / logic) jako pod-blok pod společnou hlavičkou.
 * `label` = lidský název režimu, `emptyMsg` = co napsat, když analýza proběhla bez
 * nálezů (rozlišení "ran s 0 nálezy" vs "skipped"). `note` = volitelná trvalá poznámka
 * hned pod hlavičkou (logika ji používá na přiznání aproximace). Stavy: skipped /
 * verified / analyzed / ready – každý schválně rozlišitelný (ne falešné "hotovo").
 */
function aiModeBlock(label: string, ai: AiStatus | undefined, emptyMsg: string, note?: string): string[] {
  const out: string[] = [`### ${label}`, ""];
  if (note) {
    out.push(`> ${sanitizeInline(note)}`);
    out.push("");
  }

  if (!ai || ai.kind === "skipped") {
    const reason = ai?.reason ?? "AI vrstva zatím neproběhla";
    out.push(`_Přeskočeno: ${sanitizeInline(reason)}_`);
    out.push("");
    return out;
  }
  if (ai.kind === "verified") {
    out.push("_Ověřeno (testovací dotaz na API proběhl úspěšně)._");
    out.push("");
    return out;
  }
  if (ai.kind === "analyzed") {
    out.push(
      `_Model ${sanitizeInline(ai.model)}: tokeny ${ai.usage.inputTokens} vstup + ` +
        `${ai.usage.outputTokens} výstup, odhad ceny ~$${ai.costUsd.toFixed(4)}._`,
    );
    out.push("");
    if (ai.findings.length === 0) {
      out.push(emptyMsg);
    } else {
      for (const f of ai.findings) out.push(renderFinding(f));
    }
    out.push("");
    return out;
  }
  out.push("_Připraveno (klíč nalezen, dotaz zatím neproběhl)._");
  out.push("");
  return out;
}

/** Přiznání u logické analýzy: soud o celku se ověřuje nejhůř ze tří režimů. */
const AI_LOGIC_APPROX_NOTE =
  "Pozor: posouzení celku vůči záměru je neúplná APROXIMACE (slabší obrana proti halucinaci než u řádkových nálezů). Každý nález si ověř v kódu.";

/**
 * Sekce "## AI analýza". Tři NEZÁVISLÉ pod-bloky (non-goaly, kód, logika) – každý běží
 * na vlastní přepínač a má vlastní stav/cenu. Logika má navíc přiznání aproximace.
 * Strojová vrstva běží beze změny.
 */
function aiSection(ai: AiReport | undefined): string[] {
  return [
    "## AI analýza",
    "",
    ...aiModeBlock("Porušení non-goalů (--ai-non-goal)", ai?.nonGoal, "Žádné porušení deklarovaných non-goalů nenalezeno."),
    ...aiModeBlock("Kvalita a rizika kódu (--ai-code)", ai?.code, "Žádné závažné problémy kódu nenalezeny."),
    ...aiModeBlock("Logika vs záměr (--ai-logic)", ai?.logic, "Žádný rozpor funkčnosti se záměrem nenalezen.", AI_LOGIC_APPROX_NOTE),
  ];
}

/** Krátké shrnutí jednoho AI režimu do hlavičky reportu. */
function aiModeSummary(label: string, ai: AiStatus | undefined): string {
  if (!ai || ai.kind === "skipped") return `- AI (${label}): přeskočeno`;
  if (ai.kind === "verified") return `- AI (${label}): ověřeno`;
  if (ai.kind === "analyzed") {
    return `- AI (${label}): analyzováno (${ai.findings.length} nálezů, ~$${ai.costUsd.toFixed(4)})`;
  }
  return `- AI (${label}): připraveno`;
}

/** Shrnutí všech tří AI režimů do hlavičky reportu (tři řádky). */
function aiSummaryLines(ai: AiReport | undefined): string[] {
  return [aiModeSummary("non-goaly", ai?.nonGoal), aiModeSummary("kód", ai?.code), aiModeSummary("logika", ai?.logic)];
}

/** Krátké shrnutí stavu grafu modulů do hlavičky reportu. */
function moduleGraphSummaryLine(mg: ModuleGraphResult | undefined): string {
  if (!mg || mg.kind === "skipped") return "- Graf modulů: přeskočeno";
  const minSuffix = mg.minified > 0 ? ` (${mg.minified} minifikátů vyřazeno)` : "";
  return `- Graf modulů: ${mg.edges.length} hran mezi ${mg.fileCount} soubory${minSuffix}`;
}

/**
 * Vloží cizí text jako blockquote (každý řádek `> `). Spolu s neutralizeFences
 * tím udržíme cizí `#` nadpisy i fence uvnitř citace – nerozbijí strukturu
 * našich sekcí ani Mermaid blok.
 */
function blockquote(text: string): string[] {
  return text.split("\n").map((line) => `> ${neutralizeFences(line)}`);
}

/**
 * Sekce "## Záměr projektu" do hlavičky reportu. Když záměr (nebo jeho část)
 * chybí, vypíše explicitní "_nedodáno_" – záměrně viditelný stav, ne prázdná
 * díra. Hodnocení nálezů vůči záměru sem nepatří (to až AI vrstva).
 */
function intentSection(intent: Intent | null | undefined): string[] {
  const out: string[] = ["## Záměr projektu", ""];

  if (!intent) {
    out.push(
      "_Záměr nedodán._ Nenašel jsem v analyzovaném projektu `.mini/project.md` ani `project.md`.",
    );
    out.push("");
    return out;
  }

  // sourcePath je odvozen z cesty cíle (uživatel ji řídí) → taky cizí vstup.
  // Backtick i newline v názvu složky by rozbily inline code span hlavičky
  // (backtick ukončí span, newline ho přeruší); oba nahradíme (nálezy 4-5).
  const safeSource = intent.sourcePath.replace(/`/g, "'").replace(/[\r\n]/g, " ");
  out.push(`Načteno z \`${safeSource}\`.`);
  out.push("");

  out.push("**Co se staví:**");
  out.push("");
  if (intent.building === null) {
    out.push("> _nedodáno_");
  } else {
    out.push(...blockquote(intent.building));
  }
  out.push("");

  out.push("**Deklarované non-goaly:**");
  out.push("");
  if (intent.nonGoals === null) {
    out.push("> _nedodáno_");
  } else {
    for (const ng of intent.nonGoals) out.push(`> - ${neutralizeFences(ng)}`);
  }
  out.push("");

  return out;
}

export interface FolderDiagram {
  lines: string[];
  total: number;
  shown: number;
  truncated: boolean;
}

/**
 * Postaví Mermaid diagram (graph LR) JEN nad složkami.
 * LR (zleva doprava) skládá sourozenecké složky pod sebe → graf roste do výšky,
 * ne do šířky, a u projektů s mnoha mělkými složkami je čitelnější.
 * Při překročení limitu uzlů se diagram ořízne (a volající to napíše do reportu).
 */
export function buildFolderDiagram(
  dirPaths: readonly string[],
  rootLabel: string,
  maxNodes: number,
): FolderDiagram {
  const total = dirPaths.length;
  const sorted = [...dirPaths].sort();
  // jeden uzel rezervujeme pro kořen
  const shownPaths = sorted.slice(0, Math.max(0, maxNodes - 1));
  const truncated = shownPaths.length < total;

  const idOf = new Map<string, number>();
  idOf.set("", 0);
  let next = 1;
  for (const p of shownPaths) idOf.set(p, next++);

  const labelFor = (p: string): string => (p === "" ? rootLabel : (p.split("/").pop() ?? p));

  const lines: string[] = ["graph LR"];
  lines.push(`  n0["${escapeLabel(rootLabel)}"]`);
  for (const p of shownPaths) {
    lines.push(`  n${idOf.get(p)}["${escapeLabel(labelFor(p))}"]`);
  }
  for (const p of shownPaths) {
    const slash = p.lastIndexOf("/");
    const parent = slash === -1 ? "" : p.slice(0, slash);
    // rodič mohl vypadnout kvůli ořezu → napojíme na kořen
    const parentId = idOf.has(parent) ? idOf.get(parent) : 0;
    lines.push(`  n${parentId} --> n${idOf.get(p)}`);
  }

  return { lines, total, shown: shownPaths.length, truncated };
}

export interface ModuleDiagram {
  lines: string[];
  totalNodes: number;
  shownNodes: number;
  totalEdges: number;
  shownEdges: number;
  truncated: boolean;
}

/**
 * Postaví Mermaid `graph LR` z hran importů (A --> B = A importuje B). Id uzlu
 * se přiřadí podle CESTY (ne jména souboru) – dva `index.ts` v různých složkách
 * se nesmí slít. Label je relativní cesta (jednoznačná, byť delší).
 *
 * Ořez je POJISTKA, ne běžný stav: hrany bereme v setříděném pořadí a přidáme
 * jen ty, které se vejdou do stropu uzlů i hran (hrana přidávající uzly nad
 * `maxNodes` se přeskočí). `truncated` říká volajícímu, ať to napíše do reportu.
 */
export function buildModuleDiagram(
  edges: readonly ModuleEdge[],
  maxNodes: number,
  maxEdges: number,
): ModuleDiagram {
  const sorted = [...edges].sort((a, b) =>
    a.from === b.from ? a.to.localeCompare(b.to) : a.from.localeCompare(b.from),
  );
  const allNodes = new Set<string>();
  for (const e of sorted) {
    allNodes.add(e.from);
    allNodes.add(e.to);
  }
  const totalNodes = allNodes.size;
  const totalEdges = sorted.length;

  const idOf = new Map<string, number>();
  const shown: ModuleEdge[] = [];
  for (const e of sorted) {
    if (shown.length >= maxEdges) break;
    const newNodes = (idOf.has(e.from) ? 0 : 1) + (idOf.has(e.to) ? 0 : 1);
    if (idOf.size + newNodes > maxNodes) continue; // tahle hrana by přetekla limit uzlů
    if (!idOf.has(e.from)) idOf.set(e.from, idOf.size);
    if (!idOf.has(e.to)) idOf.set(e.to, idOf.size);
    shown.push(e);
  }

  const lines: string[] = ["graph LR"];
  for (const [p, id] of idOf) {
    lines.push(`  n${id}["${escapeLabel(p)}"]`);
  }
  for (const e of shown) {
    lines.push(`  n${idOf.get(e.from)} --> n${idOf.get(e.to)}`);
  }

  return {
    lines,
    totalNodes,
    shownNodes: idOf.size,
    totalEdges,
    shownEdges: shown.length,
    truncated: shown.length < totalEdges || idOf.size < totalNodes,
  };
}

/**
 * Sekce "## Graf modulů". Tři stavy jako ostatní vrstvy: skipped / prázdný graf
 * / graf s hranami. Osamělé soubory (bez jediné hrany) se do grafu NEkreslí, jen
 * vypíšou textem. Přizná přibližnost: kreslí jen statické relativní importy,
 * dynamický `import()`/`require()` ani externí balíky ne.
 */
function moduleGraphSection(
  mg: ModuleGraphResult | undefined,
  maxNodes: number,
  maxEdges: number,
): string[] {
  const out: string[] = ["## Graf modulů", ""];

  if (!mg || mg.kind === "skipped") {
    const reason = mg?.reason ?? "graf modulů se nesestavil";
    out.push(`_Graf modulů přeskočen: ${sanitizeInline(reason)}_`);
    out.push("");
    return out;
  }

  out.push(
    `Graf ukazuje statické relativní importy mezi ${mg.fileCount} zdrojovými soubory ` +
      "a vykreslí se jen v prohlížeči s podporou Mermaid (např. GitHub nebo VS Code).",
  );
  out.push("");
  out.push(
    "> Pozor: kreslí se jen statické `import … from`, side-effect importy a " +
      "`export … from` s relativní cestou. Dynamický `import()`/`require()`, " +
      "externí balíky a typové aliasy z `tsconfig` se nezobrazují – graf je " +
      "přibližný a nemusí být úplný.",
  );
  out.push("");

  // Honest report o přeskočených souborech (ať se prázdný/neúplný graf neplete
  // s tichým falešným "vše čisté").
  const skippedNotes: string[] = [];
  if (mg.unreadable > 0) skippedNotes.push(`${mg.unreadable} nečitelných`);
  if (mg.unparsable > 0) skippedNotes.push(`${mg.unparsable} nezparsovatelných`);
  if (mg.tooLarge > 0) skippedNotes.push(`${mg.tooLarge} příliš velkých (bundle?)`);
  if (mg.minified > 0) skippedNotes.push(`${mg.minified} minifikátů (podle jména)`);
  if (skippedNotes.length > 0) {
    out.push(`> Přeskočené soubory: ${skippedNotes.join(", ")}.`);
    out.push("");
  }

  if (mg.edges.length === 0) {
    // Odliš "vážně nic" od "vše se přeskočilo/vyřadilo" (tichý falešný "čisto"):
    // když nezbyl k sestavení grafu ani jeden zdrojový soubor, ale nějaké se
    // přeskočily NEBO vyřadily (vč. minifikátů), řekni to – jinak by projekt jen
    // z bundlů (fileCount=0, minified>0) lživě hlásil "žádné importní hrany".
    const allSkipped =
      mg.fileCount === 0 && mg.unreadable + mg.unparsable + mg.tooLarge + mg.minified > 0;
    if (allSkipped) {
      out.push("_Žádný zdrojový soubor nezbyl k sestavení grafu – všechny byly přeskočeny nebo vyřazeny (viz přeskočené výše)._");
    } else {
      out.push("_Žádné importní hrany mezi soubory projektu._");
    }
    out.push("");
  } else {
    const diagram = buildModuleDiagram(mg.edges, maxNodes, maxEdges);
    if (diagram.truncated) {
      out.push(
        `> Graf byl oříznut: zobrazeno ${diagram.shownNodes} z ${diagram.totalNodes} uzlů ` +
          `a ${diagram.shownEdges} z ${diagram.totalEdges} hran (limit ${maxNodes} uzlů / ${maxEdges} hran). ` +
          "Strop hran je pod tvrdým limitem Mermaidu (500), jinak by se diagram vůbec nevykreslil. " +
          "Úplné hrany jsou v JSON indexu.",
      );
      out.push("");
    }
    out.push("```mermaid");
    out.push(...diagram.lines);
    out.push("```");
    out.push("");
  }

  // Osamělé moduly: nekreslí se (tečka bez čar je šum), jen výčet.
  if (mg.isolated.length > 0) {
    out.push(`**Osamělé moduly (bez importní vazby):** ${mg.isolated.length}`);
    out.push("");
    for (const p of mg.isolated) {
      out.push(`- \`${sanitizeInline(p)}\``);
    }
    out.push("");
  }

  return out;
}

/** Sestaví lidský `.md` report ze stejného modelu, jaký jde do JSON. */
export function buildMarkdown(input: MarkdownInput, options: MarkdownOptions = {}): string {
  const maxNodes = options.maxDiagramNodes ?? DEFAULT_MAX_DIAGRAM_NODES;
  const maxModuleNodes = options.maxModuleNodes ?? DEFAULT_MAX_MODULE_NODES;
  const maxModuleEdges = options.maxModuleEdges ?? DEFAULT_MAX_MODULE_EDGES;
  const fileEntries = input.files.filter((f) => f.type === "file");
  const dirPaths = input.files.filter((f) => f.type === "dir").map((f) => f.path);
  const rootLabel = path.basename(input.root) || input.root;

  const diagram = buildFolderDiagram(dirPaths, rootLabel, maxNodes);

  const out: string[] = [];
  out.push("# VibeAnalyzer – strukturální report");
  out.push("");
  out.push(`- Kořen: \`${input.root}\``);
  out.push(`- Vygenerováno: ${input.generatedAt}`);
  const minifiedCount = fileEntries.filter((f) => f.minified).length;
  const minifiedSuffix = minifiedCount > 0 ? ` (z toho ${minifiedCount} minifikátů)` : "";
  out.push(`- Souborů: ${fileEntries.length}${minifiedSuffix}`);
  out.push(`- Složek: ${dirPaths.length}`);
  if (input.skippedUnreadable.length > 0) {
    out.push(`- Přeskočeno (nečitelné): ${input.skippedUnreadable.length}`);
  }
  out.push(tscSummaryLine(input.tsc));
  out.push(eslintSummaryLine(input.eslint));
  out.push(secretsSummaryLine(input.secrets));
  out.push(auditSummaryLine(input.audit));
  out.push(moduleGraphSummaryLine(input.moduleGraph));
  out.push(...aiSummaryLines(input.ai));
  out.push("");

  out.push(...intentSection(input.intent));

  out.push(...tscSection(input.tsc));

  out.push(...eslintSection(input.eslint));

  out.push(...secretsSection(input.secrets));

  out.push(...auditSection(input.audit));

  out.push("## Struktura složek");
  out.push("");
  out.push("Diagram ukazuje jen složky (ne jednotlivé soubory) a vykreslí se jen v prohlížeči s podporou Mermaid (např. GitHub nebo VS Code).");
  if (diagram.truncated) {
    out.push("");
    out.push(`> Diagram byl oříznut: zobrazeno ${diagram.shown} z ${diagram.total} složek (limit ${maxNodes} uzlů). Úplný seznam je v JSON indexu.`);
  }
  out.push("");
  out.push("```mermaid");
  out.push(...diagram.lines);
  out.push("```");
  out.push("");

  out.push(...moduleGraphSection(input.moduleGraph, maxModuleNodes, maxModuleEdges));

  out.push(...aiSection(input.ai));

  out.push("## Soubory");
  out.push("");
  if (fileEntries.length === 0) {
    out.push("_Žádné soubory._");
  } else {
    for (const f of fileEntries) {
      const tag = f.minified ? " — minifikát (nelintuje se / mimo graf)" : "";
      out.push(`- \`${f.path}\` (${f.size} B)${tag}`);
    }
  }
  out.push("");

  if (input.skippedUnreadable.length > 0) {
    out.push("## Nečitelné (přeskočeno)");
    out.push("");
    for (const p of input.skippedUnreadable) {
      out.push(`- \`${p}\``);
    }
    out.push("");
  }

  return out.join("\n");
}
