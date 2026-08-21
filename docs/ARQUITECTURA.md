# Arquitectura de nominaris

Objetivo: generar nombres de negocio con `.com` libre, **100% en el navegador**,
descarga total de pocos MB (nada de 800 MB), UI mínima (textbox + lista).

## Capas

```
descripcion ──▶ extractKeywords ──▶ generateNames ──▶ checkMany (dominios) ──▶ rank ──▶ lista
                (cliente)            (tiny-LM)          (DoH + RDAP)            (heuristicas)
```

### 1. Generación — `src/generate.ts`
- **Interfaz estable:** `generateNames(idea, n): Promise<string[]>`.
- **Hoy:** motor algorítmico (prefijos/sufijos/blends/fonética) condicionado por keywords.
  Sirve para tener la app funcionando end-to-end sin esperar el modelo.
- **Endgame:** tiny-LM que reemplaza SOLO el cuerpo de esta función.
  - Decoder-only transformer, subword **BPE ~8k** (ES/EN), `d_model=256`, 4-6 capas.
  - ~6M params → **~6 MB int8**. Contexto ~64 tokens.
  - Prompt = keywords limpiadas en el cliente: `[KW] cafe organico rapido [GEN]`.

### 2. Disponibilidad de dominio — `src/domains.ts`
- **DoH (Cloudflare):** pre-filtro barato. Si no resuelve → probablemente libre.
- **RDAP (Verisign, autoritativo):** `rdap.verisign.com/com/v1/domain/NAME.com`
  → **404 = libre**, **200 = registrado**. Ambos con `Access-Control-Allow-Origin: *`.
- Pool de concurrencia (`checkMany`, 8 en paralelo) con callback para pintar en vivo.

### 3. Ranking — `src/rank.ts`
- Puro JS: dominio libre > brevedad > pronunciabilidad. Sin modelo.

## Runtime del modelo (dos caminos, misma interfaz)
1. **transformers.js / ONNX Runtime Web** — WebGPU con fallback WASM. Rápido de iterar.
2. **Kernel WASM propio** (Rust/Zig) que corre solo esta arquitectura y lee los pesos
   int8 directo. Puede pesar **<100 KB**. Es el endgame para exprimir tamaño.

El modelo se cachea con Cache API tras la primera carga.

## Entrenamiento (teacher-student)
1. **Teacher (Claude):** generar ~30-50k pares `(descripción) → [nombres con estilo]`,
   cubriendo rubros / estilos / idiomas.
   → Implementado en `tools/gen_dataset.ts` (modelo `claude-opus-4-8`, salida
   estructurada con Zod). Correr:
   ```bash
   ANTHROPIC_API_KEY=sk-... TARGET=40000 npm run gen:dataset
   # escribe data/dataset.jsonl (una fila por ejemplo)
   ```
   Cada fila: `{ idea, keywords[], names[], sector, style, lang }`.
2. **Sequence-level distillation:** entrenar el tiny-LM (PyTorch) a imitar las salidas
   del teacher (no hace falta destilar logits). Prompt = keywords → nombres.
3. **Export:** ONNX → cuantización **int8** → servir estático en `public/model/`.
4. **Enchufar:** reemplazar el cuerpo de `generateNames()` en `src/generate.ts` por
   la inferencia (transformers.js / kernel WASM). Nada más cambia.

### Estado
- [x] UI mínima + chequeo de dominios (RDAP/DoH) + ranking — funcional end-to-end
- [x] Generador de dataset teacher (`tools/gen_dataset.ts`)
- [ ] Entrenamiento del tiny-LM + export ONNX int8
- [ ] Backend de inferencia en `generate.ts`

## Presupuesto de descarga
| pieza            | tamaño aprox |
|------------------|--------------|
| app (JS+HTML)    | ~5 KB gzip   |
| runtime WASM ORT | ~2-4 MB      |
| modelo int8      | ~6 MB        |
| **total**        | **< 10 MB**  |

## Desarrollo
```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # dist/ estático
```
