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
 *  reject = chyba. `stopReason: "max_tokens"` = výstup uříznut (řeší runAiAnalysis). */
export type AnalyzeFn = (
  apiKey: string,
  model: AiModelChoice,
  system: string,
  userPrompt: string,
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
    const { rawText, usage, stopReason } = await analyze(apiKey, model, SYSTEM_PROMPT, prompt);
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
