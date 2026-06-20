import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { AI_MODEL, AI_PING_TIMEOUT_MS, classifyAiError } from "./aiPing.js";

// Testuje REÁLNÉ chybové třídy SDK (ne mock) – instanceof větve v classifyAiError
// musí sednout na skutečné typy. Síť se nikdy nevolá; jen konstruujeme/odvozujeme
// instance chyb. AuthenticationError/RateLimitError mají ošklivý konstruktor
// (chce hlavičky s .get), proto je odvodíme přes Object.create na prototypu –
// instanceof prochází po prototypovém řetězci stejně.

describe("classifyAiError – zatřídění chyby z pingu", () => {
  it("APIConnectionTimeoutError → konkrétní důvod timeoutu", () => {
    const err = new Anthropic.APIConnectionTimeoutError({ message: "timed out" });
    expect(classifyAiError(err)).toBe("časový limit při dotazu na API vypršel");
  });

  it("APIConnectionError (síť) → konkrétní důvod sítě", () => {
    const err = new Anthropic.APIConnectionError({ message: "ECONNREFUSED" });
    expect(classifyAiError(err)).toBe("síťová chyba při dotazu na API");
  });

  it("timeout se NEzařadí jako obecná síť (pořadí instanceof: timeout dědí z connection)", () => {
    const err = new Anthropic.APIConnectionTimeoutError({ message: "to" });
    // kdyby byl test connection PŘED timeout, dostali bychom 'síťová chyba'
    expect(classifyAiError(err)).not.toBe("síťová chyba při dotazu na API");
  });

  it("AuthenticationError (401) → důvod o odmítnutém klíči", () => {
    const err = Object.create(Anthropic.AuthenticationError.prototype) as Error;
    expect(err).toBeInstanceOf(Anthropic.AuthenticationError);
    expect(classifyAiError(err)).toBe("API odmítlo klíč (neplatný ANTHROPIC_API_KEY)");
  });

  it("RateLimitError (429) → důvod o rate limitu", () => {
    const err = Object.create(Anthropic.RateLimitError.prototype) as Error;
    expect(err).toBeInstanceOf(Anthropic.RateLimitError);
    expect(classifyAiError(err)).toBe("API hlásí překročení limitu (rate limit)");
  });

  it("nečekaná chyba (TypeError) → null (NESMÍ se tvářit jako přeskočeno)", () => {
    expect(classifyAiError(new TypeError("boom"))).toBeNull();
  });

  it("obecná 400 BadRequestError (programová chyba v dotazu) → null (probublá)", () => {
    const err = Object.create(Anthropic.BadRequestError.prototype) as Error;
    expect(classifyAiError(err)).toBeNull();
  });

  it("konstanty pingu: levný model a timeout v ms", () => {
    expect(AI_MODEL).toBe("claude-haiku-4-5");
    expect(AI_PING_TIMEOUT_MS).toBe(10_000);
  });
});
