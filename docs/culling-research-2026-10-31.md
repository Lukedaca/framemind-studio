# Výzkum pro další vývoj cullingu

Stav rešerše: 31. října 2026. Účel: inspirace pro vlastní návrh FrameMind Studia.
Podkladem jsou publikované články, preprinty a oficiální stránky autorů.
Tato rešerše nemění engine, neintegruje cizí implementace a nezavádí modely do aplikace.

## Co z výzkumu vyplývá pro Studio

Moje technická interpretace: culling potřebuje oddělit technickou použitelnost,
ostrost důležitého motivu, pořadí variant v sérii a hodnotu zachyceného okamžiku.
Jedno globální skóre tyto úlohy spolehlivě nezastoupí. Vyšší počet návrhů vyřazení
sám o sobě není měřítkem zlepšení.

V lokálním auditu 251 CR2 se podařilo přesně reprodukovat 152 ponechat,
96 kontrola a 3 vyřadit. U 88 snímků engine hlásil slabé detaily při nativním
vzorkování a u 83 rozdíly mezi oblastmi; množiny se překrývají. To jsou výstupy
současných heuristik, nikoli fotografem potvrzené počty vadných snímků.
Soukromá diagnostika zůstává v ignorovaném `output/playwright/`.

## Nejdůležitější nové práce

### Zoom-IQA — ECCV 2026

