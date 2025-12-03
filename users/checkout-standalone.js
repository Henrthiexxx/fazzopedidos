// Checkout standalone — lê carrinho do LS e envia pedido
// Requer: server.js (Firebase compat 10) e (opcional) bairros.json/bairros_frete.json

const LS_CART = 'catalog_cart';
const LS_CHECKOUT_LAST  = 'checkout_last_order_id';

const moneyBR = (n)=> Number(n||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const cleanPhone = (s)=> String(s||'').replace(/\D+/g,'').slice(0,11);
const isValidPhone = (d)=> /^\d{11}$/.test(d);
const collator = new Intl.Collator('pt-BR',{sensitivity:'base',numeric:true});

// ---------- dados auxiliares ----------
async function loadOrEnsurePaymentOptions(){
  try{
    const { db, ready } = await import('../server.js');
    try{ if (ready) await ready; }catch{}
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
  }catch{ return []; }
}

// Suporta vários formatos de bairros e taxas
async function loadDistrictsAndFees() {
  let list = [], fees = {};
  for (const url of ['./bairros.json','../bairros.json']) {
    try{
      const r = await fetch(url,{cache:'no-store'}); if (!r.ok) continue;
      const d = await r.json();
      if (Array.isArray(d)) {
        for (const it of d) {
          if (typeof it === 'string') list.push(it.trim());
          else if (it && typeof it === 'object') {
            const name = String(it.name ?? it.bairro ?? it.nome ?? '').trim();
            const fee  = Number(it.fee ?? it.entrega ?? 0);
            if (name) { list.push(name); if (Number.isFinite(fee)) fees[name]=fee; }
          }
        }
      } else if (d && typeof d === 'object') {
        for (const [k,v] of Object.entries(d)) {
          const name = String(k).trim(); if (!name) continue;
          list.push(name); const fee = Number(v); if (Number.isFinite(fee)) fees[name]=fee;
        }
      }
      break;
    }catch{}
  }
  for (const url of ['./bairros.json','../bairros.json']) {
    try{
      const r = await fetch(url,{cache:'no-store'}); if (!r.ok) continue;
      const d = await r.json();
      if (d && typeof d === 'object') {
        for (const [k,v] of Object.entries(d)) {
          const name = String(k).trim(); const fee = Number(v);
          if (name && Number.isFinite(fee)) fees[name]=fee;
        }
      }
      break;
    }catch{}
  }
  list = Array.from(new Set(list)).sort((a,b)=>collator.compare(a,b));
  return { list, fees };
}

function calcPayDiscount(subtotal, discount){
  if (!discount) return 0;
  const v = Number(discount.value||0);
  if (discount.type === 'percent') return +(subtotal * (v/100)).toFixed(2);
  if (discount.type === 'fixed')   return +v.toFixed(2);
  return 0;
}

function loadCart(){
  try{ const raw = localStorage.getItem(LS_CART); const arr = raw?JSON.parse(raw):[]; return Array.isArray(arr)?arr:[]; }
  catch{ return []; }
}
function cartSnapshot(cart){
  const items = cart.map(it => ({
    id: it.id, name: it.name, code: it.code || null,
    unitPrice: +Number(it.unitPrice||0).toFixed(2),
    qty: +Number(it.qty||1).toFixed(0),
    lineTotal: +Number((it.unitPrice||0)*(it.qty||1)).toFixed(2),
  }));
  const subtotal = +items.reduce((s,i)=>s+i.lineTotal,0).toFixed(2);
  const discount = +Number(0).toFixed(2);
  return { items, totals:{ subtotal, discount, total: subtotal - discount } };
}

// ---------- UI ----------
async function openCheckoutPage(cartSnap){
  const payOpts = await loadOrEnsurePaymentOptions();
  const { list: districts, fees: feeMap } = await loadDistrictsAndFees();

  // build page UI
  const root = document.createElement('div');
  root.innerHTML = `
    <style>
      .wrap{max-width:760px;margin:24px auto;padding:16px;border:1px solid #1f2937;border-radius:16px;background:#0f172a}
      .row{display:grid;grid-template-columns:1fr 1fr;gap:12px}
      .field{display:flex;flex-direction:column;gap:6px}
      .field label{font-size:12px;color:#94a3b8}
      input,select{border:1px solid #243247;background:#0b1220;color:#e5e7eb;border-radius:10px;padding:10px}
      .tot{display:flex;flex-direction:column;gap:6px;margin-top:8px}
      .line{display:flex;justify-content:space-between}
      .actions{display:flex;gap:10px;justify-content:flex-end;margin-top:16px}
      .btn{border:1px solid #243247;background:#0f172a;color:#e5e7eb;border-radius:10px;padding:10px 14px;cursor:pointer}
      .primary{background:#4f7cff;color:#000;border:none}
      .err{color:#fecaca;height:18px}
      h1{margin:0 0 12px 0;font-size:20px}
    </style>
    <div class="wrap">
      <h1>Finalizar pedido</h1>
      <div class="row">
        <div>
          <div class="field"><label>Nome *</label><input id="name" placeholder="Nome completo"></div>
          <div class="field"><label>Telefone *</label><input id="phone" placeholder="(99) 9 9999 9999" inputmode="numeric"></div>
          <div class="field"><label>Rua *</label><input id="street" placeholder="Rua / Avenida"></div>
          <div class="row">
            <div class="field"><label>Número (opcional)</label><input id="number" placeholder="Nº"></div>
            <div class="field"><label>Bairro *</label><select id="district"><option value="">Selecione…</option></select></div>
          </div>
        </div>
        <div>
          <div class="field"><label>Forma de pagamento</label>
            <select id="payment"></select>
            <small style="color:#94a3b8">Desconto da forma de pagamento não acumula com outros descontos.</small>
          </div>
          <div class="tot">
            <div class="line"><span>Subtotal:</span><b id="tSub">—</b></div>
            <div class="line"><span>Desconto:</span><b id="tDisc">—</b></div>
            <div class="line"><span>Entrega:</span><b id="tShip">—</b></div>
            <div class="line"><span>Total:</span><b id="tTot">—</b></div>
          </div>
          <div class="err" id="err"></div>
        </div>
      </div>
      <div class="actions">
        <button id="back" class="btn">Voltar</button>
        <button id="confirm" class="btn primary">Enviar pedido</button>
      </div>
    </div>
  `;
  document.body.appendChild(root);

  // refs
  const ui = {
    name: root.querySelector('#name'),
    phone: root.querySelector('#phone'),
    street: root.querySelector('#street'),
    number: root.querySelector('#number'),
    district: root.querySelector('#district'),
    payment: root.querySelector('#payment'),
    tSub: root.querySelector('#tSub'),
    tDisc: root.querySelector('#tDisc'),
    tShip: root.querySelector('#tShip'),
    tTot: root.querySelector('#tTot'),
    err: root.querySelector('#err'),
    back: root.querySelector('#back'),
    confirm: root.querySelector('#confirm'),
  };

  // Prefill LS
  const ls = (k,d='')=>{ try{return localStorage.getItem(k)??d}catch{return d} };
  ui.name.value   = ls('customer_name');
  ui.phone.value  = ls('customer_phone');
  ui.street.value = ls('customer_street');
  ui.number.value = ls('customer_number');

  // Payment
  ui.payment.innerHTML = payOpts.map(p=>{
    const label = p.discount?.type==='percent'
      ? `${p.name} — ${p.discount.value}% off`
      : `${p.name}${p.discount?.value?` — ${moneyBR(p.discount.value)} off`:''}`;
    const sel = (ls('payment_method_id')===p.id)?' selected':'';
    return `<option value="${p.id}"${sel}>${label}</option>`;
  }).join('');

  // Districts (value = nome, data-fee = taxa)
  {
    const last = ls('customer_district');
    const frag = document.createDocumentFragment();
    for (const name of districts) {
      const fee = Number(feeMap[name]||0);
      const opt = document.createElement('option');
      opt.value = name;
      opt.dataset.fee = String(fee);
      opt.textContent = fee ? `${name} — ${moneyBR(fee)}` : name;
      if (name === last) opt.selected = true;
      frag.appendChild(opt);
    }
    ui.district.appendChild(frag);
  }

  // Totais
  const subtotal = cartSnap.totals.subtotal;
  function refreshTotals(){
    const cartDisc = cartSnap.totals.discount;
    const chosen = payOpts.find(p=>p.id===ui.payment.value);
    const payDisc = calcPayDiscount(subtotal, chosen?.discount);
    const applyPayment = !(cartDisc>0);

    const sel = ui.district.options[ui.district.selectedIndex];
    const shipFee = Number(sel?.dataset?.fee || 0);

    const descontoAplicado = applyPayment ? payDisc : cartDisc;
    const total = Math.max(0, subtotal - descontoAplicado) + shipFee;

    ui.tSub.textContent  = moneyBR(subtotal);
    ui.tDisc.textContent = moneyBR(descontoAplicado);
    ui.tShip.textContent = moneyBR(shipFee);
    ui.tTot.textContent  = moneyBR(total);
  }
  ui.payment.addEventListener('change', refreshTotals);
  ui.district.addEventListener('change', refreshTotals);
  refreshTotals();

  // máscara de telefone
  ui.phone.addEventListener('input', ()=>{
    const d = cleanPhone(ui.phone.value);
    let v = d; if (v.length>0) v='('+v;
    if (v.length>3) v=v.slice(0,3)+') '+v.slice(3);
    if (v.length>6) v=v.slice(0,6)+' '+v.slice(6);
    if (v.length>11) v=v.slice(0,11)+' '+v.slice(11);
    ui.phone.value = v.slice(0,18);
  });

  // ações
  ui.back.addEventListener('click', ()=> history.length>1 ? history.back() : (location.href='/status.html'));

  ui.confirm.addEventListener('click', async ()=>{
    const name = ui.name.value.trim();
    const phone = cleanPhone(ui.phone.value);
    const street = ui.street.value.trim();
    const number = ui.number.value.trim();
    const district = ui.district.value;

    if (!name)   return showErr('Informe o nome.');
    if (!isValidPhone(phone)) return showErr('Telefone inválido. Use (99) 9 9999 9999.');
    if (!street) return showErr('Informe a rua/avenida.');
    if (!district) return showErr('Selecione o bairro.');

    // guarda preferências
    try{
      localStorage.setItem('customer_name', name);
      localStorage.setItem('customer_phone', phone);
      localStorage.setItem('customer_street', street);
      localStorage.setItem('customer_number', number);
      localStorage.setItem('customer_district', district);
      localStorage.setItem('payment_method_id', ui.payment.value);
    }catch{}

    const chosen = payOpts.find(p=>p.id===ui.payment.value) || null;
    const payDisc = calcPayDiscount(subtotal, chosen?.discount);
    const applyPayment = !(cartSnap.totals.discount > 0);

    const sel = ui.district.options[ui.district.selectedIndex];
    const deliveryFee = Number(sel?.dataset?.fee || 0);

    const total = +(Math.max(0, subtotal - (applyPayment ? payDisc : cartSnap.totals.discount)) + deliveryFee).toFixed(2);

    // monta pedido
    const order = {
      status: 'new',
      createdAt: (window.firebase?.firestore?.FieldValue?.serverTimestamp?.() ?? null),
      createdAtClient: Date.now(),
      updatedAt: (window.firebase?.firestore?.FieldValue?.serverTimestamp?.() ?? null),
      source: { from:'catalog', domain: location.host, ua: navigator.userAgent },
      customer: { name, phone, address:{ street, number, district } },
      delivery: { district, fee: deliveryFee },
      payment: {
        methodId: chosen?.id || null,
        methodName: chosen?.name || null,
        discountType: chosen?.discount?.type || null,
        discountValue: chosen?.discount?.value ?? 0,
        discountApplied: applyPayment ? payDisc : 0
      },
      items: cartSnap.items,
      totals:{ subtotal, discount: cartSnap.totals.discount, paymentDiscount: applyPayment ? payDisc : 0, delivery: deliveryFee, total }
    };

    try{
      const { db, ready } = await import('../server.js'); try{ if (ready) await ready; }catch{}
      const ref = db.collection('orders').doc();
      await ref.set(order);
      localStorage.setItem(LS_CHECKOUT_LAST, ref.id);
      // limpa carrinho
      localStorage.setItem(LS_CART, JSON.stringify([]));
      alert(`Pedido enviado!\nNúmero: ${ref.id}`);
      location.href = 'index.html';
    }catch(e){
      console.warn('[checkout] falhou envio direto, talvez você já tenha fila offline no catálogo.', e);
      alert('Sem internet agora. Abra o catálogo novamente para reencaminhar a fila quando voltar a conexão.');
    }
  });

  function showErr(msg){ ui.err.textContent = msg; setTimeout(()=> ui.err.textContent='', 3500); }
}

// ---------- boot ----------
const cart = loadCart();
if (!cart.length) {
  document.body.innerHTML = '<div style="max-width:720px;margin:40px auto;padding:16px;border:1px solid #1f2937;border-radius:16px;background:#0f172a">Seu carrinho está vazio.</div>';
} else {
  const snap = cartSnapshot(cart);
  openCheckoutPage(snap);
}
