import type { Finding, Severity } from "../findings.js";
import type { Intent } from "../intent.js";
import { AI_KEY_ENV, type AiModelChoice, type AiStatus, type AiUsage, detectAiStatus } from "./aiStatus.js";
import type { AiPayload, PayloadFile } from "./aiPayload.js";

/** ID modelů pro Anthropic API. Sdíleno s reálným voláním (aiAnalyze.ts). */
export const AI_MODEL_IDS: Record<AiModelChoice, string> = {
  opus: "claude-opus-4-8",
  sonnet: "claude-sonnet-4-6",
};

/** Ceny v USD za milion tokenů (vstup/výstup). Natvrdo – non-goal zakazuje konfig.
 *  Zdroj pro výpočet ceny ze skutečné `usage`. */
export const AI_PRICES_USD_PER_MTOK: Record<AiModelChoice, { input: number; output: number }> = {
  opus: { input: 5, output: 25 },
  sonnet: { input: 3, output: 15 },
};

/**
 * JSON schéma pro strukturovaný výstup (output_config.format). Garantuje
 * parsovatelný tvar. POZOR: structured outputs NEpodporují číselné meze (minimum
 * /maximum) – rozsah `nonGoalIndex`/`line` proto ověřujeme až v `toFindings`.
 */
export const FINDINGS_SCHEMA: { [key: string]: unknown } = {
  type: "object",
  additionalProperties: false,
  required: ["findings"],
  properties: {
    findings: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["file", "line", "nonGoalIndex", "severity", "message"],
        properties: {
          file: { type: "string" },
          line: { type: "integer" },
          nonGoalIndex: { type: "integer" },
          severity: { type: "string", enum: ["error", "warning", "info"] },
          message: { type: "string" },
        },
      },
    },
  },
};

/** Systémový prompt analytika non-goalů. Drží Claude u faktů: jen reálná porušení,
 *  vždy s konkrétním místem v poslaném kódu, bez vymýšlení. */
export const SYSTEM_PROMPT = [
  "Jsi analytik kódu. Dostaneš ZÁMĚR projektu, jeho DEKLAROVANÉ NON-GOALY (co se v této",
  "verzi schválně NEMÁ dělat) a zdrojový kód. Tvůj úkol: najít místa v kódu, která",
  "PORUŠUJÍ některý deklarovaný non-goal.",
  "",
  "Pravidla:",
  "- Hlas jen SKUTEČNÁ porušení, ne domněnky. Když nic neporušuje, vrať prázdný seznam.",
  "- Každý nález MUSÍ ukazovat na konkrétní místo: `file` přesně tak, jak je v hlavičce",
  "  `// ==== cesta ====` nad kódem, a `line` jako 1-based číslo řádku v TOM souboru.",
  "- `nonGoalIndex` je 0-based index do seznamu non-goalů, který porušení odpovídá.",
  "- Nevymýšlej si soubory ani řádky, které v poslaném kódu nejsou.",
  "- `message` piš česky, stručně: co a proč non-goal porušuje.",
].join("\n");

/** Sestaví uživatelský prompt: záměr + číslované non-goaly + (případně přiznané
 *  uříznutí) + slepený kód. Čisté, testovatelné. */
export function buildAnalyzePrompt(building: string | null, nonGoals: string[], payload: AiPayload): string {
  const parts: string[] = [];
  parts.push("# Záměr projektu");
  parts.push(building && building.trim() !== "" ? building.trim() : "(nedodán)");
  parts.push("");
  parts.push("# Deklarované non-goaly (index: text)");
  parts.push(nonGoals.map((g, i) => `${i}: ${g}`).join("\n"));
  parts.push("");
  if (payload.truncated) {
    parts.push("> Pozor: kód byl kvůli velikosti uříznut – posouzení je neúplné.");
    parts.push("");
  }
  parts.push("# Zdrojový kód (s hlavičkami cest)");
  parts.push(payload.text);
  return parts.join("\n");
}

