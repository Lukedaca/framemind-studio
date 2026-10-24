# Lokální culling ve Studiu

Výběr fotografií běží ve vašem počítači bez AI, modelů, API klíče a síťových
volání. Engine `local-1.6` navrhuje ponechat, zkontrolovat nebo vyřadit podle
technických měření. Konečné rozhodnutí zůstává fotografovi.
Tento návod popisuje vývojové vydání [0.1.4](releases/0.1.4.md).

## Výběr a prohlížení originálů

1. Importujte fotografie a otevřete **Výběr**. Zvolte technický profil ručně
   a spusťte lokální culling. Profil mění váhy metrik; nerozpoznává obsah fotografie.
2. Prohlížejte celé záběry, skóre a důvody návrhů. **K** znamená ponechat,
   **R** zkontrolovat a **X** vyřadit. Ruční volby přežijí další běh i změnu profilu.
3. Kliknutím na fotografii nebo tlačítkem **Otevřít celou fotografii** otevřete celý
   původní obrazový soubor. Náhled jej nepřevádí ani znovu nekomprimuje.
   Pro souběžnou kontrolu označte tlačítkem **+** až čtyři fotografie a zvolte
   **Porovnat výběr**. Porovnání funguje i mezi snímky mimo automaticky nalezenou sérii.
4. Výchozí pohled **Celý snímek** přizpůsobí fotografii oknu bez ořezu. Klikněte
   do snímku pro zobrazení na 100 %, použijte kolečko nebo tlačítka 100 / 200 / 400 %.
   Přiblíženou fotografii posunete tažením nebo šipkami; každou fotografii samostatně.
5. **0** vrátí celý záběr, **1** nastaví 100 % a **Esc** náhled zavře.
   Kliknutím vyberete aktivní snímek, ke kterému se vztahují **K / R / X**.

**100 %** zobrazí jeden pixel snímku na jeden fyzický pixel displeje a zohledňuje
škálování Windows. Vyšší zvětšení nedoplňuje nový obrazový detail. Prohlížení
nemění automatický verdikt ani původní soubor. Výjimkou je výslovné označení
hlavního motivu popsané níže.

## Označení hlavního motivu

V otevřené fotografii nebo porovnání zapněte **Označit hlavní motiv**, vyberte
velikost 128 / 256 / 384 px a klikněte na důležité místo. Zelený rámeček označuje
oblast, jejíž ostrost se změří v původním rozlišení a použije ve skóre při další
analýze. Označení se ukládá s fotografií a lze je vymazat. Ruční K / R / X mají
stále přednost. Měkký nebo nejistý motiv vede ke kontrole, nikoli k relativnímu
vyřazení vůči ostrému pozadí. Jde o vaše určení místa, ne o detekci subjektu.

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

Odebrání vyřazených vyžaduje potvrzení a odebere je jen z pracovní sady Studia.
Původní soubory na disku zůstávají zachované.

## Co měření znamená

Automatika měří náhled do 768 px a u větších snímků až devět pevných výřezů
384 × 384 px bez zmenšení. Podle struktury náhledu doplní nejvýše čtyři další
výřezy mimo již vzorkované oblasti. Každý se ověří v původním rozlišení.
Skóre a ostřejší reference série dál používají pevnou mřížku. Doplňkové výřezy
mohou zablokovat návrh na vyřazení; při měkké mřížce zůstane výsledek ke kontrole
s vysvětlením rozdílů mezi oblastmi. Ostré pozadí samo neprokazuje zaostření subjektu.
Malý ostrý subjekt může i toto omezené měření minout. Důležité místo si proto
lze zkontrolovat v celé původní fotografii.
Výrazně měkké původní detaily lze navrhnout k vyřazení i tehdy, když zmenšení
rozdíl zakryje. V ověřené sérii takový návrh vyžaduje srovnatelné rozměry zdrojů,
dostatek měření, nízký šum, samostatně slabý detail kandidáta a ostrou referenci.
Ostrý naměřený výřez kandidáta takové relativní vyřazení blokuje.

Skóre 0–100 není pravděpodobnost dobré fotografie. Culling nerozpoznává oči,
výraz, rozhodující moment ani zaostření na konkrétní subjekt. Jedna kalibrační
sada 114 sportovních JPEGů nestačí pro závěry napříč žánry a fotoaparáty.
Výběr jednoho fotografa se nepřenáší do univerzálních pravidel vkusu ani vah
enginu. Neexportovaný snímek není automaticky vadný; může jít o další použitelný
moment nebo omezení délky galerie. Ruční K/R/X mají přednost před automatikou.

U RAW se měří a prohlíží **vložený JPEG náhled**, nikoli senzorová data.
Kontrola detailu používá obrazový zdroj z importu, nikoli pozdější úpravy nebo retuš.
Celé Studio není plně offline: modely retuše a písma se stahují a dvě volitelné
funkce editoru používají Gemini. [Připojení a data](../README.md#připojení-a-data).

## Ověření enginu local-1.5

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
