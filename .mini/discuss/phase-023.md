# Phase 23 — Strojová bezpečnost: audit závislostí

## Intent
Pátý strojový pohled: zranitelné závislosti. Spustit `npm audit --json` nad analyzovaným projektem,
převést výsledek na strojové nálezy (balík@verze, závažnost, CVE/advisory, dostupná oprava) a vykreslit
v reportu vedle tsc/ESLint/tajemství. Druhá (a poslední) polovina backlog [4].

Tahle vrstva je VĚDOMĚ network-optional a OPT-IN – nepustí se sama. Tím se neporušuje slib „strojová
vrstva běží offline": výchozí běh zůstává offline, audit je explicitní volba uživatele.

## Key decisions
- **Opt-in přes `--audit` (rozhodnuto uživatelem):** audit běží JEN s `--audit`. Bez něj se sekce
  vykreslí jako „přeskočeno (audit nevyžádán)". Nový boolean flag v `args.ts`.
- **Rozsah dev/prod (rozhodnuto uživatelem):** `--audit` sám = jen produkční (`npm audit --omit=dev`).
  `--audit --dev` = prod i dev (bez omit). `--dev` BEZ `--audit` je neúčinný – ideálně jemná pozn. na
  stderr, ne tichý no-op (drobná unhappy-path větev).
- **Registry/hijack obrana (rozhodnuto uživatelem): vždy oficiální npm, ignorovat projektový `.npmrc`.**
  Doporučená implementace: npm NEspouštět v cizí složce vůbec. Zkopírovat jen `package.json` +
  `package-lock.json` (resp. `npm-shrinkwrap.json`) do DOČASNÉHO adresáře a audit pustit tam s
  `--registry=https://registry.npmjs.org/` a sanitovaným prostředím (smazat `npm_config_*`,
  `NPM_CONFIG_*`, `*_proxy`; případně `--userconfig`/`--globalconfig` na prázdno). Tím se cizí `.npmrc`
  ani proxy nikdy nepřečtou. Bonus: drží slib „čte, nespouští" striktněji (npm se cizího stromu netkne).
  Trade-off: projekt s legitimním privátním registry se nezaudituje – přijato.
- **Spuštění procesu:** `execFile`/`spawn` s timeoutem (`ANALYSIS_TIMEOUT_MS` z limits.ts). `runIsolated`
  se NEpoužije – ten forkuje JS modul, tady spouštíme externí `npm`.
- **Kontrakt nálezu:** rozšířit `FindingSource` o `"audit"` (sdílený union ve findings.ts). Závislost
  nemá místo v souboru → `file` = `"package-lock.json"` (kde je deklarovaná), `line`/`column` chybí
  (jako globální tsc chyby). `rule` = CVE/GHSA id, `message` = balík@rozsah + název advisory + „oprava:
  ano/ne" (BEZ příkazu k auto-fixu – non-goal). Severity mapping: critical/high → `error`,
  moderate → `warning`, low → `info`.
- **Výsledkový union:** `AuditResult = {kind:"skipped"; reason} | {kind:"ran"; findings; counts}` jako
  TscResult/EslintResult/SecretsResult. „ran s 0 nálezy" (čisto) se NESMÍ splést se „skipped".

## Watch out for
- **NENULOVÝ EXIT KÓD = past:** `npm audit` vrací nenulový exit, KDYŽ NAJDE zranitelnosti. Nesmí se brát
  jako selhání! Vždy parsovat JSON ze stdout bez ohledu na exit kód. „Selhání/skip" = chybí/nevalidní
  JSON nebo npm vůbec nešel spustit, NE nenulový kód. (Hlavní zub fáze – test musí pokrýt obojí.)
- **Závislost na lockfilu:** `npm audit --json` potřebuje `package-lock.json`/`npm-shrinkwrap.json`. Bez
  něj → skip s jasným důvodem. yarn.lock/pnpm-lock v1 NEpodporujeme (npm je nečte) → skip s důvodem.
- **Rozlišit důvody skipu** (jinak tichý falešný „čisto"): audit nevyžádán / není lockfile / není síť /
  npm chybí / timeout / nevalidní výstup. Report i JSON to musí říct konkrétně.
- **Formát `npm audit --json` v2** (`auditReportVersion: 2`): `vulnerabilities` je objekt keyovaný jménem
  balíku; každý má `severity`, `via` (pole advisory objektů NEBO jen jména – ošetřit obojí), `range`,
  `fixAvailable` (bool NEBO objekt), `isDirect`. Starší npm (v6) má jiný tvar – detekovat přes
  `auditReportVersion` a starý/neznámý tvar řešit jako skip, ne pád.
- **Síť/timeout:** cizí pomalý nebo nedostupný registry nesmí zaseknout běh → tvrdý timeout + zabití
  procesu; po timeoutu skip, ne pád. Úklid dočasného adresáře i při timeoutu/chybě (žádný osiřelý stav).
- **Non-goal kontrola:** `npm audit` NEspouští kód projektu (nečte postinstall skripty) → non-goal č. 1
  respektován. `--audit` je CLI flag, ne config soubor → non-goal o configu respektován. Žádný auto-fix,
  jen hlášení → non-goal o auto-fixu respektován.
- **Šum:** i s `--omit=dev` může být u velkého projektu hodně tranzitivních nálezů. Pro v1 vypsat všechny,
  neřešit stránkování/limit (případně jen poznámka o počtu).
- **Test bez sítě v CI:** test nesmí reálně volat síť. Injektovat běh npm (deps.runAudit) a krmit ho
  fixními JSON výstupy (s nálezy / čistý / nevalidní / nenulový exit), plus reálný malý e2e jen když je
  to bezpečné. Reálný `npm audit` v testu = flaky a síťově závislé.
