// Cria um usuário pelo terminal: npm run criar-usuario
// A senha é digitada aqui e nunca aparece na tela nem fica em lugar nenhum
// (só o hash vai para a tabela usuario).
import readline from "node:readline";
import { carregarEnv, criarUsuario, CARGOS, PERMISSOES } from "../lib/base.mjs";
import { migrar, fecharBanco } from "../lib/db.mjs";

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

const nome = await pergunta("Nome: ");
const email = await pergunta("E-mail: ");
// cargo = o que a pessoa faz (a alçada segue o cargo); permissão = o que ela configura
const escolha = async (q, ops, padrao) => {
  for (;;) { const r = (await pergunta(`${q} (${ops.join("/")}) [${padrao}]: `)).trim().toLowerCase() || padrao; if (ops.includes(r)) return r; console.log("Escolha uma das opções."); }
};
const cargo = await escolha("Cargo", CARGOS, "vendedor");
const permissao = await escolha("Permissão", PERMISSOES, "membro");
const aprovadorFinal = (await escolha("Aprovador final, o último nível que aprova tudo", ["s", "n"], "n")) === "s";
const senha = await perguntaOculta("Senha (mín. 8 caracteres): ");
rl.close();
try {
  await migrar();
  const u = await criarUsuario({ nome, email, senha, cargo, permissao, aprovadorFinal });
  console.log(`Pronto: ${u.email} (${u.cargo}, ${u.permissao}${u.aprovadorFinal ? ", aprovador final" : ""}). Entre em http://localhost:${process.env.PORTA || 8790}`);
} catch (e) {
  console.error("Não deu:", e.message);
  process.exitCode = 1;
} finally {
  await fecharBanco();
}
