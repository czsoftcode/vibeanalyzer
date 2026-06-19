import { describe, expect, it } from "vitest";
import { isMinifiedName } from "./minified.js";

describe("isMinifiedName", () => {
  it("pozitiva: *.min.<ext>", () => {
    expect(isMinifiedName("app.min.js")).toBe(true);
    expect(isMinifiedName("style.min.css")).toBe(true);
    expect(isMinifiedName("jquery.min.js")).toBe(true);
    expect(isMinifiedName("App.MIN.JS")).toBe(true); // case-insensitive
    expect(isMinifiedName("vendor.min.mjs")).toBe(true);
  });

  it("negativa: běžné zdrojáky", () => {
    expect(isMinifiedName("app.js")).toBe(false);
    expect(isMinifiedName("admin.js")).toBe(false); // 'min' uvnitř slova, ne segment
    expect(isMinifiedName("min.js")).toBe(false); // 'min' bez vedoucí přípony
    expect(isMinifiedName("app.minify.js")).toBe(false); // 'minify', ne 'min'
    expect(isMinifiedName("foo.min")).toBe(false); // chybí přípona za 'min'
    expect(isMinifiedName("foo.min.")).toBe(false); // prázdná přípona za 'min'
  });
});
