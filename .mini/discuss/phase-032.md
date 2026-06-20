# Phase 32 — Monorepo: upozornit na hoisted node_modules

## Intent
Contained CompilerHost (fáze 28) je fail-closed: importy mimo kořen padnou na TS2307
"cannot find module". V monorepu s hoisted závislostmi (node_modules o úroveň/víc výš)
se report zaplaví falešnými TS2307 a uživatel netuší, že je to artefakt analyzátoru, ne
chyba jeho kódu. Tato fáze přidá do tsc sekce reportu upozornění, které tuto situaci
přizná. V1 cílí na npm/yarn classic hoisting.

## Key decisions
- **Trojstav poznámky, ne dvě vedle sebe** (zpřesnění dnešní NODE_MODULES_NOTE v
  markdown.ts:119):
  - kořen MÁ node_modules → žádná poznámka
  - kořen NEMÁ, ale rodič výš MÁ → NOVÁ poznámka (hoisted monorepo)
  - kořen NEMÁ a rodič taky ne → STÁVAJÍCÍ NODE_MODULES_NOTE (chybí node_modules)
- **Hledání nahoru až k FS root**: procházet po rodičích od parent(root) k prvnímu
  nalezenému node_modules, zastavit u kořene filesystému.
- **Nová poznámka jen když mezi nálezy je aspoň jeden TS2307**: jinak by zbytečně
  strašila. (Pozor: stará NODE_MODULES_NOTE se na TS2307 NEváže – ukazuje se vždy při
  chybějícím node_modules; tuto novou děláme přísnější.)
- **Umístění detekce**: v analyzeTypeScript (src/analyze/tsc.ts), nové pole v TscResult
  (kind:"ran"), render v src/report/markdown.ts – konzistentní s nodeModulesPresent.

## Watch out for
- **Vzájemná exkluze poznámek**: stará a nová se NESMÍ zobrazit obě (protiřečí si).
  Render musí volit právě jednu větev trojstavu.
- **pnpm mez (známá)**: pnpm monorepo má symlinkovaný node_modules přímo v balíčku, takže
  "kořen nemá node_modules" tam nesedne a heuristika ho neoznačí. Přiznat jako V1 mez.
- **Falešná pozitivita**: čím výš hledáme, tím větší šance na nesouvisející node_modules.
  Vazba na reálný TS2307 to tlumí.
- **TS2307 detekce**: nález má rule === "TS2307" (viz toFinding v tsc.ts). Filtrovat přes
  rule, ne přes text zprávy (lokalizace/změny textu).
- **Výkon/bezpečnost**: stat na každé úrovni je levné; není to bezpečnostní hranice (jen
  informativní), takže stačí prostý path.dirname loop, není nutný realpath jako u
  contained hostu.
- **Test bez node_modules závislosti na reálném FS výš**: fixture/mock musí jít kontrolovat
  deterministicky (injektovatelný probe rodičů, ne reálný stat na cestách mimo fixturu).
