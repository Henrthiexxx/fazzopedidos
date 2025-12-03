// users/checkout.js
// Modal de checkout + criação de pedido no Firestore
// Requer: server.js (compat) exportando { db, auth, ready }
// Uso básico no catálogo:
//   import { createOrderWithCheckout } from './users/checkout.js';
//   const res = await createOrderWithCheckout({ items, totals }); // totals: {subtotal, discount, total}
//   if (res?.id) console.log('Pedido criado:', res.id);

export async function createOrderWithCheckout(cart) {
  const form = await openCheckout(cart);        // exibe modal, valida e retorna dados
  if (!form) return null;                       // usuário cancelou

  const { db, auth, ready } = await import('../server.js');
  await ready;

  const uid = auth.currentUser?.uid || null;
  const fv  = (window.firebase?.firestore?.FieldValue?.serverTimestamp?.() ?? null);

  // monta pedido
  const order = {
    status: 'new',
    createdBy: uid,
    createdAt: fv,
    createdAtClient: Date.now(),
    updatedAt: fv,
    source: { from: 'catalog', domain: location.host, ua: navigator.userAgent },
    customer: {
      name: form.name,
      phone: form.phone,
      address: {
        street: form.street,
        number: form.number || '',
        district: form.district,
      },
    },
    payment: {
      methodId: form.payment?.id || null,
      methodName: form.payment?.name || null,
      discountType: form.payment?.discount?.type || null,
      discountValue: form.payment?.discount?.value ?? 0,
      discountApplied: form.paymentDiscountApplied ?? 0,
    },
    items: cart.items || [],
    totals: form.finalTotals,  // { subtotal, discount, paymentDiscount, total }
  };

  const ref = db.collection('orders').doc();   // id aleatório
  await ref.set(order);

  try { localStorage.setItem('checkout_last_order_id', ref.id); } catch {}
  return { id: ref.id, ...order };
}

export async function openCheckout(cart) {
  const ui = buildUI();
  attach(ui);

  // Prefill LS em inglês
  const ls = (k, d='') => { try { return localStorage.getItem(k) ?? d; } catch { return d; } };
  ui.name.value    = ls('customer_name');
  ui.phone.value   = ls('customer_phone');
  ui.street.value  = ls('customer_street');
  ui.number.value  = ls('customer_number');
  ui.totalBase.textContent = moneyBR(Number(cart?.totals?.subtotal||0));
  ui.warnNoAcc.hidden = !(Number(cart?.totals?.discount||0) > 0);

  // Carrega bairros.json
  const districts = await loadDistricts();
  fillSelect(ui.district, districts, ls('customer_district'));

  // Carrega/garante paymentOptions do Firestore
  const payOpts = await loadOrEnsurePaymentOptions();
  fillPayment(ui.payment, payOpts, ls('payment_method_id'));

  // eventos
  ui.phone.addEventListener('input', () => maskPhone(ui.phone));
  ui.payment.addEventListener('change', () => refreshTotals());
  ui.close.addEventListener('click', () => destroy());
  ui.back.addEventListener('click', () => destroy());
  ui.confirm.addEventListener('click', async () => {
    const v = validate(ui);
    if (!v.ok) { showErr(ui, v.msg); return; }
    // salva LS
    try {
      localStorage.setItem('customer_name', ui.name.value.trim());
      localStorage.setItem('customer_phone', cleanPhone(ui.phone.value));
      localStorage.setItem('customer_street', ui.street.value.trim());
      localStorage.setItem('customer_number', ui.number.value.trim());
      localStorage.setItem('customer_district', ui.district.value);
      localStorage.setItem('payment_method_id', ui.payment.value);
    } catch {}
    const result = buildResult(ui, cart, payOpts);
    destroy();
    resolve(resultPromise, result);
  });

  // calcula totais init
  refreshTotals();
  // mostra modal
  ui.wrap.classList.add('show');

  // Promise que resolve quando confirmar/cancelar
  let resultPromise;
  const p = new Promise((res) => (resultPromise = res));
  // cancelamento por ESC ou backdrop
  ui.backdrop.addEventListener('click', () => { destroy(); resolve(resultPromise, null); });
  document.addEventListener('keydown', onEsc, { passive:true });
  function onEsc(e){ if (e.key === 'Escape') { destroy(); resolve(resultPromise, null); } }

  return p;

  // ==== helpers ====
  function refreshTotals(){
    const base = {
      subtotal: Number(cart?.totals?.subtotal||0),
      cartDiscount: Number(cart?.totals?.discount||0),
    };
    const chosen = payOpts.find(p => p.id === ui.payment.value);
    const payDisc = chosen ? calcPaymentDiscount(base.subtotal, chosen.discount) : 0;
    const applyPayment = !(base.cartDiscount > 0); // não acumula
    const total = Math.max(0, base.subtotal - (applyPayment ? payDisc : base.cartDiscount));
    ui.totalDisc.textContent = moneyBR(applyPayment ? payDisc : base.cartDiscount);
    ui.totalFinal.textContent = moneyBR(total);
  }

  function destroy(){
    ui.wrap.classList.remove('show');
    setTimeout(()=>ui.wrap.remove(), 150);
    document.removeEventListener('keydown', onEsc);
  }
}

function resolve(r, v){ try{ r(v); }catch{} }

