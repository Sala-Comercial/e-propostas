import zlib from "node:zlib";
// Serviços de fora: HubSpot (token no .env), IBGE e leitura de anexos.
// Regra ética da SASI: toda busca no HubSpot filtra pelo dono — negócio de
// outro vendedor não volta, nem pelo nome.

const API = () => process.env.HUBSPOT_API || "https://api.hubapi.com";
const V = () => process.env.HUBSPOT_VERSAO || "2026-09";
export const hubspotLigado = () => !!process.env.HUBSPOT_TOKEN;
const PROPS = ["dealname", "projeto", "cidade", "cidade___uf", "tipo_de_entidade", "dealstage", "hs_lastmodifieddate", "hubspot_owner_id"];

async function hs(caminho, init = {}) {
  const r = await fetch(`${API()}${caminho}`, {
    ...init,
    headers: { Authorization: `Bearer ${process.env.HUBSPOT_TOKEN}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(20_000),
  });
  if (!r.ok) throw new Error(`HubSpot ${r.status}: ${(await r.text()).slice(0, 300)}`);
  return r.json();
}

const donos = new Map();
export async function donoPorEmail(email) {
  const k = email.toLowerCase();
  if (donos.has(k)) return donos.get(k);
  const d = await hs(`/crm/owners/${V()}?email=${encodeURIComponent(k)}&archived=false&limit=1`);
  const id = d.results?.find((o) => o.email?.toLowerCase() === k)?.id ?? null;
  donos.set(k, id);
  return id;
}
function paraNegocio(b) {
  const p = b.properties, cuf = (p.cidade___uf ?? "").split(/\s*[-/]\s*/), ent = p.tipo_de_entidade ?? "";
  return {
    id: b.id, nome: p.dealname ?? "(sem nome)", solucao: p.projeto ?? "",
    cidade: p.cidade || cuf[0] || "", uf: (cuf[1] ?? "").slice(0, 2).toUpperCase(),
    setor: !ent ? null : ent === "Não trabalho em entidade pública" ? "privado" : "publico", atualizado: (p.hs_lastmodifieddate ?? "").slice(0, 10),
  };
}
export async function negociosDoDono(donoId, termo, limite = 3) {
  const corpo = {
    filterGroups: [{ filters: [{ propertyName: "hubspot_owner_id", operator: "EQ", value: donoId }] }],
    sorts: [{ propertyName: "hs_lastmodifieddate", direction: "DESCENDING" }], properties: PROPS, limit: Math.min(20, limite), after: "0",
  };
  if (termo?.trim()) corpo.query = termo.trim().slice(0, 100);
  const d = await hs(`/crm/objects/${V()}/deals/search`, { method: "POST", body: JSON.stringify(corpo) });
  // conferência dupla da regra ética
  return (d.results ?? []).filter((b) => b.properties.hubspot_owner_id === donoId).map(paraNegocio);
}
export async function negocioDoDono(id, donoId) {
  try {
    const b = await hs(`/crm/objects/${V()}/deals/${encodeURIComponent(id)}?properties=${PROPS.join(",")}`);
    return b.properties.hubspot_owner_id === donoId ? paraNegocio(b) : null;
  } catch { return null; }
}
async function etapaInicial() {
  if (process.env.HUBSPOT_PIPELINE && process.env.HUBSPOT_ETAPA) return { pipeline: process.env.HUBSPOT_PIPELINE, etapa: process.env.HUBSPOT_ETAPA };
  const d = await hs("/crm/v3/pipelines/deals");
  const p = (process.env.HUBSPOT_PIPELINE && d.results.find((x) => x.id === process.env.HUBSPOT_PIPELINE)) || [...d.results].sort((a, b) => a.displayOrder - b.displayOrder)[0];
  return { pipeline: p.id, etapa: [...p.stages].sort((a, b) => a.displayOrder - b.displayOrder)[0].id };
}
export async function criarNegocio(donoId, d) {
  const { pipeline, etapa } = await etapaInicial();
  const props = { dealname: d.nome.slice(0, 200), projeto: d.solucao, hubspot_owner_id: donoId, pipeline, dealstage: etapa };
  if (d.cidade) props.cidade = d.cidade;
  if (d.cidade && d.uf) props.cidade___uf = `${d.cidade} - ${d.uf}`;
  if (d.setor === "privado") props.tipo_de_entidade = "Não trabalho em entidade pública";
  const b = await hs(`/crm/objects/${V()}/deals`, { method: "POST", body: JSON.stringify({ properties: props, associations: [] }) });
  return paraNegocio({ ...b, properties: { ...props, ...b.properties } });
}

/* ═══ IBGE: população residente, Censo 2022 ═══ */
const IBGE = "https://servicodados.ibge.gov.br/api";
const cacheIBGE = new Map();
const norm = (s) => String(s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
export async function populacao(cidade, uf) {
  const k = `${norm(cidade)}-${norm(uf)}`;
  if (cacheIBGE.has(k)) return cacheIBGE.get(k);
  const r = await fetch(`${IBGE}/v1/localidades/estados/${encodeURIComponent(uf.toUpperCase())}/municipios`, { signal: AbortSignal.timeout(15_000) });
  if (!r.ok) throw new Error(`IBGE ${r.status}`);
  const m = (await r.json()).find((x) => norm(x.nome) === norm(cidade));
  if (!m) { cacheIBGE.set(k, null); return null; }
  const p = await fetch(`${IBGE}/v3/agregados/4709/periodos/2022/variaveis/93?localidades=N6%5B${m.id}%5D`, { signal: AbortSignal.timeout(15_000) });
  const pop = Number((await p.json())[0]?.resultados?.[0]?.series?.[0]?.serie?.["2022"]);
  const out = pop > 0 ? { nome: m.nome, pop } : null;
  cacheIBGE.set(k, out);
  return out;
}

/* ═══ texto dos anexos (PDF, Word, texto) ═══ */
export async function extrairTexto(nome, tipo, dados) {
  const ext = (/\.([a-z0-9]+)$/i.exec(nome)?.[1] ?? "").toLowerCase();
  const limpar = (t) => t.replace(/\r/g, "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  try {
    if (ext === "pdf") {
      const { extractText, getDocumentProxy } = await import("unpdf");
      const { text } = await extractText(await getDocumentProxy(new Uint8Array(dados)), { mergePages: true });
      return limpar(text);
    }
    if (ext === "docx") { const m = await import("mammoth"); return limpar((await m.extractRawText({ buffer: dados })).value); }
    if (["txt", "md", "csv", "json", "tsv"].includes(ext)) return limpar(dados.toString("utf8"));
    if (ext === "html" || ext === "htm") return limpar(dados.toString("utf8").replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]+>/g, " "));
    if (ext === "xlsx") return limpar(textoDaPlanilha(dados));
  } catch { return ""; }
  return "";
}

/* ═══ planilha .xlsx: um zip de XMLs; lido com o zlib do Node, sem biblioteca ═══ */
function arquivosDoZip(buf) {
  let fim = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { fim = i; break; }
  if (fim < 0) return new Map();
  const total = buf.readUInt16LE(fim + 10), out = new Map();
  let p = buf.readUInt32LE(fim + 16);
  for (let k = 0; k < total && buf.readUInt32LE(p) === 0x02014b50; k++) {
    const metodo = buf.readUInt16LE(p + 10), tam = buf.readUInt32LE(p + 20), nl = buf.readUInt16LE(p + 28), xl = buf.readUInt16LE(p + 30), cl = buf.readUInt16LE(p + 32);
    const nome = buf.toString("utf8", p + 46, p + 46 + nl), local = buf.readUInt32LE(p + 42);
    const ini = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    out.set(nome, () => { const d = buf.subarray(ini, ini + tam); return (metodo === 8 ? zlib.inflateRawSync(d) : d).toString("utf8"); });
    p += 46 + nl + xl + cl;
  }
  return out;
}
const desfazXml = (t) => t.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/&amp;/g, "&");
function textoDaPlanilha(dados) {
  const z = arquivosDoZip(dados);
  const comp = [...(z.get("xl/sharedStrings.xml")?.() ?? "").matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => desfazXml([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((x) => x[1]).join("")));
  const nomes = [...(z.get("xl/workbook.xml")?.() ?? "").matchAll(/<sheet [^>]*name="([^"]*)"/g)].map((m) => desfazXml(m[1]));
  const partes = [];
  for (let i = 1; z.has(`xl/worksheets/sheet${i}.xml`); i++) {
    const linhas = [];
    let umaCelula = false;
    for (const row of z.get(`xl/worksheets/sheet${i}.xml`)().matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
      const cels = [];
      for (const c of row[1].matchAll(/<c ([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const t = /t="(\w+)"/.exec(c[1])?.[1], corpo = c[2] ?? "";
        const v = t === "s" ? comp[+(/<v>([^<]*)<\/v>/.exec(corpo)?.[1] ?? -1)] ?? "" : t === "inlineStr" ? [...corpo.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((x) => x[1]).join("") : /<v>([^<]*)<\/v>/.exec(corpo)?.[1] ?? "";
        if (v !== "") cels.push(desfazXml(v));
      }
      // linha de uma célula só costuma ser título de bloco (ex.: o nome da solução): abre parágrafo novo,
      // mas títulos seguidos (título + observação) ficam juntos com as linhas que vêm depois
      if (cels.length === 1 && linhas.length && !umaCelula) linhas.push("");
      if (cels.length) { linhas.push(cels.join(" | ")); umaCelula = cels.length === 1; }
    }
    if (linhas.length) partes.push(`## ${nomes[i - 1] ?? `Aba ${i}`}\n` + linhas.join("\n"));
  }
  return partes.join("\n\n");
}
