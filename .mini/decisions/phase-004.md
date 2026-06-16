# Nápověda při chybějícím záměru jde na stdout, ne na stderr

## Decision
Když záměr (project.md) chybí, vypíše se nápověda „jak ho dodat" na stdout. Varování při nečitelném souboru (existuje, ale nejde přečíst) jde naopak na stderr.

## Why
Nabízelo se dát nápovědu taky na stderr (jednodušší, vše „neúspěšné" pohromadě). Zamítnuto: chybějící project.md je běžný legitimní stav (analyzovaný projekt ho mít nemusí), ne chyba – patří tedy mezi informační výstup vedle souhrnu. Stderr si rezervujeme pro skutečné problémy (nečitelný soubor). Drží to kontrakt „úspěšný běh nepíše nic na stderr", o který se opírá test cli.scanfail.test.ts; alternativa by ho buď porušila, nebo by si vynutila oslabení toho testu.
