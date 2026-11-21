# Lokální culling ve Studiu

Výběr fotografií běží ve vašem počítači bez API klíče a odesílání fotografií.
Engine `local-2.0` používá přibalený lokální model U²-NetP pro nalezení výrazných
objektů, měření rozmazání hran v pixelech a vlastní technická měření pro automatické
označení ponechat, zkontrolovat nebo vyřadit. Ruční rozhodnutí fotografa mají přednost.
Tento návod popisuje vydání [0.1.7](releases/0.1.7.md) a navazující změny v aktuálních zdrojích ([unreleased](releases/unreleased.md)).

## Výběr a prohlížení originálů

1. Importujte fotografie a otevřete **Výběr**. Spusťte lokální culling;
   výchozí automatika nepotřebuje ruční označování motivů. Volitelný technický profil
   mění váhy metrik, nikoli výstup modelu.
2. Po měření se otevře **Fotka po fotce**. **K** znamená ponechat,
   **R** zkontrolovat a **X** vyřadit. Volba se uloží a posune na další snímek;
   opakovaná stejná volba ji neruší. Šipky procházejí aktivní frontu, kterou lze vpravo
   filtrovat (**Vše / Kontrola / Vyřadit / Ponechat / Nerozhodnuté**).
   Klávesy: **Z** (nebo klik do snímku) otevře **Detail 1:1** rovnou na motiv/bod ostrosti,
   **M** přepíná mapu ostrosti, **C** porovná aktuální sérii vedle sebe, **Backspace** vrátí krok zpět,
   **Ctrl+Z** vrátí změnu a **?** ukáže přehled zkratek. Nad fotkou se zobrazují čitelná EXIF data
   (čas, clona, ISO, ohnisko). Tlačítko **Do editoru** dovolí pokračovat kdykoli; poslední rozhodnutí
   celé sady otevře shrnutí a **Projít znovu** zachová ruční volby.
3. **Odevzdám jako** v hlavičce nastavuje 100 %, tisk A4 nebo web a **Přísnost**
   (**Auto / Opatrný / Vyvážený / Přísný**) řídí prahy vyřazování — obojí okamžitě přepočítá
   návrhy bez nového měření. Režim **Auto** sám zvolí přísnost podle skutečné ostrosti, šumu a sérií
   dané sady (bez umělé kvóty vyřazených). **Kde je ostro** ukáže mapu, pokud je optické měření dostupné.
   **Detail 1:1** otevře celý originál rovnou na 100 %.
4. Přepínač **Celá sada** otevře kontaktní arch (čisté fotografie s patičkou metadat pod obrazem),
   profil, záměr a sbalitelné technické detaily. Rozbalená série se otevírá nahoře v zorném poli.
   Kliknutím na fotografii nebo tlačítkem **Otevřít celou fotografii** otevřete celý
   původní obrazový soubor. Náhled jej nepřevádí ani znovu nekomprimuje.
   Pro souběžnou kontrolu označte tlačítkem **+** až čtyři fotografie a zvolte
   **Porovnat výběr**. Porovnání funguje i mezi snímky mimo automaticky nalezenou sérii.
5. Při otevření z mřížky výchozí pohled **Celý snímek** přizpůsobí fotografii oknu bez ořezu. Klikněte
   do snímku pro zobrazení na 100 %, použijte kolečko nebo tlačítka 100 / 200 / 400 %.
   Přiblíženou fotografii posunete tažením nebo šipkami; každou fotografii samostatně.
6. **0** vrátí celý záběr, **1** nastaví 100 % a **Esc** náhled zavře.
   Kliknutím vyberete aktivní snímek, ke kterému se vztahují **K / R / X**.

**100 %** zobrazí jeden pixel snímku na jeden fyzický pixel displeje a zohledňuje
škálování Windows. Vyšší zvětšení nedoplňuje nový obrazový detail. Prohlížení
nemění automatický verdikt ani původní soubor. Výjimkou je výslovné označení
hlavního motivu popsané níže.

## Označení hlavního motivu

