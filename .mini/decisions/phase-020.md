# SHA-256 místo SHA-1 pro projectKey: quality, ne security

## Decision
V projectKey (src/projectPaths.ts) jsme nahradili SHA-1 za SHA-256 pro odvození 8-hex klíče adresáře z absolutní cesty projektu. Jde čistě o code-quality fix umlčující semgrep nález „weak cryptographic algorithm“, ne o bezpečnostní opravu — hash slouží jen k deterministickému klíči z vlastní lokální cesty, ne k ochraně dat ani integritě proti útočníkovi.

## Why
Zvážená a zamítnutá alternativa: nechat SHA-1 a přidat // nosemgrep anotaci. Zamítnuto, protože schovává weak-algo literál do anotace, kterou musí každý reviewer pochopit — čistší je slabý algoritmus prostě nemít. Vědomý trade-off: změna hashe změní klíč projektu, takže dříve uložené reporty/záměry pod ~/.vibeanalyzer/ osiřejí pod starým SHA-1 klíčem (round-trip zápis↔čtení se nerozbije, ale historie se z pohledu nástroje ztratí). U V1 bez nasazení přijatelné.
