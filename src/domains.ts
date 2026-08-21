// Disponibilidad de dominios .com, 100% frontend (CORS abierto en ambos endpoints):
//   1. DoH (Cloudflare) como pre-filtro: sin registros DNS ≈ probablemente libre.
//   2. RDAP (Verisign, autoritativo) confirma: 404 = libre, 200 = registrado.

export type Availability = "free" | "taken" | "unknown";

const DOH = "https://cloudflare-dns.com/dns-query";
const RDAP = "https://rdap.verisign.com/com/v1/domain/";

/** true = tiene registros DNS (probablemente tomado), false = sin registros. */
async function hasDns(domain: string): Promise<boolean> {
  const url = `${DOH}?name=${encodeURIComponent(domain)}&type=A`;
  const res = await fetch(url, { headers: { accept: "application/dns-json" } });
  if (!res.ok) throw new Error(`DoH ${res.status}`);
  const data = await res.json();
  // Status 3 = NXDOMAIN. Sin "Answer" = sin registros.
  return data.Status === 0 && Array.isArray(data.Answer) && data.Answer.length > 0;
}

/** Confirmacion autoritativa via RDAP: 404 => libre. */
async function rdapIsFree(domain: string): Promise<boolean> {
  const res = await fetch(RDAP + encodeURIComponent(domain));
  if (res.status === 404) return true;
  if (res.status === 200) return false;
  throw new Error(`RDAP ${res.status}`);
}

/** Disponibilidad de `<name>.com`. Falla suave devolviendo "unknown". */
export async function checkDotCom(name: string): Promise<Availability> {
  const domain = `${name.toLowerCase()}.com`;
  try {
    if (await hasDns(domain)) return "taken"; // tiene DNS => casi seguro tomado
    return (await rdapIsFree(domain)) ? "free" : "taken";
  } catch {
    // Si DoH falla, intentamos RDAP directo antes de rendirnos.
    try {
      return (await rdapIsFree(domain)) ? "free" : "taken";
    } catch {
      return "unknown";
    }
  }
}

/** Comprueba varios nombres con un pool de concurrencia limitado. */
export async function checkMany(
  names: string[],
  concurrency = 8,
  onResult?: (name: string, status: Availability) => void,
): Promise<Map<string, Availability>> {
  const out = new Map<string, Availability>();
  let i = 0;
  async function worker() {
    while (i < names.length) {
      const name = names[i++];
      const status = await checkDotCom(name);
      out.set(name, status);
      onResult?.(name, status);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, names.length) }, worker));
  return out;
}