function buildUI(){
  const wrap = document.createElement('div');
  wrap.id = 'ckWrap';
  wrap.innerHTML = `
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
            <div id="ckWarnNoAcc" class="ck-warn" hidden>Já existe desconto no carrinho — o desconto da forma de pagamento não será aplicado.</div>
          </div>

          <div class="ck-field">
            <label>Resumo</label>
            <div class="ck-row">
              <div>Subtotal:</div><div class="ck-total" id="ckTotalBase">—</div>
            </div>
            <div class="ck-row">
              <div>Desconto:</div><div class="ck-total" id="ckTotalDisc">—</div>
            </div>
            <div class="ck-row">
              <div>Total:</div><div class="ck-total" id="ckTotalFinal">—</div>
            </div>
            <div id="ckErr" class="ck-hint ck-danger" style="margin-top:6px"></div>
          </div>
        </div>
      </div>
      <div id="ckFt">
        <button id="ckBack"   class="ck-btn">Voltar</button>
        <button id="ckConfirm" class="ck-btn primary">Enviar pedido</button>
      </div>
    </div>
  `;
  document.body.appendChild(wrap);
  return {
    wrap,
    backdrop: wrap.querySelector('#ckBack'),
    close:    wrap.querySelector('#ckClose'),
    back:     wrap.querySelector('#ckBack'),
    confirm:  wrap.querySelector('#ckConfirm'),
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

function attach(ui){
  // nada extra aqui — somente util para manter a API organizada
}

function validate(ui){
  const name = (ui.name.value||'').trim();
  const phone = cleanPhone(ui.phone.value);
  const street = (ui.street.value||'').trim();
  const district = ui.district.value;

  if (!name) return { ok:false, msg:'Informe o nome.' };
  if (!isValidPhone(phone)) return { ok:false, msg:'Telefone inválido. Use (99) 9 9999 9999.' };
  if (!street) return { ok:false, msg:'Informe a rua/avenida.' };
  if (!district) return { ok:false, msg:'Selecione o bairro.' };
  return { ok:true };
}

function showErr(ui, msg){ ui.err.textContent = msg; setTimeout(()=> ui.err.textContent='', 4000); }

function maskPhone(inp){
  const d = cleanPhone(inp.value);
  // (99) 9 9999 9999
  let v = d;
  if (v.length > 0) v = '(' + v;
  if (v.length > 3) v = v.slice(0,3) + ') ' + v.slice(3);
  if (v.length > 6) v = v.slice(0,6) + ' ' + v.slice(6);
  if (v.length > 11) v = v.slice(0,11) + ' ' + v.slice(11);
  if (v.length > 16) v = v.slice(0,16) + ' ' + v.slice(16);
  inp.value = v.slice(0, 18);
}
function cleanPhone(s){ return String(s||'').replace(/\D+/g,'').slice(0,11); }
function isValidPhone(d){ return /^\d{11}$/.test(d); }

function moneyBR(n){ return Number(n||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'}); }

async function loadDistricts(){
  // tenta ./bairros.json depois ../bairros.json
  for (const url of ['./bairros.json','../bairros.json']) {
    try {
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) return data;
        if (data && typeof data === 'object') return Object.values(data).map(String);
      }
    } catch {}
  }
  return [];
}

function fillSelect(sel, list, selected){
  sel.innerHTML = '<option value="">Selecione…</option>' + list.map(n => {
    const v = String(n).trim();
    const selAttr = (selected && selected === v) ? ' selected' : '';
    return `<option value="${escapeHTML(v)}"${selAttr}>${escapeHTML(v)}</option>`;
  }).join('');
}

async function loadOrEnsurePaymentOptions(){
  const { db, ready } = await import('../server.js'); await ready;
  const ref = db.collection('data').doc('keys');
  const snap = await ref.get();
  const d = snap.exists ? snap.data() : {};
  let arr = Array.isArray(d.paymentOptions) ? d.paymentOptions : [];
  if (!arr.length) {
    // cria defaults
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

function fillPayment(sel, arr, selectedId){
  sel.innerHTML = arr.map(p => {
    const label = p.discount?.type === 'percent'
      ? `${p.name} — ${p.discount.value}% off`
      : `${p.name}${p.discount?.value?` — ${moneyBR(p.discount.value)} off`:''}`;
    const selAttr = (selectedId && selectedId === p.id) ? ' selected' : '';
    return `<option value="${escapeHTML(p.id)}"${selAttr}>${escapeHTML(label)}</option>`;
  }).join('');
}

function calcPaymentDiscount(subtotal, discount){
  if (!discount) return 0;
  const v = Number(discount.value||0);
  if (discount.type === 'percent') return +(subtotal * (v/100)).toFixed(2);
  if (discount.type === 'fixed')   return +v.toFixed(2);
  return 0;
}

function buildResult(ui, cart, payOpts){
  const subtotal = Number(cart?.totals?.subtotal||0);
  const cartDisc = Number(cart?.totals?.discount||0);
  const chosen   = payOpts.find(p => p.id === ui.payment.value);
  const payDisc  = calcPaymentDiscount(subtotal, chosen?.discount);
  const applyPayment = !(cartDisc > 0);
  const total = Math.max(0, subtotal - (applyPayment ? payDisc : cartDisc));

  return {
    name: (ui.name.value||'').trim(),
    phone: cleanPhone(ui.phone.value),
    street: (ui.street.value||'').trim(),
    number: (ui.number.value||'').trim(),
    district: ui.district.value,
    payment: chosen || null,
    paymentDiscountApplied: applyPayment ? payDisc : 0,
    finalTotals: {
      subtotal,
      discount: cartDisc,
      paymentDiscount: applyPayment ? payDisc : 0,
      total: +total.toFixed(2),
    },
  };
}

function escapeHTML(s){ return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
