// Troca a senha de um usuário pelo terminal: npm run trocar-senha
// A senha é digitada aqui e nunca aparece na tela nem fica em lugar nenhum
// (só o hash vai para a tabela usuario). As sessões abertas dessa conta caem.
import readline from "node:readline";
import { carregarEnv, hashSenha, usuarioPorEmail } from "../lib/base.mjs";
import { consulta, fecharBanco, UTC_AGORA } from "../lib/db.mjs";
import { auditar } from "../lib/auditoria.mjs";

carregarEnv();
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const pergunta = (q) => new Promise((ok) => rl.question(q, ok));
function perguntaOculta(q) {
  return new Promise((ok) => {
    const esc = rl._writeToOutput;
    rl._writeToOutput = (s) => { if (s.includes(q)) esc.call(rl, s); else esc.call(rl, "*".repeat(s.length ? 1 : 0)); };
    rl.question(q, (r) => { rl._writeToOutput = esc; process.stdout.write("\n"); ok(r); });
  });
}

const email = await pergunta("E-mail: ");
const senha = await perguntaOculta("Senha nova (mín. 8 caracteres): ");
const repetida = await perguntaOculta("Repita a senha nova: ");
rl.close();
try {
  if (senha.length < 8) throw new Error("A senha precisa ter pelo menos 8 caracteres.");
  if (senha !== repetida) throw new Error("As duas senhas não são iguais. Nada mudou.");
  const u = await usuarioPorEmail(email);
  if (!u) throw new Error("Não há usuário com esse e-mail. Nada mudou.");
  await consulta(`UPDATE usuario SET senha_hash = $2, atualizado_em = ${UTC_AGORA} WHERE id = $1`, [u.id, hashSenha(senha)]);
  await consulta("DELETE FROM sessao WHERE usuario_id = $1", [u.id]);
  await auditar({ origem: "SISTEMA", entity: "usuario", entityId: u.id, event: "usuario.senha_trocada", action: "UPDATE", campos: ["senha_hash"], meta: { por: "terminal" } });
  console.log(`Pronto: senha de ${u.email} trocada. Entre com a senha nova.`);
} catch (e) {
  console.error("Não deu:", e.message);
  process.exitCode = 1;
} finally {
  await fecharBanco();
}