V otevřené fotografii nebo porovnání zapněte **Označit hlavní motiv**, vyberte
velikost 128 / 256 / 384 px a klikněte na důležité místo. Zelený rámeček označuje
oblast, jejíž ostrost se změří v původním rozlišení a použije ve skóre.
Přepínačem **Nahrazovat oblasti / Přidávat oblasti** lze označit až čtyři
důležité detaily, například několik tváří, části produktu nebo místa v krajině.
Každou oblast lze jednotlivě odebrat; **Zrušit oblast motivu** odstraní všechny.
Číslo u oblasti je indikátor detailu 0–100, nikoli pravděpodobnost.

Při označení více oblastí určuje složku ostrosti nejslabší vybraný detail.
Ostrá jiná oblast či pozadí jej nezachrání. Slabé nebo nejisté měření vede
v běžném režimu ke kontrole. Označení se ukládá s fotografií a přežije opakování
i změnu technického profilu. Ruční K / R / X mají stále přednost.
Jde o vaše určení místa, ne o automatické rozpoznání subjektu.

V porovnání lze **Použít oblasti na porovnávané**: převezmou se stejné
normalizované polohy z aktivního snímku, nikoli automaticky sledovaný motiv.
Zkontrolujte, že rámečky odpovídají tomu, co chcete porovnávat. Regionální
pořadí série se použije jen při shodných rozměrech zdroje i výřezů, polohách,
počtu a ověřené obrazové podobnosti všech porovnávaných oblastí.
Pořadí potom vychází z označených detailů před celkovým skóre. Relativní návrh
vyřazení navíc vyžaduje samostatně silné známky rozmazání kandidáta a ostrou,
málo zašuměnou referenci. Samotný rozdíl dvou skóre nestačí.

## Fotografický záměr

**Záměr celé sady** přepočítá všechny hotové výsledky. V otevřené fotografii
lze nastavit **Záměr snímku** samostatně. Při různých nastaveních panel ukazuje
**Smíšené záměry**. Nastavení jednotlivých snímků se zachovávají při běžném
opakování i změně technického profilu.

- **Běžný technický výběr** zachovává technické kontroly a konzervativní návrhy.
- **Důraz na označené detaily** dovolí navrhnout vyřazení při silných měřitelných
  známkách rozmazání některé označené oblasti. Nízká textura nebo samotný šum
  takový návrh neopravňují. Bez označených oblastí platí běžné kontroly.
- **Záměrný pohyb** nezahrnuje ostrost a směrovou stopu do skóre ani nevyřazuje
  kvůli neostrosti. Kontrola expozice a ověřených totožných kopií zůstává.
- **Autorská volnost** a **Sada pro skládání** vypínají automatické vyřazování
  i automatické seskupování. Technická měření zůstávají dostupná; ruční volby
  fungují. Pro HDR, panorama nebo focus stacking je potřeba zvolit ochranu
  výslovně, jejich typ se automaticky nerozpoznává.

Série s různými záměry se automaticky nespojují. Důvod vyřazení rozlišuje
**Technickou vadu** od **Ověřené totožné kopie**. Tyto režimy jsou společné
pro fotografické žánry; nejde o univerzálně ověřené estetické hodnocení.

## Duplicity a nejistý detail

Podobný malý náhled nestačí pro automatický návrh nadbytečné kopie. JPEG/PNG
vyžadují shodu všech dekódovaných pixelů zdroje, RAW shodu SHA-256 původních
souborů. Pokud porovnání nemá dostatečný důkaz nebo přesáhne limit 64 megapixelů
pro dekódované porovnání, zůstane ke kontrole. RAW data se tím nevyvolávají.
Náhled a označený motiv navíc používají detail ve dvou měřítkách s korekcí šumu;
rozpor přidá důvod ke kontrole, nikdy sám nezpůsobí vyřazení.

## Opakovaný běh

Běh lze zastavit. Při dalším spuštění ve stejné relaci se hotová měření totožných
vstupních souborů použijí znovu; skóre a série se přepočítají. **Přeměřit vše**
vynutí nové měření. Po restartu aplikace se soubory měří znovu. Cache není
dlouhodobé úložiště a shodný název souboru neznamená totožný obsah.

