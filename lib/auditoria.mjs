// Trilhas: audit_log (o que mudou nos dados) e sessao_log (quem entrou e saiu).
// Mesmo formato do Controle de Adesões. As duas tabelas são imutáveis no banco.
import { randomUUID } from "node:crypto";
import { consulta, UTC_AGORA } from "./db.mjs";

const normalizar = (v) => (v === undefined ? null : v);
const iguais = (a, b) => JSON.stringify(normalizar(a)) === JSON.stringify(normalizar(b));

/** Só os campos que mudaram. Criar (sem antes) e apagar (sem depois) vão inteiros. */
export function diffCampos(antes, depois, ignorar = []) {
  const fora = new Set(["id", "criadoEm", "atualizadoEm", "criado_em", "atualizado_em", "trava", ...ignorar]);
  if (antes == null || depois == null) return { before: antes ?? null, after: depois ?? null, campos: Object.keys(depois ?? antes ?? {}).filter((k) => !fora.has(k)) };
  const campos = [], a = {}, d = {};
  for (const k of new Set([...Object.keys(antes), ...Object.keys(depois)])) {
    if (fora.has(k) || iguais(antes[k], depois[k])) continue;
    campos.push(k); a[k] = normalizar(antes[k]); d[k] = normalizar(depois[k]);
  }
  campos.sort();
  return campos.length ? { before: a, after: d, campos } : { before: null, after: null, campos: [] };
}

/**
 * Grava uma linha no audit_log.
 * ator: o usuário (ou null = sistema). origem: TELA | ASSISTENTE | IMPORTACAO | SISTEMA.
 * q: função de consulta da transação, quando a gravação faz parte de uma.
 */
export async function auditar({ ator = null, origem = "SISTEMA", entity, entityId, parentEntity = null, parentEntityId = null,
  event = "", action, before = null, after = null, meta = null, campos = null, ip = null, userAgent = null }, q = consulta) {
  if (campos == null) {
    if (action === "UPDATE") { const d = diffCampos(before, after); if (!d.campos.length) return; ({ before, after, campos } = d); }
    else campos = Object.keys(after ?? before ?? {});
  }
  await q(`INSERT INTO audit_log (id, user_id, actor_nome, actor_email, actor_role, actor_tipo, origem, entity, entity_id,
      parent_entity, parent_entity_id, event, action, before, after, meta, campos, ip, user_agent, created_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::jsonb, $15::jsonb, $16::jsonb, $17, $18, $19, ${UTC_AGORA})`,
    [randomUUID(), ator?.id ?? null, ator?.nome ?? "sistema", ator?.email ?? null, ator?.cargo ?? ator?.papel ?? null, ator ? "USER" : "SYSTEM", origem,
      entity, String(entityId), parentEntity, parentEntityId == null ? null : String(parentEntityId), event, action,
      before == null ? null : JSON.stringify(before), after == null ? null : JSON.stringify(after), meta == null ? null : JSON.stringify(meta),
      campos, ip, userAgent]);
}

/** LOGIN | LOGOUT | LOGIN_FALHOU, com IP e navegador. */
export async function registrarSessao({ u = null, email = "", evento, motivo = null, ip = null, userAgent = null }) {
  await consulta(`INSERT INTO sessao_log (id, user_id, nome, email, evento, motivo, ip, user_agent, created_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, ${UTC_AGORA})`,
    [randomUUID(), u?.id ?? null, u?.nome ?? "", u?.email ?? String(email ?? "").slice(0, 200), evento, motivo, ip, userAgent ? String(userAgent).slice(0, 300) : null]);
}
