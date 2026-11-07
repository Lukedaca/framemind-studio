# Culling local-1.9: výkon a ochrana malých motivů

Lokální změny, dosud nezveřejněné. Měření proběhlo v Chromiu na Windows,
Intel Core i5-11400H, přibližně 8 GB RAM. Dev server a testovací fotografie
zůstaly místní. Privátní reporty jsou v ignorované složce `output/playwright`.

## Stejné vstupy před změnou a po změně

Dvanáct prvních JPEGů ze sportovní kalibrační sady, výchozí technický profil.
Porovnávaly se celé metriky včetně automatických oblastí, skóre, rozpis složek,
verdikty, důvody a rizika. Všechny tyto hodnoty zůstaly přesně stejné.
Originály měly shodné SHA-256; externí požadavky cullingu a chyby stránky byly nulové.

| Měření | Před změnou | Po změně |
|---|---:|---:|
| Medián měření fotky po prvním snímku | 2 025 ms | 1 854 ms |
| První fotka včetně inicializace | 5 685 ms | 3 314 ms |
| Opakované čtení 12 hotových měření z cache | 0,135 ms | 0,170 ms |

Pokles teplého mediánu je 8,4 %. První snímek zahrnuje inicializaci runtime;
výsledek ovlivňují i systémové cache. Měření neobsahuje import, seskupování
ani vykreslování všech karet a není garantovanou rychlostí celé aplikace.
Cache řádky měří pouze opakované získání měření, nikoli celý opakovaný běh.

Samostatný CPU profil ukázal náklady mediánu šumu, dočasných polí a garbage
collectoru. Předalokované Float64 pole, číselné řazení a přímý součet čtyř
sousedů zachovávají původní výpočet. Šest deterministických obrazových vstupů
ve velikostech 128, 384 a 768 px mělo shodný hash všech výsledných metrik.
V konečném běhu bylo pět případů rychlejších 1,57–2,26×; zašuměný 768px
případ byl pomalejší (50,4 → 65,7 ms). Samostatný předchozí běh optimalizace
metrik měl tento případ 41,2 ms. Z těchto krátkých běhů nelze vyvozovat
zrychlení každého jednotlivého vstupu.

Culling používá `onnxruntime-web/wasm` s odpovídajícími přibalenými WASM/MJS
assets místo WebGPU/Asyncify balíčku. Jedno vlákno a lokální hash modelu
zůstávají zachované. Výběr WASM-only importu popisuje
[oficiální dokumentace ONNX Runtime](https://onnxruntime.ai/docs/tutorials/web/deploy.html).
Retuš používá svůj dosavadní runtime.

## Kvalita napříč profily

Nový regresní soubor má 13 případů: malý motiv na bílé i černé ploše ve všech
devíti profilech a výchozím nastavení, jediný neklipovaný pixel, skutečně
prázdný obraz a detail původního souboru ztracený při zmenšení. Před opravou
padalo deset profilových případů kvůli falešnému vyřazení. Po opravě procházejí.
Plocha 98 % bez informace není důkazem, že zbývající 2 % nemají význam.

Další běhy zpracovaly 12 fotografií z místní akce a 12 z portrétního focení.
Nejde o fotografem označkované sady. Kontroluje se dostupnost modelu,
neměnnost originálů a lokální provoz; tyto běhy neprokazují správnost výběru.
Probíhaly souběžně s dalšími kontrolami, proto jejich časy nejsou výkonovým
srovnáním s předchozí verzí.

Pro obecné hodnocení stále chybí označkované sady napříč žánry a fotoaparáty,
zejména produkt, krajina, noční snímky, makro, svatba, zvířata a záměrný pohyb.
Je potřeba zvlášť sledovat falešné vyřazení použitelných snímků, ponechání
technicky vadných snímků a čas celé dávky včetně P95 a spotřeby paměti.
Neexportovaný snímek není záporný štítek. Skóre není estetická pravděpodobnost.

## Reprodukce a ověření

```powershell
node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 3100 --strictPort
node scripts/culling-performance-audit.mjs before C:/cesta/k/jpeg
# Stejný příkaz po změně se štítkem wasm, stejná složka i soubory
node scripts/culling-performance-audit.mjs wasm C:/cesta/k/jpeg
node scripts/culling-performance-compare.mjs before wasm
```

Benchmark využívá zdrojové moduly Vite. Pro zabalený webový build slouží
`CULLING_SMOKE_BUNDLED=1 node scripts/culling-local-smoke.mjs`; tento režim
ověřuje UI a přeskočí doplňkový import vývojového modulu.

Prošlo 247 testů ve 30 souborech, TypeScript, web/PWA build a desktopový
frontend. Zabalený webový UI check ověřil měření, návrhy vyřazení, ochranu
detailu mimo mřížku, ruční volby po přepočtu, potvrzení odebrání a zastavení
běhu; externí požadavky cullingu a chyby stránky byly nulové.

Stejná kontrola v novém Windows EXE prošla s ověřeným odděleným profilem
WebView2: lokální model bez hlášení nedostupnosti, ochrana detailu, ruční
volby, zrušení i přijetí systémového potvrzení, zastavení a viditelná karta
při pohybu klávesami přes 60 snímků. Externí požadavky cullingu a chyby stránky
byly nulové. Windows EXE a NSIS instalátor 0.1.7 byly sestaveny místně;
pracovní aplikace nebyla aktualizována a nic nebylo zveřejněno.
