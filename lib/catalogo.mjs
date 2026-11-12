// Regras do criador (especificação do Leo, 27/10/2026). Os PREÇOS ficam no
// catálogo de itens (Configurações › Itens); aqui só as regras de quais itens
// entram em cada plano. O assistente nunca escreve preço.
import { consulta, UTC_AGORA } from "./db.mjs";
import { auditar } from "./auditoria.mjs";

export const FAIXAS = [100, 1000, 5000, 10000, 20000];
export const FAIXA_NOME = { 100: "100 usuários", 1000: "1.000 usuários", 5000: "5.000 usuários", 10000: "10.000 usuários", 20000: "20.000 usuários" };
/** App interno: 100. Para a população, pelos habitantes — o corte entra na faixa. */
export const faixaPorPopulacao = (pop) => (pop <= 5000 ? 1000 : pop <= 20000 ? 5000 : pop <= 100000 ? 10000 : 20000);
export const REGRA_FAIXA = "App interno: 100 usuários. Para a população: até 5.000 hab. → 1.000; até 20.000 → 5.000; até 100.000 → 10.000; acima → 20.000.";
export const SEMPRE_POPULACAO = ["Cidade na mão"];

export const NIVEIS = ["minimal", "premium", "ai_driven"];
export const NIVEL_NOME = { minimal: "Minimal", premium: "Premium", ai_driven: "AI Driven" };
export const COMPONENTES = { implementacao: "Implementação", licenca: "Licença mensal", suporte: "Suporte mensal" };
export const GRUPOS = {
  canal: "Canal", subcanal: "Subcanal", monitoramento: "Monitoramento", ia: "IA / ChatBot", whatsapp: "WhatsApp",
  bi: "B.I.", agendamento: "Agendamento", app: "Ícone próprio nas lojas", admin: "Plataforma ADMIN",
  suporte_remoto: "Suporte remoto", suporte_local: "Suporte local", call_center: "Call center", integracao: "Integração",
};

const MON_PADRAO = { 100: "mon_05gb", 1000: "mon_05gb", 5000: "mon_1gb", 10000: "mon_3gb", 20000: "mon_5gb" };
const IA = { 100: "ia_10m", 1000: "ia_10m", 5000: "ia_25m", 10000: "ia_50m", 20000: "ia_100m" };
export const HORAS_SUGERIDAS = { 100: 2, 1000: 4, 5000: 6, 10000: 8, 20000: 10 };

/** Linhas (item + quantidade) que um grupo coloca no plano. */
export function linhasDoGrupo(g, cfg) {
  switch (g) {
    case "canal": return [{ id: "canal_impl", qtd: 1 }, { id: `canal_lic_${cfg.faixa}`, qtd: 1 }];
    // a tabela oficial do CNM (Precos v3.5) não tem subcanal de 100 usuários: o menor é o de 1.000
    case "subcanal": return [{ id: "subcanal_impl", qtd: 1 }, { id: `subcanal_lic_${Number(cfg.faixa) === 100 ? 1000 : cfg.faixa}`, qtd: 1 }];
    case "monitoramento": return [{ id: cfg.monitoramento === "customizado" ? "mon_custom" : MON_PADRAO[cfg.faixa], qtd: 1 }];
    case "ia": return [{ id: IA[cfg.faixa], qtd: 1 }];
    case "whatsapp": return [{ id: "wpp_impl", qtd: 1 }, { id: "wpp_lic", qtd: 1 }];
    case "bi": return [{ id: "bi_impl", qtd: 1 }, { id: "bi_1u", qtd: 1 }];
    case "agendamento": return [{ id: "agenda_impl", qtd: 1 }, { id: "agenda_500", qtd: 1 }];
    case "app": return [{ id: "wl_impl", qtd: 1 }, { id: "wl_lic", qtd: 1 }];
    case "admin": return [{ id: "admin_lic", qtd: 1 }];
    case "suporte_remoto": return [{ id: "sup_remoto", qtd: cfg.horasRemoto || HORAS_SUGERIDAS[cfg.faixa] }];
    case "suporte_local": return [{ id: "sup_local", qtd: cfg.suporteLocal || 1 }];
    case "call_center": return [{ id: "call_op", qtd: 1 }];
    case "integracao": return [{ id: "integracao", qtd: 1 }];
  }
  return [];
}

