// As calculadoras dentro do criador: cada opção de preço abre a calculadora da
// solução e a tabela montada volta para dentro dessa opção (N-02 e S-03 do PRD).
// Os arquivos de apps/ são cópias das calculadoras como estão; nada de preço ou
// fórmula muda aqui. O criador só costura a barra de salvar antes do </body>.
import { readFileSync } from "node:fs";
import path from "node:path";
import { RAIZ } from "./base.mjs";

export const CALCULADORAS = {
  cnm: { arquivo: "cnm.html", nome: "Calculadora CNM" },
  "tabela-preco": { arquivo: "tabela-preco.html", nome: "Tabela de preço" },
};
/** Só o Cidade na Mão tem calculadora própria; as outras soluções usam a Tabela de preço. */
export const calculadoraDaSolucao = (solucao) => (solucao === "Cidade na mão" ? "cnm" : "tabela-preco");

const LIMITE_FOTO = 200_000; // a foto da calculadora, para reabrir preenchida

/** Confere o que a calculadora mandou. Devolve a tabela limpa, ou null se não dá para salvar. */
export function tabelaValida(b, app) {
  const anual = Number(b?.totalAnual), mensal = Number(b?.totalMensal);
  if (!CALCULADORAS[app] || !Array.isArray(b?.itens) || !b.itens.length || b.itens.length > 100) return null;
  if (!(anual > 0 && anual < 1e10) || !(mensal >= 0 && mensal < 1e10)) return null;
  const itens = b.itens.map((i) => ({ nome: String(i?.nome ?? "").trim().slice(0, 200), valor: Number(i?.valor) }));
  if (itens.some((i) => !i.nome || !Number.isFinite(i.valor) || i.valor < 0)) return null;
  const foto = b.estado && typeof b.estado === "object" && JSON.stringify(b.estado).length <= LIMITE_FOTO ? b.estado : null;
  return { app, nome: CALCULADORAS[app].nome, cidade: String(b.cidade ?? "").slice(0, 120), faixa: String(b.faixa ?? "").slice(0, 80),
    modalidade: String(b.modalidade ?? "").slice(0, 160), totalAnual: Math.round(anual * 100) / 100, totalMensal: Math.round(mensal * 100) / 100, itens, estado: foto };
}

const CSS = `<style>
#novidades-overlay,#info-btn{display:none!important}
#cr-barra{position:fixed;left:14px;bottom:14px;z-index:2147483000;font:500 12.5px/1.4 'Inter',system-ui,-apple-system,sans-serif;max-width:320px}
#cr-barra button{font:inherit;font-weight:600;padding:9px 15px;border:none;border-radius:10px;background:#0d2149;color:#fff;cursor:pointer;box-shadow:0 2px 10px rgba(13,33,73,.25)}
#cr-barra button:hover{background:#16305f}
#cr-barra button[disabled]{opacity:.6;cursor:default}
#cr-msg{margin-top:8px;background:#fff;border:1px solid #e9edf3;border-radius:10px;padding:9px 11px;color:#0f172a;box-shadow:0 2px 10px rgba(15,23,42,.10)}
#cr-msg.ruim{background:#fef2f4;border-color:#f9d2da;color:#b3123a}
#cr-msg[hidden]{display:none}
</style>`;

