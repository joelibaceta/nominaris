// Genera candidatos de nombre. Usa el tiny-LM (transformers.js / ONNX int8) si hay
// un modelo en /model/; si no, cae a un generador algorítmico de respaldo.

const STOPWORDS = new Set([
  "una","uno","un","el","la","los","las","de","del","para","por","con","que","y","o","a",
  "en","es","su","sus","al","lo","le","se","me","te","nos","mi","tu","como","mas","muy",
  "ya","sin","sobre","entre","cada","todo","todos","toda","todas","este","esta","esto",
  "ese","esa","eso","donde","cuando","tambien","pero","segun","cual","quien",
  "app","apps","aplicacion","aplicaciones","aplica","plataforma","plataformas","sistema",
  "sistemas","servicio","servicios","herramienta","herramientas","web","online","internet",
  "sitio","pagina","software","programa","solucion","soluciones","producto","productos",
  "idea","ideas","negocio","negocios","proyecto","startup","empresa","marca","tecnologia",
  "digital","gente","personas","usuario","usuarios","cliente","clientes","manera","forma",
  "facil","simple","rapida","rapido","mundo","nuevo","nueva","mejor","ayuda","ayudar",
  "permite","hacer","poder","quiero","hago","tengo",
  "the","an","of","for","to","and","or","with","that","this","are","apps","application",
  "platform","system","service","tool","tools","website","site","page","solution","product",
  "business","company","brand","tech","technology","people","users","user","customer",
  "easy","fast","quick","best","help","make","want",
]);

const ACCENTS = /[̀-ͯ]/g;
const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(ACCENTS, "");

function tokens(idea: string): string[] {
  return norm(idea)
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w));
}

/** Palabras clave de la idea, para el prompt del modelo. */
export function extractKeywords(idea: string, max = 6): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const w of tokens(idea)) {
    if (!seen.has(w)) { seen.add(w); out.push(w); }
    if (out.length >= max) break;
  }
  return out;
}

/** Descarta balbuceos y clusters impronunciables. */
function pronounceable(s: string): boolean {
  if (s.length < 4 || s.length > 13) return false;
  if (!/[aeiou]/.test(s)) return false;
  if (/[bcdfghjklmnpqrstvwxyz]{4,}/.test(s)) return false; // 4+ consonantes seguidas
  if (/[aeiou]{3,}/.test(s)) return false;                 // 3+ vocales seguidas
  if (/(.)\1\1/.test(s)) return false;                     // triples
  if (/(..)\1/.test(s)) return false;                      // balbuceo (tata)
  return true;
}