/** Composição dos níveis (EXEMPLO até a SASI mapear por solução). */
export function gruposDoNivel(n, cfg) {
  const base = [cfg.canalTipo === "subcanal" ? "subcanal" : "canal", "monitoramento"];
  if (cfg.horasRemoto > 0) base.push("suporte_remoto");
  if (cfg.suporteLocal > 0) base.push("suporte_local");
  if (cfg.integracao) base.push("integracao");
  if (n === "minimal") return base;
  if (n === "premium") return [...base, "ia", "whatsapp"];
  return [...base, "ia", "whatsapp", "bi", "app"];
}
export const paraItem = (it, qtd, add = false) => ({ id: it.id, grupo: it.grupo, nome: it.nome, componente: it.componente, unit: it.preco, unidade: it.unidade, qtd, ...(add ? { add: true } : {}) });
export function montarPlano(n, cfg, cat) {
  const out = [];
  for (const g of gruposDoNivel(n, cfg)) for (const l of linhasDoGrupo(g, cfg)) { const it = cat.get(l.id); if (it) out.push(paraItem(it, l.qtd)); }
  return out;
}

/** Catálogo inicial: valores da Calculadora CNM / Tabela de preço (exemplo).
 *  preco null = sem preço na base ainda. */
const INICIAL = [
  ["canal_impl", "canal", "Implementação de canal para app", "implementacao", 350, "por canal"],
  ["canal_lic_100", "canal", "Licença de canal no app, até 100 usuários", "licenca", 100, "mês"],
  ["canal_lic_1000", "canal", "Licença de canal no app, até 1.000 usuários", "licenca", 200, "mês"],
  ["canal_lic_5000", "canal", "Licença de canal no app, até 5.000 usuários", "licenca", 250, "mês"],
  ["canal_lic_10000", "canal", "Licença de canal no app, até 10.000 usuários", "licenca", 300, "mês"],
  ["canal_lic_20000", "canal", "Licença de canal no app, até 20.000 usuários", "licenca", null, "mês"],
  ["subcanal_impl", "subcanal", "Implementação de subcanal para app", "implementacao", 150, "por subcanal"],
  ["subcanal_lic_100", "subcanal", "Licença de subcanal no app, até 100 usuários", "licenca", null, "mês"],
  ["subcanal_lic_1000", "subcanal", "Licença de subcanal no app, até 1.000 usuários", "licenca", 100, "mês"],
  ["subcanal_lic_5000", "subcanal", "Licença de subcanal no app, até 5.000 usuários", "licenca", 120, "mês"],
  ["subcanal_lic_10000", "subcanal", "Licença de subcanal no app, até 10.000 usuários", "licenca", 150, "mês"],
  ["subcanal_lic_20000", "subcanal", "Licença de subcanal no app, até 20.000 usuários", "licenca", 200, "mês"],
  ["mon_05gb", "monitoramento", "Monitoramento Web padrão 0,5GB, B.I. 2 atualizações/dia, até 2 usuários", "licenca", 300, "mês"],
  ["mon_1gb", "monitoramento", "Monitoramento Web padrão 1GB, B.I. 4 atualizações/dia, até 2 usuários", "licenca", 400, "mês"],
  ["mon_3gb", "monitoramento", "Monitoramento Web padrão 3GB, B.I. 4 atualizações/dia, até 3 usuários", "licenca", 500, "mês"],
  ["mon_5gb", "monitoramento", "Monitoramento Web padrão 5GB, B.I. 4 atualizações/dia, até 5 usuários", "licenca", 750, "mês"],
  ["mon_10gb", "monitoramento", "Monitoramento Web padrão 10GB, B.I. 8 atualizações/dia, até 5 usuários", "licenca", 1200, "mês"],
  ["mon_custom", "monitoramento", "Monitoramento customizado (definido por projeto)", "licenca", null, "mês"],
  ["ia_10m", "ia", "Canal de IA até 10M/TKS (ChatBot)", "licenca", 350, "mês"],
  ["ia_25m", "ia", "Canal de IA até 25M/TKS (ChatBot)", "licenca", 800, "mês"],
  ["ia_50m", "ia", "Canal de IA até 50M/TKS (ChatBot)", "licenca", 1200, "mês"],
  ["ia_100m", "ia", "Canal de IA até 100M/TKS (ChatBot)", "licenca", 2000, "mês"],
  ["wpp_impl", "whatsapp", "Implementação do canal WhatsApp Business", "implementacao", 1000, "única"],
  ["wpp_lic", "whatsapp", "Canal WhatsApp Business, até 1.000 conversas", "licenca", 400, "mês"],
  ["bi_impl", "bi", "Implementação da infraestrutura de B.I. (1 visão / 3 filtros)", "implementacao", 800, "única"],
  ["bi_1u", "bi", "Mensalidade B.I. — 1 visão / 3 filtros, 1 usuário", "licenca", 1000, "mês"],
  ["bi_3u", "bi", "Mensalidade B.I. — 3 visões / 6 filtros, 3 usuários", "licenca", 2800, "mês"],
  ["agenda_impl", "agendamento", "Implementação do agendamento, por ponto de serviço", "implementacao", 600, "por ponto"],
  ["agenda_500", "agendamento", "Agendamento até 500 agendamentos/mês", "licenca", 400, "mês"],
  ["wl_impl", "app", "Implementação do ícone personalizado nas lojas", "implementacao", 1200, "única"],
  ["wl_lic", "app", "Hospedagem mensal do ícone personalizado", "licenca", 500, "mês"],
  ["admin_lic", "admin", "Licença da plataforma ADMIN SASI, por usuário", "licenca", 250, "usuário/mês"],
  ["sup_remoto", "suporte_remoto", "Suporte remoto helpdesk: treinamento, atualização e manutenção", "suporte", 55, "hora/mês"],
  ["sup_local", "suporte_local", "Suporte local com equipamentos TIC (220h/mês): treinamento, atualização e manutenção", "suporte", 7200, "operador/mês"],
  ["call_op", "call_center", "Operador de call center diurno (150h/mês)", "suporte", 5302.5, "operador/mês"],
  ["integracao", "integracao", "Integração com outros sistemas (programação definida por projeto)", "implementacao", null, "por projeto"],
].map(([id, grupo, nome, componente, preco, unidade], i) => ({ id, grupo, nome, componente, preco, unidade, ativo: true, ordem: i }));