**Použít výběr a otevřít editor** po jednom potvrzení odebere vyřazené z pracovní
sady a pokračuje do úprav. Zrušení potvrzení zachová celou sadu; **Zpět** v editoru
obnoví snímky včetně skóre, verdiktů a vysvětlení. Původní soubory na disku zůstávají zachované.

## Automatické oblasti bez označování

Přibalený model U²-NetP (4,57 MB, Apache-2.0) vytvoří mapu výrazných objektů
z obrazu 320 × 320 px. Jde o obecnou salienci, nikoli rozpoznání fotografického
žánru nebo skutečného hlavního motivu. V až čtyřech oblastech se změří nejvýše
12 výřezů 128 × 128 px původního obrazu. Měření je deterministické a probíhá
postupně v lokálním workeru s jedním WASM vláknem. Model i jeho runtime jsou
součástí balíčku; žádný model se za běhu nestahuje a fotografie se neodesílají.

Automatické vyřazení kvůli rozmazání potřebuje alespoň tři informativní výřezy,
nízký šum a slabý detail ve všech vzorcích. Jediný dostatečně ostrý vzorek ho
zablokuje. Neplatná nebo nedostupná inference vyžaduje kontrolu; pokud mapa
neobsahuje použitelnou oblast, použijí se původní celkové metriky. Ručně označené
oblasti mají přednost. Ověřené totožné kopie lze také automaticky vyřadit.

Model může vybrat jiný objekt či část těla a minout malou ostrou tvář. Nerozpoznává
oči, výraz, rozhodující okamžik ani autorský záměr. Pro záměrný pohyb, uměleckou
volnost a skládání použijte odpovídající záměr. Automatické X není smazání souboru.

## Co měření znamená

Automatika měří náhled do 768 px a u větších snímků až devět pevných výřezů
384 × 384 px bez zmenšení. Podle struktury náhledu doplní nejvýše čtyři další
výřezy mimo již vzorkované oblasti. Každý se ověří v původním rozlišení.
Pokud nejsou dostupné ruční ani automatické oblasti, používají skóre a reference série pevnou mřížku. Doplňkové výřezy
mohou zablokovat návrh na vyřazení; při měkké mřížce zůstane výsledek ke kontrole
s vysvětlením rozdílů mezi oblastmi. Ostré pozadí samo neprokazuje zaostření subjektu.
Malý ostrý subjekt může i toto omezené měření minout. Důležité místo si proto
lze zkontrolovat v celé původní fotografii.
Výrazně měkké původní detaily lze navrhnout k vyřazení i tehdy, když zmenšení
rozdíl zakryje. V ověřené sérii takový návrh vyžaduje srovnatelné rozměry zdrojů,
dostatek měření, nízký šum, samostatně slabý detail kandidáta a ostrou referenci.
Ostrý naměřený výřez kandidáta takové relativní vyřazení blokuje.

Skóre 0–100 není pravděpodobnost dobré fotografie. Culling nerozpoznává oči,
výraz, rozhodující moment ani správnost zvoleného subjektu. Jedna kalibrační
sada 114 sportovních JPEGů nestačí pro závěry napříč žánry a fotoaparáty.
Výběr jednoho fotografa se nepřenáší do univerzálních pravidel vkusu ani vah
enginu. Neexportovaný snímek není automaticky vadný; může jít o další použitelný
moment nebo omezení délky galerie. Ruční K/R/X mají přednost před automatikou.

