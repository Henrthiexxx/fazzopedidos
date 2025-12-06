// catalog.js — Catálogo interativo + carrinho (client-only)
// ui-premium.js (inline no catalog.js)

// ========== TOAST ==========
function uiToast(msg, type="info", ms=3000){
  // cria wrap se preciso
  let wrap = document.getElementById("toastWrap");
  if (!wrap) {
    wrap = document.createElement("div");
    wrap.id = "toastWrap";
    wrap.style.position = "fixed";
    wrap.style.right = "16px";
    wrap.style.bottom = "76px";
    wrap.style.display = "flex";
    wrap.style.flexDirection = "column";
    wrap.style.gap = "8px";
    wrap.style.zIndex = "10000";
    document.body.appendChild(wrap);
  }

  const el = document.createElement("div");
  el.className = "toast";
  el.style.minWidth = "260px";
  el.style.maxWidth = "380px";
  el.style.background = type==="ok" ? "#065f46" : type==="warn" ? "#7c2d12" : "#1e293b";
  el.style.color = "#e2e8f0";
  el.style.borderRadius = "10px";
  el.style.boxShadow = "0 6px 20px rgba(0,0,0,.25)";
  el.style.padding = "10px 12px";
  el.style.fontSize = "14px";
  el.style.display = "flex";
  el.style.justifyContent = "space-between";
  el.style.alignItems = "center";
  el.style.opacity = ".98";
  el.innerHTML = `<div>${msg}</div><button aria-label="Fechar" style="background:transparent;border:none;color:#cbd5e1;font-size:16px;cursor:pointer;margin-left:8px">×</button>`;
  el.querySelector("button").onclick = () => el.remove();
  wrap.appendChild(el);
  setTimeout(()=> el.remove(), ms);
}

// ========== MODAL ==========
function uiModal({ title="Título", body="", actions=[] }){
  // backdrop + caixa no padrão Premium (.modal-backdrop / .modal / .modal-header / .modal-body / .modal-footer)
  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  backdrop.setAttribute("role","dialog");
  backdrop.setAttribute("aria-modal","true");
  backdrop.innerHTML = `
    <div class="modal">
      <div class="modal-header">
        <div class="modal-title">${title}</div>
        <button id="uiModalClose" class="iconBtn" style="width:auto;height:auto;border-radius:12px;padding:6px 10px">✕</button>
      </div>
      <div class="modal-body">${body}</div>
      <div class="modal-footer"></div>
    </div>
  `;
  const foot = backdrop.querySelector(".modal-footer");
  actions.forEach(a=>{
    const b = document.createElement("button");
    b.className = "btn " + (a.cls || "ghost");
    b.textContent = a.label || "OK";
    b.onclick = a.onClick || (()=> close());
    foot.appendChild(b);
  });
  function close(){ backdrop.remove(); }
  backdrop.querySelector("#uiModalClose").onclick = close;
  backdrop.addEventListener("click", (e)=>{ if(e.target===backdrop) close(); });
  document.body.appendChild(backdrop);
  return { close, root: backdrop, setError(msg){
    let err = backdrop.querySelector(".error-msg");
    if (!err){
      err = document.createElement("div");
      err.className = "error-msg";
      backdrop.querySelector(".modal-body").appendChild(err);
    }
    err.textContent = msg || "";
  }};
}

// ========== CONFIRM PREMIUM (substitui window.confirm) ==========
function uiConfirm({ title="Confirmação", message="Deseja continuar?", confirmText="Confirmar", cancelText="Cancelar" }){
  return new Promise(resolve=>{
    const { close, root } = uiModal({
      title,
      body: `<div class="form-hint" style="margin-top:-8px">${message}</div>`,
      actions: [
        { label: cancelText, cls: "ghost", onClick: ()=>{ close(); resolve(false); } },
        { label: confirmText, cls: "primary", onClick: ()=>{ close(); resolve(true); } }
      ]
    });
  });
}