/** Surový nález tak, jak ho vrátí model podle schématu (před ověřením). */
export interface RawAiFinding {
  file: string;
  line: number;
  nonGoalIndex: number;
  severity: Severity;
  message: string;
}

/**
 * Naparsuje strukturovaný JSON výstup na `RawAiFinding[]`. Schéma sice tvar
 * garantuje, ale věříme jen tomu, co OPRAVDU přišlo – při špatném tvaru HODÍME
 * (nečekaný stav, NEmaskovat jako prázdný seznam). Volající (runAiAnalysis) ho
 * nechá probublat, na hranici CLI degraduje se stackem.
 */
export function parseFindings(rawText: string): RawAiFinding[] {
  const data = JSON.parse(rawText) as unknown;
  if (typeof data !== "object" || data === null || !Array.isArray((data as { findings?: unknown }).findings)) {
    throw new Error("AI odpověď nemá očekávaný tvar { findings: [...] }");
  }
  const arr = (data as { findings: unknown[] }).findings;
  return arr.map((item, i) => {
    if (typeof item !== "object" || item === null) {
      throw new Error(`AI nález #${i} není objekt`);
    }
    const o = item as Record<string, unknown>;
    if (
      typeof o.file !== "string" ||
      typeof o.line !== "number" ||
      typeof o.nonGoalIndex !== "number" ||
      (o.severity !== "error" && o.severity !== "warning" && o.severity !== "info") ||
      typeof o.message !== "string"
    ) {
      throw new Error(`AI nález #${i} má neočekávaná pole`);
    }
    return {
      file: o.file,
      line: o.line,
      nonGoalIndex: o.nonGoalIndex,
      severity: o.severity,
      message: o.message,
    };
  });
}

/**
 * Převede surové nálezy na sdílené `Finding[]` a LEVNĚ ověří tvrzené místo:
 * soubor musí být v poslaném setu a řádek ≤ počet jeho řádků. Když ne, místo se
 * NEpovažuje za ověřené – `file`/`line` se zahodí a do zprávy se přidá značka
 * „[místo neověřeno…]" (obrana proti halucinaci, plné sémantické ověření až později).
 * `rule` nese, který non-goal nález porušuje (kontrakt: non-goal nálezy se vážou na
 * deklarované non-goaly).
 */
export function toFindings(raw: RawAiFinding[], nonGoals: string[], includedFiles: PayloadFile[]): Finding[] {
  const lineCountByPath = new Map(includedFiles.map((f) => [f.path, f.lineCount]));
  return raw.map((r) => {
    const lineCount = lineCountByPath.get(r.file);
    const inSet = lineCount !== undefined;
    const lineOk = inSet && Number.isInteger(r.line) && r.line >= 1 && r.line <= lineCount;
    const ngOk = Number.isInteger(r.nonGoalIndex) && r.nonGoalIndex >= 0 && r.nonGoalIndex < nonGoals.length;
    const ngText = ngOk ? nonGoals[r.nonGoalIndex] : `#${r.nonGoalIndex} (mimo seznam non-goalů)`;

    let message = r.message;
    let file: string | undefined;
    let line: number | undefined;
    if (!inSet) {
      message += ` [místo neověřeno: soubor '${r.file}' nebyl poslán]`;
    } else if (!lineOk) {
      file = r.file;
      message += ` [místo neověřeno: řádek ${r.line} je mimo soubor]`;
    } else {
      file = r.file;
      line = r.line;
    }

    return { source: "ai" as const, severity: r.severity, file, line, rule: `non-goal: ${ngText}`, message };
  });
}

/** Cena v USD ze skutečné spotřeby tokenů × cenová tabulka zvoleného modelu. */
export function computeCostUsd(usage: AiUsage, model: AiModelChoice): number {
  const p = AI_PRICES_USD_PER_MTOK[model];
  return (usage.inputTokens / 1_000_000) * p.input + (usage.outputTokens / 1_000_000) * p.output;
}