// --- Respaldo algorítmico (si no hay modelo entrenado) -----------------------
// Léxico rubro -> raíces de marca on-topic, para dar contexto sin un LLM.
interface Concept { triggers: string[]; roots: string[]; }
const CONCEPTS: Concept[] = [
  { triggers: ["futbol","football","soccer","deporte","deportes","sport","cancha","canchas","gol","goles","partido","partidos","jugar","juego","liga","equipo","atleta","running","correr","tenis","basket","padel"],
    roots: ["kick","gol","arena","liga","match","play","sprint","atle","juega","rally","volea","fichaje"] },
  { triggers: ["amigos","amigo","social","comunidad","grupo","juntos","conecta","conectar","red","club","gente"],
    roots: ["crew","tribu","squad","amigo","circle","club","pandi","junta","nexo","meetup","vibe"] },
  { triggers: ["reservar","reserva","reservas","agenda","agendar","turno","turnos","cita","citas","booking","book","horario","alquilar"],
    roots: ["reserva","slot","turno","agenda","booky","cupo","cita","hora"] },
  { triggers: ["comida","comer","restaurante","cocina","chef","receta","recetas","food","gastro","delivery","plato","menu"],
    roots: ["gusto","sabor","bocado","yumi","gastro","plato","nomi","fork","sazon"] },
  { triggers: ["cafe","coffee","cafeteria","barista","espresso"],
    roots: ["barista","brew","tueste","aroma","kafe","grano"] },
  { triggers: ["dinero","pagos","pagar","finanzas","banco","credito","inversion","invertir","ahorro","ahorrar","wallet","cripto","factura"],
    roots: ["paga","coin","fondo","monto","banca","ahorro","cash","ledger","capital","peso"] },
  { triggers: ["salud","medico","doctor","clinica","bienestar","health","terapia","mental","cuidado","paciente"],
    roots: ["vita","sana","cura","salud","bienes","medi","pulso","zen","vive"] },
  { triggers: ["educacion","aprender","curso","cursos","ensenar","estudiar","escuela","clases","tutor","learn","skill"],
    roots: ["aula","aprende","tutor","skill","saber","clase","mente","academi"] },
  { triggers: ["viaje","viajes","viajar","turismo","hotel","vuelo","vuelos","destino","tour","travel","trip"],
    roots: ["viaja","ruta","destino","nomad","trip","tour","rumbo","atlas","brujula"] },
  { triggers: ["mascota","mascotas","perro","perros","gato","gatos","pet","veterinario","animal"],
    roots: ["pet","peludo","guau","miau","fauna","patas","huella"] },
  { triggers: ["eco","sostenible","sostenibilidad","verde","reciclar","reciclaje","planeta","ambiente","green","solar"],
    roots: ["eco","verde","raiz","gaia","hoja","solar","bio","terra","ciclo"] },
  { triggers: ["nino","ninos","kids","infantil","bebe","familia","juguete"],
    roots: ["peque","juega","nido","cuna","mini"] },
  { triggers: ["musica","cancion","canciones","artista","banda","sonido","audio","podcast"],
    roots: ["tono","beat","sonido","ritmo","melo","nota","vibra"] },
  { triggers: ["inteligencia","datos","data","codigo","programar","api","automatizar","bot","machine"],
    roots: ["byte","logic","neura","data","code","sync","flux","mind","stack"] },
  { triggers: ["moda","ropa","estilo","prenda","diseno","fashion","tienda","boutique"],
    roots: ["chic","estilo","hilo","vestu","atuen","lujo","trend"] },
  { triggers: ["inmobiliaria","casa","casas","propiedad","alquiler","arriendo","hogar","renta"],
    roots: ["hogar","casa","techo","nido","llave","predio","habita","domus"] },
  { triggers: ["fitness","gym","entrenar","entreno","musculo","workout","rutina"],
    roots: ["fit","reto","pulse","forma","flex","sudor"] },
];

function conceptRoots(toks: string[]): string[] {
  const roots = new Set<string>();
  const set = new Set(toks.map((t) => t.replace(/s$/, "")));
  for (const c of CONCEPTS) {
    if (c.triggers.some((t) => set.has(t) || set.has(t.replace(/s$/, "")))) {
      c.roots.forEach((r) => roots.add(r));
    }
  }
  return [...roots];
}

function root(word: string): string {
  let w = word;
  if (w.length > 4) w = w.replace(/(cion|ciones)$/, "");
  w = w.replace(/s$/, "");
  if (w.length > 5) w = w.replace(/(ar|er|ir)$/, "");
  return w.slice(0, 7);
}

const VOWELS = ["a", "o", "i", "e"];
const PREFIX = ["neo", "go", "get", "zen", "lumi", "co", "via", "uno", "vibe"];
const SUFFIX = ["ly", "io", "ia", "or", "eo", "ora", "va", "na", "zo", "fy", "mo", "sy"];
const COIN = ["opia", "aria", "ova", "ika", "umi", "era", "ana", "eza"];
const isVowel = (c: string) => "aeiou".includes(c);

function withVowel(r: string): string {
  return isVowel(r[r.length - 1]) ? r : r + VOWELS[r.length % VOWELS.length];
}

function blend(a: string, b: string): string {
  const head = a.slice(0, Math.max(3, Math.min(5, a.length)));
  let tail = b;
  while (tail.length && !isVowel(tail[0])) tail = tail.slice(1);
  return (head + (tail || b)).replace(/(.)\1{2,}/g, "$1$1");
}

