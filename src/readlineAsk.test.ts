import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { createReadlineAsk } from "./readlineAsk.js";

/**
 * Glue na readline nad fake streamy (PassThrough) – bez reálného TTY. Hlídá to,
 * co se v terminálu těžko zkouší: rozlišení odpověď vs EOF, CRLF, a hlavně že
 * dotaz PO EOF vrátí null místo pádu.
 */
describe("createReadlineAsk – most na readline", () => {
  function setup() {
    const input = new PassThrough();
    const output = new PassThrough();
    output.resume(); // ať se prompty někam odečtou a stream se nezasekne
    return { input, output, ...createReadlineAsk(input, output) };
  }

  it("vrátí jeden řádek odpovědi (bez terminátoru)", async () => {
    const { input, ask, close } = setup();
    const p = ask("Otázka?");
    input.write("ano\n");
    expect(await p).toBe("ano");
    close();
  });

  it("strip CRLF (Windows konce řádků)", async () => {
    const { input, ask, close } = setup();
    const p = ask("Q");
    input.write("hodnota\r\n");
    expect(await p).toBe("hodnota");
    close();
  });

  it("prázdný řádek je '', NE null (odlišeno od EOF)", async () => {
    const { input, ask, close } = setup();
    const p = ask("Q");
    input.write("\n");
    expect(await p).toBe("");
    close();
  });

  it("EOF (konec vstupu) → null", async () => {
    const { input, ask } = setup();
    const p = ask("Q");
    input.end(); // žádná data, rovnou EOF
    expect(await p).toBeNull();
  });

  it("dotaz PO EOF znovu vrátí null, NEspadne (ERR_USE_AFTER_CLOSE ošetřen)", async () => {
    const { input, ask } = setup();
    const p1 = ask("Q1");
    input.end();
    expect(await p1).toBeNull();
    // druhý dotaz na zavřené rozhraní nesmí házet
    expect(await ask("Q2")).toBeNull();
    expect(await ask("Q3")).toBeNull();
  });

  it("víc odpovědí po sobě ve správném pořadí", async () => {
    const { input, ask, close } = setup();
    const p1 = ask("Q1");
    input.write("první\n");
    expect(await p1).toBe("první");
    const p2 = ask("Q2");
    input.write("druhý\n");
    expect(await p2).toBe("druhý");
    close();
  });

  it("close() bez jediného dotazu nehází (rozhraní nikdy nevzniklo)", () => {
    const { close } = setup();
    expect(() => close()).not.toThrow();
  });
});