U RAW se měří a prohlíží **vložený JPEG náhled**, nikoli senzorová data.
Kontrola detailu používá obrazový zdroj z importu, nikoli pozdější úpravy nebo retuš.
Celé Studio není plně offline: modely retuše a písma se stahují a dvě volitelné
funkce editoru používají Gemini. [Připojení a data](../README.md#připojení-a-data).

## Změny v aktuálních zdrojích — 21. listopadu 2026: automatická přísnost a přesnější vyřazování

Dosavadní pravidla `local-2.0` posílala většinu neostrých nebo pohybem mázlých snímků
pouze do **Kontroly** kvůli příliš přísným vetům (jeden ostrý bod z 96–120 dlaždic, nízký
strop šumu pro vyšší ISO, nevyužité směrové biny pohybu).

- **Přísnost (`Auto / Opatrný / Vyvážený / Přísný`)**: výchozí **Auto** deterministicky
  vyhodnotí optickou ostrost, šum a série celé sady (bez pevné kvóty vyřazení) — pro ostrou
  denní sérii zvolí **Přísný**, pro šero/vysoké ISO nebo malou sadu **Opatrný**, pro smíšené
  podmínky **Vyvážený**. Ruční přepnutí přepočítá verdikty okamžitě bez nového měření.
- **Směrový pohybový máz**: `opticalMotionBlur` vyhodnocuje 4 směrové biny (`subjectDirection`),
  takže horizontální/vertikální švih už nemaskují hrany rovnoběžné se směrem pohybu. Záměr
  *Záměrný pohyb*, *Autorská volnost* a *Sada pro skládání* zůstávají chráněné.
- **Back-focus a optické porovnání sérií**: ve **Vyváženém** a **Přísném** režimu lze vyřadit
  silně mimo zaostřený objekt i vedle ostrého pozadí a opticky výrazně měkčí varianty v ověřené
  sérii vedle ostrého reprezentanta. Strop šumu pro vyhodnocení neostrosti zohledňuje běžné vyšší
  ISO (extrémní šum zůstává v kontrole).
- **Fotografické UX**: filtr fronty ve Focus režimu, porovnání série (`C`), 1:1 lupa rovnou na
  motiv (`Z` nebo klik), EXIF proužek, kontaktní arch bez textů přes obraz a klidnější temná komora.

## Změny local-2.0 — 14. listopadu 2026: optická ostrost

Dosavadní ostrost vycházela z energie Laplaceova operátoru. Ta neodliší hladký
povrch (dres, pleť, obloha) od rozmazaného: na kalibrační sadě poslala ke kontrole
desítky ostrých snímků a jeden zjevně rozmazaný ponechala.

Nový modul `utils/cullingOptics.ts` měří **poloměr rozmazání hran v pixelech**.
Přes hranu má gradient tvar Gaussovy křivky, jejíž šířka je rozmazání; šířka se čte
z tvaru profilu (vážená parabola přes logaritmus pěti vzorků), takže kontrast hrany
ani množství textury výsledek nemění. Počítají se jen rovné, osamocené hrany:
dva body podél hrany musí nést tutéž hranu a protilehlá hrana nesmí ležet blíž
než šest kroků. Tenké čáry, tečky potisku a šum by jinak vycházely ostřejší,
než skutečně jsou. Silné rozmazání se dočte ze zprůměrovaných pixelů (2× a 4×);
zprůměrované pixely ale nikdy nesmí ohlásit ostrost.

Měří se pravidelná mřížka 12 dlaždic 128 × 128 px přes celý záběr a až 24 hustších
dlaždic uvnitř objektu nalezeného modelem. Objekt i pozadí zastupuje druhá
nejostřejší dlaždice, aby jedna náhodná hrana ani jedna rozmazaná končetina
nerozhodovaly. Ploché dlaždice (obloha, stěna) se přeskočí.

**Výstup 100 % / Tisk A4 / Web** určuje, pro jakou velikost se ostrost posuzuje
(originál, 3600 px, 2048 px na delší straně). Stejný snímek může být na webu ostrý
a ve 100 % vadný. Přepnutí jen přepočítá verdikty, nepřeměřuje fotografie.

Pravidla (bez ručně označené oblasti; ta má vždy přednost):

- Objekt ostrý pro zvolený výstup (≤ 1,0 px): důvod „Hrany objektu jsou ostré“,
  ruší rizika z energie textury a **blokuje** návrhy vyřazení z texturových pravidel.
- Objekt měkký, jinde ostré místo: kontrola „Ostrost leží jinde než na nalezeném
  objektu“. Nikdy vyřazení: model nemusí najít zamýšlený subjekt.
- Objekt měkký a nic ostrého: kontrola.
- Vyřazení jen tehdy, když je rozmazané vše: i druhá nejostřejší a zároveň
  nejostřejší jednotlivá dlaždice celého záběru (> 1,4 px, resp. > 1,0 px).
- Ve skóre nahrazuje změřené rozmazání ostrost z textury; u „ostrost jinde“ se
  použije průměr objektu a nejostřejšího místa.

Detail snímku ukazuje mapu rozmazání přes náhled (zelená ostré, oranžová měkké,
červená rozmazané, bílý okraj = dlaždice objektu) a hodnoty v pixelech výstupu,
včetně údaje „Ostré do“ (největší delší strana, při které snímek ještě působí ostře).

Analýza běží na strojích se šesti a více vlákny ve dvou souběžných workerech
(každý drží jeden dekódovaný originál, u 21 MP asi 85 MB).

### Ověření

- Prahy jsou kalibrované na 24 fotografiích s vizuálně posouzenými výřezy 1:1
  (Canon 5616 × 3744, sport): ostré objekty 0–0,9 px, měkké od 1,1 px.
  Jedna sada a jeden fotoaparát nestačí pro obecné závěry.
- Syntetické testy: známé Gaussovo rozmazání 0 / 1 / 1,5 px se změří
  v tolerancích, výsledek nezávisí na kontrastu ani hustotě hran, pohyb je
  vidět v orientaci.
- Kalibrační sada 114 JPEGů: `local-1.9` 81 ponechat / 28 kontrola / 5 vyřadit,
  `local-2.0` 92 / 18 / 4. Z kontroly odešlo 21 ostrých snímků (např. 9888, 9891,
  9947, 9951, 9953, 9955), ke kontrole přibyl rozmazaný 9945, který starší
  engine ponechal. Vyřazení 9913, 9922, 9933 a 9962 zůstala; 9917 je změřeně
  ostrý (0,85 px), proto už vyřazený není. Při výstupu Web: 105 / 9 / 0.
- Tvrdý test falešného vyřazení: 18 publikovaných snímků ze zápasu Sigma –
  Mladá Boleslav = 18 ponechat, 0 vyřadit. Jsou to oříznuté exporty s doostřením
  z Digital Photo Professional; doostření zužuje hrany, proto u nich měření
  často ukazuje 0 px.
- Originály beze změny (SHA-256), žádné externí požadavky, žádné chyby stránky.
- Čas na 114 fotek, i5-11400H: auditní skript s jedním workerem
  `local-1.9` 215 s, `local-2.0` 265 s; běh v rozhraní `local-2.0` se dvěma
  workery 166 s (1,46 s na snímek). Optické měření samo trvá zhruba 0,2–0,4 s
  na snímek.

Měření neví, který objekt je pro fotografa důležitý, nerozezná záměrné
rozostření od chyby (pro to slouží záměr Pohyb / Kreativní) a u silně
doostřených exportů nedokáže rozlišit ostré od doostřeného měkkého.

## Změny local-1.9 — 7. listopadu 2026

Malý motiv na bílé či černé ploše už nestačí k návrhu „prázdný snímek“.
Celý náhled musí být oříznutý do světel nebo stínů; měřitelná struktura
v původních výřezech tento návrh blokuje. Třináct nových regresních případů
zahrnuje výchozí nastavení i všechny technické profily, jediný neklipovaný
pixel a detail ztracený při zmenšení. Jde o technickou ochranu, nikoli
rozpoznání fotografického záměru.

Měření šumu používá předem přidělené pole a nativní číselné řazení.
Model používá standardní WASM runtime s jedním vláknem. Na 12 shodných JPEGech
se zachovaly všechny metriky, skóre a verdikty. Medián měření po prvním
snímku klesl z 2,025 na 1,854 s na jednom místním počítači. Není to garance
rychlosti na jiném hardwaru. Sestavení velké sady zatím stále trvá dlouho;
samotná optimalizace metrik neřeší cenu inference modelu.

Seznam členů série se připravuje jednou pro celou sadu. Pohyb klávesami
posouvá aktivní kartu do viditelné části mřížky. Podrobné výsledky a omezení:
[měření výkonu](culling-performance-2026-11-07.md).

## Ověření local-1.8 — 1. listopadu 2026

Prošly kontroly TypeScriptu, 234 testů v 29 souborech, webový/PWA i desktopový
frontend a sestavení Windows EXE a NSIS instalátoru 0.1.7. Automatický výběr
prošel v produkčním webovém buildu i konečném Windows EXE s ověřeným odděleným
profilem: měření objektů, návrhy podle rozmazání a totožných kopií, zrušení i
přijetí systémového potvrzení, editor a obnovení přes Zpět včetně výsledků.
Kontrolní součty testovacích originálů zůstaly stejné. Externí požadavky cullingu
a chyby stránky byly nulové. U²-NetP se spouští v jednom WASM vlákně uvnitř workeru;
tím se řeší uváznutí vnořených vláken na zabaleném originu WebView2.

Uložený běh nové automatiky na 251 RAW náhledech našel použitelné automatické
oblasti u 246 snímků, bez nedostupného modelu: 196 ponechat, 40 kontrola,
15 vyřadit. Originální soubory měly stejné kontrolní součty. Jde o jednu
neoznačkovanou sadu, nikoli obecnou přesnost nebo shodu s výběrem fotografa.
Aktuální stav distribuce a rozsah ověření:
[vydání 0.1.7](releases/0.1.7.md). Rozhraní:
[aktuální snímky](../demo-screenshots/README.md).

## Historické ověření enginu local-1.5

Prošlo 155 testů, TypeScript a kontrola rozhraní v Chromiu. Syntetický případ
ověřuje ostrý detail mezi původními výřezy, zachování návrhu u plošně měkkého
zdroje, stejné skóre při přidání doplňkového detailu a bezpečné reference série.
Ruční volby, přepočet profilu, zastavení a potvrzené odebrání ze sady prošly
kontrolou přes rozhraní.
Stejná kontrola prošla také v nainstalované aplikaci WebView2 s odděleným
profilem. Webový i desktopový frontend a Windows NSIS balíček byly sestaveny.
Místní aktualizace zachovala kontrolní součty všech 341 existujících souborů
IndexedDB/localStorage; nainstalované EXE odpovídalo obsahu ověřeného instalátoru.
Metadata balíčku zůstávají 0.1.3, veřejné vydání nebylo změněno.

Na dvou místních sportovních RAW sadách (146 a 81 snímků) se porovnávaly stejné
vložené JPEG náhledy s 39 odpovídajícími snímky ve fotografově finálním exportu.
Před opravou měly tři z těchto 39 snímků návrh vyřadit, po opravě žádný.
Počet návrhů ponechat se nezměnil; rozdíly se přesunuly ke kontrole.
Na původní sadě 114 JPEGů se návrhy změnily z 94 / 13 / 7 na 94 / 19 / 1
(ponechat / kontrola / vyřadit). Všechny SHA-256 původních 341 souborů zůstaly
shodné; síťové požadavky cullingu i chyby stránky byly nulové.

Jde o tři sportovní sady a výběr jednoho fotografa. Exportované snímky nejsou
univerzální kladné štítky a neexportované snímky nejsou záporné štítky. Tato čísla
proto nevyjadřují obecnou přesnost ani rozpoznání vhodného okamžiku.

## Předchozí oprava local-1.4

Prošlo 147 testů, kontrola TypeScriptu, webový i desktopový build. Náhled byl
ověřen v Chromiu i nativním WebView2: stejné bajty jako importovaný originál,
celý snímek bez ořezu, zoom, posun, porovnání čtyř fotografií a ruční volby po
opakovaném běhu. Během cullingu nebyly síťové požadavky ani chyby stránky.

Stejná sada 114 sportovních JPEGů měla před opravou 94 ponechat / 17 kontrola /
3 vyřadit, po opravě 94 / 13 / 7. Všechna SHA-256 původních souborů zůstala
shodná. Jde o jednu kalibrační sadu; tato čísla nevyjadřují obecnou přesnost.

[Předchozí vydání 0.1.3](releases/0.1.3.md) · [Přehled dokumentace](README.md)
