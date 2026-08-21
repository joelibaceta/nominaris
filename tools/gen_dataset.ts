/**
 * Generador del dataset teacher (teacher-student / sequence-level distillation).
 *
 * Usa Claude (claude-opus-4-8) como *teacher* para producir pares
 *   (descripcion de idea)  ->  [nombres de marca con estilo]
 * cubriendo muchos sectores / estilos / idiomas. La salida es JSONL, una fila
 * por ejemplo, lista para entrenar el tiny-LM.
 *
 * Requisitos: ANTHROPIC_API_KEY en el entorno (o `ant auth login`).
 * Uso:
 *   ANTHROPIC_API_KEY=sk-... npx tsx tools/gen_dataset.ts            # tanda por defecto
 *   TARGET=40000 npx tsx tools/gen_dataset.ts                        # apunta a ~40k filas
 *
 * Cada fila JSONL:
 *   { idea, keywords: string[], names: string[], sector, style, lang }
 */

import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { appendFileSync, mkdirSync } from "node:fs";

const client = new Anthropic(); // resuelve ANTHROPIC_API_KEY / perfil del entorno

const OUT = "data/dataset.jsonl";
const TARGET = Number(process.env.TARGET ?? 2000); // filas objetivo
// Teacher configurable para controlar coste. Sonnet 4.6 da calidad de sobra para
// naming a ~1/1.7 del coste de output de Opus. Opus 4.8 = maxima calidad.
const TEACHER = process.env.TEACHER_MODEL ?? "claude-opus-4-8";
const EXAMPLES_PER_CALL = 12; // ideas por llamada
const CONCURRENCY = 6;

// Ejes de diversidad. El producto cartesiano da mucha cobertura; barajamos y
// repetimos hasta alcanzar TARGET.
const SECTORS = [
  "cafe / comida", "fintech", "salud / bienestar", "educacion", "logistica",
  "moda", "viajes", "gaming", "agro", "inmobiliaria", "mascotas", "fitness",
  "musica", "IA / dev tools", "e-commerce", "sostenibilidad", "belleza",
  "eventos", "legal", "hardware / IoT",
];
const STYLES = [
  "corto y techy (io/ly/ai)", "jugueton y memorable", "abstracto e inventado",
  "latino / espanol calido", "compuesto de dos palabras", "mitologico / evocador",
  "minimalista de una sola raiz", "onomatopeyico",
];
const LANGS = ["es", "en"];

// --- Schema de salida estructurada ------------------------------------------
const Pair = z.object({
  idea: z.string().describe("Descripcion de la idea en 1 frase, en el idioma pedido"),
  keywords: z.array(z.string()).describe("3-6 keywords en minusculas, sin tildes"),
  names: z.array(z.string()).describe("8-12 nombres de marca, minusculas, sin espacios, brandables"),
});
const Batch = z.object({ pairs: z.array(Pair) });

function prompt(sector: string, style: string, lang: string): string {
  return [
    `Genera ${EXAMPLES_PER_CALL} ideas de negocio DISTINTAS en el sector "${sector}".`,
    `Para cada idea:`,
    `- "idea": una descripcion en 1 frase, en idioma "${lang}".`,
    `- "keywords": 3-6 palabras clave en minusculas y sin tildes que capturen la esencia.`,
    `- "names": 8-12 nombres de marca en estilo "${style}". Requisitos de los nombres:`,
    `  minusculas, sin espacios ni caracteres especiales, pronunciables, cortos (3-12 letras),`,
    `  brandables y coherentes con la idea. Evita nombres de marcas reales conocidas.`,
    `Varia mucho entre ideas. No repitas nombres entre ideas.`,
  ].join("\n");
}

function* combos(): Generator<[string, string, string]> {
  // recorrido determinista pero entrelazado para maximizar variedad temprana
  let i = 0;
  while (true) {
    const s = SECTORS[i % SECTORS.length];
    const st = STYLES[(i * 3) % STYLES.length];
    const l = LANGS[i % LANGS.length];
    i++;
    yield [s, st, l];
  }
}

async function oneCall(sector: string, style: string, lang: string) {
  const res = await client.messages.parse({
    model: TEACHER,
    max_tokens: 8000,
    thinking: { type: "adaptive" },
    messages: [{ role: "user", content: prompt(sector, style, lang) }],
    output_config: { format: zodOutputFormat(Batch) },
  });
  const parsed = res.parsed_output;
  if (!parsed) return 0;
  const rows = parsed.pairs.map((p) =>
    JSON.stringify({ ...p, sector, style, lang }),
  );
  appendFileSync(OUT, rows.join("\n") + "\n");
  return rows.length;
}

async function main() {
  mkdirSync("data", { recursive: true });
  const gen = combos();
  let total = 0;
  let calls = 0;

  async function worker(id: number) {
    while (total < TARGET) {
      const [sector, style, lang] = gen.next().value!;
      calls++;
      try {
        const n = await oneCall(sector, style, lang);
        total += n;
        console.log(`[w${id}] +${n} (total ${total}/${TARGET}) ${sector} · ${style} · ${lang}`);
      } catch (e) {
        if (e instanceof Anthropic.RateLimitError) {
          console.warn(`[w${id}] rate limit, espero 5s`);
          await new Promise((r) => setTimeout(r, 5000));
        } else {
          console.error(`[w${id}] error`, (e as Error).message);
        }
      }
    }
  }

  await Promise.all(
    Array.from({ length: CONCURRENCY }, (_, i) => worker(i + 1)),
  );
  console.log(`\nListo. ${total} filas en ${OUT} (${calls} llamadas).`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
