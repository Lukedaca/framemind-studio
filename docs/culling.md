# Lokální culling ve Studiu

Výběr fotografií běží ve vašem počítači bez AI, modelů, API klíče a síťových
volání. Engine `local-1.4` navrhuje ponechat, zkontrolovat nebo vyřadit podle
technických měření. Konečné rozhodnutí zůstává fotografovi.
Tento návod popisuje aktuální `main`; [opravy po 0.1.3](releases/unreleased.md)
zatím nejsou v instalátoru veřejného vydání 0.1.3.

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
nemění automatický verdikt ani původní soubor.

## Opakovaný běh

Běh lze zastavit. Při dalším spuštění ve stejné relaci se hotová měření totožných
vstupních souborů použijí znovu; skóre a série se přepočítají. **Přeměřit vše**
vynutí nové měření. Po restartu aplikace se soubory měří znovu. Cache není
dlouhodobé úložiště a shodný název souboru neznamená totožný obsah.

Odebrání vyřazených vyžaduje potvrzení a odebere je jen z pracovní sady Studia.
Původní soubory na disku zůstávají zachované.

## Co měření znamená

Automatika měří náhled do 768 px a u větších snímků až devět pevných výřezů
384 × 384 px bez zmenšení. Malý ostrý subjekt mezi vzorkovanými místy může minout.
Proto si lze důležité místo zkontrolovat v celé původní fotografii.
Výrazně měkké původní detaily lze navrhnout k vyřazení i tehdy, když zmenšení
rozdíl zakryje. V ověřené sérii takový návrh vyžaduje srovnatelné rozměry zdrojů,
dostatek měření, nízký šum, samostatně slabý detail kandidáta a ostrou referenci.
Ostrý naměřený výřez kandidáta takové relativní vyřazení blokuje.

Skóre 0–100 není pravděpodobnost dobré fotografie. Culling nerozpoznává oči,
výraz, rozhodující moment ani zaostření na konkrétní subjekt. Jedna kalibrační
sada 114 sportovních JPEGů nestačí pro závěry napříč žánry a fotoaparáty.

U RAW se měří a prohlíží **vložený JPEG náhled**, nikoli senzorová data.
Kontrola detailu používá obrazový zdroj z importu, nikoli pozdější úpravy nebo retuš.
Celé Studio není plně offline: modely retuše a písma se stahují a dvě volitelné
funkce editoru používají Gemini. [Připojení a data](../README.md#připojení-a-data).

## Ověření místní opravy 21. 10. 2026

Prošlo 147 testů, kontrola TypeScriptu, webový i desktopový build. Náhled byl
ověřen v Chromiu i nativním WebView2: stejné bajty jako importovaný originál,
celý snímek bez ořezu, zoom, posun, porovnání čtyř fotografií a ruční volby po
opakovaném běhu. Během cullingu nebyly síťové požadavky ani chyby stránky.

Stejná sada 114 sportovních JPEGů měla před opravou 94 ponechat / 17 kontrola /
3 vyřadit, po opravě 94 / 13 / 7. Všechna SHA-256 původních souborů zůstala
shodná. Jde o jednu kalibrační sadu; tato čísla nevyjadřují obecnou přesnost.

[Předchozí vydání 0.1.3](releases/0.1.3.md) · [Přehled dokumentace](README.md)
