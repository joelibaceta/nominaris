import { generateNames } from "./generate";
import { checkMany, type Availability } from "./domains";
import { rank } from "./rank";

const ideaEl = document.getElementById("idea") as HTMLTextAreaElement;
const goEl = document.getElementById("go") as HTMLButtonElement;
const statusEl = document.getElementById("status") as HTMLSpanElement;
const resultsEl = document.getElementById("results") as HTMLUListElement;
const countEl = document.getElementById("count") as HTMLSpanElement;
const goLabelEl = document.getElementById("golabel") as HTMLSpanElement;
const reactionEl = document.getElementById("reaction") as HTMLParagraphElement;
const goLabel = goLabelEl.textContent ?? "Encontrar nombres";

// Reacción pre-escrita, estable por idea.
const REACTIONS = [
  "¡Wow, qué buena idea!",
  "¡Me encanta esa idea!",
  "¡Suena prometedor!",
  "¡Gran idea!",
  "Interesante, vamos a nombrarla.",
];
function hash(s: string): number {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h;
}

// Contador estilo tweet
function updateCount() {
  const n = ideaEl.value.length;
  countEl.textContent = `${n} / 280`;
  countEl.classList.toggle("warn", n > 240);
}
ideaEl.addEventListener("input", updateCount);
updateCount();

// Solo mostramos nombres con .com libre (status "free"); las tomadas/desconocidas
// se ocultan. La lista crece en vivo conforme se confirman dominios libres.
function render(entries: Array<{ name: string; status: Availability }>) {
  const free = entries.filter((e) => e.status === "free");
  const ranked = rank(free);
  resultsEl.innerHTML = ranked
    .map(
      ({ name }) => `<li>
        <span><span class="name">${name}</span> <span class="domain">${name}.com</span></span>
        <a class="buy" href="https://www.namecheap.com/domains/registration/results/?domain=${name}.com" target="_blank" rel="noopener">registrar →</a>
      </li>`,
    )
    .join("");
}

async function run() {
  const idea = ideaEl.value.trim();
  if (!idea) { ideaEl.focus(); return; }
  goEl.disabled = true;
  goLabelEl.textContent = "pensando…";
  resultsEl.innerHTML = "";

  const r = REACTIONS[hash(idea) % REACTIONS.length];
  reactionEl.innerHTML = `<span class="grad">${r}</span> Aquí tienes algunos nombres con el <strong>.com libre</strong>:`;
  statusEl.textContent = "inventando nombres para tu idea…";
  const names = await generateNames(idea, 40);

  // Pinta primero con estado "comprobando", luego actualiza en vivo.
  const state = new Map<string, Availability>(names.map((n) => [n, "unknown"]));
  render(names.map((n) => ({ name: n, status: "unknown" })));

  let done = 0;
  const freeCount = () => [...state.values()].filter((s) => s === "free").length;
  statusEl.textContent = `buscando dominios libres… 0/${names.length}`;
  await checkMany(names, 8, (name, status) => {
    state.set(name, status);
    done++;
    statusEl.textContent = `buscando dominios libres… ${done}/${names.length} · ${freeCount()} libres`;
    render([...state].map(([name, status]) => ({ name, status })));
  });

  const free = freeCount();
  statusEl.textContent = free
    ? `${free} con .com libre (de ${names.length} exploradas)`
    : `sin .com libre entre ${names.length} nombres — prueba otra idea`;
  if (!free) { resultsEl.innerHTML = ""; reactionEl.innerHTML = ""; }
  goEl.disabled = false;
  goLabelEl.textContent = goLabel;
}

goEl.addEventListener("click", run);
ideaEl.addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === "Enter") run();
});
