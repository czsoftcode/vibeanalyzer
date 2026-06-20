# glm: kořen uříznutí je reasoning_effort, ne strop tokenů

## Decision
Uříznutí AI výstupu u glm (stop_reason=max_tokens) řešíme primárně nízkým reasoning_effort (Z.ai default je max), ne jen zvednutím stropu. Pro glm posíláme thinking: { type: "enabled" } + reasoning_effort: "low" + max_tokens: 65536; opus/sonnet zůstávají na thinking: { type: "adaptive" }, 16k a bez reasoning_effort. Konfig žije per-model v AI_PROVIDERS. reasoning_effort je rozšíření Z.ai (ne standardní Anthropic parametr) a propašuje se do volání SDK jako extra pole jen pro glm.

## Why
Nabízelo se opravit to jen zvednutím max_tokens (jednodušší, bez nestandardních polí). Zamítnuto: docs Z.ai ukazují, že glm jede defaultně reasoning_effort: max, takže thinking sežere libovolný strop — větší strop jen oddálí stejný pád a prodraží běh. Kořen je effort, ne velikost stropu. Cena: posíláme provider-specifické pole, které Anthropic SDK netypuje a opus/sonnet ho nesmí dostat → konfig musí být per-model, ne plošný. type: adaptive je u glm mrtvé (Z.ai zná jen enabled/disabled, tiše padá na default).
