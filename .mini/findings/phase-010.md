# Review findings

> Recorded by `mini findings add` (the adversarial and verify review steps).
> Each entry is `## <id> · <severity> · <status>`; do not hand-edit those header
> lines.

## 10-1 · should-know · resolved
**Where:** src/bin.ts:21-35; src/cli.entrypoint.test.ts:69-83
**Reviewed-at:** ab57a15b70b60d4700e516d02ddcf72dda4a7eb8
**Source:** project
**Range:** 8-10
Interaktivní cesta bin.ts (reálné readline + run offer + close) nemá žádný test → riziko zaseknutí po dotazu

Celá produkční interaktivní vrstva se skládá ve fázích 9-10 v bin.ts: detekce TTY (isInteractive), createReadlineAsk(process.stdin, process.stdout), předání ask do run() a teardown přes rl?.close() v .finally(). Žádný test tuhle drátovou cestu neprojde: cli.entrypoint.test.ts podvrhuje createReadlineAsk no-op stubem (ask:undefined) a spouští bin se stdio pipe (neinteraktivní větev). createReadlineAsk je sice unit-testován nad PassThrough a offer v run() nad fake ask, ale REÁLNÝ readline nad process.stdin v terminálovém režimu + jeho uzavření po doběhu se netestuje vůbec. Dva konkrétní nechycené failure módy: (1) wiring regrese – kdyby se přestal předávat ask nebo se zapomnělo zavřít rl, všech 149 unit testů projde a feature je rozbitá/visí; (2) teardown: bin spoléhá na přirozené ukončení přes process.exitCode, ale rl.close() sám nedestruuje/neunref-uje process.stdin. U TTY (terminal:true) readline stream resumuje; po close nemusí být stdin uvolněn a proces po interaktivním doběhu může viset s otevřeným stdin. V sandboxu přes pipe (terminal=false) proces korektně skončí – právě proto by se hang v reálném terminálu žádným současným testem nechytil.

## 10-2 · nit · resolved
**Where:** src/intentWriter.ts:41; src/intentPrompt.ts:594
**Reviewed-at:** ab57a15b70b60d4700e516d02ddcf72dda4a7eb8
**Source:** project
**Range:** 8-10
Non-goal začínající '- '/'* ' dá ve vygenerovaném project.md zdvojenou odrážku '- - text'

validateAnswerLine propustí non-goal, který sám začíná pomlčkou/hvězdičkou (kontroluje jen vícenásobné řádky, fence a '^##'), např. uživatel přirozeně napíše '- Nespouštět kód'. renderProjectMd pak vyrobí 'Lidsky: - ' + g = '- - Nespouštět kód'. parseIntent regex /^\s*[-*]\s+(.*\S)\s*$/ vezme jako text položky '- Nespouštět kód', takže do reportu se non-goal dostane s vedoucí pomlčkou. Není to pád (round-trip i tak prochází), jen kosmeticky pomotaný non-goal z běžného vstupu. Sběrová vrstva by mohla vedoucí odrážku oříznout, nebo render escapovat.
