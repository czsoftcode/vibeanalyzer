# Review findings

> Recorded by `mini findings add` (the adversarial and verify review steps).
> Each entry is `## <id> · <severity> · <status>`; do not hand-edit those header
> lines.

## 6-1 · should-know · resolved
**Where:** src/scan.ts:139,149; src/gitignore.ts:53,62; src/cli.ts:90
**Reviewed-at:** 2ba8f52dc80be2235b885950b64cec5704d96a9f
**Source:** adversarial
**Reason:** Strop na délku řádky .gitignore (MAX_GITIGNORE_LINE=4096) v loadGitignore odmítne patologickou řádku jako 'invalid' ještě před kompilací; cli.ts ji hlásí na stderr a scan poběží bez .gitignore. Pokryto testy (unit + e2e), zuby ověřeny mutací.
Patologický .gitignore shodí celý scan (nehlídaný predikát ruší no-throw invariant scanTree)

Reprodukováno proti REÁLNÉMU kódu: .gitignore s jednou dlouhou řádkou (~50000 znaků) projde loadGitignore jako kind='loaded' (ignore.add() kompiluje regex LÍNĚ, takže nehází), ale první ig.ignores() ve walk() hodí 'Invalid regular expression' (V8 limit velikosti regexu). isIgnored?.() v scanTree NENÍ obalen try/catch (řádky 139 a 149), takže scanTree promise REJECTUJE. cli.ts kolem scanTree ZÁMĚRNĚ nemá try/catch (komentář 65-71 se opírá o 'scanTree na I/O nikdy nehodí') → výjimka propadne do bin.ts a celá analýza spadne se stackem místo slíbené degradace ('nečitelný .gitignore → upozornění a scan poběží bez něj'). Obrana autora ('allowRelativePaths znamená, že predikát nehází') je neúplná: ten flag řeší jen validaci relativní cesty, ne kompilaci regexu. Spouštěč je neobvyklý (poškozený/generovaný/omylem přejmenovaný soubor .gitignore), ale je to platný čitelný soubor, na kterém design slibuje hlasitou degradaci, ne pád. Oprava: obalit volání predikátu v scanTree try/catch (degradovat na 'neignorováno' + zaznamenat), nebo predikát v gitignore.ts učinit nehazejícím.

## 6-2 · should-know · resolved
**Where:** src/scan.ts:22-24,139-142
**Reviewed-at:** 2ba8f52dc80be2235b885950b64cec5704d96a9f
**Source:** adversarial
**Reason:** Doc komentář ScanResult.ignoredByGitignore upřesněn: počet vynechaných položek nejvyšší úrovně (prořezaný podstrom = 1), ne součet souborů.
ignoredByGitignore výrazně podhodnocuje – prořezaný podstrom se počítá jako 1

Doc komentář ScanResult.ignoredByGitignore tvrdí 'kolik položek (souborů i složek) se vynechalo'. Realita: ignorovaný adresář se prořízne (continue) a započítá jako +1 BEZ ohledu na to, kolik souborů uvnitř má – vendor/ s 10000 soubory přidá 1, ne 10001. Funkčně to dnes nevadí, protože JEDINÝ konzument (cli.ts:107) používá jen 'ignoredByGitignore > 0' jako boolean. Riziko je v kontraktu: pole je exportované v ScanResult a komentář aktivně mate. Budoucí konzument, který podle doc komentáře napíše do reportu 'ignorováno N položek', dostane drasticky špatné číslo a chyba se rozteče potichu (přesně proti pravidlu 'cross-module kontrakt' z CLAUDE.md). Oprava: buď doc upřesnit ('počet vynechaných POLOŽEK NEJVYŠŠÍ úrovně, prořezaný podstrom = 1'), nebo pole přejmenovat (např. ignoredEntries) tak, aby název neimplikoval součet souborů.

## 6-3 · nit · resolved
**Where:** src/cli.ts:107-112
**Reviewed-at:** 2ba8f52dc80be2235b885950b64cec5704d96a9f
**Source:** adversarial
**Reason:** Podmínka varování o prázdném reportu počítá na type==='file' (fileCount), ne result.files.length – zachytí i vzory mažící jen soubory (složky zůstanou). Pokryto e2e testem.
Report bez obsahu (jen prázdné složky) když .gitignore odfiltruje všechny SOUBORY – varování nezazní

Varování na prázdný index se spustí jen při files.length===0 && ignoredByGitignore>0. Jenže .gitignore se vzory na soubory (např. '*.ts', '*.php', '*.md') vynechá soubory, ale adresáře (src, vendor, var) v indexu zůstanou → files.length>0, takže varování NEzazní, přestože report neobsahuje jediný soubor a pro AI vrstvu je bezcenný. Není to tichý falešný úspěch v úzkém smyslu (záznamy tam jsou), proto nit; ale 'řekni nahlas, když je výsledek prakticky prázdný' by chtělo i tuhle hranici. Případná oprava: podmínku rozšířit na 'žádný soubor (type==='file') a přitom ignoredByGitignore>0'.
