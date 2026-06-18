import type { IntentDraft } from "./intentWriter.js";

/**
 * Injektovaný dotazovač: dostane otázku, vrátí odpověď uživatele, nebo `null` =
 * konec vstupu / zrušení (EOF, Ctrl-D). Reálná implementace nad `readline` přijde
 * v navazující fázi; sběrová logika tu na ní nezávisí, ať je testovatelná bez stdin.
 */
export type AskFn = (question: string) => Promise<string | null>;

/** Výsledek validace jednoho řádku odpovědi. */
export type LineCheck = { ok: true; value: string } | { ok: false; reason: string };

/** Vnitřní nový řádek – odpověď MUSÍ být jeden řádek (jinak S1 i víceřádkové S2). */
const MULTILINE = /[\r\n]/;
/** 3+ backtick/tilda kdekoliv v řádku = code-fence marker (parser na něj reaguje). */
const FENCE = /(?:`{3,}|~{3,})/;
/** Řádek vypadající jako nadpis sekce úrovně 2 – parser ho bere jako předěl sekcí. */
const SECTION_HEADING = /^##\s/;

/**
 * Vynutí precondici renderu (fáze 8, nálezy S1/S2) na JEDNÉ odpovědi. Klíčový
 * invariant: odpověď je JEDEN řádek – ten vynucujeme, NEpředpokládáme (kontrakt
 * `AskFn` jednořádkovost negarantuje; paste/bracketed-paste může dodat víc řádků):
 * - odpověď NESMÍ obsahovat vnitřní `\n`/`\r` – víceřádkový non-goal by se tiše
 *   ořízl (S1) a vnořený `## …`/fence na 2.+ řádku by parseIntent vzal jako předěl
 *   a spolkl sousední sekci (víceřádková S2). Kotvené regexy níž (`^##`) by to
 *   nechytly, proto odmítáme celý víceřádkový vstup,
 * - odpověď NESMÍ obsahovat code-fence (` ``` ` / `~~~`) – lichý fence i na jednom
 *   řádku parseIntent "rozjede" a spolkne následující sekci (S2),
 * - odpověď NESMÍ vypadat jako nadpis sekce `## …` – parser ho bere jako předěl.
 *
 * Vstup se TRIMUJE (krajní bílé znaky včetně koncového `\n` z readline jsou OK,
 * kontrolujeme až VNITŘNÍ nový řádek); prázdnotu řeší volající (sentinel
 * "hotovo"/"zrušit"), ne tahle funkce.
 */
export function validateAnswerLine(raw: string): LineCheck {
  const value = raw.trim();
  if (MULTILINE.test(value)) {
    return { ok: false, reason: "Odpověď musí být na jednom řádku (žádné nové řádky)." };
  }
  if (FENCE.test(value)) {
    return { ok: false, reason: "Řádek nesmí obsahovat ``` ani ~~~ (code fence)." };
  }
  if (SECTION_HEADING.test(value)) {
    return { ok: false, reason: "Řádek nesmí začínat '## ' (vypadá to jako nadpis sekce)." };
  }
  return { ok: true, value };
}

/** Výsledek sběru: hotový koncept záměru, nebo zrušení (EOF / prázdný záměr). */
export type CollectResult = { kind: "draft"; draft: IntentDraft } | { kind: "cancelled" };

/** JEDNA vedoucí odrážka `- `/`* ` (s mezerou). renderProjectMd už každý non-goal
 *  prefixuje `- `, takže když uživatel přirozeně napíše „- Nespouštět kód", vznikla
 *  by zdvojená odrážka `- - …` (nález 10-2). Ořez děláme TADY, ve sběru – render
 *  zůstává čistý formátter (kontrakt v intentWriter.ts). */
const LEADING_BULLET = /^[-*]\s+/;

/**
 * Odřízne JEDNU vedoucí odrážku z non-goalu (víc ne – `- - x` po jednom ořezu dá
 * `- x`, což už je validní text položky). Vstup je po `validateAnswerLine` (jeden
 * řádek, bez fence/nadpisu), takže ořez nemůže odhalit nic nebezpečného. Trim řeší
 * mezeru, kterou regex spotřeboval i případné krajní bílé znaky.
 */
function stripLeadingBullet(value: string): string {
  return value.replace(LEADING_BULLET, "").trim();
}

const Q_BUILDING = "Co stavíš? (jedna věta; prázdný řádek = zrušit)";
const Q_NONGOAL =
  "Co projekt vědomě NEMÁ dělat? (jeden non-goal; prázdný řádek = hotovo, žádné non-goaly nech prázdné)";

/**
 * Jedno kolo dotazu: ptá se tak dlouho, dokud nedostane VALIDNÍ neprázdný řádek,
 * nebo dokud nepřijde prázdný řádek / EOF. Při nevalidní odpovědi se ptá ZNOVU
 * s důvodem v hlášce – chyba se nenormalizuje potichu (kontrakt CLAUDE.md), ale
 * ani nepadá; uživatel dostane šanci to opravit.
 */
async function askValidLine(
  ask: AskFn,
  question: string,
): Promise<{ kind: "value"; value: string } | { kind: "empty" } | { kind: "eof" }> {
  let prompt = question;
  for (;;) {
    const raw = await ask(prompt);
    if (raw === null) return { kind: "eof" };
    if (raw.trim() === "") return { kind: "empty" };
    const check = validateAnswerLine(raw);
    if (check.ok) return { kind: "value", value: check.value };
    prompt = `${check.reason} ${question}`;
  }
}

/**
 * Posbírá od uživatele koncept záměru přes injektovaný `ask`. Čistě sběr –
 * NEZAPISUJE nic (zápis řeší writeIntentFile v navazující fázi) a nečte reálný
 * stdin (to je v `ask`).
 *
 * Tok: nejdřív povinný "co stavím" (1 řádek), pak 0+ non-goalů (každý 1 řádek)
 * až do prázdného řádku.
 * - prázdný "co stavím" → `cancelled` (uživatel nechce záměr vytvářet; bez záměru
 *   by render dal prázdnou sekci = k ničemu),
 * - EOF (`ask` vrátí `null`) KDEKOLIV → `cancelled`. EOF je "přeruš", odlišený od
 *   prázdného řádku ("hotovo"): half-hotový záměr radši nezapíšeme, než abychom
 *   uložili něco, co uživatel nedomyslel,
 * - prázdný řádek u non-goalů → konec sběru non-goalů (prázdný seznam je legitimní),
 * - každá neprázdná odpověď projde `validateAnswerLine` (S1/S2 u zdroje).
 *
 * Vrací `IntentDraft` (sdílený tvar s intentWriter) – `renderProjectMd` ho rovnou
 * sní; round-trip přes parser to v testech hlídá.
 */
export async function collectIntentDraft(ask: AskFn): Promise<CollectResult> {
  const building = await askValidLine(ask, Q_BUILDING);
  if (building.kind === "eof" || building.kind === "empty") return { kind: "cancelled" };

  const nonGoals: string[] = [];
  for (;;) {
    const goal = await askValidLine(ask, Q_NONGOAL);
    if (goal.kind === "eof") return { kind: "cancelled" };
    if (goal.kind === "empty") break;
    nonGoals.push(stripLeadingBullet(goal.value));
  }

  return { kind: "draft", draft: { building: building.value, nonGoals } };
}
