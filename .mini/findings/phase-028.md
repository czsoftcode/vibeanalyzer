# Review findings

> Recorded by `mini findings add` (the adversarial and verify review steps).
> Each entry is `## <id> · <severity> · <status>`; do not hand-edit those header
> lines.

## 28-1 · should-know · open
**Where:** src/audit.ts:308
**Reviewed-at:** b9f438efcec50adea6848bece9dec5e809599497
**Source:** project
**Range:** 14-28
Audit findings natvrdo ukazují package-lock.json i při npm-shrinkwrap.json

vulnToFinding hardcode 'file: "package-lock.json"' bez ohledu na to, který lockfile byl skutečně nalezen a audítován. LOCKFILES (řádek 22) explicitně zahrnuje npm-shrinkwrap.json a findLockfile ho umí najít, ale parseAuditJson/vulnToFinding dostane jen stdout – jméno lockfilu se ztratí na hranici collectAuditOutput → parseAuditJson. Když projekt používá npm-shrinkwrap.json, report ukazuje nálezy na soubor package-lock.json, který v projektu neexistuje. Není testováno – žádný test nepoužívá npm-shrinkwrap.json (audit.run.test.ts a audit.parse.test.ts vždy create package-lock.json). Cross-module kontrakt: collectAuditOutput zná jméno lockfilu, parseAuditJson ne – chybí předání této informace.

## 28-2 · nit · open
**Where:** src/audit.ts:330-337
**Reviewed-at:** b9f438efcec50adea6848bece9dec5e809599497
**Source:** project
**Range:** 14-28
readCounts fallback dává rozporná čísla (total > 0, ale všechny závažnosti 0)

Když npm audit výstup postrádá metadata.vulnerabilities, readCounts vrátí total: findings.length, ale critical/high/moderate/low/info jsou všechny 0. Report pak vypíše 'npm audit našel N zranitelností (kritických 0, vysokých 0, středních 0, nízkých 0)' – součet kategorií (0) se nerovná total (N). Cesta je sice nepravděpodobná (v2 formát vždy má metadata), ale je dosažitelná: test audit.parse.test.ts:67-76 vytváří reporty bez metadata a volá parseAuditJson. Test ověřuje severity findingů, ale nezhodnotí counts – rozporná čísla nechytí.

## 28-3 · nit · open
**Where:** src/analyze/runIsolated.ts:103-105
**Reviewed-at:** b9f438efcec50adea6848bece9dec5e809599497
**Source:** project
**Range:** 14-28
runIsolated: neomezené hromadění stderr v rodiči

stderr += chunk.toString() akumuluje veškerý stderr z dítěte bez stropu. Pokud by dítě (tsc/ESLint nad patologickým vstupem) psalo masivní stderr (ne OOM, jen verbose výstup), paměť rodiče roste po celou dobu timeoutu (ANALYSIS_TIMEOUT_MS = 120 s). Izolace měla chránit rodiče před pádem, ale neomezený stderr je vedlejší kanál, kterým dítě rodiče udusí. V praxi tsc/ESLint píší minimalní stderr, takže riziko je teoretické. Knihovna by mohla strcat-limitovat (např. prvních 64 KiB) – stačí na detekci OOM signatury.
