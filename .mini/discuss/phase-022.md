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
