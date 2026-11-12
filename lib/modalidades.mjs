// Modalidades de contratação: os textos da página 3 da proposta.
// O gerente edita em Configurações › Modalidades; texto editado perde a
// validação do Jurídico até alguém validar de novo. Tudo vai para o audit_log.
import { consulta, UTC_AGORA } from "./db.mjs";
import { auditar } from "./auditoria.mjs";

const doBanco = (r) => ({ id: r.id, nome: r.nome, fundamentacao: r.fundamentacao, objeto: r.objeto, quadros: r.quadros, vantagens: r.vantagens,
  validado: !!r.validado_em, validadoPor: r.validado_por, validadoEm: r.validado_em, ativo: r.ativo, ordem: r.ordem });

export async function listarModalidades() {
  return (await consulta("SELECT * FROM modalidade_contratacao WHERE deleted_at IS NULL ORDER BY ordem, id")).rows.map(doBanco);
}
export async function modalidadesAtivas() { return (await listarModalidades()).filter((m) => m.ativo); }

/** campos: nome, fundamentacao, objeto, quadros, vantagens, ativo; validar: true marca como validado pelo Jurídico. */
export async function atualizarModalidade(id, campos, validar, quem) {
  const antes = (await listarModalidades()).find((m) => m.id === id);
  if (!antes) return false;
  const depois = { ...antes, ...campos };
  const textoMudou = ["nome", "fundamentacao", "objeto", "quadros", "vantagens"].some((k) => k in campos && JSON.stringify(campos[k]) !== JSON.stringify(antes[k]));
  const validado = validar === true ? true : validar === false || textoMudou ? false : antes.validado;
  await consulta(`UPDATE modalidade_contratacao SET nome = $2, fundamentacao = $3, objeto = $4, quadros = $5::jsonb, vantagens = $6::jsonb, ativo = $7,
      validado_por = CASE WHEN $8::boolean THEN coalesce(CASE WHEN $9::boolean THEN $10::text END, validado_por) ELSE NULL END,
      validado_em = CASE WHEN $8::boolean THEN coalesce(CASE WHEN $9::boolean THEN ${UTC_AGORA} END, validado_em) ELSE NULL END,
      atualizado_por_id = $11, atualizado_em = ${UTC_AGORA}
    WHERE id = $1 AND deleted_at IS NULL`,
    [id, depois.nome, depois.fundamentacao, depois.objeto, JSON.stringify(depois.quadros), JSON.stringify(depois.vantagens), depois.ativo,
      validado, validar === true, quem.nome, quem.id]);
  await auditar({ ator: quem, origem: "TELA", entity: "modalidade_contratacao", entityId: id, event: validar === true ? "modalidade.validada" : "modalidade.alterada",
    action: "UPDATE", before: { ...antes, validadoEm: undefined }, after: { ...depois, validado, validadoPor: validado ? (validar === true ? quem.nome : antes.validadoPor) : null, validadoEm: undefined } });
  return true;
}
