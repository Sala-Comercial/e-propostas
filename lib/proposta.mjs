// A proposta de uma conversa: estado, planos, contas, versões, revisão.
// Guardada no Postgres (chat_conversa + chat_versao + chat_mensagem + chat_anexo
// + notificacao); cada pedido carrega, mexe no objeto e grava tudo numa transação.
import { novoId, agoraISO, ehGerente, ehAprovador, ehSuperAdmin, veTudo, quemAprova, podeAprovarValor, idsSuperAdmin, NIVEL_NOME as NIVEL_APROV } from "./base.mjs";
import { consulta, transacao, UTC_AGORA } from "./db.mjs";
import { auditar, diffCampos } from "./auditoria.mjs";
import { FAIXA_NOME, GRUPOS, NIVEIS, NIVEL_NOME, linhasDoGrupo, montarPlano, nomeSolucao, paraItem } from "./catalogo.mjs";

export const STATUS_NOME = { rascunho: "Rascunho", revisao: "Com o gerente", ajustar: "Para ajustar", aprovada: "Aprovada pelo gerente" };
export { ehGerente };
export const DIAS_NA_LIXEIRA = 30;

/* ═══ guarda ═══
 * O que nasce durante um pedido (mensagens, anexos, avisos) entra na fila da
 * conversa e é gravado junto com ela em salvarConversa — ou nada é gravado. */
const fila = new WeakMap();
const foto = new WeakMap(); // como a conversa estava ao carregar: base do diff do audit_log
const filaDe = (c) => { let f = fila.get(c); if (!f) fila.set(c, (f = { mensagens: [], anexos: [], notificacoes: [], semAnexos: [] })); return f; };
const fotoDe = (c) => structuredClone({ titulo: c.titulo, status: c.status, corrigida: c.corrigida, estado: c.estado });
export class Conflito extends Error {}

export function novaConversa(u) {
  const agora = agoraISO();
  return { id: novoId(), donoId: u.id, titulo: "Nova conversa", status: "rascunho", estado: {}, versoes: [], registro: [], corrigida: false, trava: null, criadoEm: agora, atualizadoEm: agora };
}
/** anexos: [{ id, nome, tipo, tamanho, conteudo (Buffer), texto }] — a mensagem guarda só o resumo. */
export function novaMensagem(c, tipo, texto, extra = {}, autorId = null, anexos = []) {
  const m = { id: novoId(), conversaId: c.id, tipo, texto, extra, autorId, criadoEm: agoraISO(),
    anexos: anexos.map(({ id, nome, tipo: t, tamanho }) => ({ id, nome, tipo: t, tamanho })) };
  const f = filaDe(c);
  f.mensagens.push(m);
  for (const a of anexos) f.anexos.push({ ...a, mensagemId: m.id });
  return m;
}
export function notificar(c, paraIds, texto) {
  for (const p of new Set(paraIds)) filaDe(c).notificacoes.push({ id: novoId(), para: p, texto, conversaId: c.id, criadoEm: agoraISO() });
}

const versaoDoBanco = (r) => ({ id: r.id, n: r.numero, em: r.criado_em, autor: r.criado_por_nome, autorId: r.criado_por_id, nota: r.nota,
  ...(r.motivo ? { motivo: r.motivo } : {}), mudou: r.mudou, planos: r.planos, totais: r.totais, atual: r.is_current });

/** A conversa inteira (com as versões), ou null se não existe ou está na lixeira. */
export async function carregarConversa(id) {
  const r = (await consulta("SELECT * FROM chat_conversa WHERE id = $1 AND deleted_at IS NULL", [String(id)])).rows[0];
  if (!r) return null;
  const versoes = (await consulta("SELECT * FROM chat_versao WHERE conversa_id = $1 ORDER BY numero", [r.id])).rows.map(versaoDoBanco);
  const c = { id: r.id, donoId: r.dono_id, titulo: r.titulo, status: r.status, estado: r.estado, versoes, registro: r.registro,
    corrigida: r.corrigida, trava: r.trava, criadoEm: r.criado_em, atualizadoEm: r.atualizado_em };
  foto.set(c, fotoDe(c));
  return c;
}

/** Lista da barra lateral: cada um vê o que podeVer deixa (as próprias; as enviadas da sua alçada; tudo, para o desenvolvedor). */
export async function listarConversas(u) {
  const amplo = ehAprovador(u) || veTudo(u);
  const r = await consulta(`SELECT c.id, c.titulo, c.status, c.estado->>'solucao' AS solucao, c.dono_id, d.nome AS dono_nome, c.atualizado_em,
      (SELECT count(*)::int FROM chat_versao v WHERE v.conversa_id = c.id) AS versoes, CASE WHEN c.dono_id = $1 THEN NULL ELSE c.estado END AS estado
    FROM chat_conversa c JOIN usuario d ON d.id = c.dono_id
    WHERE c.deleted_at IS NULL AND (c.dono_id = $1 OR ($2 AND ($3 OR EXISTS (SELECT 1 FROM chat_versao v WHERE v.conversa_id = c.id))))
    ORDER BY c.atualizado_em DESC`, [u.id, amplo, veTudo(u)]);
  return r.rows.filter((x) => x.dono_id === u.id || podeVer({ donoId: x.dono_id, versoes: { length: x.versoes }, estado: x.estado ?? {} }, u))
    .map(({ estado, ...x }) => x);
}

