// status.js — Acompanhar pedido do cliente (sem spam de writes)

// Utilidades básicas
const moneyBR = n => Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const formatDT = d => d ? d.toLocaleString('pt-BR') : '';
const qs = new URLSearchParams(location.search);

// Onde o catálogo guarda o último pedido enviado
const LS_LAST = 'checkout_last_order_id';
// Acks locais: evita regravar clientNotify.* várias vezes por status neste dispositivo
const LS_ACK_PREFIX = 'order_ack_'; // ordem: order_ack_{orderId}_{status}

// Resolve orderId via ?id=... ou último do LS
let orderId = qs.get('id') || localStorage.getItem(LS_LAST) || '';
const elOrderId = document.getElementById('orderId');
if (elOrderId) elOrderId.textContent = orderId ? `#${orderId}` : 'Sem ID';

if (!orderId) {
  alert('Sem pedido para acompanhar. Abra esta página com ?id=... ou finalize um pedido.');
  throw new Error('no order id');
}

// Mapa humanizado de status
function humanStatus(s) {
  const map = {
    new: 'Na Fila',
    received: 'Pedido Aceito!',
    preparing: 'Sendo preparado',
    ready: 'Pronto',
    out_for_delivery: 'Saiu para entrega',
    done: 'Concluído',
    canceled: 'Cancelado'
  };
  return map[s] || s || '—';
}

// Marca/checa ACK por dispositivo (idempotente)
const hasAck = (status) => localStorage.getItem(`${LS_ACK_PREFIX}${orderId}_${status}`) === '1';
const markAck = (status) => localStorage.setItem(`${LS_ACK_PREFIX}${orderId}_${status}`, '1');

// Executa uma vez por chave (para evitar alert repetido)
const once = (() => {
  const seen = new Set();
  return (k, fn) => { if (seen.has(k)) return; seen.add(k); try { fn && fn(); } catch {} };
})();

// Pinta a timeline baseado nos timestamps do pedido
function paintSteps(o) {
  const ts = {
    new: o.createdAt?.toDate?.() || (o.createdAtClient ? new Date(o.createdAtClient) : null),
    received: o.receivedAt?.toDate?.() || null,
    preparing: o.preparingAt?.toDate?.() || null,
    ready: o.readyAt?.toDate?.() || null,
    out_for_delivery: o.outForDeliveryAt?.toDate?.() || null,
    done: o.doneAt?.toDate?.() || null,
    canceled: o.canceledAt?.toDate?.() || null,
  };

  const stepsEl = document.getElementById('steps');
  if (!stepsEl) return;

  stepsEl.querySelectorAll('li[data-k]').forEach(li => {
    const k = li.getAttribute('data-k');
    const labelAttr = li.getAttribute('data-label');
    const label = labelAttr || humanStatus(k);
    const has = !!ts[k];

    li.classList.toggle('done', has);
    li.classList.toggle('active', o.status === k && !has);

    // Renderiza mantendo um label estável + "quando" à direita
    const when = has ? formatDT(ts[k]) : '';
    li.innerHTML = `<span class="label">${label}</span>${when ? ` <span class="when">${when}</span>` : ''}`;
    if (!labelAttr) li.setAttribute('data-label', label);
  });

  const whenEl = document.getElementById('when');
  if (whenEl) whenEl.textContent = `Atualizado: ${new Date().toLocaleString('pt-BR')}`;
}

