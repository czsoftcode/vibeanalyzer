# Review findings

> Recorded by `mini findings add` (the adversarial and verify review steps).
> Each entry is `## <id> · <severity> · <status>`; do not hand-edit those header
> lines.

## 28-1 · should-know · resolved
**Where:** src/audit.ts:308
**Reviewed-at:** b9f438efcec50adea6848bece9dec5e809599497
**Source:** project
**Range:** 14-28
Audit findings natvrdo ukazují package-lock.json i při npm-shrinkwrap.json

vulnToFinding hardcode 'file: "package-lock.json"' bez ohledu na to, který lockfile byl skutečně nalezen a audítován. LOCKFILES (řádek 22) explicitně zahrnuje npm-shrinkwrap.json a findLockfile ho umí najít, ale parseAuditJson/vulnToFinding dostane jen stdout – jméno lockfilu se ztratí na hranici collectAuditOutput → parseAuditJson. Když projekt používá npm-shrinkwrap.json, report ukazuje nálezy na soubor package-lock.json, který v projektu neexistuje. Není testováno – žádný test nepoužívá npm-shrinkwrap.json (audit.run.test.ts a audit.parse.test.ts vždy create package-lock.json). Cross-module kontrakt: collectAuditOutput zná jméno lockfilu, parseAuditJson ne – chybí předání této informace.

## 28-2 · nit · resolved
**Where:** src/audit.ts:330-337
**Reviewed-at:** b9f438efcec50adea6848bece9dec5e809599497
**Source:** project
**Range:** 14-28
readCounts fallback dává rozporná čísla (total > 0, ale všechny závažnosti 0)

Když npm audit výstup postrádá metadata.vulnerabilities, readCounts vrátí total: findings.length, ale critical/high/moderate/low/info jsou všechny 0. Report pak vypíše 'npm audit našel N zranitelností (kritických 0, vysokých 0, středních 0, nízkých 0)' – součet kategorií (0) se nerovná total (N). Cesta je sice nepravděpodobná (v2 formát vždy má metadata), ale je dosažitelná: test audit.parse.test.ts:67-76 vytváří reporty bez metadata a volá parseAuditJson. Test ověřuje severity findingů, ale nezhodnotí counts – rozporná čísla nechytí.

## 28-3 · nit · resolved
**Where:** src/analyze/runIsolated.ts:103-105
**Reviewed-at:** b9f438efcec50adea6848bece9dec5e809599497
**Source:** project
**Range:** 14-28
runIsolated: neomezené hromadění stderr v rodiči

stderr += chunk.toString() akumuluje veškerý stderr z dítěte bez stropu. Pokud by dítě (tsc/ESLint nad patologickým vstupem) psalo masivní stderr (ne OOM, jen verbose výstup), paměť rodiče roste po celou dobu timeoutu (ANALYSIS_TIMEOUT_MS = 120 s). Izolace měla chránit rodiče před pádem, ale neomezený stderr je vedlejší kanál, kterým dítě rodiče udusí. V praxi tsc/ESLint píší minimalní stderr, takže riziko je teoretické. Knihovna by mohla strcat-limitovat (např. prvních 64 KiB) – stačí na detekci OOM signatury.

## 28-4 · should-know · resolved
**Where:** src/analyze/tsc.test.ts:243,270
**Reviewed-at:** 68106b7a3573bc524161be4b88d281f59dd06d69
**Source:** adversarial
Fáze 28: symlinková obrana gate (realpath) nemá regresní test

containedCompilerHost spoléhá na isUnderRootRealSync (realpath) jako JEDINOU vrstvu, která zadrží import//// <reference path> přes symlink uvnitř root mířící VEN. Fáze 28 nepřidala pro tento vektor žádný test — oba nové testy (tsc.test.ts:243 a :270) používají jen LITERÁLNÍ '../' cesty, které chytí už isUnderRoot bez realpathu.

Ověřeno mutací: když se v allowed() (tsc.ts:226) isUnderRootRealSync→isUnderRoot (drop realpathu), VŠECH 18 testů zůstává zelených, ale symlinkovaný import VTÁHNE cizí obsah do reportu (marker SYMLINK_LEAK_MARKER_IMPORT se objeví v message + cizí soubor v file field). Repro nad dist potvrdilo leak obou vektorů (import i reference path).

Stávající symlink test (tsc.test.ts:185) kryje jen SEC-1 vektor 1 (tsconfig files) přes ASYNC isUnderRootReal (tsc.ts:72) — to je jiná kódová cesta než sync gate v containedCompilerHost.

PAST: report sám (N4) označuje realpathSync(root) při každém I/O jako výkonnostní nit a vědomě ho neoptimalizuje. Přirozená budoucí optimalizace (cachovat nebo odstranit realpath) tiše otevře leak bez toho, aby padl jediný test. Přidat regresní test: symlink uvnitř root mířící ven + import/reference na něj → assert marker v cizím souboru se neobjeví + pozitivní signál (TS2307/TS6053).

## 28-5 · nit · resolved
**Where:** src/analyze/tsc.ts:231
**Reviewed-at:** 68106b7a3573bc524161be4b88d281f59dd06d69
**Source:** adversarial
Fáze 28: readDirectory/getDirectories v containedCompilerHost nezadrženy (existence-oracle mimo root)

containedCompilerHost přepisuje jen getSourceFile/fileExists/readFile/directoryExists, ale NEreadDirectory/getDirectories (dědí z base = default host). tsc tak může enumerovat JMÉNA souborů/adresářů mimo root — OBSAH se nevtáhne (gate na čtení zadrží), ale existence/názvy ano (slabý existence-oracle). Stejný vzor už má containedParseHost (tsc.ts:192) a je to zdokumentované vědomé rozhodnutí v komentáři (tsc.ts:208-209).

Praktické riziko je nízké: createProgram běžně nevolá readDirectory/getDirectories s cestami mimo root (include/exclude expanduje už parseJsonConfigFileContent přes containedParseHost). Nevyžaduje změnu, jen hlídat, že to zůstává vědomé — pokud by někdy tsc začal enumerovat mimo root při modulové resoluci (např. paths/typeRoots), gate čtení obsah chrání, ale názvy proleznou.