export async function listarMensagens(conversaId) {
  const r = await consulta(`SELECT m.*, coalesce((SELECT json_agg(json_build_object('id', a.id, 'nome', a.nome, 'tipo', a.tipo, 'tamanho', a.tamanho) ORDER BY a.criado_em)
      FROM chat_anexo a WHERE a.mensagem_id = m.id), '[]') AS anexos
    FROM chat_mensagem m WHERE m.conversa_id = $1 ORDER BY m.criado_em, m.id`, [conversaId]);
  return r.rows.map((m) => ({ id: m.id, conversaId: m.conversa_id, tipo: m.tipo, texto: m.texto, extra: m.extra, autorId: m.autor_id, anexos: m.anexos, criadoEm: m.criado_em }));
}
export async function anexoDaConversa(conversaId, anexoId) {
  return (await consulta("SELECT nome, tipo, conteudo FROM chat_anexo WHERE id = $1 AND conversa_id = $2", [anexoId, conversaId])).rows[0] ?? null;
}

/* aviso de conversa na lixeira não aparece; volta com ela */
export async function listarNotificacoes(u) {
  const r = await consulta(`SELECT n.* FROM notificacao n LEFT JOIN chat_conversa c ON c.id = n.conversa_id
    WHERE n.para_id = $1 AND (n.conversa_id IS NULL OR c.deleted_at IS NULL) ORDER BY n.criado_em DESC LIMIT 80`, [u.id]);
  return r.rows.map((n) => ({ id: n.id, para: n.para_id, texto: n.texto, conversaId: n.conversa_id, lida: n.lida, criadoEm: n.criado_em }));
}
export async function marcarLidas(u, ids) {
  if (Array.isArray(ids)) await consulta("UPDATE notificacao SET lida = TRUE WHERE para_id = $1 AND id = ANY($2::text[])", [u.id, ids.map(String).slice(0, 500)]);
  else await consulta("UPDATE notificacao SET lida = TRUE WHERE para_id = $1 AND NOT lida", [u.id]);
}

/* para o audit_log: os campos da conversa e do estado, sem os planos (estes vão como frases em meta.mudancas) */
const resumoAudit = (x) => { const { planos, mostrados, calculadora, ...resto } = x.estado ?? {};
  return { titulo: x.titulo, status: x.status, corrigida: x.corrigida, ...resto, ...(calculadora ? { calculadora: totaisDaCalculadora(calculadora) } : {}) }; };
/* a foto da calculadora é grande: no audit_log e nas versões vai só o total de cada opção */
const totaisDaCalculadora = (calc) => Object.fromEntries(Object.entries(calc ?? {}).filter(([, t]) => t).map(([n, t]) => [n, t.totalAnual]));

/**
 * Grava a conversa, as versões e o que estiver na fila, numa transação.
 * Conflito: outra tela gravou a mesma conversa antes (trava otimista).
 */
export async function salvarConversa(c, { ator = null, origem = "TELA", event = "conversa.alterada", ip = null, userAgent = null } = {}) {
  const f = fila.get(c) ?? { mensagens: [], anexos: [], notificacoes: [], semAnexos: [] }, antes = foto.get(c), nova = c.trava == null;
  await transacao(async (q) => {
    if (nova) {
      await q(`INSERT INTO chat_conversa (id, dono_id, titulo, status, estado, registro, corrigida, trava, criado_em, atualizado_em)
        VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, 1, $8, $9)`,
        [c.id, c.donoId, c.titulo, c.status, JSON.stringify(c.estado), JSON.stringify(c.registro), c.corrigida, c.criadoEm, c.atualizadoEm]);
    } else {
      const r = await q(`UPDATE chat_conversa SET titulo = $3, status = $4, estado = $5::jsonb, registro = $6::jsonb, corrigida = $7, atualizado_em = $8, trava = trava + 1
        WHERE id = $1 AND trava = $2 AND deleted_at IS NULL RETURNING trava`,
        [c.id, c.trava, c.titulo, c.status, JSON.stringify(c.estado), JSON.stringify(c.registro), c.corrigida, c.atualizadoEm]);
      if (!r.rowCount) throw new Conflito("A proposta mudou em outra tela. Recarregue a página e tente de novo.");
    }
    for (const v of c.versoes) {
      await q(`INSERT INTO chat_versao (id, conversa_id, numero, nota, motivo, criado_por_id, criado_por_nome, criado_em, is_current, planos, totais, mudou)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11::jsonb, $12::jsonb)
        ON CONFLICT (id) DO UPDATE SET nota = EXCLUDED.nota, motivo = EXCLUDED.motivo, is_current = EXCLUDED.is_current`,
        [v.id, c.id, v.n, v.nota ?? "", v.motivo ?? null, v.autorId ?? null, v.autor ?? "sistema", v.em, !!v.atual,
          JSON.stringify(v.planos), JSON.stringify(v.totais ?? {}), JSON.stringify(v.mudou ?? [])]);
    }
    for (const m of f.mensagens) {
      await q(`INSERT INTO chat_mensagem (id, conversa_id, autor_id, tipo, texto, extra, criado_em) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)`,
        [m.id, c.id, m.autorId, m.tipo, m.texto ?? "", JSON.stringify(m.extra ?? {}), m.criadoEm]);
    }
    for (const a of f.anexos) {
      await q(`INSERT INTO chat_anexo (id, conversa_id, mensagem_id, nome, tipo, tamanho, conteudo, texto, criado_em) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, ${UTC_AGORA})`,
        [a.id, c.id, a.mensagemId, a.nome, a.tipo ?? "", a.tamanho, a.conteudo, a.texto ?? ""]);
    }
    // a imagem da capa trocada sai do banco (só as soltas, nunca anexo de mensagem)
    if (f.semAnexos.length) await q("DELETE FROM chat_anexo WHERE conversa_id = $1 AND mensagem_id IS NULL AND id = ANY($2::text[])", [c.id, f.semAnexos]);
    for (const n of f.notificacoes) {
      await q(`INSERT INTO notificacao (id, para_id, texto, conversa_id, criado_em) VALUES ($1, $2, $3, $4, $5)`, [n.id, n.para, n.texto, c.id, n.criadoEm]);
    }
    // trilha: criar vai inteiro; alterar, só o que mudou (os planos, em frases)
    if (nova) {
      await auditar({ ator, origem, entity: "chat_conversa", entityId: c.id, event: "conversa.criada", action: "CREATE", after: resumoAudit(c), ip, userAgent }, q);
    } else {
      const d = diffCampos(resumoAudit(antes), resumoAudit(c));
      const mudancas = antes.estado?.planos && c.estado.planos ? diferencas(antes.estado.planos, c.estado.planos)
        : c.estado.planos && !antes.estado?.planos ? ["planos montados"] : [];
      if (mudancas.length) d.campos.push("planos");
      if (d.campos.length) await auditar({ ator, origem, entity: "chat_conversa", entityId: c.id, event, action: "UPDATE",
        before: d.before, after: d.after, campos: d.campos, meta: mudancas.length ? { mudancas } : null, ip, userAgent }, q);
    }
  });
  if (nova) c.trava = 1; else c.trava++;
  fila.delete(c);
  foto.set(c, fotoDe(c));
}

