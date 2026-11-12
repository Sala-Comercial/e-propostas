// Passa os dados da versão antiga (arquivos JSON em data/) para o Postgres:
// npm run importar-json
// Pode rodar de novo sem duplicar nada (o que já existe é pulado). Os JSON não
// são apagados — ficam como cópia. Sessões não vêm: cada um entra de novo.
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { DADOS, carregarEnv, novoId } from "../lib/base.mjs";
import { migrar, transacao, fecharBanco } from "../lib/db.mjs";
import { auditar } from "../lib/auditoria.mjs";

carregarEnv();
const ler = (nome) => { const f = path.join(DADOS, `${nome}.json`); return existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : []; };
const conta = { usuario: 0, catalogo_item: 0, chat_conversa: 0, chat_versao: 0, chat_mensagem: 0, chat_anexo: 0, notificacao: 0 };

try {
  await migrar();
  const usuarios = ler("usuarios"), conversas = ler("conversas"), mensagens = ler("mensagens"), notificacoes = ler("notificacoes"), itens = ler("itens");
  console.log(`Lendo ${DADOS}: ${usuarios.length} usuário(s), ${conversas.length} conversa(s), ${mensagens.length} mensagem(ns), ${notificacoes.length} aviso(s), ${itens.length} item(ns) editado(s).`);

  await transacao(async (q) => {
    const ids = new Set();
    for (const u of usuarios) {
      const ger = u.papel === "gerente"; // cargo/permissão (0007): gerente antigo = gerente + superadmin, como na migração
      const r = await q(`INSERT INTO usuario (id, nome, email, senha_hash, papel, cargo, permissao, ativo, criado_em, atualizado_em)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9) ON CONFLICT DO NOTHING`,
        [u.id, u.nome, String(u.email).toLowerCase(), u.hash, ger ? "gerente" : "vendedor", ger ? "gerente" : "vendedor", ger ? "superadmin" : "membro", u.ativo !== false, u.criadoEm ?? new Date().toISOString()]);
      if (r.rowCount) { conta.usuario++; await auditar({ origem: "IMPORTACAO", entity: "usuario", entityId: u.id, event: "usuario.importado", action: "CREATE", after: { nome: u.nome, email: u.email, papel: u.papel } }, q); }
    }
    for (const r of (await q("SELECT id, nome FROM usuario")).rows) ids.add(r.id);
    const idPorNome = new Map(usuarios.map((u) => [u.nome, u.id]));

    // catálogo: só se alguém tinha editado (itens.json); senão a aplicação cria o inicial
    for (const [i, it] of itens.entries()) {
      const r = await q(`INSERT INTO catalogo_item (id, grupo, nome, componente, preco, unidade, ativo, ordem) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT DO NOTHING`,
        [it.id, it.grupo, it.nome, it.componente, it.preco ?? null, it.unidade ?? "mês", it.ativo !== false, it.ordem ?? i]);
      conta.catalogo_item += r.rowCount;
    }

    const conversasOk = new Set();
    for (const c of conversas) {
      if (!ids.has(c.donoId)) { console.log(`  pulando conversa ${c.id}: dono não existe`); continue; }
      const r = await q(`INSERT INTO chat_conversa (id, dono_id, titulo, status, estado, registro, corrigida, trava, criado_em, atualizado_em)
        VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, 1, $8, $9) ON CONFLICT DO NOTHING`,
        [c.id, c.donoId, c.titulo, c.status, JSON.stringify(c.estado ?? {}), JSON.stringify(c.registro ?? []), !!c.corrigida, c.criadoEm, c.atualizadoEm ?? c.criadoEm]);
      conversasOk.add(c.id);
      if (!r.rowCount) continue;
      conta.chat_conversa++;
      const vs = c.versoes ?? [];
      for (const [i, v] of vs.entries()) {
        await q(`INSERT INTO chat_versao (id, conversa_id, numero, nota, motivo, criado_por_id, criado_por_nome, criado_em, is_current, planos, totais, mudou)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11::jsonb, $12::jsonb) ON CONFLICT DO NOTHING`,
          [novoId(), c.id, v.n ?? i + 1, v.nota ?? "", v.motivo ?? null, idPorNome.get(v.autor) ?? null, v.autor ?? "sistema", v.em, i === vs.length - 1,
            JSON.stringify(v.planos ?? {}), JSON.stringify(v.totais ?? {}), JSON.stringify(v.mudou ?? [])]);
        conta.chat_versao++;
      }
      await auditar({ origem: "IMPORTACAO", entity: "chat_conversa", entityId: c.id, event: "conversa.importada", action: "CREATE", after: { titulo: c.titulo, status: c.status } }, q);
    }

    // mensagens na ordem do arquivo: hora crescente por conversa, para não empatar
    const ultima = new Map();
    for (const m of mensagens) {
      if (!conversasOk.has(m.conversaId)) continue;
      let t = Date.parse(m.criadoEm) || Date.now();
      t = Math.max(t, (ultima.get(m.conversaId) ?? 0) + 1); ultima.set(m.conversaId, t);
      const r = await q(`INSERT INTO chat_mensagem (id, conversa_id, autor_id, tipo, texto, extra, criado_em) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7) ON CONFLICT DO NOTHING`,
        [m.id, m.conversaId, ids.has(m.autorId) ? m.autorId : null, m.tipo, m.texto ?? "", JSON.stringify(m.extra ?? {}), new Date(t).toISOString()]);
      conta.chat_mensagem += r.rowCount;
      for (const a of m.anexos ?? []) {
        const f = path.join(DADOS, "anexos", a.id);
        if (!existsSync(f)) { console.log(`  anexo ${a.nome} sem arquivo em data/anexos: pulado`); continue; }
        const ra = await q(`INSERT INTO chat_anexo (id, conversa_id, mensagem_id, nome, tipo, tamanho, conteudo, criado_em) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT DO NOTHING`,
          [a.id, m.conversaId, m.id, a.nome, a.tipo ?? "", a.tamanho ?? 0, readFileSync(f), new Date(t).toISOString()]);
        conta.chat_anexo += ra.rowCount;
      }
    }
    for (const n of notificacoes) {
      if (!ids.has(n.para) || (n.conversaId && !conversasOk.has(n.conversaId))) continue;
      const r = await q(`INSERT INTO notificacao (id, para_id, texto, conversa_id, lida, criado_em) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT DO NOTHING`,
        [n.id, n.para, n.texto, n.conversaId ?? null, !!n.lida, n.criadoEm]);
      conta.notificacao += r.rowCount;
    }
  });
  console.log("Importado (novos):", Object.entries(conta).map(([k, v]) => `${k} ${v}`).join(" · "));
} catch (e) {
  console.error("Não deu:", e.message);
  process.exitCode = 1;
} finally {
  await fecharBanco();
}
