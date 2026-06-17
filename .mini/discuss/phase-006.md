# Phase 6 — Respektovat kořenový .gitignore

## Intent
Dnešní scanTree přeskakuje jen pevný DEFAULT_SKIP_DIRS (node_modules, .git, .mini,
dist, build). U Symfony to nestačí — vendor/, var/cache/, var/log/ se nasají do
indexu a zbytečně žerou limit i náklady AI vrstvy. Fáze přidá: přečíst KOŘENOVÝ
.gitignore a navíc vynechat, co Git ignoruje. DEFAULT_SKIP_DIRS zůstává jako
záchranná síť (funguje i bez .gitignore). Vnořené .gitignore v podadresářích jsou
MIMO rozsah (pozdější fáze).

## Key decisions
- **Porovnávání vzorů: knihovna `ignore`** (rozhodnuto uživatelem). Dostaneme plnou
  shodu s Gitem zdarma (negace `!`, `**`, kotvení `/`). Cena: je to PRVNÍ runtime
  závislost projektu (package.json měl dosud jen devDependencies) — přidat do
  "dependencies", ne "devDependencies". `ignore` je čisté JS bez dalších
  tranzitivních závislostí.
- **Prázdný výsledek po filtraci: varovat na stderr** (rozhodnuto uživatelem).
  Když .gitignore odfiltruje úplně vše (např. vzor `*`), report se vyrobí, ale na
  stderr upozorníme, že index je prázdný kvůli .gitignore. Brání tichému
  "prázdný report = exit 0".
- **Architektura (návrh, potvrď v plan):** .gitignore NEčíst uvnitř scanTree.
  Samostatná funkce `loadGitignore(root)` → vrátí matcher / predikát nebo `null`
  (soubor není / prázdný). Do scanTree předat přes ScanOptions jako predikát
  `isIgnored(relPath, isDir)`. Důvod: scan zůstane čistý a testovatelný bez
  zakládání souborů na disku; I/O kolem .gitignore na jednom místě.
- **Detekce "vše odfiltrováno":** ScanResult rozšířit o počet položek vynechaných
  kvůli gitignore (např. `ignoredByGitignore: number`). cli.ts varuje jen když
  `files.length === 0 && ignoredByGitignore > 0` — jinak by se varování spustilo i
  u opravdu prázdné, ale čitelné složky.

## Watch out for
- **Prořezávání podstromu je vůči Gitu bezpečné:** ignorovaný adresář (vendor/)
  vůbec neprocházet. Git platí pravidlo "ignorovaná rodičovská složka → soubor
  uvnitř už nejde znovu zahrnout", takže `!vendor/x` Git stejně neuvidí.
  Prořezávání u kořene stromu je nutné kvůli výkonu (desetitisíce souborů ve vendor).
- **Kontrakt scan ↔ matcher:** `ignore` matchuje RELATIVNÍ POSIX cesty BEZ vodícího
  "/". scanTree už staví `rel` s "/" oddělovačem → sedí. Knihovna `ignore` HÁŽE na
  absolutní cesty i na cestu "." → kořen (rel="") do matcheru NIKDY neposílat.
  Adresářové vzory (vendor/): ověřit, jak knihovnu zeptat na adresář (pravděpodobně
  předat rel s koncovým "/" pro dir, nebo dle semantiky lib) — pokrýt TESTEM proti
  reálné `ignore`, ne mockem (kontrakt mezi naším kódem a knihovnou).
- **Nečitelný .gitignore:** cíl fáze říká "tiše nemění", ale projekt netoleruje
  tichou degradaci. Navržený kompromis: chybějící soubor = úplné ticho (identický
  výstup jako dnes); NEČITELNÝ soubor = jednořádkové upozornění na stderr (stejný
  vzor jako nečitelný záměr v cli.ts). Rozhodnout v plan.
- **Read-only kontrakt:** .gitignore se jen čte, nikdy nepíše — non-goal č. 1
  zachován.
- **Unhappy path k pokrytí testem:** žádný .gitignore (výstup BIT-identický jako
  dnes), prázdný .gitignore, nečitelný/poškozený, vzor mažoucí celý kořen (`*`),
  ignorovaný adresář se neprochází (ne jen vynechá z indexu).
- **Vztah ke skippedUnreadable:** gitignorované položky NEPATŘÍ do skippedUnreadable
  (jiná sémantika — "přeskočeno záměrně" vs "nešlo přečíst").