/** Injektované reálné volání modelu (aiAnalyze.realAiAnalyze nebo fake v testech).
 *  Resolve = API odpovědělo (rawText = strukturovaný JSON + usage + stop_reason);
 *  reject = chyba. `stopReason: "max_tokens"` = výstup uříznut (řeší runAiAnalysis).
 *  `schema` je JSON schéma strukturovaného výstupu – KAŽDÝ režim posílá své vlastní
 *  (non-goal `FINDINGS_SCHEMA` vs code `CODE_FINDINGS_SCHEMA`); musí sedět na prompt,
 *  jinak model vrátí tvar, který parser daného režimu odmítne. */
export type AnalyzeFn = (
  apiKey: string,
  model: AiModelChoice,
  system: string,
  userPrompt: string,
  schema: { [key: string]: unknown },
) => Promise<{ rawText: string; usage: AiUsage; stopReason: string | null }>;

/**
 * Orchestrátor reálné analýzy non-goalů (za `--ai`). Detekci klíče nechává na čisté
 * `detectAiStatus`; bez klíče vrátí `skipped` BEZ síťového volání. Bez non-goalů nebo
 * bez souborů taky `skipped` (není co posuzovat). Jinak složí prompt, zavolá `analyze`
 * a zpracuje výsledek na `analyzed`. Chybu zatřídí `classify`: známá (síť/timeout/401)
 * → `skipped` s důvodem; neznámá (parse/program) → probublá se stackem (nemaskovat).
 *
 * `analyze`/`classify` injektované – testy bez sítě, a default běh ani nenahraje SDK.
 */
export async function runAiAnalysis(
  env: Record<string, string | undefined>,
  intent: Intent | null,
  payload: AiPayload,
  model: AiModelChoice,
  analyze: AnalyzeFn,
  classify: (err: unknown) => string | null,
): Promise<AiStatus> {
  const gate = detectAiStatus(env);
  if (gate.kind === "skipped") return gate;

  const nonGoals = intent?.nonGoals ?? null;
  if (!nonGoals || nonGoals.length === 0) {
    return { kind: "skipped", reason: "žádné deklarované non-goaly (není co posuzovat)" };
  }
  if (payload.includedFiles.length === 0) {
    return { kind: "skipped", reason: "žádné zdrojové soubory k analýze" };
  }

  const apiKey = (env[AI_KEY_ENV] as string).trim();
  const prompt = buildAnalyzePrompt(intent?.building ?? null, nonGoals, payload);
  try {
    const { rawText, usage, stopReason } = await analyze(apiKey, model, SYSTEM_PROMPT, prompt, FINDINGS_SCHEMA);
    // Uříznutý/prázdný výstup je PROVOZNÍ stav (thinking sežral max_tokens, model
    // nestihl JSON), NE programová chyba – čistě přeskočíme s důvodem a NAÚČTOVANOU
    // cenou (transparentně, ať uživatel ví, že běh něco stál), místo pádu na
    // JSON.parse("") se stackem.
    if (stopReason === "max_tokens" || rawText.trim() === "") {
      const cost = computeCostUsd(usage, model);
      return {
        kind: "skipped",
        reason: `model ${model} nevrátil úplný výstup (stop_reason=${stopReason ?? "prázdný"}); naúčtováno ~$${cost.toFixed(4)}. Zkus jiný model nebo menší rozsah.`,
      };
    }
    const findings = toFindings(parseFindings(rawText), nonGoals, payload.includedFiles);
    return { kind: "analyzed", model, findings, usage, costUsd: computeCostUsd(usage, model) };
  } catch (err: unknown) {
    const reason = classify(err);
    if (reason === null) throw err;
    return { kind: "skipped", reason };
  }
}

// ====================================================================================
// Analýza KVALITY / RIZIK kódu (`--ai-code`) — samostatná vrstva, NEZÁVISLÁ na non-
// goalech. Vlastní prompt i schéma BEZ `nonGoalIndex`: hledá problémy, které nezachytí
// parser/tsc/ESLint (logické chyby, rizikové vzorce, sémantika), ne syntaxi/typy.
// ====================================================================================

