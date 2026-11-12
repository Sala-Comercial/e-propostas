// Motor do assistente: GPT pela API Responses da OpenAI (chave no .env).
// O GPT conversa e chama ferramentas; preço, negócio e população vêm delas.
import { catalogo, FAIXAS, FAIXA_NOME, GRUPOS, HORAS_SUGERIDAS, NIVEIS, REGRA_FAIXA, SEMPRE_POPULACAO, SOLUCOES_HUBSPOT, faixaPorPopulacao, nomeSolucao } from "./catalogo.mjs";
import { podeAprovar, adicionarGrupo, cabeNoPreco, definirPrecoEstimado, detalharGrupo, ehGerente, enviarAoGerente, montarPlanos, mudarQuantidade, registrar, removerGrupo, resumoParaIA, totais } from "./proposta.mjs";
import { modalidadesAtivas } from "./modalidades.mjs";
import { buscar } from "./conhecimento.mjs";
import { criarNegocio, donoPorEmail, hubspotLigado, negocioDoDono, negociosDoDono, populacao } from "./externos.mjs";

export const iaLigada = () => !!process.env.OPENAI_API_KEY;
const modelo = () => process.env.OPENAI_MODELO || "gpt-6.1-sol";
const BASE = () => process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";

const INSTRUCOES = `Você é o assistente do Criador de propostas da SASI.
Fale português do Brasil, direto e curto, como um colega da equipe comercial. Escreva "implementação", nunca "implantação".

Monte a proposta com o vendedor nesta ordem, uma pergunta por vez, sempre com perguntar_opcoes:
1. "O negócio já existe no HubSpot?" (Sim / Não).
   - Sim: ultimos_negocios traz os 3 últimos mexidos pelo vendedor; ofereça os 3 + "Outro". Em "Outro", peça o nome e use buscar_negocio.
   - Não: pergunte nome do cliente, se é público ou privado, cidade e UF (público) e a solução; depois criar_negocio (cria no HubSpot com o vendedor como dono).
2. Confirmar a solução do negócio (Sim / "Trocar solução"). Para trocar, ofereça as soluções de listar_solucoes com busca.
   - Se não se sabe se o cliente é público ou privado (usar_negocio devolve setor_desconhecido), pergunte com perguntar_opcoes ("Público" / "Privado") e grave com definir_setor.
   - Pergunte uma vez, em texto: "Em uma frase, o que o cliente quer?" (ex.: "reduzir as filas da saúde com agendamento pelo celular"). Grave com definir_objetivo, nas palavras do vendedor. Se ele não souber ou pular, siga: fica em "Faltou responder" no resumo.
   - Cliente público: pergunte "Como o cliente vai contratar?" com as opções de listar_modalidades + "Ainda não sei", e grave com definir_modalidade. Ela vira a página "Recomendação de modalidade de contratação" da proposta. Cliente privado: não pergunte.
3. Canal: pergunte se o app é para a população ou de uso interno (Cidade na Mão é sempre para a população). Para a população, buscar_populacao e sugerir a faixa da regra; o vendedor pode trocar, mas aí peça o motivo (o gerente vai ver). Pergunte também canal padrão ou subcanal (subcanal barateia).
4. Monitoramento: padrão (catálogo) ou customizado. Cidade na Mão normalmente usa o padrão.
5. Suporte, uma pergunta por vez, todas com perguntar_opcoes:
   - Tipo: "Remoto", "Local", "Remoto e local".
   - Horas de suporte remoto por mês: a sugerida por definir_canal (com "(sugerido)" no detalhe) e mais 3 ou 4 valores próximos, ex.: 2, 4, 6, 8, 10.
   - Operadores de suporte local: "1", "2", "3", "4", "5 ou mais" (se escolher "5 ou mais", pergunte o número exato em texto).
   - Distribuição dos operadores locais: "Por secretaria", "Por unidade", "Por turno", "Ainda não sei".
   - Integração com outros sistemas: "Sim", "Não", "Ainda não sei".
6. configurar_proposta monta os três planos, do menor para o maior: Minimal, Premium e AI Driven. A proposta leva os TRÊS planos; o vendedor não escolhe um. Mensagens antigas podem usar os nomes de antes: Básico é o Minimal, Pro é o Premium e o Premium antigo é o AI Driven. Na dúvida sobre qual o vendedor quer dizer, pergunte.
7. O vendedor revisa e pode alterar qualquer plano (ajustar_plano), pelo chat ou pela tabela ao lado.
   - Grátis: se o vendedor disser que algo vai sem cobrar, use detalhar_grupo com gratis=true. O gerente vê o grátis em destaque, com o valor que deixa de ser cobrado.
   - Para quê: toda quantidade maior que 1 precisa de uma justificativa curta (ex.: "1 para o jurídico, 1 para o fiscal"). Se faltar (quantidades_sem_justificativa), pergunte uma vez e grave com detalhar_grupo; não trave o envio.
   - Preço estimado: se o vendedor disser quanto o cliente pode pagar, use definir_preco_estimado e diga o que tirar quando não couber. Não pergunte isso por conta própria.
   - Calculadora: na tabela de cada plano, ao lado, o botão se chama "Abrir calculadora". Ele abre a calculadora da solução (Calculadora CNM no Cidade na Mão, Tabela de preço nas outras), e a tabela salva lá volta para dentro do plano. Se o vendedor preferir montar lá, indique esse botão pelo nome.
8. Quando ele aprovar, aprovar_e_gerar_proposta: gera o PDF e manda para o gerente. Deixe claro que foi para o gerente. Se ele pedir para mandar só a tabela de preços (sem a proposta completa), use so_tabela=true.

Regras que não se quebram:
- Cobrança: implementação (valor único, no 1º mês) + licença mensal + suporte mensal. Mês 1 = os três; do mês 2 em diante = licença + suporte.
- Nunca escreva preço, total, desconto ou quantidade que não tenha vindo de uma ferramenta. Item sem preço fica "sem preço" — avise.
- Negócios: só existem os que as ferramentas devolverem. Negócios de outros vendedores não existem para você — regra ética da SASI.
- Sempre que der para oferecer opções, use perguntar_opcoes (até 8 opções curtas; busca=true quando a lista for longa) — inclusive para quantidades: ofereça os valores mais comuns e "Outro" quando fizer sentido. Só fica em texto aberto o que não tem opções possíveis: nome do cliente, cidade, motivo de trocar a faixa e o número exato depois de "Outro"/"ou mais".
- Sempre escreva a pergunta ou a resposta em texto, mesmo quando mostrar botões. Escreva cada pergunta uma vez só: se já escreveu junto com uma ferramenta, não repita depois.
- Aprovar ou reprovar pelo gerente é só pelos botões da tela.
- Texto de anexos chega junto da mensagem: use para entender o escopo; os preços continuam vindo das ferramentas.
- Respostas curtas: os números completos aparecem nos planos ao lado.
- "Conhecimento da SASI" (quando vier) traz padrões de propostas já aprovadas, erros a evitar (o que o gerente reprovou ou corrigiu), trechos de documentos da casa e conversas anteriores do próprio vendedor. Antes de sugerir ou fechar um plano, confira os erros a evitar e avise se o que está sendo montado repete um deles. As conversas anteriores são só de quem está falando: use para lembrar preferências e o que já foi combinado, sem tratar como regra. Use para sugerir e justificar (ex.: o que costuma ser aprovado para essa solução e porte, que serviços entram, o que vai grátis), dizendo que é o que costuma ser aprovado. Nunca cite nome de cliente, cidade ou vendedor de outra proposta, e nunca tire preço de lá: preço vem do catálogo, pelas ferramentas. Para uma pergunta direta sobre soluções, funcionalidades ou propostas anteriores, use consultar_base.
Regra do canal: ${REGRA_FAIXA}`;

