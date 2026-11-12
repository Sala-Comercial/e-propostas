// Criador de propostas com chat — servidor pequeno, sem framework.
// Guarda a chave do GPT e o token do HubSpot no .env (nunca vão ao navegador),
// exige login com e-mail e senha e grava tudo no Postgres (DATABASE_URL).
import http from "node:http";
import os from "node:os";
import { readFileSync } from "node:fs";
import path from "node:path";
import { RAIZ, carregarEnv, novoId, agoraISO, listarUsuarios, usuarioPorEmail, conferirSenha, abrirSessao, lerSessao, fecharSessao,
  criarUsuario, alterarAcesso, atualizarAprovadores, ehAprovador, ehAdmin, ehSuperAdmin, veTudo, quemAprova, NIVEL_NOME as NIVEL_APROV,
  CARGOS, CARGO_NOME, PERMISSOES, PERMISSAO_NOME, LIMITE_SUPERVISAO, lerVisualizacao, gravarVisualizacao } from "./lib/base.mjs";
import { CALCULADORAS, calculadoraDaSolucao, paginaCalculadora, tabelaValida } from "./lib/calculadoras.mjs";
import { paginaEmail } from "./lib/email.mjs";
import { bancoConfigurado, consulta, migrar, comTrava } from "./lib/db.mjs";
import { registrarSessao, auditar } from "./lib/auditoria.mjs";
import { COMPONENTES, FAIXAS, FAIXA_NOME, GRUPOS, NIVEIS, NIVEL_NOME, SOLUCOES_HUBSPOT, catalogo, cortesDePreco, itens, semearItens, atualizarItem, criarItem, nomeSolucao } from "./lib/catalogo.mjs";
import {
  STATUS_NOME, Conflito, novaConversa, carregarConversa, salvarConversa, listarConversas, listarMensagens, anexoDaConversa, listarNotificacoes, marcarLidas,
  apagarConversa, listarLixeira, restaurarConversa, purgarLixeira, novaMensagem, podeVer, podeEditar, motivoBloqueio,
  podeAprovar, quemDecide, editarItem, adicionarItem, removerGrupo, enviarAoGerente, aprovar, reprovar, reabrir, valorParaAlcada, cabeNoPreco, definirPrecoEstimado, salvarTabelaCalculadora, tirarTabelaCalculadora,
  definirCapa, tirarCapa, LIMITE_CAPA,
} from "./lib/proposta.mjs";
import { listarModalidades, atualizarModalidade } from "./lib/modalidades.mjs";
import { CATEGORIAS, atualizarConhecimento, resumoConversas, listarDocumentos, inserirDocumento, removerDocumento, arquivoDoDocumento, baseLigada } from "./lib/conhecimento.mjs";
import { responder, iaLigada } from "./lib/motor.mjs";
import { hubspotLigado, extrairTexto } from "./lib/externos.mjs";

carregarEnv();
const PORTA = Number(process.env.PORTA || 8790);
const HOST = process.env.HOST || "127.0.0.1";
const PRD_LINK = "https://claude.ai/artifact/6LAHDNqes6NEMbz91VWACo";

