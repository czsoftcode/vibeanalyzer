import { describe, expect, it } from "vitest";
import { loadTypescript } from "./loadTypescript.js";

describe("loadTypescript", () => {
  it("vrátí PŘIBALENÝ TypeScript s verzí a funkčním createProgram", async () => {
    const { ts, version } = await loadTypescript();
    expect(typeof ts.createProgram).toBe("function");
    // verze přibaleného TS (sémver), ne projektová
    expect(version).toMatch(/^\d+\.\d+\.\d+/);
    expect(version).toBe(ts.version);
  });

  it("nebere žádný argument (nemá kam sáhnout na projektový node_modules)", () => {
    // signatura = záruka kontraktu: bez root loadTypescript nemůže načíst cizí TS
    expect(loadTypescript.length).toBe(0);
  });
});