/* ═══ celular da capa: a tela do app feita pelo designer, ou a que a Calculadora CNM fotografou ═══ */
const TIPOS_CAPA = { "image/png": "png", "image/jpeg": "jpg" };
const ehImagem = (b, tipo) => tipo === "image/png" ? b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  : tipo === "image/jpeg" ? b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff : false;
export const LIMITE_CAPA = 6 * 1024 * 1024;
/** Guarda a imagem do celular da capa (troca a anterior). Devolve { erro } se o arquivo não serve. */
export function definirCapa(c, u, conteudo, tipo, origem) {
  if (!TIPOS_CAPA[tipo] || !ehImagem(conteudo, tipo)) return { erro: "Mande a imagem em PNG ou JPG." };
  if (conteudo.length > LIMITE_CAPA) return { erro: "A imagem pode ter até 6 MB." };
  const id = novoId(), f = filaDe(c);
  f.anexos.push({ id, nome: `celular-da-capa.${TIPOS_CAPA[tipo]}`, tipo, tamanho: conteudo.length, conteudo, texto: "", mensagemId: null });
  if (c.estado.capa?.anexoId) f.semAnexos.push(c.estado.capa.anexoId);
  c.estado.capa = { anexoId: id, origem: origem === "calculadora" ? "calculadora" : "designer", em: agoraISO(), por: u.id };
  return {};
}
export function tirarCapa(c) {
  if (!c.estado.capa) return false;
  filaDe(c).semAnexos.push(c.estado.capa.anexoId);
  delete c.estado.capa;
  return true;
}

/* ═══ lixeira: some das telas, volta ao restaurar, purga depois de 30 dias ═══ */
export async function apagarConversa(c, quem, { ip = null, userAgent = null } = {}) {
  await transacao(async (q) => {
    await q(`UPDATE chat_conversa SET deleted_at = ${UTC_AGORA}, deleted_by = $2 WHERE id = $1 AND deleted_at IS NULL`, [c.id, quem.id]);
    await auditar({ ator: quem, origem: "TELA", entity: "chat_conversa", entityId: c.id, event: "conversa.apagada", action: "DELETE",
      before: { titulo: c.titulo, status: c.status }, ip, userAgent }, q);
  });
}
/** Na lixeira, o dono vê as suas; o superADMIN vê todas. */
export async function listarLixeira(u) {
  const r = await consulta(`SELECT c.id, c.titulo, c.status, c.deleted_at, d.nome AS dono, a.nome AS apagado_por,
      ${DIAS_NA_LIXEIRA} - floor(extract(epoch FROM (${UTC_AGORA} - c.deleted_at)) / 86400)::int AS dias_restantes
    FROM chat_conversa c JOIN usuario d ON d.id = c.dono_id LEFT JOIN usuario a ON a.id = c.deleted_by
    WHERE c.deleted_at IS NOT NULL AND (c.dono_id = $1 OR $2) ORDER BY c.deleted_at DESC`, [u.id, ehSuperAdmin(u)]);
  return r.rows.map((x) => ({ id: x.id, titulo: x.titulo, status: STATUS_NOME[x.status] ?? x.status, apagadoEm: x.deleted_at, apagadoPor: x.apagado_por ?? "",
    dono: x.dono, diasRestantes: Math.max(0, x.dias_restantes) }));
}
export async function restaurarConversa(id, u, { ip = null, userAgent = null } = {}) {
  return transacao(async (q) => {
    const r = await q(`UPDATE chat_conversa SET deleted_at = NULL, deleted_by = NULL WHERE id = $1 AND deleted_at IS NOT NULL AND (dono_id = $2 OR $3)
      RETURNING titulo`, [String(id), u.id, ehSuperAdmin(u)]);
    if (!r.rowCount) return false;
    await auditar({ ator: u, origem: "TELA", entity: "chat_conversa", entityId: id, event: "conversa.restaurada", action: "RESTORE", after: { titulo: r.rows[0].titulo }, ip, userAgent }, q);
    return true;
  });
}
/** Apaga de vez o que passou de 30 dias na lixeira (mensagens, anexos e versões vão junto). */
export async function purgarLixeira() {
  return transacao(async (q) => {
    const r = await q(`DELETE FROM chat_conversa WHERE deleted_at < ${UTC_AGORA} - interval '${DIAS_NA_LIXEIRA} days' RETURNING id, titulo, dono_id, deleted_at`);
    for (const x of r.rows) await auditar({ origem: "SISTEMA", entity: "chat_conversa", entityId: x.id, event: "conversa.purgada", action: "PURGE",
      before: { titulo: x.titulo, dono_id: x.dono_id, apagada_em: x.deleted_at } }, q);
    return r.rowCount;
  });
}

