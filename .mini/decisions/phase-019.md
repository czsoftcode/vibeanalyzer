# Přibalený TS povýšen na 6.0 navzdory rozšíření divergence vůči analyzovaným projektům

## Decision
Povýšili jsme přibalený typescript z 5.9 na 6.0.3 (přesná verze). Bump se přenese na main jako produkční stav nástroje.

## Why
Zvažovaná alternativa byla zůstat na 5.9. Argument pro ni: nástroj analyzuje cizí projekty naším přibaleným TS (záměrně, ne jejich verzí), a skok 5.9 → 6.0 rozšiřuje rozdíl mezi tím, co nahlásíme my, a co by nahlásil vlastní toolchain projektu - hlavně kvůli strict-by-default a ES2025 lib u projektů bez explicitní konfigurace.

GO zvítězilo, protože: (1) přechod je technicky bez rizika - TS 6.0 je API-kompatibilní s 5.9, build i 240 testů včetně testů na tvar diagnostik prošly beze změny; (2) divergence přibalený-vs-projektový TS existovala i na 5.9 a report ji už dokumentuje přes projectTsVersion, takže 6.0 ji jen zvětšuje, nezavádí nový druh problému; (3) zůstat na 5.9 znamená odkládat nevyhnutelný přechod před nativním TS 7, kdy by se stejná práce dělala znovu na větším skoku. Zisk samotných 6.0 features je pro nás malý (cílíme ES2022 explicitně) - důvodem je synchronizace s aktuální stabilní řadou, ne nové schopnosti.