function pick<T>(arr: T[], s: number): T { return arr[Math.abs(s) % arr.length]; }

async function fallbackNames(idea: string, n = 40): Promise<string[]> {
  const toks = tokens(idea);
  const kwRoots = extractKeywords(idea).map(root).filter((r) => r.length >= 3);
  let pool = [...new Set([...conceptRoots(toks), ...kwRoots])];
  if (pool.length === 0) pool = ["nova", "lumo", "vibe", "orbi", "zeni"];

  const out = new Set<string>();
  const used = new Map<string, number>();
  let seed = 2166136261;
  for (const ch of idea) seed = (seed ^ ch.charCodeAt(0)) * 16777619; // hash estable por idea
  const spin = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff);

  let ri = 0, guard = 0;
  while (out.size < n && guard++ < 3000) {
    const r = pool[ri++ % pool.length];
    if ((used.get(r) ?? 0) >= 3) continue; // no exprimir una sola raíz

    const mode = spin() % 6;
    let name = "";
    if (mode === 0) name = withVowel(r) + pick(SUFFIX, spin());
    else if (mode === 1) name = pick(PREFIX, spin()) + r;
    else if (mode === 2) name = blend(r, pick(pool, spin()));
    else if (mode === 3) name = r + pick(COIN, spin());
    else if (mode === 4) name = withVowel(r);
    else name = pick(PREFIX, spin()) + r + pick(VOWELS, spin());

    name = name.replace(/[^a-z0-9]/g, "");
    if (pronounceable(name) && !out.has(name)) {
      out.add(name);
      used.set(r, (used.get(r) ?? 0) + 1);
    }
  }
  return [...out].slice(0, n);
}

// --- tiny-LM (transformers.js sobre ONNX int8) -------------------------------
const MODEL_DIR = "model";
let pipePromise: Promise<((text: string, opts: any) => Promise<any>) | null> | null = null;

async function loadPipe() {
  if (pipePromise) return pipePromise;
  pipePromise = (async () => {
    try {
      // Comprueba que el modelo existe (HEAD) antes de importar transformers.js,
      // así el runtime pesado no se descarga si solo hay respaldo.
      const base = import.meta.env.BASE_URL || "/";
      const probe = await fetch(`${base}${MODEL_DIR}/config.json`, { method: "HEAD" });
      if (!probe.ok) return null;
      const t = await import("@huggingface/transformers");
      t.env.allowRemoteModels = false;
      t.env.allowLocalModels = true;
      t.env.localModelPath = base;
      const pipe = await t.pipeline("text-generation", MODEL_DIR, { dtype: "q8" });
      return pipe as unknown as (text: string, opts: any) => Promise<any>;
    } catch {
      return null;
    }
  })();
  return pipePromise;
}

async function modelNames(idea: string, n: number): Promise<string[]> {
  const pipe = await loadPipe();
  if (!pipe) return [];
  const prompt = `<kw> ${extractKeywords(idea).join(" ")} <gen>`;
  const out = new Set<string>();
  for (let round = 0; round < 8 && out.size < n; round++) {
    const res = await pipe(prompt, {
      max_new_tokens: 12,
      do_sample: true,
      temperature: 0.8,
      top_k: 40,
      top_p: 0.9,
      repetition_penalty: 1.1,
      num_return_sequences: 8,
      return_full_text: false,
    });
    for (const it of Array.isArray(res) ? res : [res]) {
      const name = String(it.generated_text ?? "")
        .replace(/<\/?[a-z]+>/g, " ")
        .trim().toLowerCase()
        .replace(/[^a-z0-9]/g, "");
      if (pronounceable(name)) out.add(name);
    }
  }
  return [...out].slice(0, n);
}

/** Candidatos de nombre: tiny-LM si está entrenado, respaldo algorítmico si no. */
export async function generateNames(idea: string, n = 40): Promise<string[]> {
  const fromModel = await modelNames(idea, n);
  return fromModel.length >= Math.min(8, n) ? fromModel : fallbackNames(idea, n);
}