/**
 * JSON schéma pro nálezy analýzy kódu. Záměrně BEZ `nonGoalIndex` (code nálezy se
 * nevážou na deklarované non-goaly — to je jiná vrstva). `kind` je krátký druh
 * problému, který se v reportu promítne do `rule`. Číselné meze (`line`) schéma
 * neumí — `line` ověřujeme až v `toCodeFindings` proti počtu řádků poslaného souboru.
 */
export const CODE_FINDINGS_SCHEMA: { [key: string]: unknown } = {
  type: "object",
  additionalProperties: false,
  required: ["findings"],
  properties: {
    findings: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["file", "line", "kind", "severity", "message"],
        properties: {
          file: { type: "string" },
          line: { type: "integer" },
          kind: { type: "string" },
          severity: { type: "string", enum: ["error", "warning", "info"] },
          message: { type: "string" },
        },
      },
    },
  },
};

/** Systémový prompt analytika kvality/rizik kódu. POJISTKA proti ukecanosti (a tím
 *  proti ceně): jen reálné, ověřitelné problémy s konkrétním místem, ne domněnky ani
 *  stylové drobnosti. Syntaxi a typy řeší stroj (tsc/ESLint) — od AI je nechceme. */
export const SYSTEM_PROMPT_CODE = [
  "Jsi zkušený recenzent kódu. Dostaneš zdrojový kód projektu. Tvůj úkol: najít",
  "REÁLNÉ problémy kvality a rizika, které běžný parser, typová kontrola (tsc) ani",
  "linter (ESLint) NEodhalí — tedy logické chyby, riskantní/nebezpečné vzorce,",
  "chybějící ošetření chyb, podezřelou sémantiku, race conditions a podobně.",
  "",
  "Pravidla:",
  "- Hlas jen SKUTEČNÉ, konkrétní problémy, ne domněnky, ne stylové drobnosti. Když",
  "  nic závažného nevidíš, vrať PRÁZDNÝ seznam — radši méně nálezů s jistotou než",
  "  zaplavit šumem. (Nemá smysl hlásit syntaktické/typové chyby — ty řeší stroj.)",
  "- Každý nález MUSÍ ukazovat na konkrétní místo: `file` přesně tak, jak je v hlavičce",
  "  `// ==== cesta ====` nad kódem, a `line` jako 1-based číslo řádku v TOM souboru.",
  "- `kind` je krátký druh problému česky (např. „logická chyba\", „neošetřená chyba\",",
  "  „riskantní vzorec\").",
  "- Nevymýšlej si soubory ani řádky, které v poslaném kódu nejsou.",
  "- `message` piš česky, stručně: co je špatně a proč je to riziko.",
].join("\n");

/** Sestaví uživatelský prompt pro analýzu kódu: (případně přiznané uříznutí) + slepený
 *  kód s hlavičkami cest. Bez záměru/non-goalů — code vrstva je posuzuje nezávisle. */
export function buildCodePrompt(payload: AiPayload): string {
  const parts: string[] = [];
  if (payload.truncated) {
    parts.push("> Pozor: kód byl kvůli velikosti uříznut – posouzení je neúplné.");
    parts.push("");
  }
  parts.push("# Zdrojový kód (s hlavičkami cest)");
  parts.push(payload.text);
  return parts.join("\n");
}

/** Surový code nález tak, jak ho vrátí model podle `CODE_FINDINGS_SCHEMA`. */
export interface RawCodeFinding {
  file: string;
  line: number;
  kind: string;
  severity: Severity;
  message: string;
}

/**
 * Naparsuje strukturovaný JSON výstup code analýzy na `RawCodeFinding[]`. Stejně jako
 * `parseFindings` věříme jen tomu, co OPRAVDU přišlo — při špatném tvaru HODÍME
 * (nečekaný stav, NEmaskovat jako prázdný seznam). Volající (`runAiCodeAnalysis`) ho
 * nechá probublat, na hranici CLI degraduje se stackem.
 */