/* ═══ quem vê e quem mexe ═══ */
/** Regra ética: o vendedor só vê as próprias conversas. Quem aprova vê as enviadas que estão na alçada dele
 *  (supervisor abaixo de R$ 1 milhão, gerente a partir disso); o aprovador final vê todas as enviadas;
 *  o desenvolvedor vê todas, só para consulta. */
export const podeAprovar = (c, u) => podeAprovarValor(u, valorParaAlcada(c), c.donoId);
export const podeVer = (c, u) => c.donoId === u.id || veTudo(u)
  || (c.versoes.length > 0 && ehAprovador(u) && (u.aprovadorFinal || quemAprova(valorParaAlcada(c), c.donoId).ids.includes(u.id)));
/** Quem decide esta proposta, em palavras ("a Supervisão", "a Gerência"...). */
export const quemDecide = (c) => NIVEL_APROV[quemAprova(valorParaAlcada(c), c.donoId).nivel] ?? "ninguém cadastrado para aprovar";
export function podeEditar(c, u) {
  if (!c.estado.planos) return false;
  if (c.donoId === u.id) return c.status === "rascunho" || c.status === "ajustar";
  return c.status === "revisao" && podeAprovar(c, u);
}
export function motivoBloqueio(c, u) {
  if (!c.estado.planos) return "Os planos ainda não foram montados.";
  if (c.status === "revisao") return c.donoId === u.id ? `A proposta está com ${quemDecide(c)}.` : podeAprovar(c, u) ? "" : foraDaAlcada(c, u);
  if (c.status === "aprovada") return "A proposta foi aprovada e está travada. Para mudar, reabra uma nova versão.";
  if (c.donoId !== u.id) return veTudo(u) ? "Só para consulta." : "Só dá para corrigir enquanto a proposta está com quem aprova.";
  return "";
}

/* ═══ contas: implementação (única, no 1º mês) + licença + suporte mensais ═══
 * Item grátis não entra no total; o valor dele aparece à parte, para o aprovador ver o que deixa de ser cobrado. */
export function totais(its = []) {
  let implementacao = 0, licenca = 0, suporte = 0, semPreco = 0, gratisImpl = 0, gratisMensal = 0, gratis = 0;
  for (const it of its) {
    if (it.gratis) gratis++;
    if (it.unit == null) { semPreco++; continue; }
    const v = it.unit * it.qtd;
    if (it.gratis) { if (it.componente === "implementacao") gratisImpl += v; else gratisMensal += v; continue; }
    if (it.componente === "implementacao") implementacao += v; else if (it.componente === "suporte") suporte += v; else licenca += v;
  }
  const mensal = licenca + suporte;
  return { implementacao, licenca, suporte, mensal, mes1: implementacao + mensal, total12: implementacao + mensal * 12, semPreco,
    gratis, gratisImpl, gratisMensal, gratis12: gratisImpl + gratisMensal * 12 };
}
/** Quantidade maior que 1 precisa de um "para quê". Não trava o envio: aparece em "faltou". */
export const faltaJustificar = (c) => NIVEIS.flatMap((n) => (c.estado.planos?.[n] ?? [])
  .filter((it) => it.qtd > 1 && !String(it.para ?? "").trim()).map((it) => ({ plano: n, nome: it.nome })));
/** O valor que define quem aprova: a opção mais cara no contrato inteiro (duração em meses; 12 enquanto o formulário
 *  não perguntar), contando o que vai com desconto (a entrega vale isso) e a tabela salva da calculadora, se for maior. */
export const valorParaAlcada = (c) => {
  const meses = Number(c.estado.duracaoMeses) > 0 ? Number(c.estado.duracaoMeses) : 12;
  return Math.max(0, ...NIVEIS.map((n) => {
    const t = totais(c.estado.planos?.[n]);
    return Math.max(t.implementacao + t.gratisImpl + (t.mensal + t.gratisMensal) * meses, (Number(c.estado.calculadora?.[n]?.totalAnual) || 0) * meses / 12);
  }));
};
const foraDaAlcada = (c, u) => veTudo(u) && !ehAprovador(u) ? "Só para consulta."
  : `Esta proposta vale ${brl(valorParaAlcada(c))} no contrato e é decidida por ${quemDecide(c)}.`;
export const brl = (v) => Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
export const ord = (n) => `${n}ª`;
const gruposDe = (its) => [...new Set(its.map((i) => i.grupo))];
export const itensSemPreco = (c) => NIVEIS.reduce((s, n) => s + totais(c.estado.planos?.[n]).semPreco, 0);

