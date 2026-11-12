// Banco: Postgres pelo DATABASE_URL — Postgres.app, Supabase (local ou nuvem)
// ou qualquer outro Postgres. Trocar de lugar = trocar a URL e rodar as migrações.
import pg from "pg";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MIGRACOES = path.join(path.dirname(path.dirname(fileURLToPath(import.meta.url))), "db", "migrations");

// datas: as colunas são TIMESTAMP(3) com hora UTC; a tela recebe texto ISO.
// Comparações com "agora" usam UTC_AGORA, nunca o fuso da conexão.
export const UTC_AGORA = "(now() AT TIME ZONE 'UTC')";
pg.types.setTypeParser(1114, (v) => new Date(v.replace(" ", "T") + "Z").toISOString());
pg.types.setTypeParser(1184, (v) => new Date(v.replace(" ", "T").replace(/([+-]\d\d)$/, "$1:00")).toISOString());
// NUMERIC(14,2) vem como texto; preço é número
pg.types.setTypeParser(1700, (v) => (v == null ? null : Number(v)));

let pool = null;
function abrir() {
  if (pool) return pool;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("Falta DATABASE_URL no .env (veja o README).");
  const ca = process.env.DATABASE_CA_FILE;
  pool = new pg.Pool({
    connectionString: url,
    max: Number(process.env.DATABASE_POOL) || 5,
    // Supabase na nuvem: com o certificado do painel, a conexão confere quem é o servidor
    ...(ca ? { ssl: { ca: readFileSync(ca, "utf8"), rejectUnauthorized: true } } : {}),
  });
  pool.on("error", (e) => console.error("Postgres:", e.message));
  return pool;
}
export const bancoConfigurado = () => !!process.env.DATABASE_URL;

/** Uma consulta solta. */
export const consulta = (sql, params) => abrir().query(sql, params);

/** Tudo dentro de fn grava junto ou nada grava. */
export async function transacao(fn) {
  const cli = await abrir().connect();
  try {
    await cli.query("BEGIN");
    const r = await fn((sql, params) => cli.query(sql, params));
    await cli.query("COMMIT");
    return r;
  } catch (e) {
    await cli.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    cli.release();
  }
}
export async function fecharBanco() { if (pool) { await pool.end(); pool = null; } }

/** Aplica, em ordem, as migrações de db/migrations que ainda não rodaram. */
export async function migrar() {
  await consulta(`CREATE TABLE IF NOT EXISTS migracao (
    nome TEXT PRIMARY KEY, aplicada_em TIMESTAMP(3) NOT NULL DEFAULT (now() AT TIME ZONE 'UTC'))`);
  await consulta("ALTER TABLE migracao ENABLE ROW LEVEL SECURITY");
  const feitas = new Set((await consulta("SELECT nome FROM migracao")).rows.map((r) => r.nome));
  const novas = readdirSync(MIGRACOES).filter((f) => /^\d{4}_[\w-]+\.sql$/.test(f)).sort().filter((f) => !feitas.has(f));
  for (const f of novas) {
    await transacao(async (q) => {
      await q(readFileSync(path.join(MIGRACOES, f), "utf8"));
      await q("INSERT INTO migracao (nome) VALUES ($1)", [f]);
    });
  }
  return novas;
}

/* ═══ trava por conversa: dentro deste servidor, um pedido de cada vez mexe na mesma proposta ═══ */
const travas = new Map();
export async function comTrava(chave, fn) {
  const antes = travas.get(chave) ?? Promise.resolve();
  let soltar;
  const vez = new Promise((ok) => { soltar = ok; });
  const minha = antes.then(() => vez);
  travas.set(chave, minha);
  await antes;
  try { return await fn(); }
  finally { soltar(); if (travas.get(chave) === minha) travas.delete(chave); }
}
