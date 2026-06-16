# Párový výstup řešen best-effort úklidem, ne atomicky

## Decision
JSON a MD report se zapisují sekvenčně přes writeReportFiles. Při jakékoli chybě zápisu se OBĚ cílové cesty bezpodmínečně best-effort smažou (unlink(json).catch(); unlink(md).catch()). Žádné temp soubory ani atomické přejmenování.

## Why
Zvažoval jsem zápis obou do temp souborů a následný atomický rename. Zavrženo: dvousouborovou atomicitu to reálně nedává - druhý rename (MD) může selhat stejně jako přímý zápis, takže okno nekonzistence (osiřelý JSON) jen přesune, neodstraní. Přidalo by to složitost bez záruky navíc.

Úklid cílí obě cesty NEPODMÍNĚNĚ, ne jen 'co se stihlo úspěšně zapsat': writeFile otevírá s O_CREAT|O_TRUNC, takže soubor vznikne už při open. Když write selže až potom (plný disk ENOSPC, kvóta, EFBIG, EIO - realistické důvody selhání druhého zápisu), soubor na disku existuje, i když promise rejectne. Sledování 'úspěšně zapsaných' cest by tenhle osiřelý soubor minulo (to byl blocker 2-1). Best-effort mez (když selže i unlink) je přiznaná v chybové hlášce slovem 'best-effort', nepředstírá 100% záruku.
