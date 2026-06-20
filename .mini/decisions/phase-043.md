# Streaming + maxRetries:0 pro AI analýzu: obrana proti „zaplať a nic nedostaneš“

## Decision
Reálné analytické volání (realAiAnalyze) běží přes STREAMING (messages.stream().finalMessage()) s maxRetries: 0 a prakticky neomezeným timeoutem (30 min jen jako krajní pojistka), místo nestreamovaného messages.create s krátkým timeoutem a retry.

## Why
Měření odhalilo cenovou past: nestreamovaný požadavek s maxRetries: 2 + 120 s timeoutem nad ~93k tokeny (sonnet + adaptive thinking) překročil timeout, SDK ho poslal 3×, server pokaždé naúčtoval (~$1 celkem) a klient výsledek pokaždé zahodil → skipped bez dat. Klientský timeout neruší serverové účtování. Zvažovaná a zamítnutá alternativa „jen zvětšit timeout“ nestačí: nestreamované dlouhé spojení může utnout infrastruktura mezi klientem a API kvůli nečinnosti – server dotaz dokončí a naúčtuje, klient nedostane nic. Streaming drží spojení živé průběžnými tokeny → žádný pevný útes na X minutách a žádné placení za zahozený výsledek; maxRetries: 0 brání násobení účtu, protože retry dlouhého drahého callu znamená platit znovu za totéž.
