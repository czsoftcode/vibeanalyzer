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
