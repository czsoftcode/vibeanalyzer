import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { projectKey } from "./projectPaths.js";

describe("projectKey – stabilní klíč adresáře", () => {
  it("je idempotentní: stejná cesta → stejný klíč", () => {
    expect(projectKey("/a/b/app")).toBe(projectKey("/a/b/app"));
  });

  it("normalizuje relativní cestu na absolutní (resolve)", () => {
    // klíč relativní cesty se musí shodovat s klíčem její resolved podoby
    expect(projectKey("some/rel/app")).toBe(projectKey(path.resolve("some/rel/app")));
  });

  it("kolize basename: dvě různé cesty se stejným jménem → různý klíč", () => {
    expect(projectKey("/x/app")).not.toBe(projectKey("/y/app"));
  });

  it("tvar klíče: basename v prefixu, hex hash za pomlčkou", () => {
    expect(projectKey("/x/app")).toMatch(/^app-[0-9a-f]{8}$/);
  });

  it("kořen / (prázdný basename) → prefix 'root', ne holá pomlčka", () => {
    expect(projectKey("/")).toMatch(/^root-[0-9a-f]{8}$/);
  });

  it("hash je SHA-256: ukotvená hodnota pro známou cestu (regrese na SHA-1 padne)", () => {
    // SHA-256 z "/x/app" → prvních 8 hex. Zuby: kdyby se algoritmus vrátil na
    // SHA-1 (add3d798) nebo se jinak změnil, tento test padne. Tvar-regex výš to
    // nechytí, protože ten projde pro libovolný 8-hex hash.
    expect(projectKey("/x/app")).toBe("app-b19d3b3a");
  });
});