/* ═══ catálogo no banco (catalogo_item); a lixeira fica de fora de toda leitura ═══ */
const itemDoBanco = (r) => ({ id: r.id, grupo: r.grupo, nome: r.nome, componente: r.componente, preco: r.preco, unidade: r.unidade, ativo: r.ativo, ordem: r.ordem });
export async function itens() {
  return (await consulta("SELECT * FROM catalogo_item WHERE deleted_at IS NULL ORDER BY ordem, id")).rows.map(itemDoBanco);
}
/** Os itens ativos, por id: é o que monta os planos. */
export async function catalogo() {
  return new Map((await itens()).filter((i) => i.ativo).map((i) => [i.id, i]));
}
/** Barato, médio e caro: os itens do catálogo em três partes iguais, pelo que custam em 12 meses. Muda sozinho quando o preço muda. */
export const valorEm12Meses = (i) => Number(i.preco) * (i.componente === "implementacao" ? 1 : 12);
export async function cortesDePreco() {
  const v = (await itens()).filter((i) => i.ativo && i.preco != null).map(valorEm12Meses).sort((a, b) => a - b);
  return v.length ? { barato: v[Math.floor((v.length - 1) / 3)], medio: v[Math.floor(((v.length - 1) * 2) / 3)] } : null;
}
/** Primeira vez: põe os valores iniciais. Depois, nunca mexe no que o gerente editou. */
export async function semearItens() {
  if ((await consulta("SELECT count(*)::int AS n FROM catalogo_item")).rows[0].n) return 0;
  for (const i of INICIAL) {
    await consulta(`INSERT INTO catalogo_item (id, grupo, nome, componente, preco, unidade, ativo, ordem, atualizado_em)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, ${UTC_AGORA}) ON CONFLICT (id) DO NOTHING`,
      [i.id, i.grupo, i.nome, i.componente, i.preco, i.unidade, i.ativo, i.ordem]);
  }
  return INICIAL.length;
}
/** Muda nome, preço, unidade ou situação. Devolve false se o item não existe. */
export async function atualizarItem(id, campos, quem) {
  const antes = (await itens()).find((i) => i.id === id);
  if (!antes) return false;
  const depois = { ...antes, ...campos };
  await consulta(`UPDATE catalogo_item SET nome = $2, preco = $3, unidade = $4, ativo = $5, atualizado_por_id = $6, atualizado_em = ${UTC_AGORA}
    WHERE id = $1 AND deleted_at IS NULL`, [id, depois.nome, depois.preco, depois.unidade, depois.ativo, quem.id]);
  await auditar({ ator: quem, origem: "TELA", entity: "catalogo_item", entityId: id, event: "catalogo.item_alterado", action: "UPDATE", before: antes, after: depois });
  return true;
}
/** Item novo no fim da lista. Devolve false se já existe um com esse id. */
export async function criarItem(it, quem) {
  const r = await consulta(`INSERT INTO catalogo_item (id, grupo, nome, componente, preco, unidade, ativo, ordem, atualizado_por_id, atualizado_em)
    VALUES ($1, $2, $3, $4, $5, $6, TRUE, (SELECT coalesce(max(ordem), -1) + 1 FROM catalogo_item), $7, ${UTC_AGORA})
    ON CONFLICT (id) DO NOTHING`, [it.id, it.grupo, it.nome, it.componente, it.preco, it.unidade, quem.id]);
  if (!r.rowCount) return false;
  await auditar({ ator: quem, origem: "TELA", entity: "catalogo_item", entityId: it.id, event: "catalogo.item_criado", action: "CREATE",
    after: { grupo: it.grupo, nome: it.nome, componente: it.componente, preco: it.preco, unidade: it.unidade } });
  return true;
}

