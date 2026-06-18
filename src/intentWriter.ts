import { mkdir, rm, writeFile } from "node:fs/promises";
import * as path from "node:path";
import { INTENT_HEADINGS } from "./intent.js";
import { homeIntentPath, safeHomedir } from "./projectPaths.js";

/**
 * Vstup pro render záměru. Záměrně přesně to, co `parseIntent` reálně čte:
 * - `building` = text sekce "What I'm building",
 * - `nonGoals` = položky sekce "Non-goals".
 * Ostatní sekce vzoru `.mini/project.md` (Approach, Success criteria, …) NErenderujeme:
 * analyzátor je nečte, ptát se na ně by znamenalo psát text, který nikdo nepoužije.
 */
export interface IntentDraft {
  building: string;
  nonGoals: string[];
}

/**
 * Z konceptu záměru vyrenderuje obsah `project.md` se dvěma sekcemi, jejichž
 * nadpisy bere z `INTENT_HEADINGS` (sdílený literál s parserem) – render tak
 * zapíše PŘESNĚ ty nadpisy, které `parseIntent` umí najít (round-trip test to hlídá).
 *
 * Render je permisivní (validaci vstupu má na starosti volající); `building` se
 * trimuje, `nonGoals` se vypíší jako odrážky `- `. Prázdné vstupy nevyhodí – jen
 * vzniknou prázdné sekce, které `parseIntent` přečte jako null (viditelný stav
 * "nedodáno", ne tichá díra).
 *
 * PRECONDICE (zodpovědnost volajícího – budoucí interaktivní vrstvy):
 * - každá položka `nonGoals` je JEDNOŘÁDKOVÁ; `\n` uvnitř položky parser na druhém
 *   řádku ztratí (extractList bere jen řádky `- `/`* `) → tichý ořez,
 * - `building` ani `nonGoals` NEOBSAHUJÍ code-fence (```` ``` ````/`~~~`) ani řádek
 *   `## …`. parseIntent je fence/heading-aware (nálezy 4-1/4-3): lichý fence v
 *   `building` spolkne i následující nadpis `## Non-goals` a celá sekce zmizí
 *   (nonGoals = null). Render to ZÁMĚRNĚ neescapuje – kontrola/sanitizace patří
 *   vrstvě, co odpovědi sbírá, ne čistému formátteru. Round-trip je zaručen jen
 *   pro vstup splňující tuto precondici (viz test "round-trip").
 */
export function renderProjectMd(draft: IntentDraft): string {
  const building = draft.building.trim();
  const nonGoals = draft.nonGoals.map((g) => `- ${g.trim()}`).join("\n");
  return (
    `## ${INTENT_HEADINGS.building}\n` +
    `${building}\n\n` +
    `## ${INTENT_HEADINGS.nonGoals}\n` +
    `${nonGoals}\n`
  );
}

/**
 * Výsledek zápisu záměru do domácího úložiště. Rozlišujeme stavy záměrně, ať se
 * "už tam byl" (běžné, NEpřepisujeme) nepleť s "nešlo zapsat" (problém k nahlášení)
 * ani s "neznámý domov" (nemáme kam psát).
 */
export type WriteIntentResult =
  | { kind: "written"; path: string }
  | { kind: "exists"; path: string }
  | { kind: "unwritable"; path: string; code: string }
  | { kind: "no-home" };

/**
 * Zapíše záměr do `~/.vibeanalyzer/<projectKey>/project.md`. READ-ONLY vůči
 * ANALYZOVANÉMU projektu (non-goal č. 1) – píše se VÝHRADNĚ do domova, nikdy do
 * `targetPath`.
 *
 * - domov neznámý → `no-home` (nic se nevytvoří),
 * - soubor už existuje → `exists`; přepis se NEKONÁ (flag `wx` je atomický – žádné
 *   TOCTOU okno mezi kontrolou a zápisem), cizí/dřívější záměr zůstane netknutý,
 * - mkdir/zápis selže (práva, …) → `unwritable` s `code`,
 * - jinak → `written` s cestou.
 *
 * Úklid: pamatujeme si NEJVYŠŠÍ adresář, který mkdir reálně vytvořil (`createdDir`).
 * Když zápis selže (a soubor přitom NEexistoval), tyhle adresáře po sobě smažeme –
 * ať po neúspěchu nezůstane osiřelý prázdný strom v domově (stejná úvaha jako úklid
 * v cli.ts, nálezy 3-10/3-14). Když mkdir vrátí undefined (cílový adresář už
 * existoval), NEmažeme nic – není to náš adresář.
 *
 * Hranice atomicity: mezi mkdir a writeFile (nebo při pádu procesu) může osiřet
 * prázdná složka v domově. To je přijatelné (prázdný adresář nic nerozbije), ne
 * předstíráme dokonalost.
 *
 * `options.homeDir` umožní v testech podstrčit jiný domov (jinak `safeHomedir()`).
 */
export async function writeIntentFile(
  targetPath: string,
  content: string,
  options: { homeDir?: string } = {},
): Promise<WriteIntentResult> {
  const homeDir = options.homeDir ?? safeHomedir();
  const filePath = homeIntentPath(homeDir, targetPath);
  if (filePath === null) return { kind: "no-home" };

  const dir = path.dirname(filePath);

  let createdDir: string | undefined;
  try {
    createdDir = await mkdir(dir, { recursive: true });
  } catch (err: unknown) {
    const e = err as NodeJS.ErrnoException;
    return { kind: "unwritable", path: filePath, code: e.code ?? "neznámá chyba" };
  }

  try {
    // flag "wx": existující soubor → EEXIST (atomicky, bez přepisu).
    await writeFile(filePath, content, { encoding: "utf8", flag: "wx" });
  } catch (err: unknown) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === "EEXIST") {
      // Soubor už tam byl → adresář existoval i s ním, takže createdDir je
      // undefined a NEmáme co uklízet; cizí záměr nesmíme smazat ani přepsat.
      return { kind: "exists", path: filePath };
    }
    if (createdDir !== undefined) {
      await rm(createdDir, { recursive: true, force: true }).catch(() => {});
    }
    return { kind: "unwritable", path: filePath, code: e.code ?? "neznámá chyba" };
  }

  return { kind: "written", path: filePath };
}