/* ═══ preço estimado: o que o cliente pode pagar em 12 meses, por opção ═══ */
const BASE_DO_PLANO = ["canal", "subcanal", "monitoramento"]; // sem isso o plano não existe: nunca sugere tirar
/** Compara a opção com o preço estimado e, se passar, diz o que tirar. null = sem preço estimado. */
export function cabeNoPreco(c, n) {
  const estimado = Number(c.estado.precoEstimado?.[n]);
  if (!(estimado > 0)) return null;
  const its = c.estado.planos?.[n] ?? [], total = totais(its).total12;
  if (total <= estimado) return { estimado, total, cabe: true, tirar: [] };
  const falta = total - estimado;
  const grupos = gruposDe(its).filter((g) => !BASE_DO_PLANO.includes(g))
    .map((g) => ({ grupo: g, nome: GRUPOS[g], valor: totais(its.filter((i) => i.grupo === g)).total12 })).filter((x) => x.valor > 0);
  // o menor grupo que resolve sozinho; se nenhum resolve, os maiores até caber
  const um = grupos.filter((x) => x.valor >= falta).sort((a, b) => a.valor - b.valor)[0];
  const tirar = [];
  if (um) tirar.push(um);
  else for (const x of [...grupos].sort((a, b) => b.valor - a.valor)) { tirar.push(x); if (tirar.reduce((s, y) => s + y.valor, 0) >= falta) break; }
  return { estimado, total, cabe: false, falta, tirar, resolve: tirar.reduce((s, y) => s + y.valor, 0) >= falta };
}
export function definirPrecoEstimado(c, u, n, valor) {
  if (!podeEditar(c, u)) return motivoBloqueio(c, u);
  const v = valor == null || valor === "" ? null : Math.round(Number(valor) * 100) / 100;
  if (v != null && !(v > 0)) return "Valor inválido.";
  const antes = c.estado.precoEstimado?.[n] ?? null;
  if (v === antes) return "";
  mudar(c, u, n, v == null ? "tirou o preço estimado" : `preço estimado ${brl(v)}`, () => {
    const p = { ...(c.estado.precoEstimado ?? {}) };
    if (v == null) delete p[n]; else p[n] = v;
    c.estado.precoEstimado = p;
  });
  return "";
}

/* ═══ tabela montada na calculadora, guardada dentro da opção ═══ */
export function salvarTabelaCalculadora(c, u, n, t) {
  if (!podeEditar(c, u)) return motivoBloqueio(c, u);
  mudar(c, u, n, `salvou a tabela da ${t.nome}: ${brl(t.totalAnual)} em 12 meses`, () => {
    c.estado.calculadora = { ...(c.estado.calculadora ?? {}), [n]: { ...t, em: new Date().toISOString(), por: u.nome } };
  });
  return "";
}
export function tirarTabelaCalculadora(c, u, n) {
  if (!podeEditar(c, u)) return motivoBloqueio(c, u);
  const t = c.estado.calculadora?.[n];
  if (!t) return "";
  mudar(c, u, n, `tirou a tabela da ${t.nome}`, () => { const x = { ...c.estado.calculadora }; delete x[n]; c.estado.calculadora = x; });
  return "";
}

export function registrar(c, u, texto) { c.registro.push({ em: new Date().toISOString(), autor: u.nome, texto }); }

