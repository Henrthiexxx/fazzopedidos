// status.js — Acompanhar pedidos do cliente (múltiplos pedidos + cancelamento)

// Utilidades básicas
const moneyBR = n => Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const formatDT = d => d ? d.toLocaleString('pt-BR') : '';
const qs = new URLSearchParams(location.search);

// Onde o catálogo guarda o último pedido enviado
const LS_LAST = 'checkout_last_order_id';
const LS_MY_ORDERS = 'my_order_ids'; // lista de pedidos do cliente
// Acks locais: evita regravar clientNotify.* várias vezes por status neste dispositivo
const LS_ACK_PREFIX = 'order_ack_'; // ordem: order_ack_{orderId}_{status}

// Resolve orderId via ?id=... ou último do LS
let orderId = qs.get('id') || localStorage.getItem(LS_LAST) || '';

// Salva pedido na lista de "meus pedidos"
if (orderId) {
  try {
    const myOrders = JSON.parse(localStorage.getItem(LS_MY_ORDERS) || '[]');
    if (!myOrders.includes(orderId)) {
      myOrders.push(orderId);
      localStorage.setItem(LS_MY_ORDERS, JSON.stringify(myOrders));
    }
  } catch {}
}

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
    canceled: '❌ Cancelado'
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
    
    // Se cancelado, marca tudo como inativo exceto o canceled
    if (o.status === 'canceled' && k !== 'canceled') {
      li.classList.remove('active');
      li.classList.add('canceled-order');
    }

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
    if (elStatus) {
      elStatus.textContent = humanStatus(o.status);
      // Adiciona classe especial se cancelado
      if (o.status === 'canceled') {
        elStatus.classList.add('status-canceled');
        const alertBox = document.getElementById('cancelAlert');
        if (alertBox) alertBox.classList.add('show');
      } else {
        elStatus.classList.remove('status-canceled');
        const alertBox = document.getElementById('cancelAlert');
        if (alertBox) alertBox.classList.remove('show');
      }
    }

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
      if (o.status === 'out_for_delivery' && !hasAck('out_for_delivery') && !o?.clientNotify?.outForDeliveryAt) {
        updates['clientNotify.outForDeliveryAt'] = firebase.firestore.FieldValue.serverTimestamp();
      }
      if (o.status === 'canceled' && !hasAck('canceled') && !o?.clientNotify?.canceledAt) {
        updates['clientNotify.canceledAt'] = firebase.firestore.FieldValue.serverTimestamp();
        // Alerta o cliente sobre cancelamento
        once(`cancel_alert_${orderId}`, () => {
          alert('⚠️ Seu pedido foi cancelado pelo estabelecimento.');
        });
      }

      if (Object.keys(updates).length) {
        try {
          await ref.set(updates, { merge: true });
          if (updates['clientNotify.receivedAt']) markAck('received');
          if (updates['clientNotify.preparingAt']) markAck('preparing');
          if (updates['clientNotify.readyAt']) markAck('ready');
          if (updates['clientNotify.outForDeliveryAt']) markAck('out_for_delivery');
          if (updates['clientNotify.canceledAt']) markAck('canceled');
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

// === Lista de meus pedidos (sidebar ou dropdown) ===
const btnMyOrders = document.getElementById('btnMyOrders');
const myOrdersList = document.getElementById('myOrdersList');

if (btnMyOrders && myOrdersList) {
  btnMyOrders.addEventListener('click', () => {
    myOrdersList.hidden = !myOrdersList.hidden;
    loadMyOrders();
  });
}

async function loadMyOrders() {
  if (!myOrdersList) return;
  
  try {
    const myOrders = JSON.parse(localStorage.getItem(LS_MY_ORDERS) || '[]');
    if (!myOrders.length) {
      myOrdersList.innerHTML = '<div class="muted">Nenhum pedido anterior.</div>';
      return;
    }

    myOrdersList.innerHTML = '<div class="muted">Carregando...</div>';

    const { db } = await import('./server.js');
    const promises = myOrders.map(id => db.collection('orders').doc(id).get());
    const docs = await Promise.all(promises);

    const html = docs.map(doc => {
      if (!doc.exists) return '';
      const o = doc.data();
      const st = o.status || 'new';
      const total = o?.totals?.total ?? 0;
      const isCurrent = doc.id === orderId;
      return `
        <div class="order-item ${isCurrent ? 'current' : ''}" onclick="window.location.href='status.html?id=${doc.id}'">
          <div><b>#${doc.id}</b> ${isCurrent ? '(atual)' : ''}</div>
          <div class="muted">${humanStatus(st)} • ${moneyBR(total)}</div>
        </div>
      `;
    }).join('');

    myOrdersList.innerHTML = html || '<div class="muted">Nenhum pedido encontrado.</div>';
  } catch (e) {
    console.error('Erro ao carregar meus pedidos:', e);
    myOrdersList.innerHTML = '<div class="muted">Erro ao carregar pedidos.</div>';
  }
}

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
