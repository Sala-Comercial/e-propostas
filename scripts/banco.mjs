// Mostra onde o criador está gravando e quantas linhas tem cada tabela: npm run banco
// A URL sai sem senha, pronta para colar no TablePlus (Import from URL).
import { carregarEnv } from "../lib/base.mjs";
import { consulta, fecharBanco } from "../lib/db.mjs";

carregarEnv();
const url = process.env.DATABASE_URL;
if (!url) { console.error("Falta DATABASE_URL no .env."); process.exit(1); }
const u = new URL(url);
const semSenha = `${u.protocol}//${u.username ? decodeURIComponent(u.username) + "@" : ""}${u.host}${u.pathname}`;
console.log(`Banco: ${semSenha}${u.password ? "  (a senha está no .env)" : ""}`);
console.log(`TablePlus: Host ${u.hostname} · Port ${u.port || 5432} · User ${decodeURIComponent(u.username || "")} · Database ${u.pathname.slice(1)}`);
try {
  const v = (await consulta("SELECT version()")).rows[0].version;
  console.log(v.split(",")[0]);
  const tabelas = ["usuario", "sessao", "usuario_visualizacao", "catalogo_item", "modalidade_contratacao", "chat_conversa", "chat_versao", "chat_mensagem", "chat_anexo", "notificacao", "audit_log", "sessao_log", "migracao"];
  for (const t of tabelas) {
    const n = await consulta(`SELECT count(*)::int AS n FROM ${t}`).then((r) => r.rows[0].n).catch(() => "—");
    console.log(`  ${t.padEnd(22)} ${n}`);
  }
} catch (e) {
  console.error("Não consegui conectar:", e.message);
  process.exitCode = 1;
} finally {
  await fecharBanco();
}
