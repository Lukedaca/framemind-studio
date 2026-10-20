# Lokální culling ve Studiu 0.1.3

Výběr fotografií běží ve vašem počítači bez AI, modelů, API klíče a síťových
volání. Engine `local-1.3` navrhuje ponechat, zkontrolovat nebo vyřadit podle
technických měření. Konečné rozhodnutí zůstává fotografovi.

## Výběr a kontrola detailu

1. Importujte fotografie a otevřete **Výběr**. Zvolte technický profil ručně
   a spusťte lokální culling. Profil mění váhy metrik; nerozpoznává obsah fotografie.
2. Prohlížejte celé záběry, skóre a důvody návrhů. **K** znamená ponechat,
   **R** zkontrolovat a **X** vyřadit. Ruční volby přežijí další běh i změnu profilu.
3. Dvojklikem na fotografii nebo tlačítkem **Otevřít detail 1:1** otevřete detail.
   Pro souběžnou kontrolu označte tlačítkem **+** až čtyři fotografie a zvolte
   **Porovnat výběr**. Porovnání funguje i mezi snímky mimo automaticky nalezenou sérii.
4. Klikněte na místo v celém záběru. Pod ním se zobrazí výřez až **384 × 384 px**
   z původního obrazového zdroje. U malého zdroje je výřez menší; u okraje se
   posune dovnitř snímku. Karty v přehledu ani výřezy nepřepisují originál.
5. Volba **Společná poloha výřezu** propojí relativní místo ve všech záběrech.
   Vypněte ji, pokud je subjekt v každém snímku jinde. Šipky posouvají výřez,
   **Na střed** jej vystředí a **Esc** detail zavře. Kliknutím vyberete aktivní
   snímek, ke kterému se vztahují klávesy **K / R / X**.

**1:1** zobrazí jeden pixel snímku na jeden fyzický pixel displeje a zohledňuje
škálování Windows. **2:1** výřez zvětší na dvojnásobek. Vyšší zvětšení nedoplňuje
nový obrazový detail. Měření vybrané oblasti slouží ruční kontrole; její poloha
nemění automatický verdikt a neukládá se po zavření detailu.

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
Proto si lze důležité místo zkontrolovat ručně. V ověřené sérii musí pro relativní
vyřazení kvůli slabšímu detailu souhlasit původní výřezy i zmenšený náhled.

Skóre 0–100 není pravděpodobnost dobré fotografie. Culling nerozpoznává oči,
výraz, rozhodující moment ani zaostření na konkrétní subjekt. Jedna kalibrační
sada 114 sportovních JPEGů nestačí pro závěry napříč žánry a fotoaparáty.

U RAW se měří a prohlíží **vložený JPEG náhled**, nikoli senzorová data.
Kontrola detailu používá obrazový zdroj z importu, nikoli pozdější úpravy nebo retuš.
Celé Studio není plně offline: modely retuše a písma se stahují a dvě volitelné
funkce editoru používají Gemini. [Připojení a data](../README.md#připojení-a-data).

[Změny a ověření 0.1.3](releases/0.1.3.md) · [Přehled dokumentace](README.md)
