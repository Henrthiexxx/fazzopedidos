// status.js — Acompanhamento de pedidos com modais estilizados

const moneyBR = n => Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const formatDT = d => d ? d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '';

const LS_LAST = 'checkout_last_order_id';
const LS_MY_ORDERS = 'my_order_ids';
const LS_ACK_PREFIX = 'order_ack_';

const qs = new URLSearchParams(location.search);
let orderId = qs.get('id') || localStorage.getItem(LS_LAST) || '';

// Salva pedido na lista
if (orderId) {
  try {
    const myOrders = JSON.parse(localStorage.getItem(LS_MY_ORDERS) || '[]');
    if (!myOrders.includes(orderId)) {
      myOrders.push(orderId);
      localStorage.setItem(LS_MY_ORDERS, JSON.stringify(myOrders));
    }
  } catch {}
}

// ===== MODAIS ESTILIZADOS =====
function showModal(title, message, buttonText = 'OK'){
  return new Promise(resolve => {
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.innerHTML = `
      <div class="modal">
        <div class="modal-header">
          <div class="modal-title">${title}</div>
        </div>
        <div class="modal-body">
          <p>${message}</p>
        </div>
        <div class="modal-footer">
          <button class="btn-primary" id="btnOk">${buttonText}</button>
        </div>
      </div>
    `;
    document.body.appendChild(backdrop);
    const close = () => { backdrop.remove(); resolve(); };
    backdrop.querySelector('#btnOk').onclick = close;
  });
}

function showLoading(message = 'Carregando...'){
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `
    <div class="modal" style="max-width:320px">
      <div class="modal-body" style="text-align:center;padding:40px 24px">
        <div style="width:40px;height:40px;margin:0 auto 16px;border:3px solid var(--gray-800);border-top-color:var(--white);border-radius:50%;animation:spin 0.6s linear infinite"></div>
        <p style="color:var(--gray-400);margin:0">${message}</p>
      </div>
    </div>
  `;
  document.body.appendChild(backdrop);
  return {
    close: () => backdrop.remove()
  };
}

// ===== HELPERS =====
const orderIdEl = document.getElementById('orderId');
if (!orderId) {
  if (orderIdEl) orderIdEl.textContent = 'Nenhum pedido encontrado';
  showModal('Pedido não encontrado', 'Finalize um pedido para acompanhar o status aqui.', 'Voltar').then(() => {
    window.location.href = 'index.html';
  });
  throw new Error('no order id');
}

if (orderIdEl) orderIdEl.textContent = `#${orderId.slice(0,8)}`;

function humanStatus(s) {
  const map = {
    new: 'Na Fila',
    received: 'Aceito',
    preparing: 'Preparando',
    ready: 'Pronto',
    out_for_delivery: 'Saiu para Entrega',
    done: 'Concluído',
    canceled: 'Cancelado'
  };
  return map[s] || s || '—';
}

function getStatusClass(s){
  const map = {
    new: 'status-new',
    received: 'status-received',
    preparing: 'status-preparing',
    ready: 'status-ready',
    out_for_delivery: 'status-preparing',
    done: 'status-done',
    canceled: 'status-canceled'
  };
  return map[s] || 'status-new';
}

const hasAck = (status) => localStorage.getItem(`${LS_ACK_PREFIX}${orderId}_${status}`) === '1';
const markAck = (status) => localStorage.setItem(`${LS_ACK_PREFIX}${orderId}_${status}`, '1');

const once = (() => {
  const seen = new Set();
  return (k, fn) => { if (seen.has(k)) return; seen.add(k); try { fn && fn(); } catch {} };
})();