// Snapshot e ACKs idempotentes (sem spam)
let unsub = null;
(async function init() {
  const { db, ready } = await import('./server.js');
  try { await ready; } catch {}

  const ref = db.collection('orders').doc(orderId);

  // includeMetadataChanges p/ checar hasPendingWrites e evitar loops locais
  unsub = ref.onSnapshot({ includeMetadataChanges: true }, async (doc) => {
    if (!doc.exists) return;
    const o = doc.data() || {};
    const meta = doc.metadata || {};

    // Header de status
    const elStatus = document.getElementById('status');
    if (elStatus) elStatus.textContent = humanStatus(o.status);

    // Totais
    const totalVal = o?.totals?.total ?? 0;
    const shipVal = o?.delivery?.fee ?? 0;
    const elTotal = document.getElementById('total');
    if (elTotal) elTotal.textContent = shipVal ? `${moneyBR(totalVal)} (c/ entrega)` : moneyBR(totalVal);

    // Itens
    const items = Array.isArray(o.items) ? o.items : [];
    const itemsEl = document.getElementById('items');
    if (itemsEl) {
      const rows = items.map(it => `
        <div class="item">
          <div>${it.qty}× ${it.name}</div>
          <b>${moneyBR(it.lineTotal || 0)}</b>
        </div>
      `).join('');
      itemsEl.innerHTML = rows || '<div class="muted">Sem itens.</div>';
    }

    // Timeline
    paintSteps(o);

    // ACKs do cliente (somente quando NÃO há writes locais pendentes)
    if (!meta.hasPendingWrites) {
      const updates = {};
      if (o.status === 'received' && !hasAck('received') && !o?.clientNotify?.receivedAt) {
        updates['clientNotify.receivedAt'] = firebase.firestore.FieldValue.serverTimestamp();
      }
      if (o.status === 'preparing' && !hasAck('preparing') && !o?.clientNotify?.preparingAt) {
        updates['clientNotify.preparingAt'] = firebase.firestore.FieldValue.serverTimestamp();
      }
      if (o.status === 'ready' && !hasAck('ready') && !o?.clientNotify?.readyAt) {
        updates['clientNotify.readyAt'] = firebase.firestore.FieldValue.serverTimestamp();
      }

      if (Object.keys(updates).length) {
        try {
          await ref.set(updates, { merge: true });
          if (updates['clientNotify.receivedAt']) markAck('received');
          if (updates['clientNotify.preparingAt']) markAck('preparing');
          if (updates['clientNotify.readyAt']) markAck('ready');
        } catch (e) {
          // Regras podem bloquear — só loga, não alerta o usuário
          console.warn('[status] ack falhou (ignorado):', e?.message);
        }
      }
    }
  }, err => {
    console.error('[status] snapshot error', err);
    once('snap_error', () => alert('Não foi possível atualizar o status do seu pedido agora.'));
  });
})();

// Limpa listener ao sair
window.addEventListener('beforeunload', () => { try { unsub && unsub(); } catch {} });

// === (Opcional) Notificações Push via FCM ===
const btnPush = document.getElementById('enablePush');
if (btnPush) {
  btnPush.addEventListener('click', async (ev) => {
    const btn = ev.currentTarget;
    try {
      const ok = await askPushPermission();
      if (!ok) return;

      const token = await getFcmToken();
      if (!token) { alert('Não foi possível obter token de push.'); return; }

      const { db } = await import('./server.js');
      await db.collection('orders').doc(orderId).set({
        clientPushTokens: firebase.firestore.FieldValue.arrayUnion(token)
      }, { merge: true });

      const info = document.getElementById('pushInfo');
      if (info) info.textContent = 'Notificações ativadas neste dispositivo ✅';
      btn.disabled = true;
      btn.textContent = 'Notificações ativas';
    } catch (e) {
      console.warn('push error', e);
      once('push_error', () => alert('Não foi possível ativar notificações.'));
    }
  });
}

// Permissão de push
async function askPushPermission() {
  if (!('Notification' in window)) { alert('Seu navegador não suporta notificações.'); return false; }
  if (Notification.permission === 'granted') return true;
  const p = await Notification.requestPermission();
  return p === 'granted';
}

// Obter token FCM (precisa do firebase-messaging e VAPID key pública configurados)
async function getFcmToken() {
  if (!firebase.messaging) return null;
  const messaging = firebase.messaging();
  // TODO: substitua pela sua VAPID PUBLIC KEY
  const vapidKey = 'SUA_VAPID_PUBLIC_KEY_AQUI';
  try {
    const token = await messaging.getToken({ vapidKey });
    return token || null;
  } catch (e) {
    console.warn('getToken error', e);
    return null;
  }
}
