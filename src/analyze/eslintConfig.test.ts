import { describe, expect, it } from "vitest";
import { eslintConfig } from "./eslintConfig.js";

describe("eslintConfig", () => {
  it("je neprázdné flat-config pole", () => {
    expect(Array.isArray(eslintConfig)).toBe(true);
    expect(eslintConfig.length).toBeGreaterThan(0);
  });

  it("obsahuje kurátorovaná correctness pravidla (ne styl)", () => {
    const jsBlock = eslintConfig.find((c) => c.files?.some((f) => String(f).includes("*.js")));
    expect(jsBlock).toBeDefined();
    const rules = jsBlock?.rules ?? {};
    for (const r of ["eqeqeq", "no-empty", "no-debugger", "no-cond-assign", "no-unreachable", "no-fallthrough"]) {
      expect(rules[r]).toBeDefined();
    }
  });

  it("TS blok má parser a vypnuté no-unused-vars (false-positives)", () => {
    const tsBlock = eslintConfig.find((c) => c.files?.some((f) => String(f).includes("*.ts")));
    expect(tsBlock?.languageOptions?.parser).toBeDefined();
    expect(tsBlock?.rules?.["no-unused-vars"]).toBe("off");
  });

  it("JS blok má vypnuté no-unused-vars (false-positives na JSX)", () => {
    // JSX použití (importy komponent, React pragma) jádrové no-unused-vars nevidí
    // → na zdravém React kódu falešné nálezy. Proto vypnuto i na JS, ne jen TS.
    const jsBlock = eslintConfig.find((c) => c.files?.some((f) => String(f).includes("*.js")));
    expect(jsBlock?.rules?.["no-unused-vars"]).toBe("off");
  });

  it("JS blok má zapnuté JSX parsování (ecmaFeatures.jsx)", () => {
    // bez něj espree padá na .jsx/.js s JSX fatal "Parsing error" (nález 13-1)
    const jsBlock = eslintConfig.find((c) => c.files?.some((f) => String(f).includes("*.js")));
    expect(jsBlock?.languageOptions?.parserOptions?.ecmaFeatures?.jsx).toBe(true);
  });
});