// ===== TIMELINE =====
function renderTimeline(o){
  const steps = [
    { key: 'new', label: 'Pedido Enviado', icon: '📝', field: 'createdAt' },
    { key: 'received', label: 'Aceito pelo PDV', icon: '✅', field: 'receivedAt' },
    { key: 'preparing', label: 'Sendo Preparado', icon: '👨\u200d🍳', field: 'preparingAt' },
    { key: 'ready', label: 'Pronto', icon: '🎉', field: 'readyAt' },
    { key: 'out_for_delivery', label: 'Saiu para Entrega', icon: '🚗', field: 'outForDeliveryAt' },
    { key: 'done', label: 'Concluído', icon: '✨', field: 'doneAt' }
  ];

  const timeline = document.getElementById('timeline');
  if (!timeline) return;

  const isCanceled = o.status === 'canceled';
  
  timeline.innerHTML = steps.map(step => {
    const timestamp = o[step.field]?.toDate?.() || (step.key === 'new' && o.createdAtClient ? new Date(o.createdAtClient) : null);
    const isDone = !!timestamp;
    const isActive = o.status === step.key && !isDone;
    
    let className = 'timeline-item';
    if (isDone) className += ' done';
    if (isActive) className += ' active';
    if (isCanceled && !isDone) className += ' canceled';

    return `
      <li class="${className}">
        <div class="timeline-dot">${step.icon}</div>
        <div class="timeline-content">
          <div class="timeline-label">${step.label}</div>
          ${timestamp ? `<div class="timeline-time">${formatDT(timestamp)}</div>` : ''}
        </div>
      </li>
    `;
  }).join('');

  if (isCanceled) {
    timeline.innerHTML += `
      <li class="timeline-item canceled">
        <div class="timeline-dot">❌</div>
        <div class="timeline-content">
          <div class="timeline-label">Cancelado</div>
          ${o.canceledAt ? `<div class="timeline-time">${formatDT(o.canceledAt.toDate())}</div>` : ''}
        </div>
      </li>
    `;
  }
}

// ===== SNAPSHOT =====
let unsub = null;
(async function init() {
  const loading = showLoading('Carregando pedido...');
  
  try {
    const { db, ready } = await import('./server.js');
    try { await ready; } catch {}

    const ref = db.collection('orders').doc(orderId);

    loading.close();

    unsub = ref.onSnapshot({ includeMetadataChanges: true }, async (doc) => {
      if (!doc.exists) {
        await showModal('Pedido não encontrado', 'Este pedido não existe ou foi removido.');
        window.location.href = 'index.html';
        return;
      }

      const o = doc.data() || {};
      const meta = doc.metadata || {};

      // Status
      const statusBadge = document.getElementById('statusBadge');
      if (statusBadge) {
        statusBadge.textContent = humanStatus(o.status);
        statusBadge.className = 'status-badge ' + getStatusClass(o.status);
      }

      // Alert cancelamento
      const cancelAlert = document.getElementById('cancelAlert');
      if (cancelAlert) {
        cancelAlert.classList.toggle('show', o.status === 'canceled');
      }

      // Total
      const totalVal = o?.totals?.total ?? 0;
      const totalEl = document.getElementById('totalValue');
      if (totalEl) totalEl.textContent = moneyBR(totalVal);

      // Updated
      const updatedEl = document.getElementById('updatedAt');
      if (updatedEl) updatedEl.textContent = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

      // Timeline
      renderTimeline(o);

      // Items
      const items = Array.isArray(o.items) ? o.items : [];
      const itemsEl = document.getElementById('itemsList');
      if (itemsEl) {
        itemsEl.innerHTML = items.map(it => `
          <div class="item">
            <div class="item-info">
              <div class="item-name">${it.qty}× ${it.name}</div>
              <div class="item-details">${moneyBR(it.unitPrice)}/un</div>
            </div>
            <div class="item-price">${moneyBR(it.lineTotal || 0)}</div>
          </div>
        `).join('') || '<div style="color:var(--gray-500);font-size:14px">Nenhum item</div>';
      }

      // ACKs
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
          once(`cancel_alert_${orderId}`, () => {
            showModal('⚠️ Pedido Cancelado', 'Seu pedido foi cancelado pelo estabelecimento.', 'Entendi');
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
            console.warn('[status] ack failed:', e?.message);
          }
        }
      }
    }, err => {
      console.error('[status] snapshot error', err);
      once('snap_error', () => {
        showModal('Erro de Conexão', 'Não foi possível atualizar o status do pedido.', 'Entendi');
      });
    });
  } catch (e) {
    loading.close();
    await showModal('Erro', 'Não foi possível carregar o pedido. Verifique sua conexão.', 'Entendi');
    window.location.href = 'index.html';
  }
})();

