# FrameMind Studio desktop — Windows 0.1.0

Desktopová aplikace používá Tauri 2. Rust vytvoří okno a propojí systémové dialogy
a ukládání souborů. Současné rozhraní React/Vite běží v Microsoft WebView2.
Jde o instalovatelnou aplikaci s vlastním oknem; rozhraní není přepsané do WinUI.

## Instalace a aktualizace

Distribuční soubor je `FrameMind-Studio_0.1.0_x64-setup.exe` v
[GitHub Releases](https://github.com/Lukedaca/framemind-studio/releases).
Instalátor NSIS nabízí češtinu a angličtinu, licenci MIT, volbu složky a zástupce.
Instaluje pro aktuálního uživatele, výchozí složka je
`%LOCALAPPDATA%\FrameMind Studio\`. Uživatel nepotřebuje vývojové nástroje.

Instalátor má přibližně 213 MiB. Obsahuje offline instalační program WebView2,
který použije, pokud runtime není nainstalovaný. Připojení není potřeba pro
stažení tohoto předpokladu během instalace. Instalace na čistém Windows bez
WebView2 dosud nebyla ověřena; místní test používá už přítomný runtime.

Instalátor 0.1.0 není podepsaný certifikátem vydavatele a vydání je předběžné.
Automatický updater není implementovaný. Další verze se instalují ručně.
Odinstalace je v nastavení aplikací Windows. Volba odstranění místních dat je
samostatná; pokud je potřebujete, ponechte ji vypnutou.

## Sestavení ze zdrojů

Na vývojovém počítači jsou potřeba Node.js 22, npm, Rust stable s cílem
`x86_64-pc-windows-msvc`, Visual Studio C++ Build Tools, Windows SDK a WebView2.
Oficiální požadavky: [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/).
První build stahuje npm a Cargo závislosti, nástroje NSIS a instalační program WebView2.

```bash
npm ci
npm run typecheck
npm run test:run
npm run desktop:build
```

Výstupy:

- `dist-desktop/`: zabalený frontend bez PWA a service workeru.
- `src-tauri/target/release/framemind-studio.exe`: vlastní aplikace.
- `src-tauri/target/release/bundle/nsis/FrameMind Studio_0.1.0_x64-setup.exe`: instalátor.

Pro vývoj okna aplikace použijte `npm run desktop:dev`. Tauri spustí Vite na
`127.0.0.1:3000`; tento port musí být volný. Instalovaný release žádný Vite server
nespouští. Před dalším buildem zavřete aplikaci spuštěnou přímo z `target/release/`,
protože Windows nedovolí přepsat její běžící EXE.

`package-lock.json` a `src-tauri/Cargo.lock` patří do Gitu. `target/`, `gen/`
a buildové výstupy jsou ignorované. Windows GitHub Actions sestavuje instalátor
jako artefakt; publikování vydání je samostatný krok. Aplikace se nikam nenasazuje.
Balíčky pro jiné platformy nejsou součástí ověřeného vydání.

## Soubory a místní data

Import dál používá objekty `File` uvnitř WebView. Culling pracuje na náhledu
ve workeru a původní soubory nemaže. Odmítnuté snímky se odeberou pouze ze sady
po potvrzení. Systémové potvrzení je asynchronní; jeho zrušení musí ponechat sadu.

Export JPEG/PNG používá dialog Windows. Export sady vybírá složku jednou.
Tauri povoluje zápis do cest, které uživatel vybral v dialogu; schopnosti okna
neobsahují přístup k libovolnému disku nebo shellu. Názvy v dávce se kontrolují,
aby se nemohly změnit v cestu mimo vybranou složku. Uložení může přepsat soubor
stejného názvu ve vybrané exportní složce, stejně jako dřívější webový export.

WebView2 používá vlastní profil pod `%LOCALAPPDATA%\cz.framemind.studio\`.
Profil je oddělený od dat aplikace otevřené v prohlížeči; automatická migrace není
implementovaná. Interní origin je `https://tauri.localhost`, obsluhovaný aplikací.
Jeho schéma a identifikátor musí zůstat stabilní, jinak se změní přístup k místnímu
úložišti. Viz [Tauri window configuration](https://v2.tauri.app/reference/config/).

CRM pořád ukládá JSON do `localStorage`. Tato změna neřeší obnovení objektů
`File`, fotek ani `blob:` URL po restartu aplikace. Originály uchovávejte na disku
a výsledky exportujte. GitHub zálohuje zdrojový kód, nikoli místní fotografie či CRM.

## Připojení a omezení

Culling je bez AI, klíčů, modelů a síťových požadavků. Zabalení do desktopu
nemění jiné části editoru: retuš a klikací laso stále poprvé stahují modely
z Hugging Face, písma používají Google Fonts a dvě funkce editoru stále používají
Gemini s vlastním klíčem. Přesný rozpis je v [README](../README.md#připojení-a-data).
Celou aplikaci proto nelze označit jako plně offline.

Desktop nepoužívá PWA service worker. Cache modelů je v profilu WebView2;
její dostupnost není garantovaná. WebGPU a WASM retuš závisí na runtime, GPU
a ovladačích. Konfigurace obsahuje hlavičky pro cross-origin izolaci a CSP;
jejich přítomnost sama nedokazuje podporu vícevláknového WASM na každém počítači.

## Volitelné ověření skutečného okna

Playwright je volitelný nástroj, nikoli závislost aplikace. Nainstalujte jej
samostatně podle [CONTRIBUTING](../CONTRIBUTING.md#optional-browser-smoke-check).
Na Windows spusťte testovací aplikaci s diagnostickým portem pouze pro její proces:

```powershell
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = '--remote-debugging-port=9225'
$studioProcess = Start-Process -FilePath "$env:LOCALAPPDATA\FrameMind Studio\framemind-studio.exe" -PassThru
Remove-Item Env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS
$env:DESKTOP_SMOKE_CDP = 'http://127.0.0.1:9225'
$env:DESKTOP_SMOKE_PID = "$($studioProcess.Id)"
node scripts/culling-local-smoke.mjs
node scripts/desktop-export-smoke.mjs
```

Před tím zavřete ostatní okna Studia: aplikace používá jedinou instanci.
Testy dočasně ovládají tuto instanci a nahrají syntetické snímky. Helper pro
systémové dialogy kontroluje zadaný proces `framemind-studio`, nikoli cizí okna.
Výsledky a vytvořené fotky patří do ignorovaného `output/playwright/`.
Po testu aplikaci zavřete a spusťte běžně bez diagnostického portu.

Culling smoke ověřuje měření náhledu, ruční volby, přepočet profilu, potvrzené
odebrání a zastavení běhu. Desktopová varianta nepoužívá vývojový import zdrojového
modulu pro samostatnou analýzu workeru; worker se ověřuje přes UI.
Export smoke ověřuje zrušení systémového dialogu, JPEG, rozměry PNG, export sady
a zachování SHA-256 původních testovacích souborů. Ani jeden test neprokazuje
fotografickou kvalitu, výkon velké RAW sady nebo úplnou funkčnost všech AI modelů.

Místní ověření 2026-10-04: typecheck, 106 testů, webový a desktopový frontend build
prošly. Nainstalovaná verze prošla oběma smoke testy: culling měl 0 externích
požadavků a 0 chyb stránky; export ověřil JPEG, PNG 128 × 96, dva soubory ve
vybrané složce a nezměněné SHA-256 originálů. Testovací Windows už obsahovaly WebView2.
