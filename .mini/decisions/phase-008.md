# Sanitizace vstupu patří volajícímu, ne renderu

## Decision
renderProjectMd zůstává čistý formátter bez validace/escapování. Precondici vstupu (jednořádkové non-goaly, žádné code-fence ani '## …' v textu) plní volající — budoucí interaktivní vrstva. V renderu je precondice jen explicitně zdokumentovaná, ne vynucená.

## Why
Zvažovaná alternativa: escapovat/slučovat rizikový vstup přímo v renderu, aby round-trip render→parseIntent nikdy tiše neztratil data (nálezy S1/S2 z adversariálního review — lichý fence v buildingu spolkne celou sekci Non-goals). Odmítnuto, protože writeIntentFile zatím nemá žádného volajícího mimo testy a správná politika (odmítnout chybný vstup × sloučit × escapovat) je rozhodnutí té vrstvy, co odpovědi sbírá. Zabudovat ji teď do formátteru by znamenalo uhodnout politiku před jejím volajícím a postavit spekulativní vrstvu — proti pravidlu nepřidávat vrstvy pro budoucnost. Riziko (tichá ztráta dat při porušení precondice) je vědomě přesunuto na příští fázi, kde se sběr vstupu reálně řeší.
