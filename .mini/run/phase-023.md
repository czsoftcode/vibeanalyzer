---
phase: 23
verdict: done
steps:
  - title: "Flagy --audit a --dev v args.ts"
    status: done
  - title: "Spuštění npm audit izolovaně (temp kopie + sanitace + timeout)"
    status: done
  - title: "Parser npm audit JSON -> nálezy (AuditResult)"
    status: done
  - title: "Render auditu v reportu (md + JSON)"
    status: done
  - title: "Napojení do CLI"
    status: done
  - title: "End-to-end + nezávislý self-review"
    status: done
---

# Phase 23 — report z auto session

## Co se udělalo
Pátý strojový pohled: audit závislostí přes `npm audit --json`. Nový `src/audit.ts`:
- **Runner** (`collectAuditOutput` + `runProcessForAudit` + `defaultNpmAuditRunner`): ověří
  `package.json` + lockfile, zkopíruje JE do **dočasného adresáře** a `npm audit` pustí TAM s vynuceným
  `--registry=npmjs.org` a sanitovaným prostředím (smaže `npm_config_*`/`*_proxy`). Cizí `.npmrc`/proxy se
  nikdy nepřečte (obrana proti hijacku, drží „čte, nespouští"). Temp dir se uklidí VŽDY (finally).
- **Parser** (`parseAuditJson`): z `auditReportVersion: 2` vyrobí `Finding[]` (`source:"audit"`,
  `file="package-lock.json"`, `rule`=GHSA, severity mapping critical/high→error, moderate→warning,
  low→info). Ošetřuje `via` string|objekt, `fixAvailable` bool|objekt|null, top-level `error` (síť),
  npm v6 (`advisories`) i nevalidní JSON → vždy `skipped` s konkrétním důvodem, ne pád.
- `FindingSource` += `"audit"`. `JsonIndex` nese `audit`, `INDEX_VERSION` 5→6. Report (md) má sekci
  „Strojové nálezy (závislosti)" + souhrnný řádek se třemi+ stavy.
- `args.ts`: flagy `--audit` (opt-in) a `--dev`. `cli.ts`: s `--audit` zavolá audit (předá `dev`), jinak
  `skipped "audit nevyžádán (--audit)"`; `--dev` bez `--audit` → pozn. na stderr. Defenzivní catch.

## Klíčová rozhodnutí (z diskuze, dodržena)
- Opt-in `--audit` → výchozí běh zůstává offline (neporušuje slib o strojové vrstvě bez sítě).
- `--audit` sám = jen prod (`--omit=dev`); `--audit --dev` = i dev.
- Izolace přes temp kopii lockfilu = obrana proti registry-hijacku z cizího `.npmrc`.

## Hlavní past (ověřeno)
`npm audit` vrací NENULOVÝ exit, když najde zranitelnosti. Runner to NEbere jako selhání – parsuje stdout
bez ohledu na exit kód. Testováno REÁLNÝM procesem (`node -e` se simulovaným exit 1 + stdout), ne jen
injektovaným outcome.

## Ověření (vše mnou, mechanicky)
- `npm run typecheck` čistý, `npm run build` projde, `npm test` = **39 souborů, 303 testů, zelené**
  (před fází 272). Nové testy: audit.run / audit.parse / cli.audit / report/markdown.audit + rozšířené args.
- Testy se zuby na obě strany: nález → report ho označí; čistý → „Žádné zranitelné závislosti"; skipy
  nesou konkrétní důvod. Bez sítě – runner i parser injektované, reálný `npm audit` se v testech nevolá.
- E2e přes `run()`: `--audit` s injektovaným nálezem → md i JSON ho mají; bez `--audit` → „přeskočeno
  (nevyžádán)" a audit se vůbec nezavolá; `--audit` bez lockfilu (reálný kód) → skip s důvodem, bez sítě.

## Nezávislý self-review (čerstvý sub-agent) a reakce
Našel **1 blocker** + chybějící test + 1 should-fix, VŠE opraveno:
1. **BLOCKER:** externí SIGKILL (OOM killer) se hlásil jako „timeout / pomalá síť" – lživý důvod skipu.
   Časový limit se teď pozná spolehlivě přes `err.killed === true`; externí signál dostal vlastní pravdivý
   důvod („ukončen signálem … možná docházela paměť").
2. Doplněn test, který tu díru hlídá (child se zabije sám SIGKILL → výsledek NESMÍ být timeout).
3. **should-fix:** přetečení `maxBuffer` (> 64 MB) dostalo explicitní větev s pravdivým důvodem místo
   matoucího „nevalidní JSON".
Sub-agent potvrdil jako OK: úklid temp dir při výjimce, sanitace env pro daný threat model, odolnost vůči
prototype pollution z JSON, smíšené `via`, defenzivní CLI catch, cross-module kontrakt.

## Vědomá omezení
- Jen npm lockfile (yarn/pnpm se přeskočí s důvodem). Jen `auditReportVersion: 2` (npm v7+); v6 → skip.
- Audit je síťový a odešle strom závislostí na oficiální npm registry – proto opt-in. Privátní registry se
  nezauditují (vynucujeme oficiální). To je vědomá cena za obranu proti hijacku.
- Windows: `execFile("npm")` a sémantika signálů se může lišit; projekt cílí Linux.
