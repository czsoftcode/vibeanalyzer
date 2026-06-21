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

  it("InternalServerError 529 (přetížení) → důvod o přetížení", () => {
    // SDK mapuje všechna 5xx na InternalServerError; status se kontroluje ručně.
    // Konstruktor chce hlavičky, proto instanci odvodíme a status dosadíme.
    const err = Object.create(Anthropic.InternalServerError.prototype) as Error;
    (err as { status?: number }).status = 529;
    expect(err).toBeInstanceOf(Anthropic.InternalServerError);
    expect(classifyAiError(err)).toBe("API přetížené, zkus později");
  });

  it("InternalServerError 503 (dočasně nedostupné) → důvod o nedostupnosti", () => {
    const err = Object.create(Anthropic.InternalServerError.prototype) as Error;
    (err as { status?: number }).status = 503;
    expect(classifyAiError(err)).toBe("API je dočasně nedostupné, zkus později");
  });

  it("InternalServerError 500 → null (NEpřematchovat všechna 5xx, jen retry-later stavy)", () => {
    const err = Object.create(Anthropic.InternalServerError.prototype) as Error;
    (err as { status?: number }).status = 500;
    expect(err).toBeInstanceOf(Anthropic.InternalServerError);
    expect(classifyAiError(err)).toBeNull();
  });

  it("utnutý stream: AnthropicError s message 'terminated' → síťová chyba", () => {
    // Replikuje SDK wrap (MessageStream.js): ne-Anthropic chyba se zabalí do base
    // AnthropicError s okopírovanou message a původním TypeError v cause.
    const err = new Anthropic.AnthropicError("terminated");
    (err as { cause?: unknown }).cause = new TypeError("terminated");
    expect(classifyAiError(err)).toBe("síťová chyba při dotazu na API");
  });

  it("utnutý stream přes cause: message jiná, cause 'terminated' → síťová chyba (fallback)", () => {
    const err = new Anthropic.AnthropicError("stream error");
    (err as { cause?: unknown }).cause = new TypeError("terminated");
    expect(classifyAiError(err)).toBe("síťová chyba při dotazu na API");
  });

  it("base AnthropicError bez 'terminated' (protokolová chyba) → null (probublá)", () => {
    // „stream ended without producing a Message" apod. CHCEME probublat se stackem.
    const err = new Anthropic.AnthropicError("stream ended without producing a Message");
    expect(classifyAiError(err)).toBeNull();
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
