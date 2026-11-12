// Base de conhecimento da IA, fatiada e vetorizada (pgvector) para o assistente
// buscar por significado a cada mensagem. Quatro fontes:
//   proposta_aprovada  os acertos, como padrão, sem nomes: para todos
//   aprendizado        reprovações e correções do gerente, sem nomes: para todos
//   arquivo            documentos inseridos na plataforma: para todos
//   conversa           a conversa inteira, com nomes: SÓ para o próprio dono
// Regra do Leo (05/11/2026): "tudo, para o chat ir aprendendo com os erros e os
// acertos". A regra ética continua: um vendedor nunca vê o negócio de outro.
// Preço nunca sai daqui: vem do catálogo.
import { createHash, randomUUID } from "node:crypto";
import { consulta, transacao, UTC_AGORA } from "./db.mjs";
import { auditar } from "./auditoria.mjs";
import { FAIXA_NOME, GRUPOS, NIVEIS, NIVEL_NOME, COMPONENTES, nomeSolucao } from "./catalogo.mjs";
import { totais, brl } from "./proposta.mjs";

const BASE = () => process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";
const MODELO_VETOR = () => process.env.OPENAI_MODELO_VETOR || "text-embedding-3-small";
export const CATEGORIAS = { solucao: "Descrição de solução", escopo: "Escopo / termo de referência", proposta: "Proposta", preco: "Tabela de preço", manual: "Manual / PRD", outro: "Outro" };
export const baseLigada = () => !!process.env.OPENAI_API_KEY;

/** Vetores de 1536 dimensões, em lotes. */
export async function vetorizar(textos) {
  const out = [];
  for (let i = 0; i < textos.length; i += 64) {
    const r = await fetch(`${BASE()}/embeddings`, {
      method: "POST", headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: MODELO_VETOR(), input: textos.slice(i, i + 64), dimensions: 1536 }), signal: AbortSignal.timeout(30_000),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error?.message || `OpenAI ${r.status}`);
    out.push(...d.data.sort((a, b) => a.index - b.index).map((x) => x.embedding));
  }
  return out;
}
const vetorSql = (v) => `[${v.join(",")}]`;

/** Trechos de ~1.800 caracteres, quebrando em parágrafo e repetindo um pouco do
 *  fim do anterior (igual ao E- Propostas). */
export function fatiar(texto, alvo = 1800, sobra = 250) {
  const pars = String(texto).split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean), out = [];
  let atual = "";
  const fechar = () => { if (atual.trim()) out.push(atual.trim()); atual = atual.slice(-sobra); };
  for (const p of pars) {
    if (p.length > alvo) {
      for (const f of p.split(/(?<=[.!?;\n])\s+/)) { if ((atual + " " + f).length > alvo) fechar(); atual += (atual ? " " : "") + f; }
      continue;
    }
    if ((atual + "\n\n" + p).length > alvo) fechar();
    atual += (atual ? "\n\n" : "") + p;
  }
  if (atual.trim() && (!out.length || !out[out.length - 1].endsWith(atual.trim()))) out.push(atual.trim());
  return out;
}
/** Planilha (.xlsx, .csv): um trecho por bloco (ex.: uma solução), sem misturar blocos;
 *  bloco grande é dividido por linhas, repetindo o título do bloco em cada pedaço. */
export function fatiarPorBloco(texto, alvo = 1800) {
  const out = [];
  for (const bloco of String(texto).split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean)) {
    if (bloco.length <= alvo * 1.3) { out.push(bloco); continue; }
    const [titulo, ...linhas] = bloco.split("\n");
    let atual = titulo;
    for (const l of linhas) { if ((atual + "\n" + l).length > alvo && atual !== titulo) { out.push(atual); atual = titulo; } atual += "\n" + l; }
    if (atual !== titulo) out.push(atual);
  }
  return out;
}
const md5 = (t) => createHash("md5").update(t).digest("hex");

