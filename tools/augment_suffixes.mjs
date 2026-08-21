/**
 * Añade a cada idea nombres con una paleta de sufijos diversa (-ify, -ly, -ame, -er,
 * -ist, -able, -ity...), derivados de sus keywords, para variar el estilo del dataset.
 *
 * Uso: node tools/augment_suffixes.mjs [--per 4]
 */
import fs from "node:fs";

const IN = "data/dataset.jsonl";
const PER = Number(process.argv.includes("--per") ? process.argv[process.argv.indexOf("--per") + 1] : 4);

// Paleta de sufijos diversa (evita -o / -vo).
const SUF = ["ify","fy","ly","er","ist","ery","ity","able","ia","io","hub","labs",
             "ame","alo","ero","ista","azo","ely","ix","io"];

const isVowel = (c) => "aeiou".includes(c);

function root(w) {
  let r = w.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z]/g, "");
  if (r.length > 5) r = r.replace(/(cion|ciones)$/, "");
  r = r.replace(/s$/, "");
  if (r.length > 5) r = r.replace(/(ar|er|ir)$/, "");
  return r.slice(0, 6);
}

function join(r, suf) {
  let name = isVowel(r[r.length - 1]) && isVowel(suf[0]) ? r.slice(0, -1) + suf : r + suf;
  return name.replace(/(.)\1{2,}/g, "$1$1");
}

function pron(s) {
  if (s.length < 4 || s.length > 13) return false;
  if (!/[aeiou]/.test(s)) return false;
  if (/[bcdfghjklmnpqrstvwxyz]{3,}/.test(s)) return false; // clusters feos
  if (/(.)\1\1/.test(s)) return false;                     // triples
  if (!/[aeiouynrlsmt]$/.test(s)) return false;            // final admisible (incl. -er, -ist, -ify)
  return true;
}

const lines = fs.readFileSync(IN, "utf8").trim().split("\n");
let added = 0;
const out = lines.map((l, li) => {
  const o = JSON.parse(l);
  const roots = [...new Set((o.keywords || []).map(root).filter((r) => r.length >= 3))];
  if (!roots.length) return l;
  const have = new Set(o.names.map((n) => n.toLowerCase()));
  const extra = [];
  let k = li * 3; // desfase por idea -> los sufijos se reparten parejo en todo el set
  for (const r of roots) {
    for (let t = 0; t < 4 && extra.length < PER; t++) {
      const name = join(r, SUF[k++ % SUF.length]);
      if (pron(name) && !have.has(name) && !extra.includes(name)) { extra.push(name); have.add(name); }
    }
  }
  if (extra.length) { o.names = o.names.concat(extra); added += extra.length; }
  return JSON.stringify(o);
});
fs.writeFileSync(IN, out.join("\n") + "\n");
console.log(`nombres añadidos: ${added}`);