/** Soluções do campo "Solução" (projeto) dos negócios no HubSpot. */
export const SOLUCOES_HUBSPOT = [
  "Alerta Cidade", "Aluno Abordo", "Artista Conectado", "Ação e Prevenção", "Boletim Médico Digital", "Brigada Segura", "Capitão Nemo",
  "Carteira PCD", "Checklist Digital", "Cidade na mão", "CIPA Legal", "Conecta Hans", "Controle de Estoque de Medicamento", "Controle Interno",
  "Defensoria Digital", "E-Público", "E-Vigilance", "Emprega Mais", "Entrega Já", "Escola Digital", "Frota Feliz", "Gabinete Virtual",
  "Gravidez Saudável", "Habita Fácil", "HiperDia", "Inventário", "Libera Fácil", "Melhor em Casa", "Meu Evento", "Meu Pet", "Meu RH",
  "Empresa na Mão", "Outros", "Paga Fogo", "Pesquisa Populacional", "Plataforma Pajé", "Portaria Inteligente", "PROCON Digital",
  "Programa de Benefícios", "Remédio em Casa", "Teleauditoria", "Telemedicina", "TEVAS (Testes e Vacinas)", "Tropa de E-lite",
];
const ROTULO = { "Aluno Abordo": "Aluno A Bordo", "Frota Feliz": "Frota na Mão", "Empresa na Mão": "Minha Empresa" };
export const nomeSolucao = (v) => (v ? ROTULO[v] ?? v : "");
