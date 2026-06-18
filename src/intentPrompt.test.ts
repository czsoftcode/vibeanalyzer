import { describe, expect, it } from "vitest";
import { parseIntent } from "./intent.js";
import { type AskFn, collectIntentDraft, validateAnswerLine } from "./intentPrompt.js";
import { renderProjectMd } from "./intentWriter.js";

/**
 * Fake dotazovač: vydává odpovědi v pořadí; po vyčerpání pole vrací null (EOF).
 * `null` přímo v poli simuluje EOF uprostřed toku. Zaznamenává položené otázky –
 * pro ověření re-asku (otázka s hláškou) a počtu dotazů.
 */
function fakeAsk(answers: ReadonlyArray<string | null>): { ask: AskFn; questions: string[] } {
  const questions: string[] = [];
  let i = 0;
  const ask: AskFn = async (q) => {
    questions.push(q);
    return i < answers.length ? (answers[i++] ?? null) : null;
  };
  return { ask, questions };
}

describe("validateAnswerLine – precondice na řádek (S2)", () => {
  it("normální řádek projde a ořízne se", () => {
    expect(validateAnswerLine("  Lokální CLI.  ")).toEqual({ ok: true, value: "Lokální CLI." });
  });

  it("code fence ``` → odmítnuto", () => {
    expect(validateAnswerLine("ukázka: ```").ok).toBe(false);
    expect(validateAnswerLine("```ts").ok).toBe(false);
    expect(validateAnswerLine("~~~").ok).toBe(false);
  });

  it("nadpis sekce '## ' → odmítnuto", () => {
    expect(validateAnswerLine("## Non-goals").ok).toBe(false);
  });

  it("vnitřní nový řádek → odmítnuto (S1 i víceřádkové S2)", () => {
    // '## ' až na 2. řádku obejde kotvený /^##/, ale jako víceřádek padne
    expect(validateAnswerLine("Reálný text\n## Non-goals\nFAKE").ok).toBe(false);
    expect(validateAnswerLine("první\r\ndruhý").ok).toBe(false);
    expect(validateAnswerLine("položka\ndalší řádek").ok).toBe(false);
  });

  it("jednoduché '# ' (H1) i '### ' projdou – parser je za předěl sekcí nebere", () => {
    expect(validateAnswerLine("# Titulek").ok).toBe(true);
    expect(validateAnswerLine("### detail").ok).toBe(true);
  });
});

describe("collectIntentDraft – sběrová smyčka", () => {
  it("happy path: building + non-goaly + prázdný řádek → draft", async () => {
    const { ask } = fakeAsk(["CLI nástroj.", "Nespouštět kód.", "Nestavět web.", ""]);
    const r = await collectIntentDraft(ask);
    expect(r).toEqual({
      kind: "draft",
      draft: { building: "CLI nástroj.", nonGoals: ["Nespouštět kód.", "Nestavět web."] },
    });
  });

  it("KONTRAKT round-trip: collect → render → parseIntent vrátí přesně posbíraná data", async () => {
    const { ask } = fakeAsk(["Lokální CLI nástroj.", "Nespouštět kód.", "Nestavět web.", ""]);
    const r = await collectIntentDraft(ask);
    expect(r.kind).toBe("draft");
    if (r.kind === "draft") {
      const parsed = parseIntent(renderProjectMd(r.draft), "/x/project.md");
      expect(parsed.building).toBe(r.draft.building);
      expect(parsed.nonGoals).toEqual(r.draft.nonGoals);
    }
  });

  it("S1/S2 u zdroje: pokus o fence se re-askne a do renderu se nedostane porušení", async () => {
    // druhá odpověď (non-goal) je fence → re-ask → oprava; do draftu se fence nedostane
    const { ask, questions } = fakeAsk(["CLI.", "```", "Nespouštět kód.", ""]);
    const r = await collectIntentDraft(ask);
    expect(r.kind).toBe("draft");
    if (r.kind === "draft") {
      expect(r.draft.nonGoals).toEqual(["Nespouštět kód."]);
      // re-ask nesl důvod v hlášce
      expect(questions.some((q) => q.includes("code fence"))).toBe(true);
      // a round-trip drží (žádný fence neunikl do sekce)
      const parsed = parseIntent(renderProjectMd(r.draft), "/x");
      expect(parsed.nonGoals).toEqual(["Nespouštět kód."]);
      expect(parsed.building).toBe("CLI.");
    }
  });

  it("víceřádkový vstup (vnořený '## Non-goals') se re-askne a NErozbije round-trip", async () => {
    // bez ochrany by multiline building po renderu spolkl sekci Non-goals (S2)
    const { ask, questions } = fakeAsk([
      "Reálný záměr.\n## Non-goals\nFAKE injected",
      "Lokální CLI nástroj.",
      "Nespouštět kód.",
      "",
    ]);
    const r = await collectIntentDraft(ask);
    expect(r.kind).toBe("draft");
    if (r.kind === "draft") {
      expect(r.draft.building).toBe("Lokální CLI nástroj.");
      expect(questions.some((q) => q.includes("jednom řádku"))).toBe(true);
      // round-trip drží: sekce Non-goals nezmizela
      const parsed = parseIntent(renderProjectMd(r.draft), "/x");
      expect(parsed.building).toBe("Lokální CLI nástroj.");
      expect(parsed.nonGoals).toEqual(["Nespouštět kód."]);
    }
  });

  it("nevalidní building se re-askne, teprve validní projde", async () => {
    const { ask } = fakeAsk(["## heading", "CLI nástroj.", ""]);
    const r = await collectIntentDraft(ask);
    expect(r).toEqual({ kind: "draft", draft: { building: "CLI nástroj.", nonGoals: [] } });
  });

  it("víc nevalidních pokusů za sebou, pak validní", async () => {
    const { ask } = fakeAsk(["CLI.", "## x", "```", "Reálný non-goal.", ""]);
    const r = await collectIntentDraft(ask);
    expect(r).toEqual({
      kind: "draft",
      draft: { building: "CLI.", nonGoals: ["Reálný non-goal."] },
    });
  });

  it("žádné non-goaly (hned prázdný řádek) → prázdný seznam", async () => {
    const { ask } = fakeAsk(["CLI nástroj.", ""]);
    const r = await collectIntentDraft(ask);
    expect(r).toEqual({ kind: "draft", draft: { building: "CLI nástroj.", nonGoals: [] } });
  });

  it("prázdný building → cancelled (uživatel nechce vytvářet)", async () => {
    const { ask } = fakeAsk([""]);
    expect(await collectIntentDraft(ask)).toEqual({ kind: "cancelled" });
  });

  it("EOF na buildingu (ask→null) → cancelled bez výjimky", async () => {
    const { ask } = fakeAsk([null]);
    expect(await collectIntentDraft(ask)).toEqual({ kind: "cancelled" });
  });

  it("EOF uprostřed non-goalů → cancelled (zahodí i posbírané, ne half-záměr)", async () => {
    const { ask } = fakeAsk(["CLI.", "Nespouštět kód.", null]);
    expect(await collectIntentDraft(ask)).toEqual({ kind: "cancelled" });
  });
});