/* ═══ respostas ═══ */
const SEG = { "X-Content-Type-Options": "nosniff", "Referrer-Policy": "same-origin", "X-Frame-Options": "SAMEORIGIN" };
function json(res, st, obj, extra = {}) { res.writeHead(st, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...SEG, ...extra }); res.end(JSON.stringify(obj)); }
function pagina(res, arq) { res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", ...SEG }); res.end(readFileSync(path.join(RAIZ, "public", arq))); }
const erro = (res, st, msg) => json(res, st, { erro: msg });
async function corpoJson(req) { let b = ""; for await (const c of req) { b += c; if (b.length > 1e6) break; } try { return JSON.parse(b || "{}"); } catch { return {}; } }
const cookie = (req, nome) => (req.headers.cookie ?? "").split(/;\s*/).map((x) => x.split("=")).find(([k]) => k === nome)?.[1];
const quemPede = (req) => ({ ip: req.socket.remoteAddress ?? null, userAgent: req.headers["user-agent"] ?? null });

/* ═══ login: limite de tentativas por endereço ═══ */
const tentativas = new Map();
function bloqueado(ip) {
  const t = (tentativas.get(ip) ?? []).filter((x) => x > Date.now() - 10 * 60_000);
  tentativas.set(ip, t);
  return t.length >= 10;
}

/* ═══ o que a tela recebe ═══ */
// nomes de todos (inclusive quem está na lixeira): autoria de mensagens antigas não some
/** O que a tela precisa saber do acesso de quem está logado. "gerente" = aprova propostas (nome antigo, usado pela tela). */
const acesso = (u) => ({ gerente: ehAprovador(u), cargo: u.cargo, cargoNome: CARGO_NOME[u.cargo] ?? u.cargo, permissao: u.permissao,
  admin: ehAdmin(u), superadmin: ehSuperAdmin(u), aprovadorFinal: !!u.aprovadorFinal, veTudo: veTudo(u) });
async function pessoas() { return new Map((await consulta("SELECT id, nome, papel, cargo, aprovador_final FROM usuario")).rows.map((x) => [x.id, x])); }
const aprova = (x) => x && (x.cargo === "supervisor" || x.cargo === "gerente" || x.aprovador_final);
function paraTela(c, u, P) {
  return {
    id: c.id, titulo: c.titulo, status: c.status, estado: c.estado, versoes: c.versoes, registro: c.registro, corrigida: c.corrigida,
    criadoEm: c.criadoEm, atualizadoEm: c.atualizadoEm, dono: { id: c.donoId, nome: P.get(c.donoId)?.nome ?? "" },
    souDono: c.donoId === u.id, souGerente: podeAprovar(c, u), soConsulta: c.donoId !== u.id && !podeAprovar(c, u), solucaoNome: nomeSolucao(c.estado.solucao),
    podeEditar: podeEditar(c, u), bloqueio: motivoBloqueio(c, u),
    caber: Object.fromEntries(NIVEIS.map((n) => [n, cabeNoPreco(c, n)])),
    calculadoraDaSolucao: c.estado.solucao ? { id: calculadoraDaSolucao(c.estado.solucao), nome: CALCULADORAS[calculadoraDaSolucao(c.estado.solucao)].nome } : null,
    alcada: ehAprovador(u) && c.donoId !== u.id ? { valor: valorParaAlcada(c), quem: quemDecide(c), posso: podeAprovar(c, u) } : null,
  };
}
function msgTela(m, P) {
  const a = P.get(m.autorId);
  return { id: m.id, tipo: m.tipo, texto: m.texto, extra: m.extra, criadoEm: m.criadoEm,
    autor: a ? { id: a.id, nome: a.nome, gerente: !!aprova(a) } : null,
    anexos: (m.anexos ?? []).map(({ id, nome, tipo, tamanho }) => ({ id, nome, tipo, tamanho })) };
}
const CATALOGO_TELA = { grupos: GRUPOS, componentes: COMPONENTES, niveis: NIVEL_NOME, status: STATUS_NOME, faixas: FAIXAS.map((f) => ({ valor: f, nome: FAIXA_NOME[f] })),
  solucoes: SOLUCOES_HUBSPOT.map((v) => ({ valor: v, nome: nomeSolucao(v) })), categoriasBase: CATEGORIAS };
const tocar = (c) => { c.atualizadoEm = agoraISO(); };
function avisos(c, lista) { return lista.map((a) => novaMensagem(c, "sistema", a.texto, a.estilo ? { estilo: a.estilo } : {})); }

/* ═══ rotas da API (com sessão) ═══ */
async function api(req, res, u, url) {
  const p = url.pathname, m = req.method, pedido = quemPede(req);
  let r;

  if (p === "/api/eu") return json(res, 200, { id: u.id, nome: u.nome, email: u.email, ...acesso(u), iaLigada: iaLigada(), hubspotLigado: hubspotLigado() });

  if (p === "/api/chat" && m === "GET") {
    const lista = (await listarConversas(u)).map((c) => ({ id: c.id, titulo: c.titulo, status: c.status, versao: c.versoes, solucao: nomeSolucao(c.solucao),
      dono: c.dono_nome, minha: c.dono_id === u.id, atualizadoEm: c.atualizado_em }));
    return json(res, 200, { conversas: lista, catalogo: { ...CATALOGO_TELA, cortes: await cortesDePreco() }, iaLigada: iaLigada(), eu: { id: u.id, nome: u.nome, ...acesso(u) } });
  }
  if (p === "/api/chat" && m === "POST") {
    const c = novaConversa(u);
    novaMensagem(c, "assistente", `Oi, ${u.nome.split(" ")[0]}! Vamos montar a proposta. O negócio já existe no HubSpot?`,
      { pergunta: { busca: false, opcoes: [{ rotulo: "Sim" }, { rotulo: "Não", detalhe: "o sistema cria no HubSpot" }] } });
    await salvarConversa(c, { ator: u, origem: "TELA", ...pedido });
    return json(res, 200, { ok: true, id: c.id });
  }

  if (p === "/api/notificacoes" && m === "GET") {
    const ns = await listarNotificacoes(u);
    return json(res, 200, { notificacoes: ns, naoLidas: ns.filter((n) => !n.lida).length });
  }
  if (p === "/api/notificacoes/lidas" && m === "POST") {
    const { ids } = await corpoJson(req);
    await marcarLidas(u, ids);
    return json(res, 200, { ok: true });
  }

  // preferências da tela (largura do painel, barra lateral, novidades vistas): seguem o usuário
  if (p === "/api/preferencias" && m === "GET") return json(res, 200, { config: await lerVisualizacao(u, "chat") });
  if (p === "/api/preferencias" && m === "POST") {
    const { config } = await corpoJson(req);
    if (!config || typeof config !== "object" || Array.isArray(config) || JSON.stringify(config).length > 4000) return erro(res, 400, "Preferência inválida.");
    await gravarVisualizacao(u, "chat", config);
    return json(res, 200, { ok: true });
  }

  if (p === "/api/itens" && m === "GET") return json(res, 200, { itens: await itens(), grupos: GRUPOS, componentes: COMPONENTES, possoMexer: ehAdmin(u) });
  if ((r = /^\/api\/itens\/([\w-]+)$/.exec(p)) && m === "PATCH") {
    if (!ehAdmin(u)) return erro(res, 403, "Só admin ou superADMIN mexe no catálogo.");
    const b = await corpoJson(req), campos = {};
    if (typeof b.nome === "string" && b.nome.trim()) campos.nome = b.nome.trim().slice(0, 200);
    if ("preco" in b) { const v = b.preco == null ? null : Number(b.preco); if (v != null && (!Number.isFinite(v) || v < 0)) return erro(res, 400, "Preço inválido."); campos.preco = v == null ? null : Math.round(v * 100) / 100; }
    if (typeof b.unidade === "string") campos.unidade = b.unidade.trim().slice(0, 40) || "mês";
    if (typeof b.ativo === "boolean") campos.ativo = b.ativo;
    if (!(await atualizarItem(r[1], campos, u))) return erro(res, 404, "Item não encontrado.");
    return json(res, 200, { ok: true });
  }
  if (p === "/api/itens" && m === "POST") {
    if (!ehAdmin(u)) return erro(res, 403, "Só admin ou superADMIN mexe no catálogo.");
    const b = await corpoJson(req);
    const nome = String(b.nome ?? "").trim().slice(0, 200);
    if (!nome) return erro(res, 400, "Dê um nome ao item.");
    if (!(b.grupo in GRUPOS)) return erro(res, 400, "Escolha o grupo.");
    if (!(b.componente in COMPONENTES)) return erro(res, 400, "Escolha implementação, licença ou suporte.");
    const preco = b.preco == null || b.preco === "" ? null : Number(b.preco);
    if (preco != null && (!Number.isFinite(preco) || preco < 0)) return erro(res, 400, "Preço inválido.");
    const id = `${b.grupo}_${nome}`.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "_").slice(0, 60);
    if (!(await criarItem({ id, grupo: b.grupo, nome, componente: b.componente, preco, unidade: String(b.unidade || "mês").slice(0, 40) }, u)))
      return erro(res, 409, "Já existe um item com esse nome nesse grupo.");
    return json(res, 200, { ok: true });
  }

  // PRD e novidades: arquivos em docs/, mantidos junto com o código
  if (p === "/api/prd" && m === "GET") return json(res, 200, { html: readFileSync(path.join(RAIZ, "docs", "prd.html"), "utf8"), link: PRD_LINK });
  if (p === "/api/novidades" && m === "GET") return json(res, 200, { novidades: JSON.parse(readFileSync(path.join(RAIZ, "docs", "novidades.json"), "utf8")) });
  if (p === "/api/usuarios" && m === "GET") {
    if (!ehAdmin(u)) return erro(res, 403, "Só admin ou superADMIN vê os usuários.");
    return json(res, 200, { usuarios: (await listarUsuarios()).map((x) => ({ id: x.id, nome: x.nome, email: x.email, cargo: x.cargo, permissao: x.permissao,
      aprovadorFinal: x.aprovadorFinal, ativo: x.ativo, eu: x.id === u.id })), possoMexer: ehSuperAdmin(u),
      cargos: CARGOS.map((id) => ({ id, nome: CARGO_NOME[id] })), permissoes: PERMISSOES.map((id) => ({ id, nome: PERMISSAO_NOME[id] })), limite: LIMITE_SUPERVISAO });
  }
  if ((r = /^\/api\/usuarios\/([\w-]+)$/.exec(p)) && m === "PATCH") {
    const b = await corpoJson(req);
    const problema = await alterarAcesso(r[1], { cargo: b.cargo, permissao: b.permissao, aprovadorFinal: b.aprovadorFinal }, u);
    return problema ? erro(res, 400, problema) : json(res, 200, { ok: true });
  }
  if (p === "/api/usuarios" && m === "POST") {
    if (!ehSuperAdmin(u)) return erro(res, 403, "Só quem é superADMIN cadastra usuários.");
    const b = await corpoJson(req);
    try { await criarUsuario({ nome: b.nome, email: b.email, senha: b.senha, cargo: b.cargo, permissao: b.permissao, aprovadorFinal: b.aprovadorFinal === true }, u); }
    catch (e) { return erro(res, 400, e.message); }
    return json(res, 200, { ok: true });
  }

  // modalidades de contratação (página 3 da proposta): todos leem, só o gerente edita e valida
  if (p === "/api/modalidades" && m === "GET") return json(res, 200, { modalidades: await listarModalidades(), possoMexer: ehAdmin(u) });
  if ((r = /^\/api\/modalidades\/([\w-]+)$/.exec(p)) && m === "PATCH") {
    if (!ehAdmin(u)) return erro(res, 403, "Só admin ou superADMIN mexe nos textos das modalidades.");
    const b = await corpoJson(req), campos = {};
    for (const k of ["nome", "fundamentacao", "objeto"]) if (typeof b[k] === "string" && b[k].trim()) campos[k] = b[k].trim().slice(0, 4000);
    for (const k of ["quadros", "vantagens"]) if (Array.isArray(b[k])) campos[k] = b[k].slice(0, 6);
    if (typeof b.ativo === "boolean") campos.ativo = b.ativo;
    if (!(await atualizarModalidade(r[1], campos, typeof b.validar === "boolean" ? b.validar : undefined, u))) return erro(res, 404, "Modalidade não encontrada.");
    return json(res, 200, { ok: true });
  }

  // base de contexto: o que a IA aprende (propostas aprovadas, sem nomes, e documentos inseridos)
  if (p === "/api/base" && m === "GET") return json(res, 200, { documentos: await listarDocumentos(), conversas: await resumoConversas(), possoMexer: ehAdmin(u), ligada: baseLigada() });
  if (p === "/api/base" && m === "POST") {
    if (!ehAdmin(u)) return erro(res, 403, "Só admin ou superADMIN insere documentos na base.");
    let form;
    try { form = await new Request(`http://x${p}`, { method: "POST", headers: req.headers, body: req, duplex: "half" }).formData(); }
    catch { return erro(res, 400, "Envio inválido."); }
    const f = form.get("arquivo");
    if (!f || typeof f !== "object" || !("arrayBuffer" in f)) return erro(res, 400, "Escolha um arquivo.");
    if (f.size > 20 * 1024 * 1024) return erro(res, 400, "O arquivo pode ter até 20 MB.");
    const dados = Buffer.from(await f.arrayBuffer()), texto = (await extrairTexto(f.name, f.type, dados)).slice(0, 2_000_000);
    const solucao = String(form.get("solucao") ?? ""), categoria = String(form.get("categoria") ?? "outro");
    try {
      await inserirDocumento({ titulo: String(form.get("titulo") ?? "").trim().slice(0, 200) || f.name, categoria, solucao: SOLUCOES_HUBSPOT.includes(solucao) ? solucao : "",
        setor: String(form.get("setor") ?? ""), arquivo: f.name.slice(0, 200), tipo: f.type.slice(0, 100), dados, texto }, u);
    } catch (e) { return erro(res, 400, e.message); }
    return json(res, 200, { ok: true });
  }
  if ((r = /^\/api\/base\/([\w-]+)$/.exec(p)) && m === "DELETE") {
    if (!ehAdmin(u)) return erro(res, 403, "Só admin ou superADMIN remove documentos da base.");
    if (!(await removerDocumento(r[1], u))) return erro(res, 404, "Documento não encontrado.");
    return json(res, 200, { ok: true });
  }
  if ((r = /^\/api\/base\/([\w-]+)\/arquivo$/.exec(p)) && m === "GET") {
    const a = await arquivoDoDocumento(r[1]);
    if (!a) return erro(res, 404, "Arquivo não encontrado.");
    res.writeHead(200, { "Content-Type": a.tipo || "application/octet-stream", "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(a.arquivo)}`, ...SEG });
    return res.end(a.conteudo);
  }
  if (p === "/api/base/atualizar" && m === "POST") {
    if (!ehAdmin(u)) return erro(res, 403, "Só admin ou superADMIN.");
    await atualizarConhecimento();
    return json(res, 200, { ok: true, documentos: await listarDocumentos() });
  }

  // lixeira: conversas apagadas, 30 dias para restaurar
  if (p === "/api/lixeira" && m === "GET") return json(res, 200, { itens: await listarLixeira(u) });
  if ((r = /^\/api\/lixeira\/([\w-]+)\/restaurar$/.exec(p)) && m === "POST") {
    if (!(await restaurarConversa(r[1], u, pedido))) return erro(res, 404, "Nada para restaurar.");
    return json(res, 200, { ok: true });
  }

  // ── conversa ──
  if (!(r = /^\/api\/chat\/([\w-]+)(\/.*)?$/.exec(p))) return erro(res, 404, "Rota não encontrada.");
  const id = r[1], sub = r[2] ?? "";
  // conversa de outro vendedor responde igual a inexistente (regra ética)
  const abrir = async () => { const c = await carregarConversa(id); return c && podeVer(c, u) ? c : null; };

  if (sub === "" && m === "GET") {
    const c = await abrir();
    if (!c) return erro(res, 404, "Conversa não encontrada.");
    // desenvolvedor abrindo proposta de outro, só para consulta: fica na trilha
    if (veTudo(u) && c.donoId !== u.id && !podeAprovar(c, u))
      await auditar({ ator: u, origem: "TELA", entity: "chat_conversa", entityId: c.id, event: "conversa.consultada", action: "READ", ...quemPede(req) });
    const P = await pessoas();
    return json(res, 200, { conversa: paraTela(c, u, P), mensagens: (await listarMensagens(c.id)).map((x) => msgTela(x, P)) });
  }
  if ((r = /^\/anexo\/([\w-]+)$/.exec(sub)) && m === "GET") {
    const c = await abrir();
    if (!c) return erro(res, 404, "Conversa não encontrada.");
    const a = await anexoDaConversa(c.id, r[1]);
    if (!a) return erro(res, 404, "Anexo não encontrado.");
    res.writeHead(200, { "Content-Type": a.tipo || "application/octet-stream", "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(a.nome)}`, ...SEG });
    return res.end(a.conteudo);
  }

  // o que muda a proposta: um pedido de cada vez por conversa, carregando de novo dentro da vez
  return comTrava(id, async () => {
    const c = await abrir();
    if (!c) return erro(res, 404, "Conversa não encontrada.");

    if (sub === "" && m === "PATCH") {
      if (c.donoId !== u.id) return erro(res, 403, "Só o dono muda o nome da conversa.");
      const titulo = String((await corpoJson(req)).titulo ?? "").replace(/\s+/g, " ").trim().slice(0, 120);
      if (!titulo) return erro(res, 400, "Dê um nome à conversa.");
      c.titulo = titulo;
      await salvarConversa(c, { ator: u, origem: "TELA", event: "conversa.renomeada", ...pedido });
      return json(res, 200, { ok: true });
    }
    if (sub === "" && m === "DELETE") {
      if (c.donoId !== u.id) return erro(res, 403, "Só o dono apaga a conversa.");
      if (c.versoes.length) return erro(res, 409, "Conversa já enviada ao gerente não pode ser apagada.");
      await apagarConversa(c, u, pedido);
      return json(res, 200, { ok: true });
    }

    if (sub === "/mensagem" && m === "POST") {
      let form;
      try { form = await new Request(`http://x${p}`, { method: "POST", headers: req.headers, body: req, duplex: "half" }).formData(); }
      catch { return erro(res, 400, "Mensagem inválida."); }
      const texto = String(form.get("texto") ?? "").trim().slice(0, 8000);
      const arquivos = form.getAll("arquivos").filter((f) => typeof f === "object" && f && "arrayBuffer" in f);
      if (!texto && !arquivos.length) return erro(res, 400, "Escreva algo ou anexe um arquivo.");
      if (arquivos.length > 10) return erro(res, 400, "Até 10 anexos por mensagem.");
      if (arquivos.some((f) => f.size > 15 * 1024 * 1024)) return erro(res, 400, "Cada anexo pode ter até 15 MB.");
      if (c.status === "revisao" && c.donoId === u.id && arquivos.length) return erro(res, 409, "A proposta está com o gerente. Anexos, depois que ele responder.");

      const anexos = [], lidos = [];
      for (const f of arquivos) {
        const conteudo = Buffer.from(await f.arrayBuffer());
        const lido = (await extrairTexto(f.name, f.type, conteudo)).slice(0, 200_000);
        anexos.push({ id: novoId(), nome: f.name.slice(0, 200), tipo: f.type.slice(0, 100), tamanho: f.size, conteudo, texto: lido });
        lidos.push({ nome: f.name, texto: lido });
      }
      const anteriores = await listarMensagens(c.id), P = await pessoas();
      const minha = novaMensagem(c, "usuario", texto, {}, u.id, anexos);
      const novas = [minha];
      if (!iaLigada()) {
        novas.push(novaMensagem(c, "assistente", "O assistente ainda não está ligado: falta a chave do GPT (OPENAI_API_KEY) no arquivo .env. Sua mensagem ficou guardada."));
      } else {
        const hist = [...anteriores, minha].map((x) => ({ tipo: x.tipo, texto: x.texto, autor: P.get(x.autorId)?.nome || null }));
        try {
          const rr = await responder(c, u, hist, lidos);
          novas.push(...avisos(c, rr.avisos));
          const extra = {};
          if (rr.pergunta?.opcoes.length) extra.pergunta = rr.pergunta;
          if (rr.planos) extra.planos = true;
          if (rr.proposta) extra.proposta = true;
          novas.push(novaMensagem(c, "assistente", rr.texto || "Pronto.", extra));
        } catch (e) {
          console.error("GPT falhou:", e.message);
          novas.push(novaMensagem(c, "assistente", `Não consegui responder agora (o GPT falhou: ${String(e.message).slice(0, 160)}). Tente de novo em instantes.`, { erro: true }));
        }
      }
      tocar(c);
      await salvarConversa(c, { ator: u, origem: "ASSISTENTE", event: "conversa.chat", ...pedido });
      return json(res, 200, { conversa: paraTela(c, u, P), novas: novas.map((x) => msgTela(x, P)) });
    }

    if (sub === "/tabela" && m === "POST") {
      const b = await corpoJson(req);
      if (!NIVEIS.includes(b.plano)) return erro(res, 400, "Plano inválido.");
      if (!podeEditar(c, u)) return erro(res, 409, "Você não pode mexer nesta tabela agora.");
      let aviso = "";
      if (b.op === "item") {
        const ok = b.campo === "gratis" ? typeof b.valor === "boolean" : b.campo === "para" ? typeof b.valor === "string" : ["qtd", "unit"].includes(b.campo) && Number.isFinite(b.valor);
        if (typeof b.indice !== "number" || !ok) return erro(res, 400, "Mudança inválida.");
        aviso = editarItem(c, u, b.plano, b.indice, b.campo, b.valor);
      } else if (b.op === "adicionar") aviso = adicionarItem(c, u, b.plano, String(b.item ?? ""), await catalogo());
      else if (b.op === "remover") { if (!(b.grupo in GRUPOS)) return erro(res, 400, "Grupo inválido."); aviso = removerGrupo(c, u, b.plano, b.grupo); }
      else if (b.op === "preco_estimado") aviso = definirPrecoEstimado(c, u, b.plano, b.valor);
      else if (b.op === "tirar_calculadora") aviso = tirarTabelaCalculadora(c, u, b.plano);
      else return erro(res, 400, "Operação desconhecida.");
      tocar(c);
      await salvarConversa(c, { ator: u, origem: "TELA", event: "tabela.alterada", ...pedido });
      return json(res, 200, { ok: true, aviso, conversa: paraTela(c, u, await pessoas()) });
    }

    if (sub === "/calculadora" && m === "POST") {
      const b = await corpoJson(req);
      if (!NIVEIS.includes(b.plano)) return erro(res, 400, "Plano inválido.");
      if (!podeEditar(c, u)) return erro(res, 409, motivoBloqueio(c, u) || "Você não pode mexer nesta tabela agora.");
      const t = tabelaValida(b.tabela, String(b.app ?? ""));
      if (!t) return erro(res, 400, "A tabela da calculadora veio incompleta. Monte de novo e salve.");
      salvarTabelaCalculadora(c, u, b.plano, t);
      tocar(c);
      await salvarConversa(c, { ator: u, origem: "TELA", event: "tabela.calculadora", ...pedido });
      return json(res, 200, { ok: true });
    }

    // celular da capa: o vendedor (ou o gerente corrigindo) manda a tela do app; a Calculadora CNM manda a dela ao salvar
    if (sub === "/capa" && (m === "POST" || m === "DELETE")) {
      if (!podeEditar(c, u)) return erro(res, 409, motivoBloqueio(c, u) || "Você não pode mexer nesta proposta agora.");
      if (m === "DELETE") {
        if (!tirarCapa(c)) return json(res, 200, { ok: true });
      } else {
        if (Number(req.headers["content-length"] || 0) > LIMITE_CAPA + 64 * 1024) return erro(res, 400, "A imagem pode ter até 6 MB.");
        let form;
        try { form = await new Request(`http://x${p}`, { method: "POST", headers: req.headers, body: req, duplex: "half" }).formData(); }
        catch { return erro(res, 400, "Imagem inválida."); }
        const f = form.get("imagem");
        if (!f || typeof f !== "object" || !("arrayBuffer" in f)) return erro(res, 400, "Escolha a imagem.");
        const rr = definirCapa(c, u, Buffer.from(await f.arrayBuffer()), String(f.type || ""), String(form.get("origem") ?? ""));
        if (rr.erro) return erro(res, 400, rr.erro);
      }
      tocar(c);
      await salvarConversa(c, { ator: u, origem: "TELA", event: m === "DELETE" ? "capa.tirada" : "capa.definida", ...pedido });
      return json(res, 200, { ok: true, conversa: paraTela(c, u, await pessoas()) });
    }

    if (sub === "/revisao" && m === "POST") {
      const { acao, motivo, soTabela } = await corpoJson(req);
      const rr = acao === "enviar" ? await enviarAoGerente(c, u, { soTabela: soTabela === true }) : acao === "aprovar" ? aprovar(c, u) : acao === "reprovar" ? reprovar(c, u, motivo)
        : acao === "reabrir" ? reabrir(c, u) : { erro: "Ação desconhecida." };
      if (rr.erro) return erro(res, 409, rr.erro);
      const novas = [...avisos(c, rr.avisos), novaMensagem(c, "assistente", rr.texto, acao === "enviar" || acao === "aprovar" ? { proposta: true } : {})];
      tocar(c);
      await salvarConversa(c, { ator: u, origem: "TELA", event: `proposta.${acao}`, ...pedido });
      if (acao === "aprovar" || acao === "reabrir" || acao === "reprovar") atualizarConhecimento();
      const P = await pessoas();
      return json(res, 200, { ok: true, conversa: paraTela(c, u, P), novas: novas.map((x) => msgTela(x, P)) });
    }
    return erro(res, 404, "Rota não encontrada.");
  });
}

/* ═══ servidor ═══ */
async function atender(req, res) {
  let r;
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const token = cookie(req, "sessao");
    const u = token ? await lerSessao(token) : null;
    // pedidos que mudam algo só valem vindos desta mesma página
    if (req.method !== "GET" && req.headers.origin && new URL(req.headers.origin).host !== req.headers.host) return erro(res, 403, "Origem não permitida.");

    // imagens da proposta (rodapé com logo, selos e lojas): públicas, não têm dado de ninguém
    if ((r = /^\/img\/([\w-]+\.(png|jpg))$/.exec(url.pathname)) && req.method === "GET") {
      let b; try { b = readFileSync(path.join(RAIZ, "public", "img", r[1])); } catch { return erro(res, 404, "Imagem não encontrada."); }
      res.writeHead(200, { "Content-Type": r[2] === "jpg" ? "image/jpeg" : "image/png", "Cache-Control": "max-age=3600", ...SEG });
      return res.end(b);
    }
    if (url.pathname === "/login") return u ? (res.writeHead(302, { Location: "/" }), res.end()) : pagina(res, "login.html");
    if (url.pathname === "/api/login" && req.method === "POST") {
      const pedido = quemPede(req), ip = pedido.ip;
      if (bloqueado(ip)) return erro(res, 429, "Muitas tentativas. Espere 10 minutos.");
      const { email, senha } = await corpoJson(req);
      const quem = await usuarioPorEmail(email);
      if (!quem || !quem.ativo || !conferirSenha(String(senha ?? ""), quem.senhaHash)) {
        tentativas.get(ip)?.push(Date.now()) ?? tentativas.set(ip, [Date.now()]);
        await registrarSessao({ u: quem, email, evento: "LOGIN_FALHOU", motivo: !quem ? "e-mail não cadastrado" : !quem.ativo ? "usuário inativo" : "senha errada", ...pedido });
        return erro(res, 401, "E-mail ou senha errados.");
      }
      const s = await abrirSessao(quem, pedido);
      return json(res, 200, { ok: true }, { "Set-Cookie": `sessao=${s}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${7 * 24 * 3600}` });
    }
    if (url.pathname === "/api/sair" && req.method === "POST") {
      if (token) await fecharSessao(token, quemPede(req));
      return json(res, 200, { ok: true }, { "Set-Cookie": "sessao=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0" });
    }
    if (!u) return url.pathname.startsWith("/api/") ? erro(res, 401, "Sua sessão acabou. Entre de novo.") : (res.writeHead(302, { Location: "/login" }), res.end());
    if (url.pathname === "/" || url.pathname === "/index.html") return pagina(res, "index.html");
    if (url.pathname.startsWith("/api/")) return await api(req, res, u, url);
    // e-mail para o cliente: só proposta aprovada pelo gerente, e só para quem pode ver a conversa
    if (url.pathname === "/apps/email" && req.method === "GET") {
      const c = await carregarConversa(String(url.searchParams.get("conversa") ?? ""));
      if (!c || !podeVer(c, u)) return erro(res, 404, "Página não encontrada.");
      if (c.status !== "aprovada") return erro(res, 409, "O e-mail para o cliente libera depois que o gerente aprova a proposta.");
      if (c.estado.envio === "tabela") return erro(res, 409, "O gerente aprovou só a tabela de preços. Reabra e envie a proposta completa para liberar o e-mail.");
      const dono = (await consulta("SELECT nome, email FROM usuario WHERE id = $1", [c.donoId])).rows[0];
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "same-origin" });
      return res.end(paginaEmail(c, dono));
    }
    // calculadora ligada a uma opção de uma conversa: só quem pode ver a conversa abre
    if ((r = /^\/apps\/(cnm|tabela-preco)$/.exec(url.pathname)) && req.method === "GET") {
      const c = await carregarConversa(String(url.searchParams.get("conversa") ?? "")), plano = String(url.searchParams.get("plano") ?? "");
      if (!c || !podeVer(c, u) || !NIVEIS.includes(plano) || !c.estado.planos) return erro(res, 404, "Página não encontrada.");
      const salva = c.estado.calculadora?.[plano];
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "same-origin" });
      return res.end(paginaCalculadora(r[1], { app: r[1], conversa: c.id, plano, planoNome: NIVEL_NOME[plano], podeSalvar: podeEditar(c, u), foto: salva?.app === r[1] ? salva.estado : null,
        capaDoDesigner: c.estado.capa?.origem === "designer" }));
    }
    erro(res, 404, "Página não encontrada.");
  } catch (e) {
    if (e instanceof Conflito) return erro(res, 409, e.message);
    console.error(e);
    if (!res.headersSent) erro(res, 500, "Erro no servidor.");
  }
}