/* O que cada calculadora sabe dar: a tabela na tela e a foto para reabrir. */
const CNM = `
  function dados(){
    var p = _computeProposta(), faixa = '', ex = (typeof extraDiscPct !== 'undefined' && extraDiscPct) || 0;
    try { var L = (typeof t === 'function' && t().labelsShort) ? t().labelsShort : null; if(L && p.idx != null && L[p.idx]) faixa = String(L[p.idx]); } catch(e){}
    return { cidade: (window.cnmCity || '').trim(), faixa: faixa, totalAnual: Math.round(p.total * 100) / 100, totalMensal: Math.round(p.mensal * 100) / 100,
      itens: (p.rows || []).map(function(r){ return { nome: r.nome, valor: Math.round(r.val * (1 - ex / 100) * 100) / 100 }; }) };
  }
  function foto(){ var e = null; try { if(typeof _cmpSnapEstado === 'function') e = _cmpSnapEstado(); } catch(err){} if(e) e.cidade = (window.cnmCity || '').trim(); return e; }
  /* o celular da capa, fotografado do jeito que a calculadora faz na proposta dela */
  function celular(){
    if(typeof loadHtml2Canvas !== 'function') return Promise.resolve(null);
    var frame = document.querySelector('.iphone-frame');
    if(!frame) return Promise.resolve(null);
    return loadHtml2Canvas().then(function(h){ return h(frame, { backgroundColor: null, scale: 3, useCORS: true, logging: false }); })
      .then(function(cv){ return new Promise(function(ok){ cv.toBlob(ok, 'image/png'); }); });
  }
  function restaurar(e){
    if(typeof _cmpRestaurarEstado !== 'function') return false;
    if(e.cidade){ window.cnmCity = e.cidade; if(typeof applyCityLogo === 'function') applyCityLogo(null, e.cidade); }
    _cmpRestaurarEstado(e); return true;
  }`;
const TABELA = `
  function dados(){
    var idx = cgFaixaIdx(), sel = cgOrdenar(cgTodos().filter(function(i){ return adicSelected[i.key]; }));
    var extra = (typeof extraDiscPct !== 'undefined' && extraDiscPct) ? extraDiscPct : 0, fator = 1 - extra / 100;
    var itens = sel.map(function(i){
      var d = (typeof effectiveDiscount === 'function') ? effectiveDiscount('adic', i.key, idx) : 0, q = cgQtdDe(i.key), net = i.unit * (1 - d / 100);
      return { nome: i.desc + (q > 1 ? ' (' + q + '×)' : ''), valor: Math.round((i.meses === 1 ? net * q : net * q * 12) * fator * 100) / 100 };
    });
    var total = itens.reduce(function(s, i){ return s + i.valor; }, 0), cid = document.getElementById('city-search-input');
    var modTipo = (typeof cgModalidade !== 'undefined' && cgModalidade && cgModalidade.tipo) || '', mod = (typeof MOD_NOMES !== 'undefined' && MOD_NOMES[modTipo]) || modTipo;
    if(mod && typeof cgModalidade !== 'undefined' && cgModalidade.ata) mod += ' — ' + cgModalidade.ata;
    return { cidade: cid ? cid.value.trim() : '', modalidade: String(mod), totalAnual: Math.round(total * 100) / 100, totalMensal: Math.round(total / 12 * 100) / 100, itens: itens };
  }
  function celular(){ return Promise.resolve(null); }
  function foto(){
    try {
      var sel = cgOrdenar(cgTodos().filter(function(i){ return adicSelected[i.key]; })), pop = document.getElementById('pop'), cid = document.getElementById('city-search-input');
      return { pop: pop ? pop.value : null, extra: (typeof extraDiscPct !== 'undefined' ? extraDiscPct : 0), live: (typeof LIVE_DISC !== 'undefined' && LIVE_DISC) ? JSON.parse(JSON.stringify(LIVE_DISC)) : {},
        cidade: cid ? cid.value.trim() : '', modalidade: (typeof cgModalidade !== 'undefined' && cgModalidade) ? { tipo: cgModalidade.tipo, ata: cgModalidade.ata } : null,
        itens: sel.map(function(i){ return { key: i.key, qtd: cgQtdDe(i.key), desc: i.desc, unit: i.unit, meses: i.meses }; }) };
    } catch(e){ return null; }
  }
  function restaurar(e){
    if(!Array.isArray(e.itens)) return false;
    var aviso = window.cgAviso; window.cgAviso = function(){};
    try {
      var pop = document.getElementById('pop');
      if(pop && e.pop != null){ pop.value = e.pop; pop.dispatchEvent(new Event('input', { bubbles: true })); }
      if(typeof LIVE_DISC !== 'undefined' && LIVE_DISC && e.live) Object.keys(e.live).forEach(function(k){ LIVE_DISC[k] = e.live[k]; });
      cgAplicarDados({ itens: e.itens, cidade: e.cidade, modalidade: e.modalidade });
      if(typeof extraDiscPct !== 'undefined' && e.extra != null) extraDiscPct = Number(e.extra) || 0;
      if(typeof recalcPrices === 'function') recalcPrices();
      if(typeof render === 'function') render();
      return true;
    } finally { window.cgAviso = aviso; }
  }`;