/* ═══ proposta aprovada → texto de padrão, sem nomes ═══ */
const REGIAO = { AC: "Norte", AM: "Norte", AP: "Norte", PA: "Norte", RO: "Norte", RR: "Norte", TO: "Norte", AL: "Nordeste", BA: "Nordeste", CE: "Nordeste", MA: "Nordeste",
  PB: "Nordeste", PE: "Nordeste", PI: "Nordeste", RN: "Nordeste", SE: "Nordeste", DF: "Centro-Oeste", GO: "Centro-Oeste", MT: "Centro-Oeste", MS: "Centro-Oeste",
  ES: "Sudeste", MG: "Sudeste", RJ: "Sudeste", SP: "Sudeste", PR: "Sul", RS: "Sul", SC: "Sul" };
const MODALIDADE = { ata_inexigibilidade: "ATA de registro de preços por inexigibilidade + adesão", inexigibilidade: "Inexigibilidade", dispensa: "Dispensa", adesao_ata: "Adesão a ATA" };
function porte(e) {
  if (e.setor === "privado") return "cliente privado";
  const p = Number(e.populacao) || 0;
  if (!p) return e.cidade ? "município (população não informada)" : "órgão estadual ou outro ente público";
  return p <= 5000 ? "município de até 5 mil habitantes" : p <= 20000 ? "município de 5 a 20 mil habitantes" : p <= 100000 ? "município de 20 a 100 mil habitantes" : "município com mais de 100 mil habitantes";
}
/** Tira de um texto livre os nomes que identificam o negócio. */
function semNomes(t, nomes) {
  let s = String(t ?? "");
  for (const n of nomes) if (n && n.length >= 3) s = s.replace(new RegExp(n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), "[omitido]");
  return s;
}
export function textoDaProposta(c, versao, donoNome) {
  const e = c.estado, cfg = e.config ?? {}, planos = versao?.planos ?? e.planos ?? {};
  const nomes = [e.cliente, c.titulo, e.cidade, donoNome, ...(String(donoNome ?? "").split(" "))].filter(Boolean);
  const L = [];
  L.push(`Proposta aprovada pelo gerente — padrão de negócio (sem nomes).`);
  L.push(`Solução: ${nomeSolucao(e.solucao) || "não informada"}. Setor: ${e.setor === "privado" ? "privado" : "público"}. Porte: ${porte(e)}.${e.uf && REGIAO[e.uf] ? ` Região: ${REGIAO[e.uf]}.` : ""}`);
  if (e.setor !== "privado") L.push(`Modalidade de contratação: ${MODALIDADE[e.modalidade] ?? "não definida"}.`);
  L.push(`Canal: ${cfg.publico === "interno" ? "app de uso interno" : "para a população"}, ${FAIXA_NOME[cfg.faixa] ?? "faixa não definida"}, ${cfg.canalTipo === "subcanal" ? "subcanal" : "canal padrão"}.` +
    (e.motivoFaixa ? ` A faixa sugerida pela regra era ${FAIXA_NOME[e.faixaSugerida] ?? e.faixaSugerida}; o vendedor trocou porque: ${semNomes(e.motivoFaixa, nomes)}.` : ""));
  L.push(`Monitoramento: ${cfg.monitoramento === "customizado" ? "customizado" : "padrão"}. Suporte remoto: ${cfg.horasRemoto ?? 0} h/mês. Suporte local: ${cfg.suporteLocal ?? 0} operador(es). Integração com outros sistemas: ${cfg.integracao ? "sim" : "não"}.`);
  L.push(`Aprovada na ${c.versoes.length}ª versão.`);
  for (const n of NIVEIS) {
    const its = planos[n] ?? [], t = totais(its);
    L.push("");
    L.push(`Plano ${NIVEL_NOME[n]}: ${brl(t.mensal)}/mês, 1º mês ${brl(t.mes1)}, 12 meses ${brl(t.total12)}${t.gratis ? `; ${t.gratis} item(ns) sem custo (${brl(t.gratis12)} em 12 meses)` : ""}.`);
    for (const it of its) {
      L.push(`- ${GRUPOS[it.grupo] ?? it.grupo}: ${it.qtd} × ${it.nome} (${COMPONENTES[it.componente] ?? it.componente})${it.gratis ? " — sem custo" : ""}${it.para ? ` — para quê: ${semNomes(it.para, nomes)}` : ""}`);
    }
  }
  return L.join("\n");
}

