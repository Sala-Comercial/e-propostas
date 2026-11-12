// Coisas de base: .env, login (usuários e sessões no Postgres) e utilidades.
import { readFileSync, existsSync } from "node:fs";
import { randomBytes, scryptSync, timingSafeEqual, randomUUID, createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { consulta, UTC_AGORA } from "./db.mjs";
import { auditar, registrarSessao } from "./auditoria.mjs";

export const RAIZ = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
// pasta dos JSON antigos (só para importar) — DADOS_DIR permite apontar para uma cópia
export const DADOS = process.env.DADOS_DIR || path.join(RAIZ, "data");

/** Lê o .env (sem biblioteca). O que já vier do ambiente tem prioridade. */
export function carregarEnv() {
  const f = path.join(RAIZ, ".env");
  if (!existsSync(f)) return;
  for (const linha of readFileSync(f, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(linha);
    if (!m || linha.trim().startsWith("#")) continue;
    const v = m[2].replace(/^(['"])(.*)\1$/, "$2");
    if (process.env[m[1]] === undefined) process.env[m[1]] = v;
  }
}

export const novoId = () => randomUUID();
// hora sempre crescente dentro do servidor: mensagens do mesmo pedido não empatam na ordem
let ultimaHora = 0;
export function agoraISO() { ultimaHora = Math.max(Date.now(), ultimaHora + 1); return new Date(ultimaHora).toISOString(); }

/* ═══ senha (scrypt, sem guardar a senha) ═══ */
export function hashSenha(senha) {
  const sal = randomBytes(16);
  return `${sal.toString("hex")}:${scryptSync(senha, sal, 32).toString("hex")}`;
}
export function conferirSenha(senha, hash) {
  const [sal, h] = String(hash || "").split(":");
  if (!sal || !h) return false;
  const a = scryptSync(senha, Buffer.from(sal, "hex"), 32), b = Buffer.from(h, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

/* ═══ usuários (a lixeira fica de fora de toda leitura: só aqui se filtra) ═══ */
const VIVO = "deleted_at IS NULL";
const usuarioDoBanco = (r) => r && { id: r.id, nome: r.nome, email: r.email, papel: r.papel, senhaHash: r.senha_hash, ativo: r.ativo, criadoEm: r.criado_em,
  cargo: r.cargo ?? (r.papel === "gerente" ? "gerente" : "vendedor"), permissao: r.permissao ?? (r.papel === "gerente" ? "superadmin" : "membro"), aprovadorFinal: !!r.aprovador_final };

/* ═══ cargos e permissões (ABAC, decisão do Leo de 11/11/2026) ═══
 * Cargo = o que a pessoa faz; a alçada segue o cargo. Permissão = o que ela pode configurar. São independentes. */
export const CARGOS = ["vendedor", "supervisor", "gerente", "desenvolvedor"];
export const CARGO_NOME = { vendedor: "Vendedor", supervisor: "Supervisor", gerente: "Gerente", desenvolvedor: "Desenvolvedor" };
export const PERMISSOES = ["membro", "admin", "superadmin"];
export const PERMISSAO_NOME = { membro: "Membro", admin: "Admin", superadmin: "SuperADMIN" };
/** Abaixo disto aprova a Supervisão; a partir disto, a Gerência (processo comercial da SASI). Valor do contrato inteiro. */
export const LIMITE_SUPERVISAO = 1_000_000;

/** Aprova alguma proposta (supervisor, gerente ou o aprovador final). */
export const ehAprovador = (u) => !!u && (u.cargo === "supervisor" || u.cargo === "gerente" || u.aprovadorFinal);
/** Muda preços, itens, modalidades e a base. */
export const ehAdmin = (u) => u?.permissao === "admin" || u?.permissao === "superadmin";
/** Também cuida dos usuários (cargo, permissão, aprovador final). */
export const ehSuperAdmin = (u) => u?.permissao === "superadmin";
/** Vê todas as propostas, só para consulta (suporte). */
export const veTudo = (u) => u?.cargo === "desenvolvedor";
/** Legado: "gerente" no sentido antigo de quem aprova. */
export const ehGerente = ehAprovador;

/* quem aprova o quê depende de quem está cadastrado: guardado em memória e refeito a cada mudança de usuário */
let APROV = null;
export async function atualizarAprovadores() {
  const r = await consulta(`SELECT id, cargo, permissao, aprovador_final, papel, ativo FROM usuario WHERE ${VIVO}`);
  APROV = new Map(r.rows.map((x) => [x.id, { cargo: x.cargo ?? (x.papel === "gerente" ? "gerente" : "vendedor"), final: !!x.aprovador_final, ativo: x.ativo, superadmin: x.permissao === "superadmin" }]));
  return APROV;
}
const aprovadores = () => APROV ?? new Map();
/**
 * Quem decide esta proposta. Valor abaixo do limite → supervisores; a partir dele → gerentes.
 * Sem ninguém cadastrado no nível, sobe para o de cima (supervisor → gerente → aprovador final).
 * Proposta de quem também aprova (supervisor ou gerente que vende) vai direto ao aprovador final.
 * Ninguém aprova a própria proposta. Devolve { nivel, ids } (ids vazio = ninguém pode aprovar).
 */
export function quemAprova(valor, donoId) {
  const A = aprovadores(), dono = A.get(donoId);
  const no = (f) => [...A].filter(([id, x]) => x.ativo && id !== donoId && f(x)).map(([id]) => id);
  const niveis = { supervisor: no((x) => x.cargo === "supervisor"), gerente: no((x) => x.cargo === "gerente"), final: no((x) => x.final) };
  const cadeia = dono && (dono.cargo === "supervisor" || dono.cargo === "gerente") ? ["final"]
    : valor < LIMITE_SUPERVISAO ? ["supervisor", "gerente", "final"] : ["gerente", "final"];
  for (const n of cadeia) if (niveis[n].length) return { nivel: n, ids: niveis[n] };
  return { nivel: null, ids: [] };
}
/** Pode aprovar (e corrigir) esta proposta: está no nível que decide, ou é o aprovador final. Nunca a própria. */
export function podeAprovarValor(u, valor, donoId) {
  if (!u || u.id === donoId || !ehAprovador(u)) return false;
  return u.aprovadorFinal || quemAprova(valor, donoId).ids.includes(u.id);
}
/** Quem é superADMIN (para avisar quando ninguém está cadastrado para aprovar). */
export const idsSuperAdmin = (exceto) => [...aprovadores()].filter(([id, x]) => x.ativo && x.superadmin && id !== exceto).map(([id]) => id);
export const NIVEL_NOME = { supervisor: "a Supervisão", gerente: "a Gerência", final: "o aprovador final" };

export async function listarUsuarios() {
  return (await consulta(`SELECT * FROM usuario WHERE ${VIVO} ORDER BY criado_em`)).rows.map(usuarioDoBanco);
}
export async function usuarioPorEmail(email) {
  return usuarioDoBanco((await consulta(`SELECT * FROM usuario WHERE ${VIVO} AND lower(email) = lower($1)`, [String(email ?? "").trim()])).rows[0]);
}
export async function usuarioPorId(id) {
  return usuarioDoBanco((await consulta(`SELECT * FROM usuario WHERE ${VIVO} AND id = $1`, [id])).rows[0]);
}

/** Muda cargo, permissão ou aprovador final de alguém. Só superADMIN; ninguém mexe no próprio acesso. Devolve o problema, ou "". */
export async function alterarAcesso(id, campos, quem) {
  if (!ehSuperAdmin(quem)) return "Só quem é superADMIN muda cargos e permissões.";
  const alvo = await usuarioPorId(id);
  if (!alvo) return "Usuário não encontrado.";
  if (alvo.id === quem.id) return "Você não pode mudar o seu próprio acesso.";
  const depois = { cargo: alvo.cargo, permissao: alvo.permissao, aprovadorFinal: alvo.aprovadorFinal };
  if (campos.cargo !== undefined) { if (!CARGOS.includes(campos.cargo)) return "Cargo inválido."; depois.cargo = campos.cargo; }
  if (campos.permissao !== undefined) { if (!PERMISSOES.includes(campos.permissao)) return "Permissão inválida."; depois.permissao = campos.permissao; }
  if (campos.aprovadorFinal !== undefined) depois.aprovadorFinal = campos.aprovadorFinal === true;
  const antes = { cargo: alvo.cargo, permissao: alvo.permissao, aprovadorFinal: alvo.aprovadorFinal };
  if (JSON.stringify(antes) === JSON.stringify(depois)) return "";
  await consulta(`UPDATE usuario SET cargo = $2, permissao = $3, aprovador_final = $4, papel = $5, atualizado_em = ${UTC_AGORA} WHERE id = $1`,
    [alvo.id, depois.cargo, depois.permissao, depois.aprovadorFinal, papelLegado(depois)]);
  await auditar({ ator: quem, origem: "TELA", entity: "usuario", entityId: alvo.id, event: "usuario.acesso_alterado", action: "UPDATE", before: antes, after: depois });
  await atualizarAprovadores();
  return "";
}
/* a coluna antiga papel acompanha, para o audit_log e scripts antigos */
const papelLegado = (x) => (x.cargo === "supervisor" || x.cargo === "gerente" || x.aprovadorFinal ? "gerente" : "vendedor");

/** quem: o usuário que cadastra (null no terminal). Só superADMIN cadastra pela tela. */
export async function criarUsuario({ nome, email, senha, cargo = "vendedor", permissao = "membro", aprovadorFinal = false, papel }, quem = null, origem = "TELA") {
  email = String(email ?? "").trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error("E-mail inválido.");
  if (String(senha ?? "").length < 8) throw new Error("A senha precisa ter pelo menos 8 caracteres.");
  if (papel && cargo === "vendedor" && papel === "gerente") { cargo = "gerente"; permissao = "superadmin"; } // chamadas antigas (papel)
  if (!CARGOS.includes(cargo)) throw new Error("Cargo inválido.");
  if (!PERMISSOES.includes(permissao)) throw new Error("Permissão inválida.");
  if (quem && !ehSuperAdmin(quem)) throw new Error("Só quem é superADMIN cadastra usuários.");
  const u = { id: novoId(), nome: String(nome ?? "").trim().slice(0, 80) || email, email, cargo, permissao, aprovadorFinal: aprovadorFinal === true, ativo: true };
  u.papel = papelLegado(u);
  try {
    await consulta(`INSERT INTO usuario (id, nome, email, senha_hash, papel, cargo, permissao, aprovador_final, criado_em, atualizado_em)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, ${UTC_AGORA}, ${UTC_AGORA})`, [u.id, u.nome, u.email, hashSenha(senha), u.papel, u.cargo, u.permissao, u.aprovadorFinal]);
  } catch (e) {
    if (e.code === "23505") throw new Error("Já existe usuário com esse e-mail.");
    throw e;
  }
  await auditar({ ator: quem, origem: quem ? origem : "SISTEMA", entity: "usuario", entityId: u.id, event: "usuario.criado", action: "CREATE",
    after: { nome: u.nome, email: u.email, cargo: u.cargo, permissao: u.permissao, aprovadorFinal: u.aprovadorFinal } });
  await atualizarAprovadores();
  return u;
}

/* ═══ sessões: cookie aleatório; no banco só o hash dele; 7 dias ═══ */
const SETE_DIAS = 7 * 24 * 3600 * 1000;
const hashToken = (t) => createHash("sha256").update(String(t)).digest("hex");
export async function abrirSessao(u, quem) {
  const token = randomBytes(32).toString("base64url");
  await consulta(`DELETE FROM sessao WHERE expira_em < ${UTC_AGORA}`);
  await consulta(`INSERT INTO sessao (token_hash, usuario_id, expira_em, criado_em) VALUES ($1, $2, $3, ${UTC_AGORA})`,
    [hashToken(token), u.id, new Date(Date.now() + SETE_DIAS).toISOString()]);
  await registrarSessao({ u, evento: "LOGIN", ...quem });
  return token;
}
export async function lerSessao(token) {
  const r = await consulta(`SELECT u.* FROM sessao s JOIN usuario u ON u.id = s.usuario_id
    WHERE s.token_hash = $1 AND s.expira_em > ${UTC_AGORA} AND u.ativo AND u.deleted_at IS NULL`, [hashToken(token)]);
  return usuarioDoBanco(r.rows[0]) ?? null;
}
export async function fecharSessao(token, quem) {
  const r = await consulta(`DELETE FROM sessao WHERE token_hash = $1 RETURNING usuario_id`, [hashToken(token)]);
  if (r.rows[0]) await registrarSessao({ u: await usuarioPorId(r.rows[0].usuario_id), evento: "LOGOUT", ...quem });
}

/* ═══ preferências de tela (usuario_visualizacao), no banco e não no navegador ═══ */
export async function lerVisualizacao(u, tela) {
  return (await consulta(`SELECT config FROM usuario_visualizacao WHERE usuario_id = $1 AND tela = $2 AND is_default`, [u.id, tela])).rows[0]?.config ?? {};
}
export async function gravarVisualizacao(u, tela, config) {
  await consulta(`INSERT INTO usuario_visualizacao (id, usuario_id, tela, config, is_default, escopo, criado_em, criado_por)
    VALUES ($1, $2, $3, $4::jsonb, TRUE, 'PESSOAL', ${UTC_AGORA}, $5)
    ON CONFLICT (usuario_id, tela) WHERE is_default DO UPDATE SET config = usuario_visualizacao.config || EXCLUDED.config`,
    [novoId(), u.id, tela, JSON.stringify(config ?? {}), u.nome]);
}