const fn = (name, description, properties = {}) => ({
  type: "function", name, description, strict: true,
  parameters: { type: "object", properties, required: Object.keys(properties), additionalProperties: false },
});
const strOuNulo = { type: ["string", "null"] };
const FERRAMENTAS = [
  fn("perguntar_opcoes", "Mostra a pergunta com botões de toque (e busca quando busca=true). O que o usuário tocar volta como mensagem.", {
    opcoes: { type: "array", maxItems: 8, items: { type: "object", properties: { rotulo: { type: "string" }, detalhe: strOuNulo }, required: ["rotulo", "detalhe"], additionalProperties: false } },
    busca: { type: "boolean" },
  }),
  fn("ultimos_negocios", "Os 3 últimos negócios mexidos pelo vendedor dono desta conversa no HubSpot."),
  fn("buscar_negocio", "Busca no HubSpot, pelo nome, entre os negócios do vendedor dono desta conversa.", { termo: { type: "string" } }),
  fn("usar_negocio", "Usa um negócio do HubSpot nesta proposta (id de negocios_mostrados no estado, ou devolvido por ultimos_negocios/buscar_negocio).", { id: { type: "string" } }),
  fn("criar_negocio", "Cria o negócio no HubSpot com o vendedor como dono, quando ele ainda não existe.", {
    nome: { type: "string", description: "nome do negócio, ex.: Prefeitura de Maués - Cidade na Mão" },
    cliente: { type: "string" }, setor: { type: "string", enum: ["publico", "privado"] },
    cidade: strOuNulo, uf: strOuNulo, solucao: { type: "string", enum: SOLUCOES_HUBSPOT },
  }),
  fn("listar_solucoes", "Soluções da SASI (as mesmas do campo Solução do HubSpot)."),
  fn("definir_setor", "Grava se o cliente é público ou privado, quando o negócio do HubSpot não informa.", { setor: { type: "string", enum: ["publico", "privado"] } }),
  fn("definir_objetivo", "Grava, em uma frase, o que o cliente quer com o projeto. Aparece no topo do resumo do negócio para o gerente.", { texto: { type: "string" } }),
  fn("trocar_solucao", "Troca a solução desta proposta.", { solucao: { type: "string", enum: SOLUCOES_HUBSPOT } }),
  fn("buscar_populacao", "População do Censo 2022 (IBGE) da cidade do negócio, com a faixa de canal da regra."),
  fn("definir_canal", "Registra para quem é o app, a faixa de usuários do canal e o tipo de canal. Devolve as horas de suporte remoto sugeridas.", {
    publico: { type: "string", enum: ["populacao", "interno"] }, faixa: { type: "integer", enum: FAIXAS },
    tipo: { type: "string", enum: ["padrao", "subcanal"] },
    motivo_troca: { ...strOuNulo, description: "obrigatório quando a faixa for diferente da sugerida" },
  }),
  fn("configurar_proposta", "Fecha monitoramento, suporte e integração e monta os três planos com os preços do catálogo.", {
    monitoramento: { type: "string", enum: ["padrao", "customizado"] },
    horas_suporte_remoto: { type: "integer", description: "0 = sem suporte remoto" },
    operadores_suporte_local: { type: "integer", description: "0 = sem suporte local" },
    integracao: { type: "boolean" },
  }),
  fn("mostrar_planos", "Abre os três planos na mensagem e no painel."),
  fn("ajustar_plano", "Altera um plano: adicionar ou remover um grupo de itens, ou mudar a quantidade.", {
    plano: { type: "string", enum: [...NIVEIS, "todos"] }, acao: { type: "string", enum: ["adicionar", "remover", "quantidade"] },
    grupo: { type: "string", enum: Object.keys(GRUPOS) }, quantidade: { type: ["integer", "null"] },
  }),
  fn("detalhar_grupo", "Marca um grupo de itens como grátis ou cobrado (gratis) e/ou grava o para quê da quantidade (para_que). null = não mexe.", {
    plano: { type: "string", enum: [...NIVEIS, "todos"] }, grupo: { type: "string", enum: Object.keys(GRUPOS) },
    gratis: { type: ["boolean", "null"] }, para_que: strOuNulo,
  }),
  fn("definir_preco_estimado", "Grava quanto o cliente pode pagar em 12 meses numa opção. Devolve se cabe e, se não couber, o que tirar.", {
    plano: { type: "string", enum: [...NIVEIS, "todos"] }, valor: { type: "number" },
  }),
  fn("listar_modalidades", "Modalidades de contratação para cliente público (texto da página de modalidade da proposta)."),
  fn("definir_modalidade", "Grava como o cliente público vai contratar. nao_sei = a proposta sai sem a página de modalidade.", {
    modalidade: { type: "string", enum: ["ata_inexigibilidade", "inexigibilidade", "dispensa", "adesao_ata", "nao_sei"] },
  }),
  fn("consultar_base", "Busca na base de conhecimento da SASI (propostas aprovadas e erros a evitar, sem nomes; documentos inseridos na plataforma; conversas anteriores do próprio vendedor): soluções, funcionalidades, escopos, o que costuma ser aprovado ou reprovado.", {
    pergunta: { type: "string" },
  }),
  fn("aprovar_e_gerar_proposta", "O vendedor aprovou os planos: gera o PDF e envia para o gerente. Só quando ele pedir. so_tabela=true manda só a tabela de preços para aprovação, sem a proposta completa.", { so_tabela: { type: "boolean" } }),
];