export function montarPlanos(c, u, cat) {
  const cfg = c.estado.config;
  c.estado.planos = Object.fromEntries(NIVEIS.map((n) => [n, montarPlano(n, cfg, cat)]));
  // as horas de suporte remoto vêm da regra da faixa: o "para quê" já nasce preenchido (o vendedor pode trocar)
  for (const n of NIVEIS) for (const it of c.estado.planos[n])
    if (it.grupo === "suporte_remoto" && it.componente === "suporte" && it.qtd > 1) it.para = `${it.qtd} horas por mês, sugeridas para canal de ${FAIXA_NOME[cfg.faixa]}`;
  registrar(c, u, `montou os planos: ${nomeSolucao(c.estado.solucao)}, canal de ${FAIXA_NOME[cfg.faixa]}`);
}
function mudar(c, u, n, descricao, fn) {
  fn(c.estado.planos[n]);
  if (c.donoId !== u.id) { c.corrigida = true; registrar(c, u, `corrigiu (${NIVEL_NOME[n]}): ${descricao}`); }
  else registrar(c, u, `${NIVEL_NOME[n]}: ${descricao}`);
}
export function resumoPlano(c, n) {
  const t = totais(c.estado.planos[n]);
  return `${NIVEL_NOME[n]}: 1º mês ${brl(t.mes1)}, depois ${brl(t.mensal)}/mês, ${brl(t.total12)} em 12 meses${t.gratis ? `; ${t.gratis} item grátis (${brl(t.gratis12)} em 12 meses)` : ""}${t.semPreco ? ` (${t.semPreco} item sem preço)` : ""}.`;
}
export function adicionarGrupo(c, u, n, g, cat, qtd) {
  if (!podeEditar(c, u)) return motivoBloqueio(c, u);
  if (gruposDe(c.estado.planos[n]).includes(g)) return qtd ? mudarQuantidade(c, u, n, g, qtd) : `O ${NIVEL_NOME[n]} já tem ${GRUPOS[g]}.`;
  const novos = [];
  for (const l of linhasDoGrupo(g, c.estado.config)) { const it = cat.get(l.id); if (it) novos.push(paraItem(it, l.qtd, true)); }
  // canal e subcanal: a quantidade é de canais; nos outros, do que é cobrado por mês
  if (qtd) for (const it of novos) if (g === "canal" || g === "subcanal" || it.componente !== "implementacao") it.qtd = qtd;
  if (!novos.length) return `Não há item de ${GRUPOS[g]} no catálogo.`;
  mudar(c, u, n, `adicionou ${GRUPOS[g]}${qtd ? ` (${qtd})` : ""}`, (l) => l.push(...novos));
  return `Adicionei ${GRUPOS[g]} no ${NIVEL_NOME[n]}. ${resumoPlano(c, n)}`;
}
export function removerGrupo(c, u, n, g) {
  if (!podeEditar(c, u)) return motivoBloqueio(c, u);
  if (!gruposDe(c.estado.planos[n]).includes(g)) return `O ${NIVEL_NOME[n]} não tem ${GRUPOS[g]}.`;
  mudar(c, u, n, `tirou ${GRUPOS[g]}`, (l) => { for (let i = l.length - 1; i >= 0; i--) if (l[i].grupo === g) l.splice(i, 1); });
  return `Tirei ${GRUPOS[g]} do ${NIVEL_NOME[n]}. ${resumoPlano(c, n)}`;
}
export function mudarQuantidade(c, u, n, g, qtd) {
  if (!podeEditar(c, u)) return motivoBloqueio(c, u);
  const q = Math.max(0, Math.min(999, Math.round(qtd)));
  if (q === 0) return removerGrupo(c, u, n, g);
  const alvo = c.estado.planos[n].filter((it) => it.grupo === g && (g === "canal" || g === "subcanal" || it.componente !== "implementacao"));
  if (!alvo.length) return `O ${NIVEL_NOME[n]} não tem ${GRUPOS[g]}.`;
  if (alvo.every((it) => it.qtd === q)) return `${GRUPOS[g]} já está com ${q} no ${NIVEL_NOME[n]}.`;
  mudar(c, u, n, `${GRUPOS[g]}: quantidade ${alvo[0].qtd} → ${q}`, () => { for (const it of alvo) it.qtd = q; });
  return `${GRUPOS[g]} com ${q} no ${NIVEL_NOME[n]}. ${resumoPlano(c, n)}`;
}
export function editarItem(c, u, n, indice, campo, valor) {
  if (!podeEditar(c, u)) return motivoBloqueio(c, u);
  const its = c.estado.planos[n], it = its[indice];
  if (!it) return "Item não encontrado.";
  if (campo === "unit") {
    if (c.donoId === u.id) return "Só o gerente corrige preço.";
    const v = Math.max(0, Math.round(valor * 100) / 100);
    if (v === it.unit) return "";
    mudar(c, u, n, `${it.nome}: preço ${it.unit == null ? "sem preço" : brl(it.unit)} → ${brl(v)}`, () => { it.unit = v; });
    return "";
  }
  if (campo === "gratis") {
    const g = !!valor;
    if (g === !!it.gratis) return "";
    mudar(c, u, n, `${it.nome}: ${g ? "grátis" : "volta a ser cobrado"}`, () => { if (g) it.gratis = true; else delete it.gratis; });
    return "";
  }
  if (campo === "para") {
    const t = String(valor ?? "").trim().slice(0, 200);
    if (t === (it.para ?? "")) return "";
    mudar(c, u, n, `${it.nome}: para quê “${t || "—"}”`, () => { if (t) it.para = t; else delete it.para; });
    return "";
  }
  const q = Math.max(0, Math.min(999, Math.round(valor)));
  if (q === it.qtd) return "";
  mudar(c, u, n, `${it.nome}: quantidade ${it.qtd} → ${q}`, (l) => { if (q === 0) l.splice(l.indexOf(it), 1); else it.qtd = q; });
  return "";
}
/** Pelo chat: marca um grupo inteiro como grátis ou cobrado, e/ou escreve o "para quê" dele. */
export function detalharGrupo(c, u, n, g, gratis, para) {
  if (!podeEditar(c, u)) return motivoBloqueio(c, u);
  const its = c.estado.planos[n], alvo = its.filter((it) => it.grupo === g);
  if (!alvo.length) return `O ${NIVEL_NOME[n]} não tem ${GRUPOS[g]}.`;
  for (const it of alvo) {
    if (gratis != null) editarItem(c, u, n, its.indexOf(it), "gratis", gratis);
    if (para != null && (it.qtd > 1 || it.para)) editarItem(c, u, n, its.indexOf(it), "para", para);
  }
  return `${GRUPOS[g]} no ${NIVEL_NOME[n]}: ${gratis == null ? "" : gratis ? "grátis. " : "cobrado. "}${para ? `para quê: “${para}”. ` : ""}${resumoPlano(c, n)}`;
}
export function adicionarItem(c, u, n, id, cat) {
  if (!podeEditar(c, u)) return motivoBloqueio(c, u);
  const it = cat.get(id);
  if (!it) return "Item fora do catálogo.";
  if (c.estado.planos[n].some((x) => x.id === id)) return `O ${NIVEL_NOME[n]} já tem esse item.`;
  mudar(c, u, n, `adicionou ${it.nome}`, (l) => l.push(paraItem(it, 1, true)));
  return "";
}