export function parseCodeFindings(rawText: string): RawCodeFinding[] {
  const data = JSON.parse(rawText) as unknown;
  if (typeof data !== "object" || data === null || !Array.isArray((data as { findings?: unknown }).findings)) {
    throw new Error("AI odpověď (code) nemá očekávaný tvar { findings: [...] }");
  }
  const arr = (data as { findings: unknown[] }).findings;
  return arr.map((item, i) => {
    if (typeof item !== "object" || item === null) {
      throw new Error(`AI code nález #${i} není objekt`);
    }
    const o = item as Record<string, unknown>;
    if (
      typeof o.file !== "string" ||
      typeof o.line !== "number" ||
      typeof o.kind !== "string" ||
      (o.severity !== "error" && o.severity !== "warning" && o.severity !== "info") ||
      typeof o.message !== "string"
    ) {
      throw new Error(`AI code nález #${i} má neočekávaná pole`);
    }
    return { file: o.file, line: o.line, kind: o.kind, severity: o.severity, message: o.message };
  });
}

/**
 * Převede surové code nálezy na sdílené `Finding[]` a LEVNĚ ověří tvrzené místo —
 * stejný kontrakt jako `toFindings`: soubor musí být v poslaném setu a řádek ≤ počet
 * jeho řádků, jinak se místo NEpovažuje za ověřené (obrana proti halucinaci).
 * `rule` nese druh problému (`kód: <kind>`); žádná vazba na non-goaly.
 */
export function toCodeFindings(raw: RawCodeFinding[], includedFiles: PayloadFile[]): Finding[] {
  const lineCountByPath = new Map(includedFiles.map((f) => [f.path, f.lineCount]));
  return raw.map((r) => {
    const lineCount = lineCountByPath.get(r.file);
    const inSet = lineCount !== undefined;
    const lineOk = inSet && Number.isInteger(r.line) && r.line >= 1 && r.line <= lineCount;

    let message = r.message;
    let file: string | undefined;
    let line: number | undefined;
    if (!inSet) {
      message += ` [místo neověřeno: soubor '${r.file}' nebyl poslán]`;
    } else if (!lineOk) {
      file = r.file;
      message += ` [místo neověřeno: řádek ${r.line} je mimo soubor]`;
    } else {
      file = r.file;
      line = r.line;
    }

    return { source: "ai" as const, severity: r.severity, file, line, rule: `kód: ${r.kind}`, message };
  });
}

/**
 * Orchestrátor analýzy kódu (za `--ai-code`). Stejná kostra jako `runAiAnalysis`, ale
 * NEZÁVISLÁ na non-goalech: nepřeskakuje kvůli jejich chybění. Bez klíče → `skipped`
 * BEZ síťového volání. Bez souborů → `skipped` (není co posuzovat). Jinak složí prompt,
 * zavolá `analyze`, zpracuje výsledek; uříznutý/prázdný výstup je provozní `skipped`
 * s naúčtovanou cenou; známá chyba → `skipped` s důvodem; neznámá → probublá se stackem.
 */
export async function runAiCodeAnalysis(
  env: Record<string, string | undefined>,
  payload: AiPayload,
  model: AiModelChoice,
  analyze: AnalyzeFn,
  classify: (err: unknown) => string | null,
): Promise<AiStatus> {
  const gate = detectAiStatus(env);
  if (gate.kind === "skipped") return gate;

  if (payload.includedFiles.length === 0) {
    return { kind: "skipped", reason: "žádné zdrojové soubory k analýze" };
  }

  const apiKey = (env[AI_KEY_ENV] as string).trim();
  const prompt = buildCodePrompt(payload);
  try {
    const { rawText, usage, stopReason } = await analyze(apiKey, model, SYSTEM_PROMPT_CODE, prompt, CODE_FINDINGS_SCHEMA);
    if (stopReason === "max_tokens" || rawText.trim() === "") {
      const cost = computeCostUsd(usage, model);
      return {
        kind: "skipped",
        reason: `model ${model} nevrátil úplný výstup (stop_reason=${stopReason ?? "prázdný"}); naúčtováno ~$${cost.toFixed(4)}. Zkus jiný model nebo menší rozsah.`,
      };
    }
    const findings = toCodeFindings(parseCodeFindings(rawText), payload.includedFiles);
    return { kind: "analyzed", model, findings, usage, costUsd: computeCostUsd(usage, model) };
  } catch (err: unknown) {
    const reason = classify(err);
    if (reason === null) throw err;
    return { kind: "skipped", reason };
  }
}