function planosResumo(c) {
  return Object.fromEntries(NIVEIS.map((n) => {
    const p = c.estado.planos[n], t = totais(p);
    return [n, { itens: p.map((i) => `${i.qtd} × ${i.nome}${i.gratis ? " (grátis)" : ""}${i.para ? ` — para: ${i.para}` : ""}`), implementacao: t.implementacao, licenca_mensal: t.licenca, suporte_mensal: t.suporte, mes_1: t.mes1, a_partir_do_mes_2: t.mensal, total_12_meses: t.total12, itens_sem_preco: t.semPreco, gratis_12_meses: t.gratis12 }];
  }));
}

async function executar(nome, a, { c, u, saida }) {
  const e = c.estado, dono = c.donoId === u.id;
  const coleta = dono && (c.status === "rascunho" || c.status === "ajustar");
  const soColeta = { erro: "Só o vendedor dono muda isso, e só antes de enviar ao gerente." };
  const hubspot = async () => {
    if (!hubspotLigado()) return { erro: "HubSpot ainda não está ligado (falta HUBSPOT_TOKEN no .env). Pergunte os dados ao vendedor." };
    if (!dono) return { erro: "Só o vendedor dono consulta os negócios dele." };
    const id = await donoPorEmail(u.email);
    return id ? { id } : { erro: `O e-mail ${u.email} não é usuário do HubSpot, então não há negócios dele lá. Siga pelo caminho "Não": pergunte os dados e use criar_negocio (o negócio fica só nesta proposta).` };
  };
  switch (nome) {
    case "perguntar_opcoes":
      if (!(a.opcoes ?? []).length) return { erro: "Sem opções não há botões. Para pergunta aberta, só escreva a pergunta." };
      saida.pergunta = { busca: a.busca === true, opcoes: (a.opcoes ?? []).slice(0, 8).map((o) => ({ rotulo: String(o.rotulo ?? "").slice(0, 80), ...(o.detalhe ? { detalhe: String(o.detalhe).slice(0, 90) } : {}) })).filter((o) => o.rotulo) };
      return { ok: true };
    case "ultimos_negocios":
    case "buscar_negocio": {
      const d = await hubspot();
      if (d.erro) return d;
      try {
        const busca = nome === "buscar_negocio";
        const ns = await negociosDoDono(d.id, busca ? String(a.termo ?? "") : undefined, busca ? 8 : 3);
        if (coleta) e.mostrados = ns.map((n) => ({ id: n.id, nome: n.nome, solucao: nomeSolucao(n.solucao), cidade: n.cidade }));
        return { negocios: ns.map((n) => ({ ...n, solucao: nomeSolucao(n.solucao) })), observacao: ns.length ? undefined : "Nenhum negócio deste vendedor encontrado." };
      } catch (err) { console.error("hubspot", err.message); return { erro: "O HubSpot não respondeu agora." }; }
    }
    case "usar_negocio": {
      if (!coleta) return soColeta;
      const d = await hubspot();
      if (d.erro) return d;
      const n = await negocioDoDono(String(a.id), d.id);
      if (!n) return { erro: "Negócio não encontrado entre os seus." };
      e.negocio = { id: n.id, nome: n.nome }; e.mostrados = undefined;
      e.cliente = n.nome; e.cidade = n.cidade || undefined; e.uf = n.uf || undefined; e.setor = n.setor ?? e.setor; e.solucao = n.solucao || undefined;
      c.titulo = n.nome;
      registrar(c, u, `usou o negócio do HubSpot ${n.nome}`);
      return { ok: true, negocio: { ...n, solucao: nomeSolucao(n.solucao) }, ...(e.setor ? {} : { setor_desconhecido: true }) };
    }
    case "criar_negocio": {
      if (!coleta) return soColeta;
      const dados = { nome: String(a.nome).slice(0, 200), solucao: String(a.solucao), cidade: a.cidade || undefined, uf: a.uf ? String(a.uf).toUpperCase().slice(0, 2) : undefined, setor: a.setor === "privado" ? "privado" : "publico" };
      let id = null, semHubspot = "";
      if (hubspotLigado()) {
        const d = await hubspot();
        // quem não é usuário do HubSpot (ex.: gerente testando) segue sem ligar o negócio
        if (d.erro) semHubspot = d.erro;
        else try { id = (await criarNegocio(d.id, dados)).id; } catch (err) { console.error("hubspot", err.message); return { erro: "Não consegui criar o negócio no HubSpot agora." }; }
      }
      e.negocio = { id, nome: dados.nome, criadoPeloSistema: !!id };
      e.cliente = String(a.cliente).slice(0, 120); e.cidade = dados.cidade; e.uf = dados.uf; e.setor = dados.setor; e.solucao = dados.solucao;
      c.titulo = dados.nome;
      registrar(c, u, id ? `criou o negócio ${dados.nome} no HubSpot` : `cadastrou ${dados.nome} (HubSpot não ligado)`);
      return id ? { ok: true, hubspot_id: id } : { ok: true, aviso: `${semHubspot || "HubSpot não está ligado."} O negócio ficou só nesta proposta, sem criar no HubSpot.` };
    }
    case "listar_solucoes": return { solucoes: SOLUCOES_HUBSPOT.map(nomeSolucao) };
    case "trocar_solucao":
      if (!coleta) return soColeta;
      e.solucao = String(a.solucao);
      registrar(c, u, `trocou a solução para ${nomeSolucao(e.solucao)}`);
      return e.config ? { ok: true, aviso: "Solução trocada. Rode configurar_proposta de novo para remontar os planos." } : { ok: true };
    case "buscar_populacao": {
      if (!e.cidade || !e.uf) return { erro: "O negócio não tem cidade e UF. Pergunte ao vendedor." };
      try {
        const p = await populacao(e.cidade, e.uf);
        if (!p) return { erro: `Não achei ${e.cidade} - ${e.uf} no IBGE. Peça o número de habitantes ao vendedor.` };
        const f = faixaPorPopulacao(p.pop);
        if (coleta) { e.populacao = p.pop; e.faixaSugerida = f; }
        return { populacao: p.pop, fonte: "IBGE, Censo 2022", faixa_sugerida: f, faixa_nome: FAIXA_NOME[f] };
      } catch { return { erro: "O IBGE não respondeu agora. Peça o número de habitantes ao vendedor." }; }
    }
    case "definir_canal": {
      if (!coleta) return soColeta;
      const publico = a.publico === "interno" ? "interno" : "populacao";
      if (publico === "interno" && SEMPRE_POPULACAO.includes(e.solucao ?? "")) return { erro: `${nomeSolucao(e.solucao)} não é app interno.` };
      const faixa = Number(a.faixa);
      if (!FAIXAS.includes(faixa)) return { erro: "Faixa inválida." };
      const sugerida = publico === "interno" ? 100 : e.faixaSugerida;
      const motivo = typeof a.motivo_troca === "string" ? a.motivo_troca.trim() : "";
      if (sugerida && faixa !== sugerida && !motivo) return { erro: `A regra sugere ${FAIXA_NOME[sugerida]}. Pergunte o motivo da troca ao vendedor.` };
      e.faixaSugerida = sugerida;
      e.motivoFaixa = sugerida && faixa !== sugerida ? motivo.slice(0, 500) : undefined;
      e.config = { horasRemoto: HORAS_SUGERIDAS[faixa], suporteLocal: 0, integracao: false, monitoramento: "padrao", ...e.config, publico, faixa, canalTipo: a.tipo === "subcanal" ? "subcanal" : "padrao" };
      registrar(c, u, `canal: ${publico === "interno" ? "app interno" : "para a população"}, ${FAIXA_NOME[faixa]}, ${a.tipo === "subcanal" ? "subcanal" : "canal padrão"}${e.motivoFaixa ? ` (trocou a faixa sugerida: ${e.motivoFaixa})` : ""}`);
      return { ok: true, horas_suporte_remoto_sugeridas: HORAS_SUGERIDAS[faixa] };
    }
    case "configurar_proposta": {
      if (!coleta) return soColeta;
      if (!e.config) return { erro: "Defina o canal antes (definir_canal)." };
      if (!e.solucao) return { erro: "Falta a solução." };
      e.config = { ...e.config, monitoramento: a.monitoramento === "customizado" ? "customizado" : "padrao",
        horasRemoto: Math.max(0, Math.min(500, Math.round(Number(a.horas_suporte_remoto) || 0))),
        suporteLocal: Math.max(0, Math.min(50, Math.round(Number(a.operadores_suporte_local) || 0))), integracao: a.integracao === true };
      montarPlanos(c, u, await catalogo());
      saida.planos = true;
      return { ok: true, planos: planosResumo(c) };
    }
    case "mostrar_planos":
      if (!e.planos) return { erro: "Os planos ainda não foram montados." };
      saida.planos = true;
      return { ok: true, planos: planosResumo(c) };
    case "ajustar_plano": {
      const alvos = a.plano === "todos" ? NIVEIS : [String(a.plano)], q = typeof a.quantidade === "number" ? a.quantidade : undefined, cat = await catalogo();
      const r = alvos.map((n) => a.acao === "remover" ? removerGrupo(c, u, n, a.grupo) : a.acao === "quantidade" ? (q == null ? "Diga a quantidade." : mudarQuantidade(c, u, n, a.grupo, q)) : adicionarGrupo(c, u, n, a.grupo, cat, q));
      saida.planos = true;
      return { resultado: r };
    }
    case "consultar_base": {
      const achados = await buscar(String(a.pergunta ?? ""), { solucao: e.solucao ?? "", limite: 6, dono: dono ? u.id : "", conversaAtual: c.id });
      return achados.length ? { achados: achados.map((x) => ({ fonte: x.titulo, texto: x.texto })) } : { achados: [], aviso: "Nada na base sobre isso ainda." };
    }
    case "listar_modalidades":
      return { modalidades: (await modalidadesAtivas()).map((m) => ({ id: m.id, nome: m.nome, validada_pelo_juridico: m.validado })) };
    case "definir_setor": {
      if (!coleta) return soColeta;
      e.setor = a.setor === "privado" ? "privado" : "publico";
      if (e.setor === "privado") delete e.modalidade;
      registrar(c, u, `cliente ${e.setor === "privado" ? "privado" : "público"}`);
      return { ok: true };
    }
    case "definir_objetivo": {
      if (!coleta) return soColeta;
      const t = String(a.texto ?? "").replace(/\s+/g, " ").trim().slice(0, 300);
      if (!t) return { erro: "Texto vazio." };
      e.objetivo = t;
      registrar(c, u, `o que o cliente quer: ${t}`);
      return { ok: true };
    }
    case "definir_modalidade": {
      if (!coleta) return soColeta;
      if (e.setor === "privado") return { erro: "Cliente privado não tem modalidade de licitação; siga sem ela." };
      if (a.modalidade === "nao_sei") { delete e.modalidade; registrar(c, u, "modalidade de contratação: ainda não definida"); return { ok: true }; }
      const m = (await modalidadesAtivas()).find((x) => x.id === a.modalidade);
      if (!m) return { erro: "Modalidade desconhecida." };
      e.modalidade = m.id;
      registrar(c, u, `modalidade de contratação: ${m.nome}`);
      return { ok: true, modalidade: m.nome, aviso: m.validado ? null : "O texto desta modalidade ainda não foi validado pelo Jurídico; o gerente vê o aviso." };
    }
    case "detalhar_grupo": {
      if (!e.planos) return { erro: "Os planos ainda não foram montados." };
      const alvos = a.plano === "todos" ? NIVEIS : [String(a.plano)];
      const para = typeof a.para_que === "string" && a.para_que.trim() ? a.para_que.trim() : null;
      const r = alvos.map((n) => detalharGrupo(c, u, n, a.grupo, typeof a.gratis === "boolean" ? a.gratis : null, para));
      saida.planos = true;
      return { resultado: r };
    }
    case "definir_preco_estimado": {
      if (!c.estado.planos) return { erro: "Monte os planos antes." };
      const alvos = a.plano === "todos" ? NIVEIS : [String(a.plano)];
      const avisos = alvos.map((n) => definirPrecoEstimado(c, u, n, a.valor)).filter(Boolean);
      if (avisos.length) return { erro: avisos[0] };
      saida.planos = true;
      return { resultado: Object.fromEntries(alvos.map((n) => [n, cabeNoPreco(c, n)])) };
    }
    case "aprovar_e_gerar_proposta": {
      const r = await enviarAoGerente(c, u, { soTabela: a.so_tabela === true });
      if (r.erro) return r;
      saida.avisos.push(...r.avisos); saida.proposta = true;
      return { ok: true, mensagem: r.texto };
    }
  }
  return { erro: `Ferramenta desconhecida: ${nome}` };
}