/** A página da calculadora com a barra de salvar. ctx: { conversa, plano, planoNome, podeSalvar, foto, capaDoDesigner }. */
export function paginaCalculadora(app, ctx) {
  const html = readFileSync(path.join(RAIZ, "apps", CALCULADORAS[app].arquivo), "utf8");
  const dadosSeguros = JSON.stringify(ctx).replace(/</g, "\\u003c");
  const barra = `${CSS}<div id="cr-barra"><button type="button" id="cr-salvar"></button><div id="cr-msg" hidden></div></div>
<script>(function(){
  var C = ${dadosSeguros};
  window.openNovidades = function(){};
  ${app === "cnm" ? CNM : TABELA}
  var bt = document.getElementById('cr-salvar'), msg = document.getElementById('cr-msg');
  function dizer(t, ruim){ msg.textContent = t; msg.className = ruim ? 'ruim' : ''; msg.hidden = false; }
  bt.textContent = 'Salvar na opção ' + C.planoNome;
  if(!C.podeSalvar){ bt.disabled = true; dizer('Só para consulta: esta proposta não pode ser alterada agora.'); }
  if(C.foto){ setTimeout(function(){ try { if(!restaurar(C.foto)) dizer('Não consegui reabrir a tabela salva.', true); } catch(e){ dizer('Não consegui reabrir a tabela salva.', true); } }, 300); }
  bt.onclick = function(){
    var d;
    try { d = dados(); d.estado = foto(); } catch(e){ dizer('Não consegui ler a tabela desta calculadora.', true); return; }
    if(!d.itens.length || !(d.totalAnual > 0)){ dizer('Monte a tabela antes de salvar.', true); return; }
    bt.disabled = true;
    fetch('/api/chat/' + encodeURIComponent(C.conversa) + '/calculadora', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ plano: C.plano, app: C.app, tabela: d }) })
      .then(function(r){ return r.json().then(function(j){ if(!r.ok) throw new Error(j.erro || 'Não consegui salvar.'); return j; }); })
      .then(function(){
        // a tela do app vai para a capa, a não ser que o designer já tenha mandado a dele
        if(C.capaDoDesigner) return '';
        return celular().then(function(b){
          if(!b) return '';
          var f = new FormData(); f.append('imagem', b, 'celular.png'); f.append('origem', 'calculadora');
          return fetch('/api/chat/' + encodeURIComponent(C.conversa) + '/capa', { method: 'POST', body: f })
            .then(function(r){ return r.ok ? ' A tela do app foi para a capa.' : ''; });
        }).catch(function(){ return ''; });
      })
      .then(function(extra){
        dizer('Tabela salva na opção ' + C.planoNome + '.' + extra + ' Pode fechar esta aba.');
        try { if(window.opener) window.opener.postMessage({ criador: 'calculadora', conversa: C.conversa }, location.origin); } catch(e){}
      })
      .catch(function(e){ dizer(e.message, true); })
      .then(function(){ bt.disabled = false; });
  };
})();</script>`;
  const i = html.lastIndexOf("</body>");
  return i < 0 ? html + barra : html.slice(0, i) + barra + html.slice(i);
}
