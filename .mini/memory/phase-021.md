# Phase 21 — Upgrade vitest na 4.1.9 (CVE-2026-47429)

**Goal:** Zvednout vitest z 2.1.9 na ^4.1.9, opravit případné breaking changes v testech a ověřit, že celá testovací sada zůstane zelená a kritický supply-chain nález (path traversal ve Vitest UI serveru) zmizí.

## Steps
- [done] Zvednout vitest na ^4.1.9 a přegenerovat lock
- [done] Spustit testy a zachytit breaking changes
- [skipped] Opravit breakage v testech (jen pokud nějaký je)
- [done] Ověřit zmizení kritického nálezu
- [done] Self-review unhappy path + zápis do reportu

## Auto-commit
- Phase 21: Upgrade vitest na 4.1.9 (CVE-2026-47429)

## Run report
---
phase: 21
verdict: done
steps:
  - title: "Zvednout vitest na ^4.1.9 a přegenerovat lock"
    status: done
  - title: "Spustit testy a zachytit breaking changes"
    status: done
  - title: "Opravit breakage v testech (jen pokud nějaký je)"
    status: skipped
  - title: "Ověřit zmizení kritického nálezu"
    status: done
  - title: "Self-review unhappy path + zápis do reportu"
    status: done
---

# Phase 21 — report z auto session

## Co se udělalo
- `package.json`: `vitest` zvednut z `^2.1.0` na `^4.1.9`, `npm install` přegeneroval `package-lock.json`.
- Reálně rozřešená verze: `vitest@4.1.9`, všechny pod-balíčky `@vitest/*` (expect, mocker, pretty-format, runner, snapshot, spy, utils) také na `4.1.9`.
- Žádný zdrojový kód se neměnil — změna se týká jen dev toolchainu (test runner).

## Major skok 2 → 4 — co bylo riziko a jak dopadl
- Šlo o **major** přeskok (2.x → 4.x), protože `2.1.9` je poslední verze řady 2 a žádný 2.x patch pro CVE-2026-47429 neexistuje. Patch v rámci `^2.1.0` nebyl možný.
- Předem ověřeno přes context7, že API, které testy používají (`vi.spyOn`, `vi.restoreAllMocks` v `afterEach`, `vi.mock`, `vi.importActual`, `vi.fn`, `vi.mocked`, `expect.stringContaining`), má ve vitest 4 stabilní sémantiku.
- Projekt **nemá vitest/vite config** ani workspace → odpadlo nejčastější ohnisko breaking changes (změny defaultů configu, `workspace` → `projects`).
- **Výsledek: žádný breakage.** `npm test` (`vitest run`) = **31 test files, 241 testů, vše passed, 0 skipped**. Proto je krok "Opravit breakage v testech" označen jako `skipped` (N/A — nebylo co opravovat).

## Ověření zmizení nálezu (machine-verifiable, ověřeno mnou)
- `grep '"version": "2.1.9"'` v `package-lock.json` → nic.
- `grep 'vitest/-/vitest-2\.'` → žádná tarball reference na vitest 2.x.
- `npm audit` → **found 0 vulnerabilities**.
- CVE-2026-47429 se váže výhradně na řadu 2.x (path traversal ve Vitest UI serveru); na 4.1.9 neplatí. Navíc `@vitest/ui` v projektu ani není nainstalovaný, takže zranitelná cesta byla nedosažitelná už před upgradem — upgrade nález uzavírá i formálně, aby ho Semgrep přestal hlásit na `main`.

## Self-review unhappy path
- Změnila se jen verze test runneru, žádný zdrojový kód → žádné nové dosažitelné větve, žádné změněné exit kódy, žádné nové kontrakty mezi moduly.
- Chybové/unhappy-path testy (`cli.scanfail`, `cli.writefail`, `cli.isolation`, `cli.tsc`, `cli.eslint`, `args` …) všechny proběhly a prošly — upgrade tedy tiše nezahodil pokrytí chybových cest. 0 skipped/todo v běhu = sada neztratila zuby.
- Nezávislého sub-agenta na self-review jsem **nepouštěl**: tato fáze nesahá na chybové cesty ani kontrakty v kódu (je to pure dependency bump), takže není návrhová plocha, kterou by red-team chytil navíc.

## Pozn. k publikaci
Beze změny: publikuje se jen `dist/` (`files` v package.json), vitest se k uživateli nikdy nedostával — riziko bylo i tak dev-only.
