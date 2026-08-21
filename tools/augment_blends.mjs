/**
 * Añade a cada idea nombres-blend que fusionan pares de sus keywords
 * (presta + negocio -> prestanegocio), para que el modelo aprenda a combinar conceptos.
 *
 * Uso: node tools/augment_blends.mjs [--per 4]
 */
import fs from "node:fs";

const IN = "data/dataset.jsonl";
const PER = Number(process.argv.includes("--per") ? process.argv[process.argv.indexOf("--per") + 1] : 4);
const isVowel = (c) => "aeiou".includes(c);

function clean(w) {
  return w.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z]/g, "").replace(/s$/, "");
}
function stem(w) {
  let r = clean(w);
  if (r.length > 5) r = r.replace(/(ar|er|ir)$/, "");
  return r;
}
function join(a, b) {
  if (!a || !b) return "";
  let x = a, y = b;
  if (x[x.length - 1] === y[0]) y = y.slice(1);                       // solapa letra repetida
  else if (isVowel(x[x.length - 1]) && isVowel(y[0])) x = x.slice(0, -1); // evita doble vocal
  return (x + y).replace(/(.)\1{2,}/g, "$1$1");
}
function pron(s) {
  return s.length >= 5 && s.length <= 13 && /[aeiou]/.test(s)
    && !/[bcdfghjklmnpqrstvwxyz]{3,}/.test(s) && !/(.)\1\1/.test(s) && /[aeiounrlsm]$/.test(s);
}

// Genera candidatos-blend de un par (a,b) con varias estrategias
function blends(a, b) {
  const A = clean(a), B = clean(b), sA = stem(a).slice(0, 6), sB = stem(b).slice(0, 6);
  return [
    join(sA, B),                 // presta + negocio -> prestanegocio
    join(sB, A),                 // negoci + prestamo
    join(A.slice(0, 4), B),      // pres + negocio
    join(A.slice(0, 5), B.slice(0, 4)), // blend corto
  ];
}

const lines = fs.readFileSync(IN, "utf8").trim().split("\n");
let added = 0;
const out = lines.map((l) => {
  const o = JSON.parse(l);
  const kws = (o.keywords || []).filter((k) => clean(k).length >= 3);
  if (kws.length < 2) return l;
  const have = new Set(o.names.map((n) => n.toLowerCase()));
  const extra = [];
  // recorre pares de keywords (distintas)
  outer: for (let i = 0; i < kws.length; i++) {
    for (let j = 0; j < kws.length; j++) {
      if (i === j) continue;
      for (const name of blends(kws[i], kws[j])) {
        if (pron(name) && !have.has(name) && !extra.includes(name)) {
          extra.push(name); have.add(name);
          if (extra.length >= PER) break outer;
        }
      }
    }
  }
  if (extra.length) { o.names = o.names.concat(extra); added += extra.length; }
  return JSON.stringify(o);
});
fs.writeFileSync(IN, out.join("\n") + "\n");
console.log(`blends añadidos: ${added}`);
