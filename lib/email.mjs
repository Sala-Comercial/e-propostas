// E-mail para o cliente: o Gerador de E-mail SASI do André (apps/email.html, sem
// mudança nenhuma) aberto já preenchido com os dados da proposta. O criador só
// escreve o rascunho que o gerador lê ao abrir; o vendedor revisa, ajusta e copia
// para o Gmail pelo botão do próprio gerador. Nada é enviado daqui.
import { readFileSync } from "node:fs";
import path from "node:path";
import { RAIZ } from "./base.mjs";
import { nomeSolucao } from "./catalogo.mjs";

const FUNC = JSON.parse(readFileSync(path.join(RAIZ, "docs", "referencia", "funcionalidades-email.json"), "utf8")).solucoes;
// os mesmos valores padrão do gerador, para uma proposta não herdar o que ficou de outra
const CNM_FEATURES = [
  { t: "Fale com o Prefeito", d: "Canal direto com o cidadão" }, { t: "Pergunta Tudo", d: "IA avançada para a população" },
  { t: "Pergunta Cidade", d: "IA treinada com dados do município" }, { t: "Secretarias", d: "Todas as secretarias em um só aplicativo" },
  { t: "Notícias", d: "Comunicação oficial direta" }, { t: "Sugestões", d: "Participação cidadã ativa" },
];
const CNM_PARAGRAFO = "A SASI gostaria de apresentar uma solução voltada à modernização da gestão municipal e ao fortalecimento da relação entre as prefeituras e seus munícipes, unindo tecnologia, inteligência artificial e serviços públicos em um só aplicativo.";
const BOTAO_CASES = { on: true, label: "Veja quem já trabalha conosco  →", url: "https://cases-sasi.netlify.app/", style: "solid", color: "#3D9B34" };
const BOTOES_CNM = [
  { on: true, label: "Quero conhecer o Cidade na Mão  →", url: "https://cidade-na-mao.sasipaje.com/", style: "solid", color: "#0B6B45" },
  { on: true, label: "⬇  Baixe nosso catálogo", url: "https://drive.google.com/uc?export=download&id=1MmWxn4EXoqOSwVM-KCkSMypYuWYa2qTw", style: "outline", color: "#0B6B45" },
  BOTAO_CASES,
];
const CTA = "Gostaríamos de contar com um momento na sua agenda para apresentarmos a proposta, conhecermos suas prioridades e avaliarmos juntos o melhor caminho.";

/** O conteúdo do e-mail, a partir da conversa. Só texto: logo, cores e imagens o vendedor escolhe no gerador. */
export function conteudoDoEmail(c, dono) {
  const e = c.estado ?? {}, cliente = String(e.cliente || c.titulo || "").trim(), sol = nomeSolucao(e.solucao) || "SASI";
  const cnm = e.solucao === "Cidade na mão", privado = e.setor === "privado";
  const anexo = `Em anexo, segue a nossa proposta com três opções de plano (Minimal, Premium e AI Driven), para que vocês escolham a que melhor atende ${privado ? "à empresa" : "à gestão"}.`;
  const contato = dono?.nome ? `\n\nFico à disposição: **${dono.nome}**${dono.email ? " · " + dono.email : ""}` : "";
  return {
    kicker: ("SASI · " + cliente).toUpperCase().slice(0, 70),
    headline: cnm ? "A cidade inteira,\nna palma da mão." : sol,
    headerSub: `Proposta · ${cliente}`,
    greeting: privado ? "Prezados," : "Prezados Gestores,",
    paragraphs: [cnm ? CNM_PARAGRAFO : `A SASI tem a satisfação de apresentar a solução **${sol}**, pensada para a realidade ${privado ? "da sua empresa" : "da sua gestão"}.`, anexo],
    features: cnm ? CNM_FEATURES : FUNC[e.solucao] ?? [{ t: "", d: "" }], // vazio: o gerador esconde o quadro
    featTitle: cnm ? "Tudo em um só app." : `O que a ${sol} oferece.`,
    ctaText: CTA + contato,
    buttons: cnm ? BOTOES_CNM : [{ ...BOTOES_CNM[0], on: false }, { ...BOTOES_CNM[1], on: false }, BOTAO_CASES],
    // a tela do celular é do Cidade na Mão: nas outras soluções o e-mail sai sem ela
    ...(cnm ? { mockMode: "embed" } : { mockMode: "url", mockUrl: "", featLayout: "cards" }),
  };
}

/** A página do gerador com o rascunho desta proposta. O script entra antes do script do gerador. */
export function paginaEmail(c, dono) {
  const html = readFileSync(path.join(RAIZ, "apps", "email.html"), "utf8");
  const dados = JSON.stringify({ conversa: c.id, campos: conteudoDoEmail(c, dono) }).replace(/</g, "\\u003c");
  const pre = `<script>(function(){
  var K = 'cnm-gerador-v1', C = ${dados}, s = {};
  try { s = JSON.parse(localStorage.getItem(K) || '{}') || {}; } catch(e){}
  // outra proposta: logo, telas e fotos do cliente anterior não passam para esta
  try { if(localStorage.getItem('criador-email-conversa') !== C.conversa) ['logoData','screenData','prodLogo','bgPhoto','bgUrl','mockUrl'].forEach(function(k){ delete s[k]; }); } catch(e){}
  for (var k in C.campos) s[k] = C.campos[k];
  try { localStorage.setItem(K, JSON.stringify(s)); localStorage.setItem('criador-email-conversa', C.conversa); } catch(e){}
})();</script>`;
  const i = html.indexOf("<head>");
  return i < 0 ? pre + html : html.slice(0, i + 6) + pre + html.slice(i + 6);
}