// ====================================================================================
// Analýza LOGIKY / FUNKČNOSTI kódu jako CELKU (`--ai-logic`) — třetí samostatná vrstva.
// Posuzuje, zda kód jako celek dělá to, co slibuje ZÁMĚR z project.md ("What I'm
// building"), a kde se s ním rozchází. Dvě věci jsou jinak než u non-goal/code:
//   1) Místo je NEPOVINNÉ – soud o celku nemusí mířit na jeden řádek. Chybějící místo
//      je LEGITIMNÍ (ne značka „[místo neověřeno]"); vyplněné se ověří stejně.
//   2) Brána je na ZÁMĚRU (intent.building), ne na non-goalech ani jen na souborech.
//      Bez záměru se režim čistě přeskočí (odvození záměru z kódu je vyčleněno dál).
// Soud o celku se ověřuje nejhůř ze tří režimů → obrana proti halucinaci je slabší;
// pojistka je jen v promptu (jen reálné rozpory) + přiznání aproximace v reportu.
// ====================================================================================

/**
 * JSON schéma pro nálezy logické analýzy. `file` a `line` jsou ZÁMĚRNĚ NEpovinné
 * (nejsou v `required`) – nález o celku nemusí ukazovat na jeden řádek. Když model
 * místo dodá, ověří se až v `toLogicFindings`; když ne, je to legitimní stav, ne chyba.
 * Číselné meze (`line`) schéma neumí – ověřujeme je v kódu proti počtu řádků souboru.
 */
export const LOGIC_FINDINGS_SCHEMA: { [key: string]: unknown } = {
  type: "object",
  additionalProperties: false,
  required: ["findings"],
  properties: {
    findings: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["kind", "severity", "message"],
        properties: {
          file: { type: "string" },
          line: { type: "integer" },
          kind: { type: "string" },
          severity: { type: "string", enum: ["error", "warning", "info"] },
          message: { type: "string" },
        },
      },
    },
  },
};

/** Systémový prompt analytika logiky/funkčnosti CELKU vůči záměru. POJISTKA proti
 *  halucinaci (slabší než u řádkových režimů): jen reálné, doložitelné rozpory, radši
 *  méně. Místo je nepovinné, ale když ho lze určit, ať ho model uvede. */
export const SYSTEM_PROMPT_LOGIC = [
  "Jsi zkušený recenzent. Dostaneš ZÁMĚR projektu (co se staví) a jeho zdrojový kód.",
  "Tvůj úkol: posoudit kód jako CELEK a najít místa, kde se jeho skutečná funkčnost",
  "ROZCHÁZÍ s deklarovaným záměrem – chybějící slíbená funkčnost, rozpor mezi tím, co",
  "kód dělá a co má dělat, neúplné nebo polovičaté naplnění záměru.",
  "",
  "Pravidla:",
  "- Hlas jen SKUTEČNÉ, doložitelné rozpory se záměrem, ne domněnky ani přání. Když",
  "  kód záměr naplňuje, vrať PRÁZDNÝ seznam – radši méně nálezů s jistotou.",
  "- Posuzuješ CELEK: je to neúplná APROXIMACE, ne řádkový audit. Syntaxi, typy a",
  "  rizikové vzorce řeší jiné vrstvy (tsc/ESLint/code analýza) – ty je neřeš.",
  "- Místo je NEpovinné. Když rozpor JDE ukázat na konkrétní soubor/řádek, uveď `file`",
  "  přesně tak, jak je v hlavičce `// ==== cesta ====` nad kódem, a `line` jako 1-based",
  "  číslo řádku. Když rozpor míří na celek a místo určit nelze, `file`/`line` vynech.",
  "- Nevymýšlej si soubory ani řádky, které v poslaném kódu nejsou.",
  "- `kind` je krátký druh rozporu česky (např. „chybí funkčnost\", „rozpor se záměrem\").",
  "- `message` piš česky, stručně: co kód (ne)dělá a jak se to s záměrem rozchází.",
].join("\n");

