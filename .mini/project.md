# VibeAnalyzer

## What I'm building
Lokální CLI nástroj (TypeScript), který čte – nespouští – projekty psané AI agenty a generuje .md report (s Mermaid diagramy, případně HTML) z pěti úhlů: kód, bezpečnost, projektová struktura, logika a non-goaly. Záměr projektu (a deklarované non-goaly) bere z .mini/project.md; když .mini není, vyžádá si project.md.

## Who it's for
Vibekodeři

## Approach
- Hybridní analýza: strojová vrstva (tsc/ESLint, audit závislostí, hledání tajemství, čtení stromu souborů) + AI vrstva (Claude přes Anthropic API) na logiku a non-goaly.
- Obě vrstvy oddělené: strojová doběhne i bez internetu a API klíče; AI vrstva se v takovém případě jen označí jako přeskočená.
- Non-goal a logická analýza se vždy poměřuje vůči záměru z project.md a report to explicitně uvádí ("posuzováno vůči tomuto záměru").
- Každý AI nález ukazuje na konkrétní místo v kódu, aby se dal ověřit (obrana proti halucinacím).
- Velký projekt se pro AI vrstvu krájí na části, aby se vešel do limitu dotazu.
- Před AI během se zobrazí odhad rozsahu/nákladů.
- V1 cílí na JS/TS; podpora dalších jazyků je ambice na později.

## Non-goals
- Do not run or execute the analyzed code in this version - only read it.
- Do not build a web service with login/accounts in this version - it stays a local CLI.
- Do not auto-fix found problems - only report them.
- Do not add a config file for toggling rules in this version.
- Do not track history or compare across runs in this version.
- Do not add CI integration in this version.

## Success criteria
- Spuštění na složce s mini projektem vyrobí .md report bez pádu.
- Report obsahuje nálezy ze všech pěti úhlů, každý s odkazem na konkrétní místo v kódu.
- Strojová vrstva doběhne i bez API klíče nebo bez internetu; AI vrstva se čistě přeskočí.
- Non-goal nálezy se vážou na non-goaly deklarované v project.md.
- Vygeneruje se Mermaid diagram struktury projektu.

## Main constraints
Typescript