const moneyBR = (n)=> Number(n||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const collator = new Intl.Collator('pt-BR', { sensitivity:'base', numeric:true });

// 🔑 localStorage keys (em inglês)
const LS_PRODUCTS_VIEW = 'catalog_products_view';
const LS_CART          = 'catalog_cart';
const LS_CART_UPDATED  = 'catalog_cart_updated_at';

// refs UI
const els = {
  meta:     document.getElementById('meta'),
  q:        document.getElementById('q'),
  catalog:  document.getElementById('catalog'),
  empty:    document.getElementById('empty'),
  count:    document.getElementById('count'),
  ts:       document.getElementById('ts'),
  pillStock:document.getElementById('pillStock'),
  pillMin:  document.getElementById('pillMin'),
  cartBtn:  document.getElementById('toggleCart'),
  closeCart:document.getElementById('closeCart'),
  cartPanel:document.getElementById('cartPanel'),
  cartBody: document.getElementById('cartBody'),
  cartItems:document.getElementById('cartItems'),
  cartTotal:document.getElementById('cartTotal'),
  clearCart:document.getElementById('clearCart'),
  checkout: document.getElementById('checkout'),
  cartCount:document.getElementById('cartCount'),
};

// filtros: estoque oculto por padrão; min=0 opcional via querystring (?min=1)
const params = new URLSearchParams(location.search);
const qsStock = params.get('stock'); // null|0|1
const FILTERS = {
  hideNoStock: qsStock === null ? true : qsStock === '1',
  hideMinZero: params.get('min') === '1',
};

// estados
let db, unsub = null;
let rawSrc = [];      // <- bruto do Firestore (fonte da verdade para reprocessar filtros)
let all = [];         // view local filtrada
let indexById = new Map();
let cart = loadCart();

// ================== UI BIND FIRST ==================
wireUI();
console.log('[catalog] UI wired');

// ================== BOOTSTRAP (async) ==============
(async function bootstrap(){
  try{
    await initFirebase();
    await firstLoad();
    setupRealtime();
  }catch(e){
    console.error('[catalog] bootstrap error', e);
    // tenta cache local
    loadFromLocal();
  }
})();

// ================== FUNÇÕES ==================
async function initFirebase(){
  const mod = await import('./server.js');
  db = mod.db;
  // se server.js exportar ready, aguarda (útil se rules exigirem auth)
  try { if (mod.ready) await mod.ready; } catch {}
  console.log('[catalog] firebase ready');
}

function normalize(raw){
  if (raw == null) return [];
  let x = raw;
  if (typeof x === 'string') {
    const s = x.trim();
    try { x = JSON.parse(s); }
    catch { try { x = JSON.parse('['+s.replace(/}\s*[\n,]?\s*\{/g,'},{')+']'); } catch { return []; } }
  }
  let arr = Array.isArray(x) ? x : (x && typeof x === 'object' ? Object.values(x) : []);
  return arr.map(it => typeof it==='string' ? (()=>{try{return JSON.parse(it)}catch{return null}})() : it).filter(Boolean);
}

function isActive(p){
  if(!p) return false;
  if (p.ativo === false || p.ativo === 0 || p.ativo === 'false' || p.ativo === '0') return false;
  if ('status' in p) {
    const s = String(p.status).toLowerCase();
    if (['inativo','inactive','off','0','false'].includes(s)) return false;
  }
  return true;
}
function minVal(p){ const n = Number(p?.min); return Number.isFinite(n) ? n : null; }
function stockVal(p){
  const names = ['estoque','qtd','quantidade','saldo','qtdEstoque','estoqueAtual','stock'];
  for (const k of names) {
    const v = p?.[k];
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}
function productPrice(p){
  const cand = ['precoVenda','preco','price','valor','valorVenda','unitPrice'];
  for (const k of cand) {
    const v = Number(p?.[k]);
    if (!Number.isNaN(v) && v != null) return v;
  }
  return 0;
}
function productId(p){
  const base = p?.id ?? p?.codigoBarras ?? `${p?.nome || 'item'}|${productPrice(p)}`;
  return String(base); // <- força string e preserva zeros à esquerda
}


function buildLocalView(raw){
  let out = normalize(raw).filter(isActive);
  if (FILTERS.hideMinZero) out = out.filter(p => minVal(p) !== 0);
  if (FILTERS.hideNoStock) out = out.filter(p => {
    const s = stockVal(p);
    return s === null ? true : s > 0;
  });
  indexById = new Map();
for (const p of out) indexById.set(productId(p), p); // <- usa productId(p) (string) como chave
  out.sort((a,b)=> collator.compare(a?.nome?.toString?.()||'', b?.nome?.toString?.()||''));
  return out;
}

function groupByCategory(arr){
  const map = new Map();
  for (const p of arr) {
    let c = (p?.categoria ?? '').toString().trim();
    if (!c) c = 'Sem categoria';
    if (!map.has(c)) map.set(c, []);
    map.get(c).push(p);
  }
  const cats = Array.from(map.keys()).sort((a,b)=> collator.compare(a,b));
  return cats.map(cat => ({
    cat,
    items: map.get(cat).slice().sort((a,b)=> collator.compare(a?.nome?.toString?.()||'', b?.nome?.toString?.()||'')),
  }));
}

function render(filterText=""){
  const q = (filterText||"").toLowerCase();
  const filtered = all.filter(p =>
    !q ||
    (p.nome||'').toLowerCase().includes(q) ||
    (p.codigoBarras||'').toLowerCase().includes(q)
  );
  const groups = groupByCategory(filtered);

  let totalShown = 0;
  const html = groups.map(g => {
    if (!g.items.length) return '';
    totalShown += g.items.length;
    const cards = g.items.map(p => {
      const id = productId(p);
      return `
        <div class="card" data-id="${id}">
          <div>
            <div class="nm">${p.nome || '—'}</div>
            <div class="hint">
              ${p.codigoBarras ? '#'+p.codigoBarras : ''}
              ${p.categoria ? ' • '+p.categoria : ''}
            </div>
          </div>
          <div style="display:flex;align-items:center;gap:8px">
            <div class="pr">${moneyBR(productPrice(p))}</div>
            <button class="btnAdd" data-add="${id}" type="button">Adicionar</button>
          </div>
        </div>
      `;
    }).join('');
    return `
      <section class="cat">
        <div class="cat-title">
          <div>${g.cat}</div>
          <div class="count">${g.items.length} item${g.items.length===1?'':'s'}</div>
        </div>
        <div class="grid">${cards}</div>
        <div class="divider"></div>
      </section>
    `;
  }).join('');

  els.catalog.innerHTML = html;
  els.count.textContent = `${totalShown} item${totalShown===1?'':'s'}`;
  els.empty.hidden = totalShown > 0;
}

function updateMeta(viewCount, totalSrc, online=true){
  const dt = new Date();
  const flags = [
    FILTERS.hideNoStock ? 'sem estoque oculto' : 'sem estoque visível',
    FILTERS.hideMinZero ? 'min=0 oculto' : null,
  ].filter(Boolean).join(' • ') || 'sem filtros';
  els.meta.textContent = `${online ? 'Conectado' : 'Sem conexão'} • ${viewCount} exibidos de ${totalSrc} (${flags})`;
  els.ts.textContent = `${online ? 'Atualizado em' : 'Último cache em'} ${dt.toLocaleString('pt-BR')}`;
}

async function firstLoad(){
  const ref = db.collection('data').doc('keys');
  const snap = await ref.get();
  const d = snap.exists ? snap.data() : {};
  rawSrc = d.produtos || [];
  const view = buildLocalView(rawSrc);
  localStorage.setItem(LS_PRODUCTS_VIEW, JSON.stringify(view));
  all = view;
  render(els.q.value);
  updateMeta(view.length, normalize(rawSrc).length, true);
}

function setupRealtime(){
  const ref = db.collection('data').doc('keys');
  unsub = ref.onSnapshot(doc => {
    const d = doc.exists ? doc.data() : {};
    rawSrc = d.produtos || [];
    const view = buildLocalView(rawSrc);
    localStorage.setItem(LS_PRODUCTS_VIEW, JSON.stringify(view));
    all = view;
    render(els.q.value);
    updateMeta(view.length, normalize(rawSrc).length, true);
  }, err => {
    console.error('[catalog] listener error', err);
    els.meta.textContent = 'Erro no listener — mantendo último estado';
  });
}

function loadFromLocal(){
  try{
    const local = JSON.parse(localStorage.getItem(LS_PRODUCTS_VIEW) || '[]');
    all = Array.isArray(local) ? local : [];
    render(els.q.value);
    updateMeta(all.length, all.length, false);
  }catch{}
}

// ======= UI wiring & Cart =======

function wireUI(){
  els.q?.addEventListener('input', () => render(els.q.value));

  // toggles de filtro — reprocessa SEMPRE a partir do bruto
  els.pillStock?.addEventListener('click', () => {
    FILTERS.hideNoStock = !FILTERS.hideNoStock;
    updatePillsUI();
    all = buildLocalView(rawSrc);
    localStorage.setItem(LS_PRODUCTS_VIEW, JSON.stringify(all));
    render(els.q?.value || '');
  });
  els.pillMin?.addEventListener('click', () => {
    FILTERS.hideMinZero = !FILTERS.hideMinZero;
    updatePillsUI();
    all = buildLocalView(rawSrc);
    localStorage.setItem(LS_PRODUCTS_VIEW, JSON.stringify(all));
    render(els.q?.value || '');
  });

  // abrir/fechar carrinho
  els.cartBtn?.addEventListener('click', () => els.cartPanel?.classList.add('open'));
  els.closeCart?.addEventListener('click', () => els.cartPanel?.classList.remove('open'));

  // delegação para "Adicionar"
  els.catalog?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-add]');
    if (!btn) return;
    const id = btn.dataset.add;
    const p = indexById.get(id);
    if (!p) return console.warn('[catalog] produto não encontrado para id', id);
    addToCart(fromProduct(p));
  });

  // ações do carrinho
  els.cartBody?.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    const { id, act } = btn.dataset;
    if (act === 'inc')  incItem(id, +1);
    if (act === 'dec')  incItem(id, -1);
    if (act === 'del')  removeItem(id);
  });

  els.clearCart?.addEventListener('click', clearCart);

  // ===== Checkout =====
  const LS_CHECKOUT_LAST  = 'checkout_last_order_id';
  const LS_CHECKOUT_QUEUE = 'checkout_pending';

  // handler direto (se o botão existir já no DOM)
  els.checkout?.addEventListener('click', (e) => {
    e.preventDefault();                // evita submit nativo
    e.stopPropagation();
    doCheckout();
  });

  // fallback delegado (se o botão for inserido depois)
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('#checkout');
    if (!btn) return;
    e.preventDefault();                // evita submit nativo
    e.stopPropagation();
    doCheckout();
  });

  window.addEventListener('online', tryFlushQueue);

  // primeira render do carrinho e estado dos "pills"
  updatePillsUI();
  renderCart();

  // ==== helpers internos do checkout (iguais aos seus) ====
  function cartSnapshot(){
    const items = cart.map(it => ({
      id: it.id,
      name: it.name,
      code: it.code || it.codigoBarras || null,
      unitPrice: +Number(it.unitPrice || 0).toFixed(2),
      qty: +Number(it.qty || 1).toFixed(0),
      lineTotal: +Number((it.unitPrice || 0) * (it.qty || 1)).toFixed(2),
    }));
    const subtotal = +items.reduce((s,i)=>s+i.lineTotal,0).toFixed(2);
    const discount = +Number(0).toFixed(2); // ajuste se tiver regras
    const total = +(subtotal - discount).toFixed(2);
    return { items, totals:{ subtotal, discount, total } };
  }

  async function doCheckout(){
    if (!cart.length) { alert('Carrinho vazio.'); return; }

    // 1) abre modal e obtém dados do cliente + pagamento (com desconto)
    const snap = cartSnapshot();
    const form = await openCheckoutModal(snap);
    if (!form) return; // cancelado

    // 2) monta pedido final (não acumula descontos)
    const subtotal = snap.totals.subtotal;
    const cartDisc = snap.totals.discount;
    const payDisc  = form.paymentDiscountApplied || 0;
    const total    = +(subtotal - (cartDisc > 0 ? cartDisc : payDisc)).toFixed(2);

    const order = {
      status: 'new',
      createdAt: (window.firebase?.firestore?.FieldValue?.serverTimestamp?.() ?? null),
      createdAtClient: Date.now(),
      updatedAt: (window.firebase?.firestore?.FieldValue?.serverTimestamp?.() ?? null),
      source: { from:'catalog', domain: location.host, ua: navigator.userAgent },
      customer: {
        name:   form.name,
        phone:  form.phone,
        address:{ street: form.street, number: form.number || '', district: form.district }
      },
      payment: {
        methodId: form.payment?.id || null,
        methodName: form.payment?.name || null,
        discountType: form.payment?.discount?.type || null,
        discountValue: form.payment?.discount?.value ?? 0,
        discountApplied: payDisc
      },
      items: snap.items,
      totals:{ subtotal, discount: cartDisc, paymentDiscount: payDisc, total }
    };

    try{
      const { ready } = await import('./server.js'); await ready;

      // se tiver CF createOrder:
      const fnOk = !!(window.firebase?.functions);
      if (fnOk) {
        const callable = firebase.app().functions('us-central1').httpsCallable('createOrder');
        const res = await callable({
          customer: {
            name: form.name,
            phone: form.phone,
            address:{ street: form.street, number: form.number || '', district: form.district }
          },
          paymentMethodId: form.payment?.id || null,
          cart: snap,
          domain: location.host,
          ua: navigator.userAgent
        });
        const orderId = res?.data?.id;
        if (orderId) {
          localStorage.setItem(LS_CHECKOUT_LAST, orderId);
          cart = []; saveCart(); renderCart();
          alert(`Pedido enviado!\nNúmero: ${orderId}`);
          return;
        }
      }

      // fallback: Firestore direto
      const { db } = await import('./server.js');
      const ref = db.collection('orders').doc();
      await ref.set(order);
      localStorage.setItem(LS_CHECKOUT_LAST, ref.id);
      cart = []; saveCart(); renderCart();
      alert(`Pedido enviado!\nNúmero: ${ref.id}`);
    }catch(err){
      // offline: enfileira
      enqueuePending(order);
      alert('Sem internet. O pedido foi guardado e será enviado quando a conexão voltar.');
      console.warn('[checkout] enfileirado (offline)', err);
    }
  }

  function loadQueue(){
    try{ const raw = localStorage.getItem(LS_CHECKOUT_QUEUE); const arr = raw?JSON.parse(raw):[]; return Array.isArray(arr)?arr:[]; }
    catch{ return []; }
  }
  function saveQueue(q){ localStorage.setItem(LS_CHECKOUT_QUEUE, JSON.stringify(q)); }
  function enqueuePending(order){ const q = loadQueue(); q.push(order); saveQueue(q); }

  async function tryFlushQueue(){
    const q = loadQueue(); if (!q.length) return;
    try{
      const { db, ready } = await import('./server.js'); await ready;
      for (const order of q) {
        const ref = db.collection('orders').doc();
        await ref.set({ ...order, updatedAt: (window.firebase?.firestore?.FieldValue?.serverTimestamp?.() ?? null) });
        localStorage.setItem(LS_CHECKOUT_LAST, ref.id);
      }
      saveQueue([]);
      console.log('[checkout] fila enviada:', q.length);
    }catch(e){
      console.warn('[checkout] flush falhou, mantém fila', e);
    }
  }

  // ==== utilitários do modal (iguais aos seus) ====
  function escapeHTML(s){ return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
  function cleanPhone(s){ return String(s||'').replace(/\D+/g,'').slice(0,11); }
  function isValidPhone(d){ return /^\d{11}$/.test(d); }
  function calcPayDiscount(subtotal, discount){
    if (!discount) return 0;
    const v = Number(discount.value||0);
    if (discount.type === 'percent') return +(subtotal * (v/100)).toFixed(2);
    if (discount.type === 'fixed')   return +v.toFixed(2);
    return 0;
  }

async function openCheckoutModal(cart){
  const ui = buildCkUI();
  document.body.appendChild(ui.wrap);
  const ls = (k,d='')=>{ try{return localStorage.getItem(k)??d}catch{return d} };

  // Prefill
  ui.name.value    = ls('customer_name');
  ui.phone.value   = ls('customer_phone');
  ui.street.value  = ls('customer_street');
  ui.number.value  = ls('customer_number');

  ui.totalBase.textContent = moneyBR(cart.totals.subtotal);
  ui.warnNoAcc.hidden = !(cart.totals.discount > 0);

// ===== Bairros + Taxas (corrigido) =====
const { list: districts, fees: feeMap } = await loadDistrictsAndFees();
const lastDistrict = ls('customer_district');

ui.district.innerHTML = '<option value="">Selecione…</option>';
{
  const frag = document.createDocumentFragment();
  for (const name of districts) {
    const fee = Number(feeMap[name] || 0);
    const opt = document.createElement('option');
    opt.value = name;                          // <-- value é SEMPRE o nome
    opt.dataset.fee = String(fee);             // <-- taxa guardada no data-fee
    opt.textContent = fee ? `${name} — ${moneyBR(fee)}` : name; // rótulo bonito
    if (name === lastDistrict) opt.selected = true;
    frag.appendChild(opt);
  }
  ui.district.appendChild(frag);
}

// ===== Recalcular totais somando a entrega =====
const refreshTotals = ()=>{
  const subtotal = cart.totals.subtotal;
  const cartDisc = cart.totals.discount;

  const chosen = payOpts.find(p=>p.id===ui.payment.value);
  const payDisc = calcPayDiscount(subtotal, chosen?.discount);
  const applyPayment = !(cartDisc > 0);

  const sel = ui.district.options[ui.district.selectedIndex];
  const shipFee = Number(sel?.dataset?.fee || 0);  // <-- lê do data-fee

  const descontoAplicado = applyPayment ? payDisc : cartDisc;
  const total = Math.max(0, subtotal - descontoAplicado) + shipFee;

  ui.totalDisc.textContent  = moneyBR(descontoAplicado);
  if (ui.totalShip) ui.totalShip.textContent = moneyBR(shipFee); // opcional se existir linha de frete
  ui.totalFinal.textContent = moneyBR(total);
};

ui.payment.addEventListener('change', refreshTotals);
ui.district.addEventListener('change', refreshTotals);
refreshTotals();

  // Pagamentos
  const payOpts = await loadOrEnsurePaymentOptions();
  ui.payment.innerHTML = payOpts.map(p=>{
    const label = p.discount?.type==='percent'
      ? `${p.name} — ${p.discount.value}% off`
      : `${p.name}${p.discount?.value?` — ${moneyBR(p.discount.value)} off`:''}`;
    const sel = (ls('payment_method_id')===p.id)?' selected':'';
    return `<option value="${escapeHTML(p.id)}"${sel}>${escapeHTML(label)}</option>`;
  }).join('');

  // Máscara telefone
  ui.phone.addEventListener('input', ()=>{
    const d = cleanPhone(ui.phone.value);
    let v = d; if (v.length>0) v='('+v;
    if (v.length>3) v=v.slice(0,3)+') '+v.slice(3);
    if (v.length>6) v=v.slice(0,6)+' '+v.slice(6);
    if (v.length>11) v=v.slice(0,11)+' '+v.slice(11);
    ui.phone.value = v.slice(0,18);
  });


  ui.payment.addEventListener('change', refreshTotals);
  ui.district.addEventListener('change', refreshTotals);
  refreshTotals();

  // Promise de retorno
  const result = await new Promise((resolve)=>{
    const done = (payload)=>{ ui.wrap.remove(); resolve(payload); };
    ui.close.addEventListener('click', ()=>done(null));
    ui.back .addEventListener('click', ()=>done(null));
    ui.confirm.addEventListener('click', ()=>{
      const name = ui.name.value.trim();
      const phone = cleanPhone(ui.phone.value);
      const street = ui.street.value.trim();
      const number = ui.number.value.trim();
      const district = ui.district.value;
      if (!name)   return showCkErr('Informe o nome.');
      if (!isValidPhone(phone)) return showCkErr('Telefone inválido. Use (99) 9 9999 9999.');
      if (!street) return showCkErr('Informe a rua/avenida.');
      if (!district) return showCkErr('Selecione o bairro.');

      // Salva LS
      try{
        localStorage.setItem('customer_name', name);
        localStorage.setItem('customer_phone', phone);
        localStorage.setItem('customer_street', street);
        localStorage.setItem('customer_number', number);
        localStorage.setItem('customer_district', district);
        localStorage.setItem('payment_method_id', ui.payment.value);
      }catch{}

      const chosen = payOpts.find(p=>p.id===ui.payment.value) || null;
      const payDisc = calcPayDiscount(cart.totals.subtotal, chosen?.discount);
      const applyPayment = !(cart.totals.discount > 0);
      const deliveryFee = Number(feeMap[district] || 0);

      done({
        name, phone, street, number, district,
        payment: chosen,
        paymentDiscountApplied: applyPayment ? payDisc : 0,
        deliveryFee
      });
    });
    function showCkErr(msg){ ui.err.textContent = msg; setTimeout(()=>ui.err.textContent='', 3500); }
  });

  return result;

  // UI com linha de "Entrega:"
  function buildCkUI(){
    const wrap = document.createElement('div');
    wrap.innerHTML = `
      <style>
      #ckWrap{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;z-index:4000}
      #ckBack{position:absolute;inset:0;background:rgba(0,0,0,.55)}
      #ckBox{position:relative;width:680px;max-width:95vw;background:#0b1220;color:#e5e7eb;border:1px solid #1f2937;border-radius:16px;box-shadow:0 20px 48px rgba(0,0,0,.35);overflow:hidden}
      #ckHd{display:flex;align-items:center;justify-content:space-between;padding:12px 14px;background:#0f172a;border-bottom:1px solid #1f2937}
      #ckHd .ttl{font-weight:800}
      #ckBd{padding:14px;display:grid;grid-template-columns:1fr 1fr;gap:12px}
      #ckFt{padding:12px 14px;border-top:1px solid #1f2937;background:#0f172a;display:flex;gap:10px;align-items:center;justify-content:flex-end}
      .ck-field{display:flex;flex-direction:column;gap:6px}
      .ck-field label{font-size:12px;color:#94a3b8}
      .ck-field input,.ck-field select{border:1px solid #243247;background:#0b1220;color:#e5e7eb;border-radius:10px;padding:9px 10px;outline:none}
      .ck-col{display:flex;flex-direction:column;gap:12px}
      .ck-row{display:flex;gap:10px}
      .ck-row .ck-field{flex:1}
      .ck-hint{font-size:12px;color:#94a3b8}
      .ck-badge{font-size:12px;border:1px solid #243247;border-radius:999px;padding:4px 8px}
      .ck-btn{border:1px solid #243247;background:#0f172a;color:#e5e7eb;border-radius:10px;padding:10px 14px;cursor:pointer}
      .ck-btn.primary{background:#4f7cff;color:#000;border:none}
      .ck-close{all:unset;cursor:pointer;color:#94a3b8}
      .ck-total{font-weight:800}
      .ck-warn{font-size:12px;color:#f59e0b}
      </style>
      <div id="ckWrap">
        <div id="ckBack"></div>
        <div id="ckBox">
          <div id="ckHd">
            <div class="ttl">Finalizar pedido</div>
            <button id="ckClose" class="ck-close">✕</button>
          </div>
          <div id="ckBd">
            <div class="ck-col">
              <div class="ck-field">
                <label>Nome <span class="ck-badge">obrigatório</span></label>
                <input id="ckName" placeholder="Nome completo">
              </div>
              <div class="ck-field">
                <label>Telefone <span class="ck-badge">obrigatório</span></label>
                <input id="ckPhone" placeholder="(99) 9 9999 9999" inputmode="numeric">
              </div>
              <div class="ck-field">
                <label>Rua <span class="ck-badge">obrigatório</span></label>
                <input id="ckStreet" placeholder="Rua / Avenida">
              </div>
              <div class="ck-row">
                <div class="ck-field">
                  <label>Número <span class="ck-hint">(opcional)</span></label>
                  <input id="ckNumber" placeholder="Nº">
                </div>
                <div class="ck-field">
                  <label>Bairro <span class="ck-badge">obrigatório</span></label>
                  <select id="ckDistrict"><option value="">Carregando…</option></select>
                </div>
              </div>
            </div>
            <div class="ck-col">
              <div class="ck-field">
                <label>Forma de pagamento</label>
                <select id="ckPayment"></select>
                <div class="ck-hint">Desconto da forma de pagamento <b>não acumula</b> com outros descontos.</div>
                <div id="ckWarnNoAcc" class="ck-warn">Já existe desconto no carrinho — o desconto da forma de pagamento não será aplicado.</div>
              </div>
              <div class="ck-field">
                <label>Resumo</label>
                <div class="ck-row"><div>Subtotal:</div><div class="ck-total" id="ckTotalBase">—</div></div>
                <div class="ck-row"><div>Desconto:</div><div class="ck-total" id="ckTotalDisc">—</div></div>
                <div class="ck-row"><div>Entrega:</div><div class="ck-total" id="ckTotalShip">—</div></div>
                <div class="ck-row"><div>Total:</div><div class="ck-total" id="ckTotalFinal">—</div></div>
                <div id="ckErr" class="ck-hint" style="color:#fecaca;margin-top:6px"></div>
              </div>
            </div>
          </div>
          <div id="ckFt">
            <button id="ckBack" class="ck-btn">Voltar</button>
            <button id="ckConfirm" class="ck-btn primary">Enviar pedido</button>
          </div>
        </div>
      </div>
    `;
    return {
      wrap: wrap,
      close: wrap.querySelector('#ckClose'),
      back:  wrap.querySelector('#ckBack'),
      confirm: wrap.querySelector('#ckConfirm'),
      name:   wrap.querySelector('#ckName'),
      phone:  wrap.querySelector('#ckPhone'),
      street: wrap.querySelector('#ckStreet'),
      number: wrap.querySelector('#ckNumber'),
      district: wrap.querySelector('#ckDistrict'),
      payment:  wrap.querySelector('#ckPayment'),
      totalBase:  wrap.querySelector('#ckTotalBase'),
      totalDisc:  wrap.querySelector('#ckTotalDisc'),
      totalShip:  wrap.querySelector('#ckTotalShip'),
      totalFinal: wrap.querySelector('#ckTotalFinal'),
      warnNoAcc:  wrap.querySelector('#ckWarnNoAcc'),
      err: wrap.querySelector('#ckErr'),
    };
  }
}

async function openCheckoutModal(cart){
  const ui = buildCkUI();
  document.body.appendChild(ui.wrap);

  const ls = (k,d='')=>{ try{return localStorage.getItem(k)??d}catch{return d} };

  // Prefill
  ui.name.value    = ls('customer_name');
  ui.phone.value   = ls('customer_phone');
  ui.street.value  = ls('customer_street');
  ui.number.value  = ls('customer_number');

  ui.totalBase.textContent = moneyBR(cart.totals.subtotal);
  ui.warnNoAcc.hidden = !(cart.totals.discount > 0);

  // Bairros
  const districts = await (async()=>{
    for (const url of ['./bairros.json','../bairros.json']){
      try{ const r = await fetch(url); if (r.ok){ const d = await r.json(); return Array.isArray(d)?d:Object.values(d) } }catch{}
    }
    return [];
  })();
  ui.district.innerHTML = '<option value="">Selecione…</option>' + districts.map(n=>{
    const v = String(n).trim(); const sel = (ls('customer_district')===v)?' selected':'';
    return `<option value="${escapeHTML(v)}"${sel}>${escapeHTML(v)}</option>`;
  }).join('');

  // Pagamentos
  const payOpts = await loadOrEnsurePaymentOptions();
  ui.payment.innerHTML = payOpts.map(p=>{
    const label = p.discount?.type==='percent'
      ? `${p.name} — ${p.discount.value}% off`
      : `${p.name}${p.discount?.value?` — ${moneyBR(p.discount.value)} off`:''}`;
    const sel = (ls('payment_method_id')===p.id)?' selected':'';
    return `<option value="${escapeHTML(p.id)}"${sel}>${escapeHTML(label)}</option>`;
  }).join('');

  // Máscara telefone
  ui.phone.addEventListener('input', ()=>{
    const d = cleanPhone(ui.phone.value);
    let v = d; if (v.length>0) v='('+v;
    if (v.length>3) v=v.slice(0,3)+') '+v.slice(3);
    if (v.length>6) v=v.slice(0,6)+' '+v.slice(6);
    if (v.length>11) v=v.slice(0,11)+' '+v.slice(11);
    ui.phone.value = v.slice(0,18);
  });

  // Recalcular totais ao trocar pagamento
  const refreshTotals = ()=>{
    const subtotal = cart.totals.subtotal;
    const cartDisc = cart.totals.discount;
    const chosen = payOpts.find(p=>p.id===ui.payment.value);
    const payDisc = calcPayDiscount(subtotal, chosen?.discount);
    const applyPayment = !(cartDisc>0);
    const total = Math.max(0, subtotal - (applyPayment ? payDisc : cartDisc));
    ui.totalDisc.textContent  = moneyBR(applyPayment ? payDisc : cartDisc);
    ui.totalFinal.textContent = moneyBR(total);
  };
  ui.payment.addEventListener('change', refreshTotals);
  refreshTotals();

  // Fluxo de retorno
  const result = await new Promise((resolve)=>{
    const done = (payload)=>{ ui.wrap.remove(); resolve(payload); };
    ui.close.addEventListener('click', ()=>done(null));
    ui.backdrop.addEventListener('click', ()=>done(null)); // clique fora fecha
    ui.backBtn.addEventListener('click', ()=>done(null));  // botão Voltar

    ui.confirm.addEventListener('click', ()=>{
      const name = ui.name.value.trim();
      const phone = cleanPhone(ui.phone.value);
      const street = ui.street.value.trim();
      const number = ui.number.value.trim();
      const district = ui.district.value;

      if (!name)   return showErr('Informe o nome.');
      if (!isValidPhone(phone)) return showErr('Telefone inválido. Use (99) 9 9999 9999.');
      if (!street) return showErr('Informe a rua/avenida.');
      if (!district) return showErr('Selecione o bairro.');

      // Salva LS
      try{
        localStorage.setItem('customer_name', name);
        localStorage.setItem('customer_phone', phone);
        localStorage.setItem('customer_street', street);
        localStorage.setItem('customer_number', number);
        localStorage.setItem('customer_district', district);
        localStorage.setItem('payment_method_id', ui.payment.value);
      }catch{}

      const chosen = payOpts.find(p=>p.id===ui.payment.value) || null;
      const payDisc = calcPayDiscount(cart.totals.subtotal, chosen?.discount);
      const applyPayment = !(cart.totals.discount > 0);

      done({
        name, phone, street, number, district,
        payment: chosen,
        paymentDiscountApplied: applyPayment ? payDisc : 0
      });
    });

    function showErr(msg){ ui.err.textContent = msg; setTimeout(()=>ui.err.textContent='', 3500); }
  });

  return result;

  // === UI builder (ids únicos) ===
  function buildCkUI(){
    const wrap = document.createElement('div');
    wrap.innerHTML = `
      <style>
      #ckWrap{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;z-index:2147483647}
      #ckBackdrop{position:absolute;inset:0;background:rgba(0,0,0,.55);z-index:1}
      #ckBox{position:relative;z-index:2;width:680px;max-width:95vw;background:#0b1220;color:#e5e7eb;
             border:1px solid #1f2937;border-radius:16px;box-shadow:0 20px 48px rgba(0,0,0,.35);overflow:hidden}
      #ckHd{display:flex;align-items:center;justify-content:space-between;padding:12px 14px;background:#0f172a;border-bottom:1px solid #1f2937}
      #ckHd .ttl{font-weight:800}
      #ckBd{padding:14px;display:grid;grid-template-columns:1fr 1fr;gap:12px}
      #ckFt{padding:12px 14px;border-top:1px solid #1f2937;background:#0f172a;display:flex;gap:10px;align-items:center;justify-content:flex-end}
      .ck-field{display:flex;flex-direction:column;gap:6px}
      .ck-field label{font-size:12px;color:#94a3b8}
      .ck-field input,.ck-field select{border:1px solid #243247;background:#0b1220;color:#e5e7eb;border-radius:10px;padding:9px 10px;outline:none}
      .ck-col{display:flex;flex-direction:column;gap:12px}
      .ck-row{display:flex;gap:10px}
      .ck-row .ck-field{flex:1}
      .ck-hint{font-size:12px;color:#94a3b8}
      .ck-badge{font-size:12px;border:1px solid #243247;border-radius:999px;padding:4px 8px}
      .ck-btn{border:1px solid #243247;background:#0f172a;color:#e5e7eb;border-radius:10px;padding:10px 14px;cursor:pointer}
      .ck-btn.primary{background:#4f7cff;color:#000;border:none}
      .ck-close{all:unset;cursor:pointer;color:#94a3b8}
      .ck-total{font-weight:800}
      .ck-warn{font-size:12px;color:#f59e0b}
      </style>
      <div id="ckWrap">
        <div id="ckBackdrop"></div>
        <div id="ckBox">
          <div id="ckHd">
            <div class="ttl">Finalizar pedido</div>
            <button id="ckClose" class="ck-close">✕</button>
          </div>
          <div id="ckBd">
            <div class="ck-col">
              <div class="ck-field">
                <label>Nome <span class="ck-badge">obrigatório</span></label>
                <input id="ckName" placeholder="Nome completo">
              </div>
              <div class="ck-field">
                <label>Telefone <span class="ck-badge">obrigatório</span></label>
                <input id="ckPhone" placeholder="(99) 9 9999 9999" inputmode="numeric">
              </div>
              <div class="ck-field">
                <label>Rua <span class="ck-badge">obrigatório</span></label>
                <input id="ckStreet" placeholder="Rua / Avenida">
              </div>
              <div class="ck-row">
                <div class="ck-field">
                  <label>Número <span class="ck-hint">(opcional)</span></label>
                  <input id="ckNumber" placeholder="Nº">
                </div>
                <div class="ck-field">
                  <label>Bairro <span class="ck-badge">obrigatório</span></label>
                  <select id="ckDistrict"><option value="">Carregando…</option></select>
                </div>
              </div>
            </div>
            <div class="ck-col">
              <div class="ck-field">
                <label>Forma de pagamento</label>
                <select id="ckPayment"></select>
                <div class="ck-hint">Desconto da forma de pagamento <b>não acumula</b> com outros descontos.</div>
                <div id="ckWarnNoAcc" class="ck-warn">Já existe desconto no carrinho — o desconto da forma de pagamento não será aplicado.</div>
              </div>
              <div class="ck-field">
                <label>Resumo</label>
                <div class="ck-row"><div>Subtotal:</div><div class="ck-total" id="ckTotalBase">—</div></div>
                <div class="ck-row"><div>Desconto:</div><div class="ck-total" id="ckTotalDisc">—</div></div>
                <div class="ck-row"><div>Total:</div><div class="ck-total" id="ckTotalFinal">—</div></div>
                <div id="ckErr" class="ck-hint" style="color:#fecaca;margin-top:6px"></div>
              </div>
            </div>
          </div>
          <div id="ckFt">
            <button id="ckBackBtn" class="ck-btn">Voltar</button>
            <button id="ckConfirm" class="ck-btn primary">Enviar pedido</button>
          </div>
        </div>
      </div>
    `;
    return {
      wrap: wrap,
      backdrop: wrap.querySelector('#ckBackdrop'),
      close: wrap.querySelector('#ckClose'),
      backBtn: wrap.querySelector('#ckBackBtn'),
      confirm: wrap.querySelector('#ckConfirm'),
      name:   wrap.querySelector('#ckName'),
      phone:  wrap.querySelector('#ckPhone'),
      street: wrap.querySelector('#ckStreet'),
      number: wrap.querySelector('#ckNumber'),
      district: wrap.querySelector('#ckDistrict'),
      payment:  wrap.querySelector('#ckPayment'),
      totalBase:  wrap.querySelector('#ckTotalBase'),
      totalDisc:  wrap.querySelector('#ckTotalDisc'),
      totalFinal: wrap.querySelector('#ckTotalFinal'),
      warnNoAcc:  wrap.querySelector('#ckWarnNoAcc'),
      err: wrap.querySelector('#ckErr'),
    };
  }
}


  async function loadOrEnsurePaymentOptions(){
    const { db, ready } = await import('./server.js'); await ready;
    const ref = db.collection('data').doc('keys');
    const snap = await ref.get();
    const d = snap.exists ? snap.data() : {};
    let arr = Array.isArray(d.paymentOptions) ? d.paymentOptions : [];
    if (!arr.length) {
      arr = [
        { id:'pix',     name:'Pix',      discount:{ type:'percent', value:5 } },
        { id:'debito',  name:'Débito',   discount:{ type:'percent', value:2 } },
        { id:'credito', name:'Crédito',  discount:{ type:'percent', value:0 } },
        { id:'money',   name:'Dinheiro', discount:{ type:'fixed',   value:0 } },
      ];
      await ref.set({ paymentOptions: arr }, { merge:true });
    }
    return arr;
  }
}
// Carrega bairros + taxas de vários formatos aceitos.
// Suporta:
//  - ["Centro", "Jardim", ...]                       (sem taxa -> 0)
//  - [{name:"Centro", fee: 7.5}, ...]                (ou {bairro/nome, entrega})
//  - {"Centro": 7.5, "Jardim": 5, ...}               (mapa)
//  - bairros_frete.json (mesmo formato do mapa)      -> sobrescreve taxas
async function loadDistrictsAndFees() {
  let list = [];
  let fees = {};

  // bairros.json
  for (const url of ['./bairros.json','../bairros.json']) {
    try {
      const r = await fetch(url, { cache:'no-store' });
      if (!r.ok) continue;
      const d = await r.json();

      if (Array.isArray(d)) {
        for (const item of d) {
          if (typeof item === 'string') {
            const name = item.trim(); if (name) list.push(name);
          } else if (item && typeof item === 'object') {
            const name = String(item.name ?? item.bairro ?? item.nome ?? '').trim();
            const fee  = Number(item.fee ?? item.entrega ?? 0);
            if (name) {
              list.push(name);
              if (Number.isFinite(fee)) fees[name] = fee;
            }
          }
          // (se vier número puro não tem como inferir o nome -> ignora)
        }
      } else if (d && typeof d === 'object') {
        for (const [k,v] of Object.entries(d)) {
          const name = String(k).trim();
          if (!name) continue;
          list.push(name);
          const fee = Number(v);
          if (Number.isFinite(fee)) fees[name] = fee;
        }
      }
      break;
    } catch {}
  }

  // bairros_frete.json (override)
  for (const url of ['./bairros_frete.json','../bairros_frete.json']) {
    try {
      const r = await fetch(url, { cache:'no-store' });
      if (!r.ok) continue;
      const d = await r.json();
      if (d && typeof d === 'object') {
        for (const [k,v] of Object.entries(d)) {
          const name = String(k).trim();
          const fee = Number(v);
          if (name && Number.isFinite(fee)) fees[name] = fee;
        }
      }
      break;
    } catch {}
  }

  // dedup + ordena
  list = Array.from(new Set(list)).sort((a,b)=> a.localeCompare(b,'pt-BR',{sensitivity:'base'}));
  return { list, fees };
}