/** Sestaví uživatelský prompt pro logickou analýzu: záměr ("What I'm building") + slepený
 *  kód s hlavičkami cest. Non-goaly se NEposílají – ty řeší `--ai-non-goal`. Uříznutý kód
 *  sem nedoteče (orchestrátor na `payload.truncated` přeskočí), proto bez poznámky o uříznutí. */
export function buildLogicPrompt(building: string, payload: AiPayload): string {
  const parts: string[] = [];
  parts.push("# Záměr projektu (What I'm building)");
  parts.push(building.trim());
  parts.push("");
  parts.push("# Zdrojový kód (s hlavičkami cest)");
  parts.push(payload.text);
  return parts.join("\n");
}

/** Surový logický nález tak, jak ho vrátí model podle `LOGIC_FINDINGS_SCHEMA`. `file`/`line`
 *  jsou nepovinné (soud o celku nemusí mířit na jeden řádek). */
export interface RawLogicFinding {
  file?: string;
  line?: number;
  kind: string;
  severity: Severity;
  message: string;
}

/**
 * Naparsuje strukturovaný JSON výstup logické analýzy na `RawLogicFinding[]`. Stejně jako
 * ostatní režimy věříme jen tomu, co OPRAVDU přišlo – při špatném tvaru HODÍME (nečekaný
 * stav, NEmaskovat jako prázdný seznam). `file`/`line` jsou nepovinné: chybějící je v
 * pořádku, ale když přijdou, musí mít správný typ (jinak hodíme).
 */
export function parseLogicFindings(rawText: string): RawLogicFinding[] {
  const data = JSON.parse(rawText) as unknown;
  if (typeof data !== "object" || data === null || !Array.isArray((data as { findings?: unknown }).findings)) {
    throw new Error("AI odpověď (logic) nemá očekávaný tvar { findings: [...] }");
  }
  const arr = (data as { findings: unknown[] }).findings;
  return arr.map((item, i) => {
    if (typeof item !== "object" || item === null) {
      throw new Error(`AI logic nález #${i} není objekt`);
    }
    const o = item as Record<string, unknown>;
    if (
      typeof o.kind !== "string" ||
      (o.severity !== "error" && o.severity !== "warning" && o.severity !== "info") ||
      typeof o.message !== "string"
    ) {
      throw new Error(`AI logic nález #${i} má neočekávaná pole`);
    }
    // Nepovinné místo: smí chybět, ale když je přítomné, musí mít správný typ.
    if (o.file !== undefined && typeof o.file !== "string") {
      throw new Error(`AI logic nález #${i} má neplatné pole file`);
    }
    if (o.line !== undefined && typeof o.line !== "number") {
      throw new Error(`AI logic nález #${i} má neplatné pole line`);
    }
    const out: RawLogicFinding = { kind: o.kind, severity: o.severity, message: o.message };
    if (typeof o.file === "string") out.file = o.file;
    if (typeof o.line === "number") out.line = o.line;
    return out;
  });
}

/**
 * Převede surové logické nálezy na sdílené `Finding[]`. Místo je NEpovinné, takže se liší
 * od `toFindings`/`toCodeFindings`:
 *   - `file` chybí          → nález o celku, žádné místo, ŽÁDNÁ značka (legitimní).
 *   - `file` mimo poslaný set→ nelze ověřit → značka „[místo neověřeno]", `file` se zahodí.
 *   - `file` v setu, bez `line` → nález o celém souboru (legitimní), bez řádku, bez značky.
 *   - `file` v setu + `line` mimo rozsah → značka „[místo neověřeno]", řádek se zahodí.
 *   - `file` v setu + platný `line` → ověřené místo.
 * `rule` nese druh rozporu (`logika: <kind>`).
 */