async function chamarGPT(corpo) {
  const r = await fetch(`${BASE()}/responses`, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(corpo), signal: AbortSignal.timeout(120_000),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(d.error?.message || `OpenAI ${r.status}`); e.status = r.status; throw e; }
  return d;
}
/** Itens da saída que voltam como entrada na próxima volta (sem campos só de saída). */
const reenviar = (o) => o.type === "message" ? { role: "assistant", content: o.content.filter((x) => x.type === "output_text").map((x) => x.text).join("\n") }
  : o.type === "function_call" ? { type: "function_call", call_id: o.call_id, name: o.name, arguments: o.arguments }
  : o.type === "reasoning" ? { type: "reasoning", id: o.id, summary: o.summary ?? [], ...(o.encrypted_content ? { encrypted_content: o.encrypted_content } : {}) }
  : null;

/** O GPT pode escrever em mais de uma volta e repetir a mesma frase: a resposta leva cada texto uma vez só. */
const semEspacos = (t) => String(t).replace(/\s+/g, " ").trim().toLowerCase();
export function juntarTextos(textos) {
  const out = [];
  for (const t of textos) {
    const n = semEspacos(t);
    if (!n || out.some((x) => semEspacos(x).includes(n))) continue;
    for (let i = out.length - 1; i >= 0; i--) if (n.includes(semEspacos(out[i]))) out.splice(i, 1); // o novo já contém o anterior
    out.push(t);
  }
  // e o parágrafo repetido logo em seguida, mesmo quando veio tudo numa volta só
  return out.join("\n\n").split(/\n\s*\n/).filter((p, i, l) => i === 0 || semEspacos(p) !== semEspacos(l[i - 1])).join("\n\n");
}

