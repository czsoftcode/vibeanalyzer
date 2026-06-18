import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { INTENT_HEADINGS, loadIntent } from "./intent.js";
import { renderProjectMd, writeIntentFile } from "./intentWriter.js";
import { projectKey } from "./projectPaths.js";

// writeFile mockujeme tak, že DEFAULTNĚ volá skutečnou implementaci (pass-through) –
// reálné testy (round-trip, exists) tedy běží na opravdovém FS. Jen test úklidu si
// jednorázově vynutí selhání zápisu přes mockRejectedValueOnce, ať se trefí do
// chybové větve s reálným mkdir/rm (cleanup je tak ověřen na skutečném kódu, ne na mocku).
vi.mock("node:fs/promises", async (orig) => {
  const actual = await orig<typeof import("node:fs/promises")>();
  return { ...actual, writeFile: vi.fn(actual.writeFile) };
});

describe("renderProjectMd – obsah pro parser", () => {
  it("vyrenderuje obě sekce s nadpisy z INTENT_HEADINGS", () => {
    const md = renderProjectMd({ building: "CLI nástroj.", nonGoals: ["Nespouštět kód."] });
    expect(md).toContain(`## ${INTENT_HEADINGS.building}`);
    expect(md).toContain(`## ${INTENT_HEADINGS.nonGoals}`);
    expect(md).toContain("CLI nástroj.");
    expect(md).toContain("- Nespouštět kód.");
  });
});

describe("writeIntentFile – bezpečný zápis do domova", () => {
  let proj: string;
  let home: string;

  beforeEach(async () => {
    proj = await mkdtemp(path.join(tmpdir(), "vibe-writer-proj-"));
    home = await mkdtemp(path.join(tmpdir(), "vibe-writer-home-"));
  });

  afterEach(async () => {
    vi.mocked(writeFile).mockClear();
    await rm(proj, { recursive: true, force: true }).catch(() => {});
    await rm(home, { recursive: true, force: true }).catch(() => {});
  });

  // Cestu počítáme přes REÁLnou projectKey – kdyby se rozešla s homeIntentPath,
  // round-trip i následující testy padnou (mají zuby).
  function storeFile(target: string): string {
    return path.join(home, ".vibeanalyzer", projectKey(target), "project.md");
  }

  it("round-trip: render → write → loadIntent vrátí stejný záměr (reálný parser)", async () => {
    const draft = {
      building: "Lokální CLI nástroj.\nDruhý řádek záměru.",
      nonGoals: ["Nespouštět kód.", "Nestavět web."],
    };
    const w = await writeIntentFile(proj, renderProjectMd(draft), { homeDir: home });
    expect(w.kind).toBe("written");
    if (w.kind === "written") {
      expect(w.path).toBe(storeFile(proj));
    }

    // KONTRAKT cesty + nadpisů: loadIntent musí přečíst přesně to, co writer zapsal.
    const r = await loadIntent(proj, { homeDir: home });
    expect(r.kind).toBe("loaded");
    if (r.kind === "loaded") {
      expect(r.intent.building).toBe(draft.building);
      expect(r.intent.nonGoals).toEqual(draft.nonGoals);
      expect(r.intent.sourcePath).toBe(storeFile(proj));
    }

    // READ-ONLY kontrakt: do analyzovaného projektu se NIC nezapsalo.
    const inProj = await readdir(proj);
    expect(inProj).toEqual([]);
  });

  it("existující soubor → exists, obsah se NEpřepíše", async () => {
    const file = storeFile(proj);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, "PŮVODNÍ ZÁMĚR – nesahat\n", "utf8");

    const w = await writeIntentFile(proj, renderProjectMd({ building: "nový", nonGoals: ["x"] }), {
      homeDir: home,
    });
    expect(w.kind).toBe("exists");
    // soubor zůstal beze změny
    expect(await readFile(file, "utf8")).toBe("PŮVODNÍ ZÁMĚR – nesahat\n");
  });

  it("neznámý domov (homeDir prázdný) → no-home, nic se nezapíše", async () => {
    const w = await writeIntentFile(proj, "cokoliv", { homeDir: "" });
    expect(w.kind).toBe("no-home");
    // domácí úložiště nevzniklo
    await expect(readdir(path.join(home, ".vibeanalyzer"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("nevytvořitelný adresář (v cestě je soubor místo složky) → unwritable", async () => {
    // <home>/.vibeanalyzer/<key> založíme jako SOUBOR → mkdir té cesty hodí
    // (EEXIST/ENOTDIR). Deterministické i pod rootem (žádné spoléhání na práva).
    const keyDir = path.join(home, ".vibeanalyzer", projectKey(proj));
    await mkdir(path.dirname(keyDir), { recursive: true });
    await writeFile(keyDir, "kolize", "utf8");

    const w = await writeIntentFile(proj, "cokoliv", { homeDir: home });
    expect(w.kind).toBe("unwritable");
    if (w.kind === "unwritable") {
      expect(w.path).toBe(storeFile(proj));
    }
  });

  it("selhání zápisu → po sobě nezůstane osiřelý adresář (úklid createdDir)", async () => {
    // jednorázově vynutíme selhání writeFile (ne EEXIST), až POTÉ co mkdir vytvoří strom
    vi.mocked(writeFile).mockRejectedValueOnce(
      Object.assign(new Error("vynucené selhání"), { code: "EACCES" }),
    );

    const w = await writeIntentFile(proj, "cokoliv", { homeDir: home });
    expect(w.kind).toBe("unwritable");
    if (w.kind === "unwritable") {
      expect(w.code).toBe("EACCES");
    }
    // createdDir = <home>/.vibeanalyzer byl vytvořen kvůli zápisu → po selhání zmizel.
    // (Kdyby se úklid odstranil, tahle složka by tu osiřele zůstala a test padne.)
    await expect(readdir(path.join(home, ".vibeanalyzer"))).rejects.toMatchObject({ code: "ENOENT" });
  });
});
