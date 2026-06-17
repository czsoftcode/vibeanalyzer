# Skládání vnořených .gitignore: zásobník nezávislých matcherů

## Decision
Vnořené .gitignore skládáme jako zásobník nezávislých matcherů — jeden na složku, každý vrací {ignored, unignored} a verdikt jde mělký→hluboký podle pravidla „vyhrává poslední rozhodný názor". Re-include přes ! napříč úrovněmi tím funguje, aniž bychom vzory předků jakkoli přepisovali.

## Why
Zvažovaný a zamítnutý plán B byl skládat vzory všech předků do jednoho ignore matcheru s přepočtem bází (rebasování *.log ze src/ na src/**/*.log apod.). To je výrazně složitější a křehké — kotvení (/foo), ** a dir-only (build/) se při přepisu cest snadno rozejdou s Gitem.

Plán A stojí na jednom netriviálním předpokladu: knihovna ignore musí osamělou negaci (!keep.log bez předchozího pozitivního vzoru v témže souboru) reportovat jako {ignored:false, unignored:true}. Kdyby vracela unignored:false, hlubší úroveň by re-include nepropsala a src/sub/keep.log by se nikdy nevrátil. Předpoklad jsem před implementací ověřil spikem proti ignore v7.0.5 (vrací unignored:true) a připnul testem „SAMOSTATNÉ '!keep.log' hlásí unignored:true". Pokud ho příští upgrade knihovny poruší, padne právě tenhle test — a teprve pak má smysl sáhnout po plánu B. Z výsledného kódu tahle závislost na chování knihovny není vidět.