/* ═══ erros: o que o gerente reprovou ou corrigiu vira aprendizado, sem nomes ═══ */
export function textoDoAprendizado(c, versoes, nomesExtras = []) {
  const e = c.estado ?? {}, nomes = [e.cliente, c.titulo, e.cidade, ...nomesExtras.flatMap((n) => [n, ...String(n ?? "").split(/\s+/)])].filter(Boolean);
  const L = [];
  for (const v of versoes) {
    const corrigida = /corrigida/i.test(v.nota ?? "");
    if (!v.motivo && !corrigida) continue;
    if (v.motivo) L.push(`Na ${v.numero}ª versão o gerente reprovou. Motivo: ${semNomes(v.motivo, nomes)}`);
    if (corrigida) L.push(`Na ${v.numero}ª versão o gerente corrigiu a proposta.${(v.mudou ?? []).length ? ` O que ele mudou: ${v.mudou.map((x) => semNomes(x, nomes)).join("; ")}.` : ""}`);
    const seguinte = versoes.find((x) => x.numero === v.numero + 1);
    if (v.motivo && seguinte?.mudou?.length) L.push(`O que o vendedor mudou depois: ${seguinte.mudou.map((x) => semNomes(x, nomes)).join("; ")}.`);
  }
  if (!L.length) return "";
  return [`Erro a evitar — o que o gerente reprovou ou corrigiu numa proposta (sem nomes).`,
    `Solução: ${nomeSolucao(e.solucao) || "não informada"}. Setor: ${e.setor === "privado" ? "privado" : "público"}. Porte: ${porte(e)}.`, ...L,
    c.status === "aprovada" ? "Depois disso, a proposta foi aprovada." : "A proposta ainda não foi aprovada."].join("\n");
}
/* ═══ a conversa inteira: tem nomes, então só o dono encontra ═══ */
const LIMITE_CONVERSA = 60_000;
export function textoDaConversa(mensagens, anexos = []) {
  const L = mensagens.filter((m) => (m.tipo === "usuario" || m.tipo === "assistente") && !m.extra?.erro && String(m.texto ?? "").trim())
    .map((m) => `${m.tipo === "usuario" ? "Vendedor" : "Assistente"}: ${String(m.texto).trim()}`);
  if (!L.some((x) => x.startsWith("Vendedor:"))) return "";
  for (const a of anexos) if (String(a.texto ?? "").trim()) L.push(`Anexo ${a.nome}: ${String(a.texto).trim().slice(0, 20_000)}`);
  return L.join("\n\n").slice(0, LIMITE_CONVERSA);
}
/** Grava ou atualiza um documento gerado pelo sistema; só vetoriza de novo se o texto mudou (ou se falhou da última vez). */
async function guardarGerado({ origem, refId, donoId = null, titulo, categoria, solucao, setor, texto }) {
  const hash = md5(texto);
  const ja = (await consulta("SELECT id, hash, situacao FROM base_documento WHERE origem = $1 AND ref_id = $2 AND deleted_at IS NULL", [origem, refId])).rows[0];
  if (!ja) await consulta(`INSERT INTO base_documento (id, origem, ref_id, dono_id, titulo, categoria, solucao, setor, texto, caracteres, hash, situacao, criado_em, atualizado_em)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'pendente', ${UTC_AGORA}, ${UTC_AGORA})`,
    [randomUUID(), origem, refId, donoId, titulo, categoria, solucao ?? "", setor ?? "", texto, texto.length, hash]);
  else if (ja.hash !== hash || ja.situacao === "erro") await consulta(`UPDATE base_documento SET titulo = $2, texto = $3, caracteres = $4, hash = $5, situacao = 'pendente', erro = NULL, atualizado_em = ${UTC_AGORA} WHERE id = $1`,
    [ja.id, titulo, texto, texto.length, hash]);
}
async function sincronizarConversas() {
  const conversas = (await consulta(`SELECT c.id, c.titulo, c.status, c.estado, c.dono_id, d.nome AS dono_nome FROM chat_conversa c JOIN usuario d ON d.id = c.dono_id WHERE c.deleted_at IS NULL`)).rows;
  const vivas = new Set(), comAprendizado = new Set();
  for (const c of conversas) {
    vivas.add(c.id);
    const msgs = (await consulta("SELECT tipo, texto, extra FROM chat_mensagem WHERE conversa_id = $1 ORDER BY criado_em, id", [c.id])).rows;
    const anexos = (await consulta("SELECT nome, texto FROM chat_anexo WHERE conversa_id = $1 ORDER BY criado_em", [c.id])).rows;
    const conversa = textoDaConversa(msgs, anexos);
    if (conversa) await guardarGerado({ origem: "conversa", refId: c.id, donoId: c.dono_id, titulo: `Sua conversa: ${c.titulo}`, categoria: "outro", solucao: c.estado?.solucao, setor: c.estado?.setor, texto: conversa });
    const versoes = (await consulta("SELECT numero, nota, motivo, mudou, criado_por_nome FROM chat_versao WHERE conversa_id = $1 ORDER BY numero", [c.id])).rows;
    const licao = textoDoAprendizado(c, versoes, [c.dono_nome, ...versoes.map((v) => v.criado_por_nome)]);
    if (licao) { comAprendizado.add(c.id); await guardarGerado({ origem: "aprendizado", refId: c.id, titulo: `Erro a evitar · ${nomeSolucao(c.estado?.solucao) || "solução não informada"} · ${porte(c.estado ?? {})}`, categoria: "proposta", solucao: c.estado?.solucao, setor: c.estado?.setor, texto: licao }); }
  }
  // conversa na lixeira ou apagada sai da base de verdade (os trechos vão junto); se restaurar, vetoriza de novo
  const docs = (await consulta("SELECT id, origem, ref_id FROM base_documento WHERE origem IN ('conversa', 'aprendizado')")).rows;
  for (const d of docs) if (!vivas.has(d.ref_id) || (d.origem === "aprendizado" && !comAprendizado.has(d.ref_id))) await consulta("DELETE FROM base_documento WHERE id = $1", [d.id]);
}