/* ═══ versões ═══ */
function diferencas(antes, depois) {
  const out = [];
  for (const n of NIVEIS) {
    const a = antes[n] ?? [], d = depois[n] ?? [];
    for (const it of d) {
      const x = a.find((y) => y.id === it.id);
      if (!x) out.push(`${NIVEL_NOME[n]}: + ${it.nome}`);
      else {
        if (x.qtd !== it.qtd) out.push(`${NIVEL_NOME[n]}: ${it.nome}, quantidade ${x.qtd} → ${it.qtd}`);
        if (!!x.gratis !== !!it.gratis) out.push(`${NIVEL_NOME[n]}: ${it.nome}, ${it.gratis ? "passou a grátis" : "voltou a ser cobrado"}`);
        if (x.unit !== it.unit) out.push(`${NIVEL_NOME[n]}: ${it.nome}, preço ${x.unit == null ? "sem preço" : brl(x.unit)} → ${it.unit == null ? "sem preço" : brl(it.unit)}`);
      }
    }
    for (const it of a) if (!d.some((y) => y.id === it.id)) out.push(`${NIVEL_NOME[n]}: − ${it.nome}`);
    const ta = totais(a).total12, td = totais(d).total12;
    if (ta !== td) out.push(`${NIVEL_NOME[n]}: 12 meses ${brl(ta)} → ${brl(td)}`);
  }
  return out;
}
export function novaVersao(c, u, nota) {
  const planos = structuredClone(c.estado.planos), ant = c.versoes[c.versoes.length - 1];
  for (const x of c.versoes) x.atual = false;
  const calc = totaisDaCalculadora(c.estado.calculadora), calcAnt = ant?.totais?.calculadora ?? {};
  const mudouCalc = NIVEIS.filter((n) => (calc[n] ?? null) !== (calcAnt[n] ?? null)).map((n) =>
    `${NIVEL_NOME[n]}: tabela da calculadora ${calcAnt[n] == null ? "sem tabela" : brl(calcAnt[n])} → ${calc[n] == null ? "sem tabela" : brl(calc[n])}`);
  const v = { id: novoId(), n: c.versoes.length + 1, em: agoraISO(), autor: u.nome, autorId: u.id, nota, mudou: ant ? [...diferencas(ant.planos, planos), ...mudouCalc] : [], planos,
    totais: { ...Object.fromEntries(NIVEIS.map((n) => [n, totais(planos[n]).total12])), ...(Object.keys(calc).length ? { calculadora: calc } : {}) }, atual: true };
  c.versoes.push(v);
  return v;
}

/* ═══ revisão: vendedor aprova → PDF → gerente ═══ */
const resumoTotais = (c) => NIVEIS.map((n) => `${NIVEL_NOME[n]} ${brl(c.versoes[c.versoes.length - 1].totais[n])}`).join(" · ");

