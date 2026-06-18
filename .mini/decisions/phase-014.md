# Vypnuté no-unused-vars i na JS bloku ESLintu

## Decision
Po zapnutí ecmaFeatures.jsx pro JS soubory jsme jádrové pravidlo no-unused-vars vypnuli i na JS bloku (dosud bylo vypnuté jen na TS). Tím se na JS i TS chová stejně: no-unused-vars neběží nikde.

## Why
Zapnutí JSX parsování způsobilo, že se JS soubory s JSX naparsují a no-unused-vars se na nich rozběhne. Jádrové pravidlo ale nerozumí JSX použití (importy komponent a React pragma použité jen v JSX) a na zdravém React kódu hlásí falešné 'defined but never used'. Cílovka jsou React vibekodeři, takže by to vracelo šum přesně tam, kde nejvíc bolí. Zvažovaná alternativa 'nechat pravidlo zapnuté' byla zamítnuta kvůli těmto false-positives; alternativa 'rozdělit blok a nechat pravidlo jen pro .js bez JSX' nepomáhá, protože cílovka píše JSX i v .js; alternativa 'přidat eslint-plugin-react (react/jsx-uses-vars)' zamítnuta, protože by znamenala další závislost a plugin resolvovaný podle jména – přesně to, čemu se non-goal č. 1 vyhýbá. Přijatý trade-off: ztrácíme hygienický signál o nepoužitých proměnných/importech v čistém neReact JS; bug-rules (eqeqeq, no-cond-assign, …) ale běží dál.
