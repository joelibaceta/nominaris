# Pipeline del tiny-LM (teacher-student)

Convierte el criterio de naming de Claude en un modelo diminuto que corre en el
navegador. La semántica (qué nombre pega con qué idea) queda **dentro** del modelo,
aprendida de miles de ejemplos del teacher — no de reglas hardcodeadas.

```
Claude (teacher) ─▶ data/dataset.jsonl ─▶ train.py ─▶ export.py ─▶ public/model/ ─▶ generate.ts
   gen_dataset.ts       (idea→nombres)     GPT-2 chico   ONNX int8    (transformers.js)
```

## 0. Requisitos
```bash
python -m venv tools/train/.venv && source tools/train/.venv/bin/activate
pip install -r tools/train/requirements.txt
```

## 1. Generar el dataset teacher

Dos rutas para producir `data/dataset.jsonl` (filas `{idea, keywords[], names[], sector, style, lang}`):

**A) Sin API key — la sesión interactiva de Claude es el teacher (ruta actual).**
Claude escribe los ejemplos directamente en el archivo, en lotes, a lo largo de
varios turnos (o con un `/loop` que va acumulando). No cuesta API; el límite es el
volumen. Es como está sembrado el dataset hoy.

**B) Con API key — automatizado (para escalar a decenas de miles).**
```bash
ANTHROPIC_API_KEY=sk-... TARGET=500  TEACHER_MODEL=claude-sonnet-4-6 npm run gen:dataset  # valida barato
ANTHROPIC_API_KEY=sk-... TARGET=40000 TEACHER_MODEL=claude-sonnet-4-6 npm run gen:dataset  # escala
```
`TEACHER_MODEL` por defecto `claude-opus-4-8`; `claude-sonnet-4-6` baja coste con
calidad de sobra para naming.

> Diversidad > cantidad bruta: muchas ideas distintas de muchos sectores generalizan
> mejor que repetir el mismo rubro.

## 2. Entrenar (local, gratis)
```bash
python tools/train/train.py --data data/dataset.jsonl --epochs 8
# -> tools/train/out/  (GPT-2 ~3-6M params + tokenizer)
```
Ajustables: `--n_embd 256 --n_layer 4 --vocab 4000`. Corre en CPU para datasets
chicos; con GPU es minutos.

## 3. Exportar a ONNX int8 (local, gratis)
```bash
python tools/train/export.py --model tools/train/out --out public/model
# -> public/model/onnx/model_quantized.onnx  (~5-10 MB)  + tokenizer
```

## 4. Enchufar en el frontend
Reemplazar el cuerpo de `generateNames()` en `src/generate.ts` por inferencia con
`transformers.js` apuntando a `/model/`. La interfaz no cambia; el resto de la app
(dominios + ranking) sigue igual.

## Notas de diseño
- **Formato:** cada `(keywords → nombre)` es una secuencia `<kw> … <gen> nombre <eos>`,
  con la pérdida enmascarada en el prompt: el modelo solo aprende a *generar* nombres.
- **Generalización:** el modelo generaliza dentro de la distribución del teacher.
  Cuantos más sectores/estilos cubra el dataset, mejor con ideas nuevas. Ideas muy
  de nicho dependen de que el teacher las haya cubierto → mantener `SECTORS` amplio
  en `tools/gen_dataset.ts`.
- **Tamaño:** GPT-2 con `n_embd=256, n_layer=4` ≈ 3-6M params → ~5-10 MB int8.