/* ═══ acertos: propostas aprovadas viram documentos; textos novos são vetorizados ═══ */
async function sincronizarPropostas() {
  const r = await consulta(`SELECT c.id, c.titulo, c.status, c.estado, d.nome AS dono_nome,
      (SELECT row_to_json(v) FROM chat_versao v WHERE v.conversa_id = c.id ORDER BY v.numero DESC LIMIT 1) AS versao,
      (SELECT count(*)::int FROM chat_versao v WHERE v.conversa_id = c.id) AS nversoes
    FROM chat_conversa c JOIN usuario d ON d.id = c.dono_id WHERE c.status = 'aprovada' AND c.deleted_at IS NULL`);
  const vivos = new Set();
  for (const x of r.rows) {
    vivos.add(x.id);
    const c = { id: x.id, titulo: x.titulo, estado: x.estado, versoes: Array.from({ length: x.nversoes }) };
    const texto = textoDaProposta(c, x.versao, x.dono_nome), hash = md5(texto);
    const titulo = `Proposta aprovada · ${nomeSolucao(x.estado.solucao) || "solução não informada"} · ${porte(x.estado)}`;
    const ja = (await consulta("SELECT id, hash FROM base_documento WHERE origem = 'proposta_aprovada' AND ref_id = $1 AND deleted_at IS NULL", [x.id])).rows[0];
    if (!ja) await consulta(`INSERT INTO base_documento (id, origem, ref_id, titulo, categoria, solucao, setor, texto, caracteres, hash, situacao, criado_em, atualizado_em)
      VALUES ($1, 'proposta_aprovada', $2, $3, 'proposta', $4, $5, $6, $7, $8, 'pendente', ${UTC_AGORA}, ${UTC_AGORA})`,
      [randomUUID(), x.id, titulo, x.estado.solucao ?? "", x.estado.setor ?? "", texto, texto.length, hash]);
    else if (ja.hash !== hash) await consulta(`UPDATE base_documento SET titulo = $2, texto = $3, caracteres = $4, hash = $5, situacao = 'pendente', erro = NULL, atualizado_em = ${UTC_AGORA} WHERE id = $1`,
      [ja.id, titulo, texto, texto.length, hash]);
  }
  // proposta que deixou de estar aprovada (reaberta, apagada) sai da base
  const fora = (await consulta("SELECT id, ref_id FROM base_documento WHERE origem = 'proposta_aprovada' AND deleted_at IS NULL")).rows.filter((d) => !vivos.has(d.ref_id));
  for (const d of fora) await consulta(`UPDATE base_documento SET deleted_at = ${UTC_AGORA}, deleted_by = 'sistema' WHERE id = $1`, [d.id]);
}
async function vetorizarPendentes() {
  const docs = (await consulta("SELECT id, titulo, texto, arquivo FROM base_documento WHERE situacao = 'pendente' AND deleted_at IS NULL ORDER BY criado_em LIMIT 25")).rows;
  for (const d of docs) {
    try {
      const trechos = /\.(xlsx|csv|tsv)$/i.test(d.arquivo ?? "") ? fatiarPorBloco(d.texto) : fatiar(d.texto);
      if (!trechos.length) throw new Error("Não há texto legível neste documento.");
      // o título vai junto no texto vetorizado: ajuda a busca a achar pelo assunto
      const vetores = await vetorizar(trechos.map((t) => `${d.titulo}\n\n${t}`));
      await transacao(async (q) => {
        await q("DELETE FROM base_trecho WHERE documento_id = $1", [d.id]);
        for (let i = 0; i < trechos.length; i++)
          await q(`INSERT INTO base_trecho (id, documento_id, ordem, texto, vetor, criado_em) VALUES ($1, $2, $3, $4, $5::extensions.vector, ${UTC_AGORA})`,
            [randomUUID(), d.id, i, trechos[i], vetorSql(vetores[i])]);
        await q(`UPDATE base_documento SET situacao = 'pronto', erro = NULL, trechos = $2, atualizado_em = ${UTC_AGORA} WHERE id = $1`, [d.id, trechos.length]);
      });
    } catch (e) {
      await consulta(`UPDATE base_documento SET situacao = 'erro', erro = $2, atualizado_em = ${UTC_AGORA} WHERE id = $1`, [d.id, String(e.message).slice(0, 300)]);
    }
  }
}
let rodando = null;
/** Põe a base em dia. Pode ser chamada à vontade: uma rodada de cada vez. */
export function atualizarConhecimento() {
  if (!baseLigada()) return Promise.resolve();
  if (rodando) return rodando;
  rodando = (async () => { try { await sincronizarPropostas(); await sincronizarConversas(); await vetorizarPendentes(); } catch (e) { console.error("Base de conhecimento:", e.message); } finally { rodando = null; } })();
  return rodando;
}

