---
phase: 32
verdict: done
steps:
  - title: "Detekce hoisted node_modules + injektovatelný probe"
    status: done
  - title: "Nové pole hoistedNodeModules v TscResult a jeho naplnění"
    status: done
  - title: "Render trojstavu v markdown.ts"
    status: done
  - title: "Test detekce (tsc.ts) přes injektovaný probe"
    status: done
  - title: "Test renderu (markdown.ts) trojstavu"
    status: done
  - title: "Self-kontrola unhappy path + build + testy"
    status: done
---

# Fáze 32 — report z auto session

## Co se udělalo

Cíl: nad monorepem s hoisted node_modules (závislosti o úroveň/víc výš) fail-closed
contained host (fáze 28) zaplaví report falešnými TS2307. Report teď tuhle situaci
přiznává poznámkou.

**Detekce (`src/analyze/tsc.ts`):**
- Nový injektovatelný dep `hasNodeModulesDir?(dir)` v `TscAnalyzeDeps` (default reálný
  stat; sdílený pro kontrolu kořene i walk přes předky). Původní privátní
  `hasNodeModules(root)` přejmenován na `hasNodeModulesDir(dir)`.
- Nová `ancestorHasNodeModules(root, probe)`: jde od `path.dirname(resolve(root))`
  nahoru až k FS root (`dirname(p) === p`), vrátí true u prvního nalezeného. Bez
  realpathu (není to bezpečnostní hranice). Walk se spustí JEN když kořen node_modules
  nemá (short-circuit).

**Pole (`src/findings.ts`):** `hoistedNodeModules: boolean` do varianty `kind:"ran"`
(povinné). Naplněno v `analyzeTypeScript`.

**Render (`src/report/markdown.ts`):** nová `HOISTED_NOTE` + konstanta
`TS_CANNOT_FIND_MODULE = "TS2307"`. `tscSection` volí PRÁVĚ JEDNU větev trojstavu
(vzájemně výlučné `if/else if`):
- kořen má node_modules → žádná poznámka
- kořen nemá + hoisted + mezi nálezy je TS2307 → HOISTED_NOTE
- kořen nemá + ne-hoisted → stávající NODE_MODULES_NOTE (beze změny)
- kořen nemá + hoisted + bez TS2307 → žádná poznámka (záměr: nic nepadlo)

**JSON index (`src/report/jsonIndex.ts`):** `jsonIndex` propouští celý `tsc` výsledek
1:1, takže nové povinné pole mění tvar JSON u každého projektu → `INDEX_VERSION` bumpnut
9 → 10 (precedent: stejně se bumplo u secrets.skipped). Doc-komentář doplněn.

## Ověření

- `npm run typecheck` i `npm run build`: čisté (exit 0).
- `npm test`: 381 testů prošlo (45 souborů). Nové testy: 4 detekční v `tsc.test.ts`
  (hoisted true/false, short-circuit když kořen má nm, dojezd k FS root + zastávka),
  3 render v `markdown.tsc.test.ts` (hoisted+TS2307 → hoisted poznámka a NE stará,
  hoisted bez TS2307 → žádná, pnpm-like → žádná).
- Self-kontrola checklistu: exit kódy nedotčeny (čistá detekce + render), catch obaluje
  jen I/O stat (vrací false), walk neterminovatelně nezacyklí (`parent===dir`), všechny
  čtyři kombinace trojstavu dosažitelné.
- **Nezávislý sub-agent** (čerstvý kontext) proběhl jako adversarial self-review
  (kontrakt mezi moduly). Žádný blocker; logika trojstavu i terminace walku potvrzeny.

## Známá rezidua (vědomě nedořešeno, nejsou to bugy této fáze)

1. **Testy se typově nehlídají** – `tsconfig.json` má `exclude: ["**/*.test.ts"]` a
   vitest běží přes esbuild (transpile-only). Celoprojektová mezera, ne zavedená touto
   fází: znamená, že chybějící povinné pole v test-literálech (kde se stejně nečte)
   neprojde jako typová chyba. Kandidát na budoucí todo (`vitest typecheck` /
   `tsconfig.test.json`).
2. **Literál "TS2307" není svázán JEDNÍM testem přes obě strany.** `tsc.ts` staví rule
   jako `TS${d.code}`, `markdown.ts` má konstantu `TS_CANNOT_FIND_MODULE="TS2307"`.
   Každá strana je ukotvena zvlášť (reálný tsc test v `tsc.test.ts` pinuje `"TS2307"`
   z reálného běhu; render test pinuje konstantu), ale není test, který by spojil
   render přímo na reálný výstup tsc. TS2307 je stabilní TS API, takže riziko driftu
   je nízké – přijato.
3. **pnpm monorepo** (lokální symlinkovaný node_modules v balíčku) heuristika
   nerozpozná ("kořen nemá node_modules" tam nesedne). Vědomá mez V1, přiznaná i přímo
   v textu HOISTED_NOTE.

## Pozn. k rozhodnutí

Žádné netriviální zavržené alternativy → ADR (`/mini:decision`) netřeba. Jediné
hraniční rozhodnutí (bump INDEX_VERSION) je přímý důsledek nového povinného pole a je
zdůvodněno v kódu i tady.