[Článek, aktuálně v5 z 5. října 2026](https://arxiv.org/abs/2601.02918),
[text v5](https://arxiv.org/html/2601.02918v5),
[stránka autorů](https://ethanliang99.github.io/ZOOMIQA-Projectpage/).

Princip: model propojuje hodnocení s konkrétními oblastmi, umí vyžádat výřez
a znovu posoudit původní závěr. Zajímavá je kombinace nejistoty, regionálních
důkazů a následného ověření. Pro Studio z toho odvozuji postup: určit relevantní
místo, získat skutečný detail z dostupného zdrojového obrazu a rozhodnout podle něj.
Nejde o hledání nejsilnější textury kdekoli v záběru.

Omezení přenosu: publikované IQA benchmarky nejsou důkazem spolehlivého fotbalového
cullingu. [Oficiální karta modelu](https://huggingface.co/Ethanliang99/Zoom-IQA-7B)
popisuje model založený na Qwen2.5-VL-7B a upozorňuje na proměnlivost výstupů.
Rychlost ani paměťové nároky ve Studiu nebyly měřeny; karta sama nepotvrzuje
kompatibilitu s naším runtime.

### GS-IQA — preprint z 8. září 2026

[From Glance to Scrutiny](https://arxiv.org/abs/2609.08316),
[plný text](https://arxiv.org/html/2609.08316v1).

Princip: postupná diagnóza místa, druhu a závažnosti vady. Učení respektuje,
že hodnocení závažnosti dává smysl až při správném nalezení a rozpoznání vady.
Pro Studio je inspirací oddělený výstup pro polohu, kategorii vady a její
intenzitu, s doložitelným výřezem.

Omezení: identifikace vady není automaticky určením hlavního fotografického motivu.
Experimenty pracují mimo jiné s uměle vytvořenými regionálními degradacemi.
Přenos na přirozený pohyb, hloubku ostrosti a malé hráče se musí měřit zvlášť.
Status doložený arXivem je preprint, nikoli potvrzená konferenční publikace.

### IQA-Spider — preprint z 23. května 2026

[Článek](https://arxiv.org/abs/2605.24553),
[plný text](https://arxiv.org/html/2605.24553v1).

Princip: společné řešení globálního a lokálního popisu kvality, prostorového
označení vad a dotazů na zvolenou oblast. Pro Studio je cenná možnost odpovídat
na otázku o konkrétním motivu a zobrazit, ke které části obrazu se závěr vztahuje.

Omezení: popis a lokalizace degradace nejsou pravidlem pro vyřazení fotografie.
Část hodnocení popisných úloh používá automatického hodnotitele GPT-4V.
Takové skóre nenahrazuje kontrolu fotografem ani přesnost návrhů vyřazení.

### BuIQA — AAAI 2026

[Burst Image Quality Assessment: A New Benchmark and Unified Framework for Multiple Downstream Tasks](https://ojs.aaai.org/index.php/AAAI/article/view/37621),
[PDF](https://ojs.aaai.org/index.php/AAAI/article/download/37621/41583).

Publikováno 14. března 2026. Autoři uvádějí 7 346 sérií, 45 827 snímků
a hodnocení pro různé následné úlohy. Výslovně rozlišují subjektivní výběr
nejlepších záběrů od výběru podkladů pro rekonstrukci, například odšumování.
Pro Studio: kvalita varianty se má vztahovat k účelu výběru a ke konkrétní sérii.

Omezení: uváděné zlepšení PSNR při rekonstrukci není úspěšnost fotografického
výběru. Z dostupného abstraktu a indexovaného úvodu nelze vyvozovat přesnost
na sportovním cullingu. Plný PDF přístup byl při této rešerši blokovaný nebo
nedostupný; detaily protokolů proto nejsou nezávisle ověřené.

### SHDIQA — CVPR 2025

[Distilling Spatially-Heterogeneous Distortion Perception for Blind Image Quality Assessment](https://openaccess.thecvf.com/content/CVPR2025/papers/Li_Distilling_Spatially-Heterogeneous_Distortion_Perception_for_Blind_Image_Quality_Assessment_CVPR_2025_paper.pdf).

Princip: učení z různých lokálních degradací a kombinování jejich informace
s globálním hodnocením. Je to relevantní alternativa k představě, že veškeré
hodnocení musí obsluhovat generující jazykový model. Článek uvádí přidání přibližně
0,2 milionu parametrů k použité základní architektuře; nejde o celkovou velikost modelu.

Pro Studio: porovnat experimentálně specializovaný obrazový model s větším VLM.
Přenos znalostí při trénování je inspirace, nikoli důkaz malých nároků při inferenci.
Podklad: indexovaný text článku a přílohy; přímé otevření PDF bylo omezené.

### DeQA-Score — CVPR 2025

[Teaching Large Language Models to Regress Accurate Image Quality Scores Using Score Distribution](https://openaccess.thecvf.com/content/CVPR2025/papers/You_Teaching_Large_Language_Models_to_Regress_Accurate_Image_Quality_Scores_CVPR_2025_paper.pdf).

Princip: modelování rozdělení hodnocení namísto jediného hrubého označení pomáhá
zachovat jemné rozdíly mezi snímky a variabilitu lidských hodnocení.
Pro Studio: skóre 84 nelze bez kalibrace interpretovat jako 84% jistotu správné
volby. Rozptyl lidského estetického hodnocení navíc není totéž co nejistota,
zda jsme našli správného hráče. Tyto veličiny je nutné oddělit.

### ME-IQA — preprint, revize 16. července 2026

[Článek](https://arxiv.org/abs/2603.20785),
[plný text v2](https://arxiv.org/html/2603.20785v2).

Princip: místo necitlivého skalárního skóre doplnit porovnání s relevantními
příklady a odhadovat párové preference. Paměť a následné přeuspořádání zmírňují
shlukování různě kvalitních obrázků do stejných hodnot.
Pro Studio: jemné porovnání variant v sérii může být vhodnější než rozdíl jejich
nezávisle vypočtených celkových skóre.

Omezení: paměť případů není sama o sobě personalizací na vkus fotografa.
Potřebná je kontrola závislosti na pořadí a historie referencí.
Jde o inspiraci pro experiment, ne o zavedení této metody do současného enginu.

### Of Chains and Gains — preprint z 23. října 2026

[Článek](https://arxiv.org/abs/2610.33203),
[plný text PDF](https://arxiv.org/pdf/2610.33203).

Tato kritická studie zkoumá, co skutečně mění posilované učení při hodnocení
kvality obrazů. Lepší skórování nemusí znamenat větší závislost na explicitním
zdůvodnění; modely mohou využít také textové zkratky korelované s cílovými skóre.
Pro Studio: přesvědčivé slovní vysvětlení ani dobrá korelace na známém datasetu
nejsou dostatečným důkazem správného rozhodnutí o fotografii.
Ověření musí zahrnout skutečný motiv, obrazový důkaz a dosud neviděné galerie.

## Doplňující souvislosti

| Práce | Ověřený přínos pro tuto rešerši | Omezení použití |
| --- | --- | --- |
| [Multidimensional Observer Model, září 2026](https://arxiv.org/abs/2609.38487) | Lidské posuzování závisí na úloze a více percepčních dimenzích; arXiv uvádí přijetí na NeurIPS 2026 | Není to hotový culling ani doklad chování ve Studiu |
| [AIM UHD-IQA, 2024](https://arxiv.org/abs/2409.16271) | Vyhodnocování kvalitních 4K fotografií zahrnuje přesnost i výpočetní rozpočet | Rozpočet soutěže není naměřená odezva na tomto počítači |
| [PARA, CVPR 2022](https://arxiv.org/abs/2203.16754) | Estetické preference se mezi lidmi liší | Estetická preference není označení technické vady |
| [Automatic Triage for a Photo Series, SIGGRAPH 2016](https://pixl.cs.princeton.edu/pubs/Chang_2016_ATF/) | Přímý starší základ relativního výběru uvnitř série podle lidských preferencí | Není novinkou roku 2026; autoři neměří naši sportovní galerii |

## Rozsah produktu napříč fotografickými žánry

Upřesnění zadání: Studio má sloužit pro obecný fotografický culling napříč
odvětvími a autorskými směry. Sportovní galerie je jedním regresním případem.
Následující rozdělení je návrh architektury, nikoli tvrzení o již dosažené přesnosti.

- Společná měřicí vrstva eviduje prostorovou ostrost, expozici, šum, dostupné
  rozlišení, metadata a podobnost. Měření samo neurčuje uměleckou hodnotu.
- Kontextová vrstva pracuje s žádným, jedním i několika důležitými motivy.
  Musí připouštět plošnou scénu, produktové detaily, skupinu lidí i abstrakci.
  Detekce lidí nemůže být povinnou podmínkou hodnocení.
- Záměr určuje, které důkazy jsou relevantní: portrét s malou hloubkou ostrosti,
  produkt s důrazem na detail, krajina s více hloubkovými plány, akce s pohybem,
  reportáž s důrazem na okamžik nebo autorská práce s úmyslnou neostrostí.
  Profil je editovatelná pomůcka; přiřazení žánru není důkaz vady a samo nemá
  vyvolat vyřazení. Smíšené galerie musí fungovat bez jediné vnucené klasifikace.
- Výběr série rozlišuje téměř totožné varianty, jiné okamžiky a záměrné pracovní
  sady: bracketing, HDR, panorama či focus stacking. Člen takové sady není
  automaticky nadbytečný, i když by samostatně získal slabší skóre.
- Rozhodování odděluje technickou použitelnost, nadbytečnost a osobní preferenci.
  Panning, silueta, zrno, high-key, low-key či rozostření mohou být záměrné.
  Při nejasném záměru má zůstat dohledatelná nejistota a ruční kontrola.

## Návrh vlastního experimentu

Následující body jsou můj návrh pro FrameMind, nikoli výsledek citovaných prací
na našem softwaru. V této rešerši se neimplementují.

1. Oddělit výstupy: technická vada, identita důležité oblasti, její ostrost,
   podobnost záběrů a preference mezi variantami. Uchovat původní měření.
2. Využít existující ruční volbu motivu jako ověřitelný základ: s označenou
   oblastí lze zkoušet přesnější technické měření bez změny cullingu na ML.
   Automatické určení hlavního motivu je další samostatná výzkumná úloha.
3. Při případném experimentu s lokálním modelem rozlišovat rozpoznaný objekt,
   důležité oblasti a pozadí. Podporovat více motivů i scénu bez dominantního
   objektu. Největší objekt ani střed nejsou spolehlivou definicí hlavního motivu.
   Maska vady není maska motivu.
4. Získávat detail z původního dostupného obrazového podkladu, s evidencí měřítka.
   U nynějšího RAW Quick Preview jde stále o vložený JPEG, nikoli analýzu senzoru.
   Umělé doostření nebo generativní obnova nemají nahrazovat důkaz původní ostrosti.
5. Nejprve vytvořit věrohodné série; teprve uvnitř nich porovnávat stejné motivy.
   V jedné akci může být několik hodnotných okamžiků. Vizuální podobnost sama
   nedokazuje nadbytečnost ani dovoluje vyřadit všechny záběry kromě jednoho.
6. Vysvětlení navázat na uložený výřez a konkrétní měření. Neurčený motiv
   a neurčitá ostrost jsou dva různé důvody kontroly.

## Jak měřit skutečné zlepšení

- Připravit fotografem označené příklady: technicky nepoužitelné, technicky
  použitelné, nejisté, preferované varianty a důležité oblasti.
  Neexportované snímky nejsou automaticky špatné. Zachovat i rovnost preferencí.
- Pokrýt portrét, skupiny, svatby a události, sport, wildlife, makro, produkt,
  krajinu, architekturu, street, dokument a experimentální fotografii.
  Doplnit smíšené galerie a pracovní sady pro skládání. Výsledky uvádět po
  kategoriích; souhrnný průměr nesmí skrýt selhání některého směru.
- Zahrnout ostré pozadí s měkkým motivem, malé objekty, překryté postavy,
  šero, vysoké ISO, panning, úmyslnou malou hloubku ostrosti, záměrnou neostrost,
  siluety, dlouhé expozice a rychlé série.
- Rozdělit data podle focení a celé série; sousední záběry jedné série nemají
  zároveň sloužit ke kalibraci i závěrečnému testu. Pro přenositelnost zahrnout
  dosud neviděné fotografy, techniku a žánry.
- Měřit zvlášť podíl správných návrhů vyřazení, zachycení vadných fotek,
  ztráty hodnotných snímků, správnost motivu a shodu pořadí variant s fotografem.
  Uvádět i počty případů a rozsah nejistoty odhadu.
- Měřit skutečný čas ručního dokončení výběru, včetně oprav chybných návrhů.
  Samotná vysoká korelace IQA skóre ani procento vyřazování tento přínos neurčují.
- Pro lokální provoz měřit čas celé sady, paměť, odezvu, možnost přerušení,
  opakovatelnost a nulový odchod obrazových dat z počítače.

## Hranice závěrů a další rozhodnutí

Nejslibnější inspirací je regionální ověření důležitého motivu propojené
s relativním porovnáním uvnitř správně sestavené série. Výběr konkrétního modelu
z této rešerše ještě nevyplývá.

V době této rešerše zůstával culling lokální a bez ML. Lokální model byl samostatnou
změnou této architektury. U kandidátů je před integrací nutné skutečně ověřit
váhy, příslušné licence, cílový runtime, závislosti a výkon. V této rešerši
neproběhlo stažení modelů, jejich spuštění, trénování ani porovnání na naší sadě.

Následná implementace 1. listopadu 2026 přidala přibalený U²-NetP pro automatické
oblasti a ověřila skutečný lokální výpočet ve Windows. Tato historická rešerše
nepopisuje aktuální kontrakt: viz [návod](culling.md) a [ověření 0.1.7](releases/unreleased.md).

Recenzované konferenční práce a čerstvé preprinty jsou výše rozlišeny.
Přijetí nebo publikační status vychází z primárního zdroje či stránky autorů.
Prohledání webu není zárukou úplného pokrytí všech prací do uvedeného data.