/* ═══ busca: os trechos mais parecidos com a pergunta ═══ */
/** dono: de quem são as conversas que podem aparecer. Sem dono, nenhuma conversa aparece.
 *  conversaAtual: fica de fora, porque já está no histórico. */
export async function buscar(pergunta, { solucao = "", limite = 6, dono = "", conversaAtual = "" } = {}) {
  if (!baseLigada() || !String(pergunta).trim()) return [];
  const lim = Math.max(1, Math.min(12, limite));
  const tem = (await consulta("SELECT 1 FROM base_documento WHERE situacao = 'pronto' AND deleted_at IS NULL AND (origem <> 'conversa' OR (dono_id = $1 AND ref_id <> $2)) LIMIT 1", [dono, conversaAtual])).rowCount;
  if (!tem) return [];
  const [v] = await vetorizar([String(pergunta).slice(0, 6000)]);
  // mesma solução ganha um pequeno empurrão; o resto é pela semelhança
  const r = await consulta(`SELECT t.texto, d.titulo, d.origem, d.solucao, (t.vetor OPERATOR(extensions.<=>) $1::extensions.vector) AS dist
    FROM base_trecho t JOIN base_documento d ON d.id = t.documento_id
    WHERE d.deleted_at IS NULL AND d.situacao = 'pronto' AND (d.origem <> 'conversa' OR (d.dono_id = $4 AND d.ref_id <> $5))
    ORDER BY (t.vetor OPERATOR(extensions.<=>) $1::extensions.vector) - CASE WHEN $2 <> '' AND d.solucao = $2 THEN 0.05 ELSE 0 END
    LIMIT $3`, [vetorSql(v), solucao ?? "", lim * 3, dono, conversaAtual]);
  // as conversas são longas e venceriam sempre: no máximo 2, para os erros e acertos também aparecerem
  let conversas = 0;
  return r.rows.filter((x) => x.dist < 0.8 && (x.origem !== "conversa" || ++conversas <= 2)).slice(0, lim)
    .map((x) => ({ titulo: x.titulo, origem: x.origem, solucao: x.solucao, texto: x.texto, semelhanca: Math.round((1 - x.dist) * 100) / 100 }));
}