/** soTabela: pede ao gerente só a aprovação da tabela de preços, sem a proposta completa. */
export async function enviarAoGerente(c, u, { soTabela = false } = {}) {
  if (c.donoId !== u.id) return { erro: "Só o vendedor dono aprova e envia a proposta." };
  if (!c.estado.planos) return { erro: "Monte os planos antes." };
  if (c.status === "revisao") return { erro: "A proposta já está com o gerente." };
  if (c.status === "aprovada") return { erro: "A proposta já foi aprovada. Reabra para fazer uma nova versão." };
  const sem = itensSemPreco(c);
  if (sem) return { erro: `${sem} item(ns) ainda sem preço. Tire do plano ou peça para cadastrar o preço em Configurações › Itens.` };
  c.estado.envio = soTabela ? "tabela" : "proposta";
  const oque = soTabela ? "a tabela de preços" : "a proposta";
  const v = novaVersao(c, u, soTabela ? "enviada pelo vendedor: só a tabela de preços" : "aprovada pelo vendedor");
  c.status = "revisao"; c.corrigida = false;
  registrar(c, u, `aprovou e enviou a ${ord(v.n)} versão ao gerente${soTabela ? " (só a tabela de preços)" : ""}`);
  const gr = NIVEIS.reduce((s, n) => s + totais(c.estado.planos[n]).gratis, 0), falta = faltaJustificar(c).length;
  const extra = [gr && `${gr} item(ns) grátis`, falta && `${falta} quantidade(s) sem justificativa`].filter(Boolean).join(", ");
  // só avisa quem decide; se ninguém está cadastrado para esse valor, avisa os superADMIN, para cadastrarem
  const valor = valorParaAlcada(c), { ids } = quemAprova(valor, u.id);
  const semNinguem = !ids.length;
  notificar(c, semNinguem ? idsSuperAdmin(u.id) : ids,
    `${u.nome} enviou ${oque} ${c.titulo} (${ord(v.n)} versão) para ${semNinguem ? "aprovação" : "sua aprovação"}${extra ? ` — ${extra}` : ""}${semNinguem ? ` — ${brl(valor)} no contrato: ninguém cadastrado para aprovar esse valor` : ""}`);
  if (soTabela) return { avisos: [{ texto: `Tabela de preços enviada ao gerente — ${ord(v.n)} versão · ${resumoTotais(c)}${extra ? ` · ${extra}` : ""}`, estilo: "info" }],
    texto: "A tabela de preços foi para o gerente aprovar (PDF na aba Proposta). Depois que ele aprovar, dá para reabrir e enviar a proposta completa." };
  return { avisos: [{ texto: `Proposta gerada e enviada ao gerente — ${ord(v.n)} versão · ${resumoTotais(c)}${extra ? ` · ${extra}` : ""}`, estilo: "info" }],
    texto: "Proposta gerada (PDF na aba Proposta) e enviada ao gerente. Ela segue para o cliente depois que ele aprovar; aviso você aqui e no sino." };
}
export function aprovar(c, u) {
  if (c.donoId === u.id) return { erro: "Ninguém aprova a própria proposta." };
  if (!ehAprovador(u)) return { erro: "Só quem aprova pode aprovar." };
  if (c.status !== "revisao") return { erro: "A proposta não está com quem aprova." };
  if (!podeAprovar(c, u)) return { erro: foraDaAlcada(c, u) };
  if (itensSemPreco(c)) return { erro: "Há item sem preço. Precifique na tabela ou tire antes de aprovar." };
  let nota = "";
  if (c.corrigida) { const v = novaVersao(c, u, "corrigida e aprovada pelo gerente"); nota = ` com correções (${ord(v.n)} versão)`; }
  else c.versoes[c.versoes.length - 1].nota = `aprovada pelo gerente ${u.nome}`;
  c.status = "aprovada"; c.corrigida = false;
  registrar(c, u, `aprovou${nota}`);
  const tabela = c.estado.envio === "tabela";
  notificar(c, [c.donoId], `${tabela ? "Tabela de preços aprovada" : "Aprovada"} pelo gerente: ${c.titulo}`);
  return { avisos: [{ texto: `${tabela ? "Tabela de preços aprovada" : "Aprovada"} pelo gerente ${u.nome}${nota}`, estilo: "ok" }],
    texto: tabela ? "O gerente aprovou a tabela de preços. Para mandar a proposta completa ao cliente, reabra e envie a proposta."
      : "O gerente aprovou. A proposta em PDF está liberada para enviar ao cliente (aba Proposta)." };
}
export function reprovar(c, u, motivo) {
  motivo = String(motivo || "").trim().slice(0, 2000);
  if (c.donoId === u.id) return { erro: "Ninguém revisa a própria proposta." };
  if (!ehAprovador(u)) return { erro: "Só quem aprova pode reprovar." };
  if (c.status !== "revisao") return { erro: "A proposta não está com quem aprova." };
  if (!podeAprovar(c, u)) return { erro: foraDaAlcada(c, u) };
  if (!motivo) return { erro: "O motivo é obrigatório." };
  if (c.corrigida) novaVersao(c, u, "corrigida pelo gerente e devolvida");
  c.versoes[c.versoes.length - 1].motivo = motivo;
  c.status = "ajustar"; c.corrigida = false;
  registrar(c, u, `reprovou: ${motivo}`);
  notificar(c, [c.donoId], `Reprovada pelo gerente: ${c.titulo} — ${motivo}`);
  return { avisos: [{ texto: `Reprovada pelo gerente ${u.nome}: “${motivo}”`, estilo: "no" }], texto: `O gerente pediu ajuste. Faça as mudanças e aprove de novo — vai como ${ord(c.versoes.length + 1)} versão.` };
}
export function reabrir(c, u) {
  if (c.donoId !== u.id) return { erro: "Só o dono reabre a proposta." };
  if (c.status !== "aprovada") return { erro: "Só proposta aprovada é reaberta." };
  c.status = "rascunho";
  registrar(c, u, "reabriu a proposta aprovada para uma nova versão");
  return { avisos: [{ texto: "Proposta reaberta. Ela precisa ser aprovada de novo pelo gerente." }], texto: "Pode ajustar. Quando terminar, aprove para gerar a nova versão." };
}

/** Resumo do estado para o assistente. */
export function resumoParaIA(c) {
  const e = c.estado;
  return {
    status: STATUS_NOME[c.status], versao: c.versoes.length,
    negocio_hubspot: e.negocio ?? null, negocios_mostrados: e.negocio ? undefined : e.mostrados ?? undefined,
    cliente: e.cliente ?? null, cidade: e.cidade ?? null, uf: e.uf ?? null, setor: e.setor ?? null,
    solucao: e.solucao ? nomeSolucao(e.solucao) : null, populacao: e.populacao ?? null, faixa_sugerida: e.faixaSugerida ?? null,
    o_que_o_cliente_quer: e.objetivo ?? "não informado — pergunte uma vez",
    setor_do_cliente: e.setor ?? "não informado — pergunte se é público ou privado",
    modalidade_contratacao: e.setor === "privado" ? "não se aplica (privado)" : e.modalidade ?? "não definida — pergunte",
    configuracao: e.config ?? null, motivo_troca_faixa: e.motivoFaixa ?? null,
    planos: e.planos ? Object.fromEntries(NIVEIS.map((n) => [n, { grupos: gruposDe(e.planos[n]).map((g) => GRUPOS[g] ?? g), ...totais(e.planos[n]) }])) : null,
    quantidades_sem_justificativa: e.planos ? faltaJustificar(c).map((x) => `${NIVEL_NOME[x.plano]}: ${x.nome}`) : null,
    preco_estimado: e.planos ? Object.fromEntries(NIVEIS.map((n) => [n, cabeNoPreco(c, n)]).filter(([, x]) => x)) : null,
    tabela_da_calculadora: e.calculadora ? Object.fromEntries(Object.entries(e.calculadora).map(([n, t]) => [n, { calculadora: t.nome, total_12_meses: t.totalAnual }])) : null,
  };
}