/* ═══ ao ligar: banco pronto, catálogo inicial, lixeira em dia ═══ */
if (!bancoConfigurado()) {
  console.error("Falta DATABASE_URL no .env. Veja o README (Postgres.app, Supabase local ou na nuvem).");
  process.exit(1);
}
try {
  if (process.env.MIGRAR_AO_INICIAR !== "nao") { const novas = await migrar(); if (novas.length) console.log(`Migrações aplicadas: ${novas.join(", ")}`); }
  await atualizarAprovadores();
  if (await semearItens()) console.log("Catálogo de itens criado com os valores iniciais.");
  const purgadas = await purgarLixeira();
  if (purgadas) console.log(`Lixeira: ${purgadas} conversa(s) com mais de 30 dias apagada(s) de vez.`);
} catch (e) {
  console.error(`Não consegui usar o banco (${e.message}). Confira o DATABASE_URL no .env e se o Postgres está ligado.`);
  process.exit(1);
}
setInterval(() => purgarLixeira().catch((e) => console.error("Purga da lixeira:", e.message)), 24 * 3600 * 1000).unref();
// base de conhecimento: em dia ao ligar e a cada 10 minutos (só vetoriza o que mudou)
atualizarConhecimento();
setInterval(() => atualizarConhecimento(), 10 * 60 * 1000).unref();

http.createServer(atender).listen(PORTA, HOST, async () => {
  console.log(`Criador de propostas com chat: http://${HOST === "0.0.0.0" ? "localhost" : HOST}:${PORTA}`);
  // aberto para a rede: mostra o endereço que os outros computadores usam
  if (HOST === "0.0.0.0") for (const ips of Object.values(os.networkInterfaces())) for (const i of ips ?? [])
    if (i.family === "IPv4" && !i.internal) console.log(`Na rede: http://${i.address}:${PORTA}`);
  console.log(`GPT: ${iaLigada() ? "ligado" : "DESLIGADO (falta OPENAI_API_KEY no .env)"} · HubSpot: ${hubspotLigado() ? "ligado" : "DESLIGADO (falta HUBSPOT_TOKEN no .env)"}`);
  if (!(await listarUsuarios()).length) console.log("Nenhum usuário ainda. Crie o primeiro: npm run criar-usuario");
});