/* ═══ documentos inseridos na plataforma (Configurações › Base de contexto) ═══ */
export async function listarDocumentos() {
  return (await consulta(`SELECT d.id, d.origem, d.titulo, d.categoria, d.solucao, d.setor, d.arquivo, d.tamanho, d.caracteres, d.situacao, d.erro, d.trechos, d.criado_em, u.nome AS enviado_por
    FROM base_documento d LEFT JOIN usuario u ON u.id = d.enviado_por_id WHERE d.deleted_at IS NULL AND d.origem <> 'conversa' ORDER BY d.origem DESC, d.criado_em DESC`)).rows.map((d) => ({
    id: d.id, origem: d.origem, titulo: d.origem === "proposta_aprovada" ? d.titulo : d.titulo, categoria: d.categoria, solucao: nomeSolucao(d.solucao), setor: d.setor,
    arquivo: d.arquivo, tamanho: d.tamanho, caracteres: d.caracteres, situacao: d.situacao, erro: d.erro, trechos: d.trechos, criadoEm: d.criado_em, enviadoPor: d.enviado_por ?? "" }));
}
/** Só os números: quantas conversas já alimentam a base. Os títulos ficam com cada dono. */
export async function resumoConversas() {
  return (await consulta("SELECT count(*)::int AS conversas, coalesce(sum(trechos), 0)::int AS trechos FROM base_documento WHERE origem = 'conversa' AND situacao = 'pronto' AND deleted_at IS NULL")).rows[0];
}
export async function inserirDocumento({ titulo, categoria, solucao, setor, arquivo, tipo, dados, texto }, quem) {
  if (!String(texto).trim()) throw new Error("Não consegui ler texto nesse arquivo. Envie PDF, Word, Excel (.xlsx), CSV, TXT ou HTML.");
  const hash = createHash("sha256").update(dados).digest("hex");
  const ja = (await consulta("SELECT titulo FROM base_documento WHERE origem = 'arquivo' AND hash = $1 AND deleted_at IS NULL", [hash])).rows[0];
  if (ja) throw new Error(`Esse arquivo já está na base (“${ja.titulo}”).`);
  const id = randomUUID();
  await consulta(`INSERT INTO base_documento (id, origem, titulo, categoria, solucao, setor, arquivo, tipo, tamanho, conteudo, texto, caracteres, hash, situacao, enviado_por_id, criado_em, atualizado_em)
    VALUES ($1, 'arquivo', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'pendente', $13, ${UTC_AGORA}, ${UTC_AGORA})`,
    [id, titulo, CATEGORIAS[categoria] ? categoria : "outro", solucao ?? "", setor ?? "", arquivo, tipo ?? "", dados.length, dados, texto, texto.length, hash, quem.id]);
  await auditar({ ator: quem, origem: "TELA", entity: "base_documento", entityId: id, event: "base.documento_inserido", action: "CREATE",
    after: { titulo, categoria, solucao, arquivo, caracteres: texto.length } });
  atualizarConhecimento();
  return id;
}
export async function removerDocumento(id, quem) {
  const r = await consulta(`UPDATE base_documento SET deleted_at = ${UTC_AGORA}, deleted_by = $2 WHERE id = $1 AND origem = 'arquivo' AND deleted_at IS NULL RETURNING titulo`, [id, quem.id]);
  if (!r.rowCount) return false;
  await auditar({ ator: quem, origem: "TELA", entity: "base_documento", entityId: id, event: "base.documento_removido", action: "DELETE", before: { titulo: r.rows[0].titulo } });
  return true;
}
export async function arquivoDoDocumento(id) {
  return (await consulta("SELECT arquivo, tipo, conteudo FROM base_documento WHERE id = $1 AND origem = 'arquivo' AND deleted_at IS NULL", [id])).rows[0] ?? null;
}