const buscasRecentes = new Map(); // conversa → última busca na base (para respostas curtas)
/** Uma rodada: histórico → GPT → ferramentas → resposta. Mexe em `c`. */
export async function responder(c, u, historico, anexos) {
  const saida = { texto: "", pergunta: null, planos: false, proposta: false, avisos: [] };
  const papel = c.donoId !== u.id && podeAprovar(c, u) ? "Aprovador (corrigindo a proposta)" : c.donoId === u.id ? "Vendedor" : "Consulta";
  const input = [{ role: "developer", content: `Agora quem fala é ${u.nome} (${papel}). Hoje é ${new Date().toLocaleDateString("pt-BR")}. HubSpot ${hubspotLigado() ? "ligado" : "NÃO ligado"}.\nEstado da proposta: ${JSON.stringify(resumoParaIA(c))}` }];
  for (const m of historico.slice(-40)) {
    if (m.tipo === "assistente") input.push({ role: "assistant", content: m.texto || "(pergunta com opções)" });
    else if (m.tipo === "sistema") input.push({ role: "developer", content: `Aviso do sistema: ${m.texto}` });
    else input.push({ role: "user", content: `${m.autor ?? "Usuário"}: ${m.texto}` });
  }
  // conhecimento da casa: os trechos mais parecidos com a última mensagem e a proposta em andamento.
  // Resposta curta de botão ("Sim", "Remoto", "2") não muda o assunto: reaproveita a última busca da conversa.
  const t0 = Date.now();
  let achados = [];
  try {
    const ultima = [...historico].reverse().find((m) => m.tipo === "usuario")?.texto ?? "";
    const e = c.estado, contexto = [nomeSolucao(e.solucao), e.setor === "privado" ? "cliente privado" : e.setor ? "cliente público" : "", e.populacao ? `${e.populacao} habitantes` : ""].filter(Boolean).join(" · ");
    // gerente corrigindo a proposta de um vendedor: as conversas dele não entram, porque a resposta fica na conversa do vendedor
    const donoFala = c.donoId === u.id, chave = `${c.id}:${u.id}`;
    const guardada = buscasRecentes.get(chave), curta = ultima.trim().split(/\s+/).length <= 3;
    if (guardada && curta && guardada.contexto === contexto) achados = guardada.achados;
    else {
      achados = await buscar([ultima, contexto].filter(Boolean).join(" · "), { solucao: e.solucao ?? "", limite: 5, dono: donoFala ? u.id : "", conversaAtual: c.id });
      buscasRecentes.set(chave, { contexto, achados });
      if (buscasRecentes.size > 500) buscasRecentes.delete(buscasRecentes.keys().next().value);
    }
  } catch (err) { console.error("busca na base:", err.message); }
  const tBusca = Date.now() - t0;
  if (achados.length) input.push({ role: "developer", content: "Conhecimento da SASI (acertos e erros de outras propostas, sem nomes; documentos da casa; conversas anteriores de quem está falando):\n\n" +
    achados.map((x) => `[${x.titulo}]\n${x.texto}`).join("\n\n---\n\n") });
  if (anexos.length) {
    let resto = 40_000;
    input.push({ role: "developer", content: "Anexos da última mensagem:\n" + anexos.map((x) => { const t = x.texto.slice(0, Math.max(0, resto)); resto -= t.length; return `--- ${x.nome} ---\n${t || "(sem texto legível)"}`; }).join("\n\n") });
  }
  let raciocinio = true;
  const textos = []; // o GPT pode escrever em qualquer volta, inclusive junto com uma ferramenta
  for (let volta = 0; volta < 12; volta++) {
    let r;
    try {
      r = await chamarGPT({ model: modelo(), instructions: INSTRUCOES, input, tools: FERRAMENTAS, store: false, ...(raciocinio ? { include: ["reasoning.encrypted_content"] } : {}) });
    } catch (err) {
      if (raciocinio && err.status === 400) { raciocinio = false; volta--; continue; } // modelo sem raciocínio
      throw err;
    }
    const chamadas = (r.output ?? []).filter((o) => o.type === "function_call");
    const t = (r.output ?? []).filter((o) => o.type === "message").flatMap((o) => o.content ?? []).filter((x) => x.type === "output_text").map((x) => x.text).join("\n").trim();
    if (t) textos.push(t);
    if (!chamadas.length) {
      console.log(`[chat] ${volta + 1} volta(s) com o GPT · busca na base ${tBusca} ms (${achados.length} trecho(s)) · total ${Date.now() - t0} ms`);
      saida.texto = juntarTextos(textos); return saida;
    }
    for (const o of r.output) { const x = reenviar(o); if (x) input.push(x); }
    for (const ch of chamadas) {
      let args = {};
      try { args = JSON.parse(ch.arguments || "{}"); } catch { /* a ferramenta reclama */ }
      let res;
      try { res = await executar(ch.name, args, { c, u, saida }); } catch (err) { console.error(`ferramenta ${ch.name}`, err); res = { erro: "Falhou agora." }; }
      input.push({ type: "function_call_output", call_id: ch.call_id, output: JSON.stringify(res) });
    }
  }
  saida.texto = juntarTextos(textos) || "Fiz o que deu por agora. Confira os planos ao lado.";
  return saida;
}
