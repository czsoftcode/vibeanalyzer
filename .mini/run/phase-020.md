---
phase: 20
verdict: done
steps:
  - title: "Záměna sha1 → sha256 v projectKey"
    status: done
  - title: "Aktualizace komentáře u řádku 13"
    status: done
  - title: "Ověřit zelené testy včetně round-tripu"
    status: done
  - title: "Test se zuby: žádný weak-algo literál"
    status: done
  - title: "ADR (phase-020.md) – quality, ne security"
    status: skipped
---

# Phase 20 — report z auto session

## Co se udělalo

- **`src/projectPaths.ts:27`** — `createHash("sha1")` → `createHash("sha256")`, `.slice(0, 8)` ponecháno. Tvar klíče `basename-<8 hex>` je beze změny.
- **Doc-komentář** u `projectKey` (řádek 13) opraven z „hash je SHA-1" na „hash je SHA-256", aby komentář nelhal o použitém algoritmu.
- **Test se zuby** (`src/projectPaths.test.ts`): nový test ukotvuje přesnou hodnotu `projectKey("/x/app") === "app-b19d3b3a"` (prvních 8 hex ze SHA-256). Pro kontrast: SHA-1 dává `add3d798`. Kdyby se algoritmus vrátil na SHA-1 nebo se jinak změnil, test padne. Tvar-regex (`/^app-[0-9a-f]{8}$/`) tohle nechytí, protože projde pro libovolný 8-hex hash.

## Ověření (mechanické, prověřeno mnou)

- `npm run build` — 0 chyb.
- `npm run typecheck` — 0 chyb.
- `npm run test` — **241/241 zelených** (předtím 240 + můj nový test). Mezi nimi prošel round-trip home úložiště (`intentWriter` ↔ `intent` přes `homeIntentPath`/`projectKey`), takže záměna algoritmu nerozbila kontrakt zápis↔čtení.

## Krok 5 (ADR) — záměrně přeskočen, předán na /mini:decision

Do-prompt fáze `do` výslovně říká ADR nepsat sám a soubor v `.mini/decisions/` netvořit ručně (riziko špatného formátu). Reálný crossroads tu ale je, takže obsah rozhodnutí sem zapisuji a krok je k zaznamenání přes **`/mini:decision`**:

- **Rozhodnutí:** SHA-1 nahrazeno SHA-256.
- **Proč:** Jde o **code-quality fix**, který umlčuje semgrep nález „weak cryptographic algorithm", **ne o bezpečnostní opravu**. Hash tu slouží jen k odvození krátkého deterministického klíče adresáře z vlastní lokální cesty, ne k ochraně dat ani integritě proti útočníkovi — reálné riziko kolize útočníkem neexistuje.
- **Zamítnutá alternativa:** nechat SHA-1 a přidat `// nosemgrep` anotaci. Zamítnuto, protože schovává weak-algo literál do anotace, kterou musí každý reviewer pochopit; čistší je literál slabého algoritmu prostě nemít.
- **Trade-off (co se „rozbije"):** změna hashe **změní klíč** projektu. Projekty dříve analyzované dostanou pod `~/.vibeanalyzer/` **nový** klíč → dříve uložené reporty/záměry zůstanou jako **osiřelé** pod starým (SHA-1) klíčem. Round-trip zápis↔čtení se nerozbije (writer i loader sdílí stejný `projectKey`), ale „historie" se z pohledu nástroje ztratí. U V1 bez nasazení je to přijatelné.

## Doporučený další krok

1. `/mini:decision` — zaznamenat výše uvedené rozhodnutí (kvůli zamítnuté alternativě a trade-offu).
2. Pak `/mini:done`.
