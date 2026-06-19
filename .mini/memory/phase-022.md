# Phase 22 — Strojová bezpečnost: hledání tajemství

**Goal:** Nový skener projde čtené soubory projektu (respektuje hotový .gitignore), konzervativním regexem najde pravděpodobná tajemství (API klíče, privátní klíče, tokeny) a vyrobí strojové nálezy s odkazem na soubor:řádek – do reportu jen místo a typ, nikdy samotnou hodnotu; přeskakuje binární/minifikované/obří soubory. Ověření: podvržený falešný klíč se v reportu objeví, čistý projekt nehlásí nic.

## Steps
- [done] Vzory, kontrakt a detektor tajemství
- [done] Skener nad soubory: skip balastu, cílený .env, ran/skipped
- [done] Render tajemství v reportu (md + JSON) bez úniku hodnoty
- [done] Napojení skeneru do CLI
- [done] End-to-end ověření + nezávislý self-review

## Auto-commit
- Phase 22: Strojová bezpečnost: hledání tajemství

## Discussion
# Phase 22 — Strojová bezpečnost: hledání tajemství

## Intent
Přidat čtvrtý druh strojové analýzy: skener tajemství (API klíče, privátní klíče, tokeny, hesla).
Projde OBSAH souborů projektu a každý nález ukáže na `soubor:řádek` jako stávající tsc/eslint nálezy.
Je to první polovina backlog [4] (Strojová bezpečnost); audit závislostí je vědomě odložen do samostatné
příští fáze (napětí s „strojová vrstva běží offline" – `npm audit` chce síť). Položka [4] zůstává otevřená.

Čtení obsahu NEporušuje non-goal „čte, nespouští" – ten zakazuje jen spouštění kódu, ne čtení.

## Key decisions
- **Co skenovat (rozhodnuto uživatelem):** respektovat `.gitignore` jako dosud, ALE navíc cíleně nahlédnout
  do typických míst pro tajemství (`.env`, `.env.*`, `*.pem`, `id_rsa`/`id_*`) i když jsou v `.gitignore`.
  Důvod: `.env` je #1 místo pro klíče a skoro vždy je gitignorovaný – striktní respekt by minul hlavní cíl.
- **Šíře hledání (rozhodnuto uživatelem):** jen JISTÁ tajemství – známé tvary (PEM blok
  `-----BEGIN ... PRIVATE KEY-----`, AWS `AKIA…`, GitHub `ghp_`/`gho_`…, Google `AIza…`, Slack `xox[bap]-`…).
  Bez obecné entropické detekce (příliš falešných poplachů) – konzervativně, radši míň ale důvěryhodných.
- **Zobrazení v reportu (rozhodnuto uživatelem):** typ + místo + MASKOVANÝ náznak.
  Maska = jen veřejný prefix vzoru (`AKIA…`) + délka, NIKDY náhodné tělo klíče. Report je commitovaný `.md`,
  nesmí sám unést tajemství dál.
- **Závažnost:** privátní klíč / cloud credential = `error`; obecný token = `warning`.
- **Kontrakt nálezu:** rozšířit `FindingSource` v `src/findings.ts` o `"secret"` (sdílený union – nový druh
  se musí přidat tady, ne lokálně, jinak se report/JSON rozejdou). `rule` = identifikátor vzoru (např.
  `aws-access-key-id`). `message` = lidský popis BEZ hodnoty.
- **Skipování balastu (výchozí, neblokující):** binárka = NUL bajt v prvním kusu → skip; velký soubor podle
  `FileEntry.size` (~1 MiB práh) → skip; minifikát podle extrémně dlouhých řádků / `.min.*` → skip (plný filtr
  minifikátů je backlog [15], sem jen minimum).

## Watch out for
- **Únik hodnoty do reportu** = nová bezpečnostní díra. Test musí ověřit, že se v `.md`/JSON NIKDY neobjeví
  celá hodnota podvrženého klíče (jen prefix+délka). Toto je hlavní zub fáze.
- **Reuse, ne re-walk:** skener má konzumovat `ScanResult.files` (už respektuje `.gitignore`, skip dirs,
  output artefakty, symlinky), ne procházet strom znovu. Cílený dohled nad `.env`/PEM je SAMOSTATNÝ malý
  průchod nad fixním seznamem jmen u kořene (a mělce), protože `scanTree` ignorované složky prořezává.
- **Omezení cíleného dohledu:** `.env` zahrabané v `.gitignore`-prořezaném `vendor/` se NENAJDE (do složky se
  nevstoupí). Pro v1 OK – report to musí přiznat (jinak tichý falešný „čisto").
- **Rozlišení ran vs skipped:** stejně jako TscResult/EslintResult – „proběhlo, 0 tajemství" se NESMÍ splést
  s „skener neproběhl". Vlastní výsledkový union (`{kind:"ran"|"skipped"}`).
- **Nečitelný soubor:** přeskočit a zaznamenat (jako `skippedUnreadable` ve scan), ne spadnout a ne tiše
  zahodit. Programovou chybu (TypeError) nemaskovat jako I/O.
- **Falešné poplachy v testech:** test musí mít zuby na OBĚ strany – podvržený klíč → nález; čistý projekt
  (vč. běžných base64/hashů, které NEjsou klíče) → ŽÁDNÝ nález. Jinak testujeme jen happy path.
- **Více vzorů na jednom řádku / multiline PEM:** PEM se pozná podle BEGIN řádku (stačí ohlásit ten řádek),
  ostatní vzory po řádcích.

## Run report
---
phase: 22
verdict: done
steps:
  - title: "Vzory, kontrakt a detektor tajemství"
    status: done
  - title: "Skener nad soubory: skip balastu, cílený .env, ran/skipped"
    status: done
  - title: "Render tajemství v reportu (md + JSON) bez úniku hodnoty"
    status: done
  - title: "Napojení skeneru do CLI"
    status: done
  - title: "End-to-end ověření + nezávislý self-review"
    status: done
---

# Phase 22 — report z auto session

## Co se udělalo
Přidán čtvrtý druh strojové analýzy: hledání tajemství. Nový `src/secrets.ts`:
- **Detektor** `detectSecrets(text)` – čistá funkce, katalog 6 konzervativních vzorů (PEM privátní
  klíč, AWS `AKIA/ASIA`, GitHub `gh[posru]_`, Google `AIza`, Slack segmentovaný tvar, Stripe `sk_live_`).
  Regexy bez `/g`. Vrací `{rule, label, severity, line, masked}`.
- **Skener** `scanSecrets(root, files)` – konzumuje `FileEntry[]` ze scanTree (reuse, ne re-walk),
  čte obsah, přeskakuje binárky (NUL bajt), velké (>1 MiB), minifikáty (`.min.*` / řádek >5000).
  Cílený probe nad kořenem najde `.env`/`*.pem`/`id_*` i mimo `.gitignore`. Union `ran|skipped`.
- `FindingSource` rozšířen o `"secret"` (findings.ts). `JsonIndex` nese `secrets`, `INDEX_VERSION` 4→5.
- Report (`buildMarkdown` + `buildJsonIndex`) má sekci tajemství se třemi stavy (ran-nálezy /
  ran-čisto / skipped) a souhrnný řádek. Renderuje jen maskovaný náznak.
- `cli.ts` volá skener INLINE (read-only, bez izolovaného workeru), v try/catch jako tsc/ESLint.

## Hlavní bezpečnostní invariant (ověřeno)
Celá hodnota tajemství se NIKDY nedostane do `.md` ani `.json` – maska ukazuje jen veřejný prefix
(`AKIA…`) + délku. Ověřeno na úrovni detektoru, renderu i **end-to-end** (reálný běh CLI nad fixturou
s gitignorovaným `.env`, čtený vygenerovaný `.md`+`.json`, assert že plná hodnota tam není).

## Ověření (vše mechanicky, mnou)
- `npm run typecheck` čistý, `npm run build` projde, `npm test` = **35 souborů, 272 testů, vše zelené**
  (před fází 268). Nové testy: secrets.test.ts, secrets.scan.test.ts, report/markdown.secrets.test.ts,
  cli.secrets.test.ts.
- E2e: gitignorovaný `.env` s falešným AWS klíčem → report ho označí (přes cílený probe); čistý projekt
  (uuid/base64/hash) → `_Žádná tajemství nenalezena._`, `kind:"ran"`, prázdné findings.
- Unhappy path: binárka/velký/minifikát/dlouhý řádek/nečitelný soubor → přeskočeno, ne pád; `fileCount`
  počítá jen reálně prohledané soubory.

## Nezávislý self-review (čerstvý sub-agent) a reakce
Hlavní bezpečnostní invariant potvrzen jako správný. Dva should-fix nálezy, OBA opraveny:
1. **Slack regex byl moc volný** (chytal placeholdery `xoxb-your-token-here`) → zpřísněn na segmentovaný
   tvar `xox?-čísla-čísla-tělo`. Šlo proti cíli konzervativnosti.
2. **Clean-text test neměl zuby na placeholdery** → přidán test, že dokumentační placeholdery
   (`ghp_xxx`, `sk_live_REPLACE_ME`, `xoxb-your-token-here`…) dají `[]`.
Navíc přidán zub na masku (odhalený prefix ≤ 8 znaků) jako pojistka proti budoucí chybě v `prefixLen`.

## Vědomá omezení (přiznáno i v reportu nástroje)
- Cílený probe `.env` běží jen u KOŘENE; `.env` zahrabané v `.gitignore`-prořezané podsložce se nenajde.
  Markdown sekce na to upozorňuje blockquote varováním.
- Detektor je záměrně konzervativní – neznámé tvary klíčů a obecnou entropii NEhledá (rozhodnuto
  v diskuzi: radši míň, ale důvěryhodných nálezů). Možné false-negatives jsou očekávané.
- `MAX_FILE_SIZE` 1 MiB a práh dlouhého řádku 5000 jsou odhady; mohou minout tajemství v atypicky
  velkém/minifikovaném souboru.

## Pozn.
Žádné netriviální zamítnuté alternativy nevznikly nad rámec toho, co je v diskuzních poznámkách
(`.mini/discuss/phase-022.md`) – ADR netřeba.