window.addEventListener('beforeunload', () => { try { unsub && unsub(); } catch {} });

// ===== MEUS PEDIDOS =====
const btnMyOrders = document.getElementById('btnMyOrders');
const ordersList = document.getElementById('ordersList');

if (btnMyOrders && ordersList) {
  btnMyOrders.addEventListener('click', () => {
    ordersList.classList.toggle('show');
    if (ordersList.classList.contains('show')) {
      loadMyOrders();
    }
  });
}

async function loadMyOrders() {
  if (!ordersList) return;
  
  const loading = showLoading('Carregando pedidos...');
  
  try {
    const myOrders = JSON.parse(localStorage.getItem(LS_MY_ORDERS) || '[]');
    if (!myOrders.length) {
      loading.close();
      ordersList.innerHTML = '<div style="color:var(--gray-500);text-align:center;padding:20px">Nenhum pedido anterior</div>';
      return;
    }

    const { db } = await import('./server.js');
    const promises = myOrders.reverse().map(id => db.collection('orders').doc(id).get());
    const docs = await Promise.all(promises);

    loading.close();

    const html = docs.map(doc => {
      if (!doc.exists) return '';
      const o = doc.data();
      const st = o.status || 'new';
      const total = o?.totals?.total ?? 0;
      const isCurrent = doc.id === orderId;
      
      return `
        <div class="order-item ${isCurrent ? 'current' : ''}" onclick="window.location.href='status.html?id=${doc.id}'">
          <div class="order-item-header">
            <div class="order-item-id">#${doc.id.slice(0,8)} ${isCurrent ? '(atual)' : ''}</div>
            <span class="order-item-badge ${getStatusClass(st)}">${humanStatus(st)}</span>
          </div>
          <div class="order-item-footer">
            <span>${moneyBR(total)}</span>
            <span>${o.createdAt ? formatDT(o.createdAt.toDate()) : ''}</span>
          </div>
        </div>
      `;
    }).join('');

    ordersList.innerHTML = html || '<div style="color:var(--gray-500);text-align:center;padding:20px">Nenhum pedido encontrado</div>';
  } catch (e) {
    loading.close();
    console.error('Erro ao carregar pedidos:', e);
    ordersList.innerHTML = '<div style="color:var(--gray-500);text-align:center;padding:20px">Erro ao carregar pedidos</div>';
  }
}

// ===== NOTIFICAÇÕES PUSH =====
const btnPush = document.getElementById('enablePush');
if (btnPush) {
  btnPush.addEventListener('click', async () => {
    const loading = showLoading('Ativando notificações...');
    
    try {
      if (!('Notification' in window)) {
        loading.close();
        await showModal('Não Suportado', 'Seu navegador não suporta notificações.', 'Entendi');
        return;
      }

      if (Notification.permission === 'denied') {
        loading.close();
        await showModal('Permissão Negada', 'Você bloqueou as notificações. Ative nas configurações do navegador.', 'Entendi');
        return;
      }

      if (Notification.permission !== 'granted') {
        const perm = await Notification.requestPermission();
        if (perm !== 'granted') {
          loading.close();
          return;
        }
      }

      // Simula ativação (substitua por FCM token real)
      setTimeout(() => {
        loading.close();
        showModal('✅ Ativado!', 'Você receberá notificações sobre atualizações do pedido.', 'OK');
        btnPush.disabled = true;
        btnPush.textContent = '✅ Notificações Ativas';
      }, 1000);

    } catch (e) {
      loading.close();
      console.error('push error', e);
      await showModal('Erro', 'Não foi possível ativar as notificações.', 'Entendi');
    }
  });
}