export function toLogicFindings(raw: RawLogicFinding[], includedFiles: PayloadFile[]): Finding[] {
  const lineCountByPath = new Map(includedFiles.map((f) => [f.path, f.lineCount]));
  return raw.map((r) => {
    let message = r.message;
    let file: string | undefined;
    let line: number | undefined;

    if (r.file !== undefined) {
      const lineCount = lineCountByPath.get(r.file);
      if (lineCount === undefined) {
        message += ` [místo neověřeno: soubor '${r.file}' nebyl poslán]`;
      } else {
        file = r.file;
        if (r.line !== undefined) {
          if (Number.isInteger(r.line) && r.line >= 1 && r.line <= lineCount) {
            line = r.line;
          } else {
            message += ` [místo neověřeno: řádek ${r.line} je mimo soubor]`;
          }
        }
      }
    }

    return { source: "ai" as const, severity: r.severity, file, line, rule: `logika: ${r.kind}`, message };
  });
}

/**
 * Orchestrátor logické analýzy (za `--ai-logic`). Stejná kostra jako ostatní orchestrátory,
 * ale brána je na ZÁMĚRU: bez klíče → `skipped` BEZ síťového volání; bez záměru
 * (`intent.building` chybí/prázdné) → `skipped` (odvození záměru z kódu je vyčleněno dál);
 * bez souborů → `skipped`; UŘÍZNUTÝ kód → `skipped` (soud o celku z neúplného vstupu je
 * nespolehlivý – krájení na části přijde v další fázi). Jinak složí prompt, zavolá `analyze`;
 * uříznutý/prázdný výstup je provozní `skipped` s naúčtovanou cenou; známá chyba → `skipped`
 * s důvodem; neznámá → probublá se stackem.
 */
export async function runAiLogicAnalysis(
  env: Record<string, string | undefined>,
  intent: Intent | null,
  payload: AiPayload,
  model: AiModelChoice,
  analyze: AnalyzeFn,
  classify: (err: unknown) => string | null,
): Promise<AiStatus> {
  const gate = detectAiStatus(env);
  if (gate.kind === "skipped") return gate;

  const building = intent?.building ?? null;
  if (building === null || building.trim() === "") {
    return {
      kind: "skipped",
      reason: "chybí záměr (sekce „What I'm building\" v project.md) – logická analýza vyžaduje záměr",
    };
  }

  if (payload.includedFiles.length === 0) {
    return { kind: "skipped", reason: "žádné zdrojové soubory k analýze" };
  }
  // Useknutý kód: soud o CELKU z neúplného vstupu by byl nespolehlivý → čistě přeskočit.
  // Krájení projektu na logické části a kontrola po částech je samostatná budoucí fáze.
  if (payload.truncated) {
    return {
      kind: "skipped",
      reason: "kód se kvůli velikosti nevešel celý – soud o celku by byl nespolehlivý (krájení na části přijde v další fázi)",
    };
  }

  const apiKey = (env[AI_KEY_ENV] as string).trim();
  const prompt = buildLogicPrompt(building, payload);
  try {
    const { rawText, usage, stopReason } = await analyze(apiKey, model, SYSTEM_PROMPT_LOGIC, prompt, LOGIC_FINDINGS_SCHEMA);
    if (stopReason === "max_tokens" || rawText.trim() === "") {
      const cost = computeCostUsd(usage, model);
      return {
        kind: "skipped",
        reason: `model ${model} nevrátil úplný výstup (stop_reason=${stopReason ?? "prázdný"}); naúčtováno ~$${cost.toFixed(4)}. Zkus jiný model nebo menší rozsah.`,
      };
    }
    const findings = toLogicFindings(parseLogicFindings(rawText), payload.includedFiles);
    return { kind: "analyzed", model, findings, usage, costUsd: computeCostUsd(usage, model) };
  } catch (err: unknown) {
    const reason = classify(err);
    if (reason === null) throw err;
    return { kind: "skipped", reason };
  }
}
