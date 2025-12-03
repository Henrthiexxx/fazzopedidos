// users/keySync.js — utilitário para enviar chaves do localStorage ao Firestore

import { db } from './server.js'; // ✅ mesma pasta

const DEFAULT_PATH = { col: 'data', doc: 'keys' };

function safeParse(raw) {
  if (raw == null) return null;
  try { return JSON.parse(raw); } catch { return raw; }
}
function isEmptyValue(val) {
  if (val == null) return true;
  if (typeof val === 'string') return val.trim() === '';
  if (Array.isArray(val)) return val.length === 0;
  if (typeof val === 'object') return Object.keys(val).length === 0;
  return false;
}

export async function uploadKey(keyName, {
  fieldName,
  blockEmpty = true,
  path = DEFAULT_PATH,
  transform,
} = {}) {
  const raw = localStorage.getItem(keyName);
  const parsed = safeParse(raw);
  const value = typeof transform === 'function' ? transform(parsed) : parsed;
  const field = fieldName || keyName;

  const ref = db.collection(path.col).doc(path.doc);

  if (blockEmpty) {
    const snap = await ref.get();
    const current = snap.exists ? snap.data() : {};
    const existing = current[field];
    if (isEmptyValue(value) && !isEmptyValue(existing)) {
      console.warn(`[KeySync] Upload ignorado: valor vazio para '${field}' preservaria servidor.`);
      return { ok: false, skipped: true, reason: 'empty_overwrite_prevented' };
    }
  }

  await ref.set({ [field]: value }, { merge: true });
  console.log(`[KeySync] Enviado '${field}' para ${path.col}/${path.doc}`);
  return { ok: true, field };
}

export async function uploadMany(keys, opts) {
  const results = [];
  for (const k of keys) results.push(await uploadKey(k, opts));
  return results;
}

export function makeAutoUploader(keyName, { intervalMs = 60000, ...opts } = {}) {
  let stopped = false;
  async function tick() {
    if (stopped) return;
    try { await uploadKey(keyName, opts); }
    catch (e) { console.error('[KeySync] erro no upload:', e); }
    finally { if (!stopped) setTimeout(tick, intervalMs); }
  }
  setTimeout(tick, intervalMs);
  return function stop() { stopped = true; };
}

// Export default + expõe no window para testes no Console
const KeySync = { uploadKey, uploadMany, makeAutoUploader };
export default KeySync;
if (typeof window !== 'undefined') window.KeySync = KeySync;
