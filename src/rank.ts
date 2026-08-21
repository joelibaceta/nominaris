// Ranking de candidatos. Sin modelo: heuristicas puras y rapidas.
// Prioriza: dominio libre > brevedad > pronunciabilidad.

import type { Availability } from "./domains";

export interface Ranked {
  name: string;
  status: Availability;
  score: number;
}

// Puntúa lo fácil de pronunciar y recordar (0..~4). Premia: longitud corta,
// equilibrio consonante/vocal, alternancia C-V (silabas limpias); penaliza clusters.
function memorability(s: string): number {
  const n = s.length;
  const vowels = s.match(/[aeiou]/g)?.length ?? 0;
  const balance = 1 - Math.abs(0.42 - vowels / n) * 2;           // ideal ~42% vocales
  // longitud: ideal 5-9; penaliza fuera de rango
  const ideal = n < 5 ? 5 : 9;
  const lenScore = n >= 5 && n <= 9 ? 1 : Math.max(0, 1 - Math.abs(ideal - n) * 0.16);
  // alternancia consonante/vocal: mas transiciones = mas pronunciable
  let trans = 0;
  for (let i = 1; i < n; i++) {
    if ("aeiou".includes(s[i - 1]) !== "aeiou".includes(s[i])) trans++;
  }
  const altScore = n > 1 ? trans / (n - 1) : 0;
  // penaliza grupos de 2+ consonantes (cada uno resta)
  const clusters = (s.match(/[bcdfghjklmnpqrstvwxyz]{2,}/g) || []).length;
  const clusterScore = Math.max(0, 1 - clusters * 0.18);
  return Math.max(0, balance) * 0.8 + lenScore * 1.1 + altScore * 1.3 + clusterScore * 0.8;
}

export function rank(entries: Array<{ name: string; status: Availability }>): Ranked[] {
  return entries
    .map(({ name, status }) => {
      const avail = status === "free" ? 1 : status === "unknown" ? 0.3 : 0;
      const score = avail * 3 + memorability(name);
      return { name, status, score };
    })
    .sort((a, b) => b.score - a.score);
}
