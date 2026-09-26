# Retuš: tvrdost, síla, chytré laso — návrh (26. 9. 2026)

Schváleno Lukášem v chatu („jen do toho“).

## 1. Tvrdost a síla
- **Tvrdost** (0–100 %): měkkost okraje štětce. Tah se kreslí tvrdě do
  pomocného plátna a teprve při sloučení do masky se rozmaže o poloměr
  úměrný (1 − tvrdost). Alfa masky = váha retuše.
- **Síla** (10–100 %): kolik doplnění se použije.
- Model dostává binární díru (alfa masky > prahu, s okrajem). Tvrdost a síla
  se uplatní až při skládání výsledku — výpočet nezpomalí.

## 2. Chytré laso
- SAM 2.1 hiera-tiny (onnx-community, encoder q4f16 ~29 MB + decoder ~5 MB),
  lokálně ve workeru přes onnxruntime-web. Encoder jednou na fotku, klik =
  decoder (desítky ms).
- Klik = objekt, další klik přidá, Alt+klik ubere. Výběr se ukáže jako obrys,
  doladí se štětcem, potvrdí tlačítkem Odstranit.
- Volitelně výběr textem přes Gemini: Gemini vrátí body objektů, masky dělá
  lokální SAM. Vyžaduje API klíč, fotka odchází do Googlu — upozornění u pole.

## 3. Kvalita a rychlost
- Okraj díry podle velikosti objektu (ne pevné 4 px).
- Rychlost podle backendu, který uživatel reálně má (GPU/CPU z panelu).

Každý krok se nasazuje zvlášť.