function updatePillsUI(){
  if (els.pillStock){
    els.pillStock.dataset.active = String(FILTERS.hideNoStock);
    els.pillStock.textContent = FILTERS.hideNoStock ? 'Sem estoque oculto' : 'Sem estoque visível';
  }
  if (els.pillMin){
    els.pillMin.dataset.active = String(FILTERS.hideMinZero);
    els.pillMin.textContent = FILTERS.hideMinZero ? 'min=0 oculto' : 'min=0 visível';
  }
}

// --------- Cart ---------
function loadCart(){
  try{
    const raw = localStorage.getItem(LS_CART);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  }catch{ return []; }
}
function saveCart(){
  localStorage.setItem(LS_CART, JSON.stringify(cart));
  localStorage.setItem(LS_CART_UPDATED, new Date().toISOString());
  renderCart();
}
function fromProduct(p){
  return {
    id: productId(p),
    name: p?.nome ?? '—',
    code: p?.codigoBarras ?? null,
    unitPrice: Number(productPrice(p) || 0),
    qty: 1
  };
}
function addToCart(item){
  const idx = cart.findIndex(it => it.id === item.id);
  if (idx >= 0) cart[idx].qty += item.qty;
  else cart.push(item);
  saveCart();
  els.cartPanel.classList.add('open');
}
function incItem(id, d){
  const it = cart.find(i => i.id === id);
  if (!it) return;
  it.qty = Math.max(1, it.qty + d);
  saveCart();
}
function removeItem(id){
  cart = cart.filter(i => i.id !== id);
  saveCart();
}
function clearCart(){
  if (!cart.length) return;
  if (!confirm('Limpar carrinho?')) return;
  cart = [];
  saveCart();
}
function renderCart(){
  const rows = cart.map(it => {
    const total = it.unitPrice * it.qty;
    return `
      <div class="cartItem">
        <div class="itemHeader">
          <b>${it.name}</b>
          <div class="itemMeta">${it.code ? '#'+it.code+' • ' : ''}${moneyBR(it.unitPrice)} un.</div>
        </div>
        <div class="qty">
          <button data-act="dec" data-id="${it.id}">−</button>
          <b>${it.qty}</b>
          <button data-act="inc" data-id="${it.id}">＋</button>
          <button class="iconBtn" data-act="del" data-id="${it.id}" title="Remover">🗑️</button>
        </div>
        <div style="grid-column:1/-1;display:flex;justify-content:flex-end;font-weight:800">
          ${moneyBR(total)}
        </div>
      </div>
    `;
  }).join('');

  els.cartBody.innerHTML = rows || '<div class="empty">Seu carrinho está vazio.</div>';
  const items = cart.reduce((s,i)=>s+i.qty,0);
  const total = cart.reduce((s,i)=>s+i.qty*i.unitPrice,0);
  els.cartItems.textContent = String(items);
  els.cartTotal.textContent = moneyBR(total);
  els.cartCount.textContent = String(items);
}
