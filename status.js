// Lê o orderId do ?id=... ou do LS, assina o doc e pinta a timeline.
// Opcional: registra token de push (se você ativar FCM depois).

const moneyBR = n => Number(n||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const qs = new URLSearchParams(location.search);
const LS_LAST = 'checkout_last_order_id';

let orderId = qs.get('id') || localStorage.getItem(LS_LAST) || '';
document.getElementById('orderId').textContent = orderId ? `#${orderId}` : 'Sem ID';

if (!orderId) {
  alert('Sem pedido para acompanhar. Abra com ?id=... ou finalize um pedido.');
  throw new Error('no order id');
}

let unsub = null;

(async function init(){
  const { db, ready } = await import('./server.js'); 
  try { await ready; } catch {}
  const ref = db.collection('orders').doc(orderId);

  unsub = ref.onSnapshot(async (doc) => {
    if (!doc.exists) return;
    const o = doc.data() || {};

    // status + totais
    document.getElementById('status').textContent = humanStatus(o.status);
    const t = o?.totals?.total ?? 0;
    const ship = o?.delivery?.fee ?? 0;
    document.getElementById('total').textContent = ship ? `${moneyBR(t)} (c/ entrega)` : moneyBR(t);

    // itens
    const itemsEl = document.getElementById('items');
    const rows = (o.items||[]).map(it => `
      <div class="item">
        <div>${it.qty}× ${it.name}</div>
        <b>${moneyBR(it.lineTotal||0)}</b>
      </div>
    `).join('');
    itemsEl.innerHTML = rows || '<div class="muted">Sem itens.</div>';

    // timeline
    paintSteps(o);

    // ACK opcional (marca que o cliente viu que o PDV recebeu / começou a preparar)
    try {
      const updates = {};
      if (o.status === 'received' && !o?.clientNotify?.receivedAt) updates['clientNotify.receivedAt'] = firebase.firestore.FieldValue.serverTimestamp();
      if (o.status === 'preparing' && !o?.clientNotify?.preparingAt) updates['clientNotify.preparingAt'] = firebase.firestore.FieldValue.serverTimestamp();
      if (o.status === 'ready' && !o?.clientNotify?.readyAt) updates['clientNotify.readyAt'] = firebase.firestore.FieldValue.serverTimestamp();
      if (Object.keys(updates).length) await ref.set(updates, { merge:true });
    } catch (e) {
      // se regras não permitirem, só ignora
      console.warn('[status] ack falhou (ignorado):', e?.message);
    }
  }, err => {
    console.error('[status] snapshot error', err);
    alert('Não foi possível acompanhar seu pedido agora.');
  });
})();

function humanStatus(s){
  const map = {
    new: 'Enviado',
    received: 'Recebido pelo PDV',
    preparing: 'Sendo preparado',
    ready: 'Pronto',
    out_for_delivery: 'Saiu para entrega',
    done: 'Concluído',
    canceled: 'Cancelado'
  };
  return map[s] || s || '—';
}

function paintSteps(o){
  const orderTs = {
    new: o.createdAt?.toDate?.() || new Date(o.createdAtClient || Date.now()),
    received: o.receivedAt?.toDate?.(),
    preparing: o.preparingAt?.toDate?.(),
    ready: o.readyAt?.toDate?.(),
    out_for_delivery: o.outForDeliveryAt?.toDate?.(),
    done: o.doneAt?.toDate?.(),
    canceled: o.canceledAt?.toDate?.(),
  };

  const stepsEl = document.getElementById('steps');
  stepsEl.querySelectorAll('li').forEach(li => {
    const k = li.getAttribute('data-k');
    const has = !!orderTs[k];
    li.classList.toggle('done', has);
    li.classList.toggle('active', o.status === k && !has);
    const when = orderTs[k] ? orderTs[k].toLocaleString('pt-BR') : '';
    const right = when ? `<span>${when}</span>` : '';
    li.innerHTML = `${li.textContent.split(' — ')[0]} ${right}`;
  });

  const whenEl = document.getElementById('when');
  whenEl.textContent = `Atualizado: ${new Date().toLocaleString('pt-BR')}`;
}

// === (Opcional) Push via FCM, registra token do navegador ===
document.getElementById('enablePush').addEventListener('click', async ()=>{
  try{
    // requer que você tenha configurado FCM no projeto e adicionado o service worker "firebase-messaging-sw.js"
    const ok = await askPushPermission();
    if (!ok) return;
    const token = await getFcmToken();
    if (!token) return alert('Não foi possível obter token de push.');
    const { db } = await import('./server.js');
    await db.collection('orders').doc(orderId).set({
      clientPushTokens: firebase.firestore.FieldValue.arrayUnion(token)
    }, { merge:true });
    document.getElementById('pushInfo').textContent = 'Notificações ativadas neste dispositivo ✅';
  }catch(e){
    console.warn('push error', e);
    alert('Não foi possível ativar notificações.');
  }
});

async function askPushPermission(){
  if (!('Notification' in window)) { alert('Seu navegador não suporta notificações.'); return false; }
  if (Notification.permission === 'granted') return true;
  const p = await Notification.requestPermission();
  return p === 'granted';
}

async function getFcmToken(){
  if (!firebase.messaging) return null;
  const messaging = firebase.messaging();
  // Substitua pela sua VAPID Key pública do FCM
  const vapidKey = 'SUA_VAPID_PUBLIC_KEY_AQUI';
  return await messaging.getToken({ vapidKey });
}
