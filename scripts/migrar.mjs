// Aplica as migrações de db/migrations no banco do DATABASE_URL: npm run migrar
// Serve para qualquer destino (Postgres.app, Supabase local ou na nuvem).
import { carregarEnv } from "../lib/base.mjs";
import { migrar, fecharBanco } from "../lib/db.mjs";

carregarEnv();
try {
  const novas = await migrar();
  console.log(novas.length ? `Aplicadas: ${novas.join(", ")}` : "O banco já está em dia.");
} catch (e) {
  console.error("Não deu:", e.message);
  process.exitCode = 1;
} finally {
  await fecharBanco();
}
