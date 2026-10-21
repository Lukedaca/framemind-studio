# FrameMind Studio desktop — Windows

Desktopová aplikace používá Tauri 2. Rust vytvoří okno a propojí systémové dialogy
a ukládání souborů. Současné rozhraní React/Vite běží v Microsoft WebView2.
Jde o instalovatelnou aplikaci s vlastním oknem; rozhraní není přepsané do WinUI.

## Instalace a aktualizace

Klientské vydání zatím není dostupné. Nepodepsaný vývojový náhled
`FrameMind-Studio_0.1.3_x64-setup.exe` je v
[GitHub Releases](https://github.com/Lukedaca/framemind-studio/releases/tag/v0.1.3); není určen klientům.
Instalátor NSIS nabízí češtinu a angličtinu, licenci MIT, volbu složky a zástupce.
Instaluje pro aktuálního uživatele, výchozí složka je
`%LOCALAPPDATA%\FrameMind Studio\`. Uživatel nepotřebuje vývojové nástroje.

Instalátor 0.1.3 má přibližně 219 MiB. Obsahuje offline instalační program WebView2,
který použije, pokud runtime není nainstalovaný. Připojení není potřeba pro
stažení tohoto předpokladu během instalace. Instalace na čistém Windows bez
WebView2 dosud nebyla ověřena; místní test používá už přítomný runtime.

Instalátor 0.1.3 není podepsaný certifikátem vydavatele. Nepožadujeme vypnutí
SmartScreen, odblokování souborů ani instalaci vlastních důvěryhodných certifikátů.
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
- `src-tauri/target/release/bundle/nsis/FrameMind Studio_0.1.3_x64-setup.exe`: instalátor.

Název souboru zveřejněného na GitHubu používá `FrameMind-Studio` s pomlčkou;
obsah je totožný s místním instalátorem se jménem `FrameMind Studio`.

Pro vývoj okna aplikace použijte `npm run desktop:dev`. Tauri spustí Vite na
`127.0.0.1:3000`; tento port musí být volný. Instalovaný release žádný Vite server
nespouští. Před dalším buildem zavřete aplikaci spuštěnou přímo z `target/release/`,
protože Windows nedovolí přepsat její běžící EXE.

`package-lock.json` a `src-tauri/Cargo.lock` patří do Gitu. `target/`, `gen/`
a buildové výstupy jsou ignorované. Windows GitHub Actions sestavuje instalátor
jako artefakt `UNSIGNED-DEVELOPMENT-ONLY`, přidává označení do archivu a ověřuje,
že kontrola klientského vydání tento instalátor odmítne. Publikování vydání je
samostatný krok. Aplikace se nikam nenasazuje.
Balíčky pro jiné platformy nejsou součástí ověřeného vydání.

## Podpis a příprava klientského vydání

`npm run desktop:build` vytváří vývojový balíček. Pro přípravu podepsaného vydání
slouží `npm run desktop:release`. Vyžaduje existující certifikát pro podepisování
kódu a jeho soukromý klíč v `Cert:\CurrentUser\My`; thumbprint se předá proměnnou
`FRAMEMIND_SIGNING_CERTIFICATE_THUMBPRINT`. Soukromý klíč zůstává v úložišti nebo
tokenu poskytovatele. Skript nevytváří účet, certifikát ani změnu systémové důvěry.

Postup nejprve zkontroluje platnost, účel, důvěryhodný řetězec a revokaci
certifikátu. Tauri pak podepisuje své Windows výstupy pomocí SHA-256 a časového
razítka RFC 3161. Aplikace i výsledný instalátor musí projít
`scripts/verify-windows-release.ps1`: platný vložený Authenticode podpis,
očekávaný certifikát vydavatele, časové razítko a `signtool verify /pa /all /tw`.
Teprve po úspěchu vznikne nová složka pod `src-tauri/target/client-release/`
s kopiemi instalátoru a SHA-256 součtem vypočítaným po podpisu. Skript nic nepublikuje.

Podepsání zde dosud nebylo provedeno: žádný použitelný certifikát není nakonfigurovaný.
Bylo ověřeno odmítnutí existujícího nepodepsaného balíčku i odmítnutí sestavení
klientského vydání bez certifikátu. Kontrola podpisu není důkaz absence škodlivého
kódu ani bezchybnosti aplikace. Před vydáním klientům je ještě nutný test staženého
instalátoru, nainstalovaných EXE a odinstalace na čistých Windows se zapnutou ochranou.

SmartScreen používá reputaci souboru i vydavatele. Nová podepsaná aplikace může
stále zobrazit varování; vlastnoručně vytvořený certifikát jej neřeší. Přechod
z EXE na MSI/MSIX sám neposkytuje důvěryhodný podpis. Microsoft Store vyžaduje
registraci a ověření vydavatele, proto jej tento projekt automaticky nenastavuje.
Viz [Microsoft SmartScreen](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation),
[Tauri signing](https://v2.tauri.app/distribute/sign/windows/) a
[Microsoft SignTool](https://learn.microsoft.com/en-us/windows/win32/seccrypto/signtool).

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

Nový frontend ukládá projekty, rozpracovanou sadu, historii a kopie fotek do
IndexedDB v místním profilu. Obrazová data jsou oddělená od nastavení; posuvníky
je znovu nezapisují. Starší JSON v `localStorage` zůstává zachovaný, ale jeho
chybějící obrazová data je nutné importovat znovu. Původní soubory na disku se
nemění. Obnova po úplném restartu byla ověřena v odděleném Chromiu na generovaných
snímcích. Při aktualizaci na 0.1.3 byla ověřena shoda všech 12 existujících souborů
IndexedDB/localStorage před prvním spuštěním a otevření instalovaného okna; tato
kontrola sama neověřuje obnovu každého uloženého projektu. Originály uchovávejte
na disku a výsledky exportujte. GitHub zálohuje kód, nikoli místní fotografie či CRM.

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

Playwright je vývojová závislost; instalovaná aplikace jej nepotřebuje.
Přípravu prohlížeče popisuje [CONTRIBUTING](../CONTRIBUTING.md#optional-browser-smoke-check).
Na Windows spusťte testovací aplikaci s diagnostickým portem pouze pro její proces:

```powershell
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = '--remote-debugging-port=9225 --remote-debugging-address=127.0.0.1'
$env:WEBVIEW2_USER_DATA_FOLDER = Join-Path $PWD "output\playwright\native-test-$([guid]::NewGuid().ToString('N'))"
$studioProcess = Start-Process -FilePath "$env:LOCALAPPDATA\FrameMind Studio\framemind-studio.exe" -WindowStyle Hidden -PassThru
Remove-Item Env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS
Remove-Item Env:WEBVIEW2_USER_DATA_FOLDER
$env:DESKTOP_SMOKE_CDP = 'http://127.0.0.1:9225'
$env:DESKTOP_SMOKE_PID = "$($studioProcess.Id)"
node scripts/culling-local-smoke.mjs
node scripts/culling-inspection-smoke.mjs
node scripts/desktop-export-smoke.mjs
```

Před tím zavřete ostatní okna Studia: aplikace používá jedinou instanci.
Testujte výhradně s odděleným profilem; ověřte, že proces WebView2 používá zadanou
složku. Culling, porovnání detailu a export spusťte každý s novým prázdným testovacím profilem,
protože pracovní sada se nově obnovuje po restartu. Testy nahrají syntetické snímky. Helper pro
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

Ověření 2026-10-15: sestaven a nainstalován balíček 0.1.2. Nativní culling prošel
měřením, ručními volbami, přepočtem profilu, potvrzením odebrání a zastavením;
0 externích požadavků a 0 chyb stránky. Nativní export ověřil zrušení dialogu,
JPEG, PNG 128 × 96, dva soubory dávky a nezměněné testovací originály.
Testy použily oddělené profily WebView2. Šest souborů původního uživatelského
úložiště zůstalo po aktualizaci beze změny. Finální oprava sloganů se sestavuje
v GitHub Actions; obsah nainstalovaného EXE se porovnává s distribuovaným artefaktem.
Tauri do NSIS payloadu mění pouze značku balíčku UNK → NSS; porovnání tuto
zdokumentovanou změnu zohledňuje a vyžaduje shodu všech ostatních bajtů.

Ověření 2026-10-20: syntetické porovnání detailu enginu `local-1.3` prošlo
v oddělené QA aplikaci WebView2 při skutečném DPR 1,25. Ověřeny byly až čtyři
snímky, limit výběru, propojené i samostatné výřezy, 1:1/2:1 a ruční volba
zachovaná po opakované analýze; 0 externích požadavků a 0 chyb stránky.
QA aplikace měla vlastní identifikátor i profil a nezasáhla běžnou pracovní sadu.

Následná uživatelem vyžádaná aktualizace na 0.1.3 zachovala všech 12 existujících
souborů IndexedDB/localStorage před prvním spuštěním. Instalované EXE se shodovalo
s payloadem ověřeného instalátoru a běžné okno se otevřelo. Kontrolní součet
instalátoru je `17d68a834cf39d3209915d3c704486f5c3d977b93b0344cf787b66b074637d5c`.
Nativní export nebyl pro 0.1.3 znovu ověřován; výše uvedený test exportu patří 0.1.2.

Ověření 2026-10-21: aktuální zdrojový kód s enginem `local-1.4` prošel 147 testy,
TypeScriptem, oběma frontendovými buildy a sestavením Windows instalátoru.
Kontrola celých originálů v odděleném profilu nativního WebView2 při DPR 1,25
ověřila původní bajty, celý snímek bez ořezu, zoom, tažení, porovnání čtyř
fotografií a ruční volby po opakovaném běhu. Culling měl 0 externích požadavků
a 0 chyb stránky. Místní aktualizace zachovala všech 341 tehdy existujících
souborů IndexedDB/localStorage; instalované EXE se shodovalo s NSIS payloadem.
Metadata místního balíčku zůstala 0.1.3; nejde o změnu veřejného vydání 0.1.3.
Rozsah a omezení opravy: [aktuální nezveřejněné změny](releases/unreleased.md).

Podrobnosti měření, kalibrace a jejich mezí: [audit cullingu](culling-local-audit.md).
