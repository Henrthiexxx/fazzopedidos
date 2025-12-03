// users/keyFetch.js — leitor simples do Firestore (v8) + download
// Requer: firebase v8 + firestore já carregados na página
//   <script src="https://www.gstatic.com/firebasejs/8.10.1/firebase-app.js"></script>
//   <script src="https://www.gstatic.com/firebasejs/8.10.1/firebase-firestore.js"></script>
// Uso rápido:
//   import { getKey, downloadKey, watchKey, getProdutosAtivos } from './users/keyFetch.js';
//   const arr = await getProdutosAtivos();
//   await downloadKey('produtos', 'produtos.json');
//   const stop = watchKey('produtos', (val)=>console.log('mudou', val));

const DEFAULT_PATH = { col: 'data', doc: 'keys' };

function ensureFirestore(){
  if (!window.firebase || !firebase.firestore) {
    throw new Error('[keyFetch] Firebase Firestore v8 não carregado. Inclua firebase-firestore.js');
  }
  return firebase.firestore();
}

function normalize(raw){
  // Aceita array | objeto/map | string JSON | itens stringificados
  if (raw == null) return [];
  let x = raw;
  if (typeof x === 'string') {
    const s = x.trim();
    try { x = JSON.parse(s); }
    catch {
      try { x = JSON.parse('[' + s.replace(/}\s*[\n,]?\s*\{/g, '},{') + ']'); }
      catch { return []; }
    }
  }
  let arr = Array.isArray(x) ? x : (x && typeof x === 'object' ? Object.values(x) : []);
  arr = arr.map(it => typeof it === 'string' ? (()=>{ try{return JSON.parse(it)}catch{return null} })() : it).filter(Boolean);
  return arr;
}

export async function getKey(fieldName, { path = DEFAULT_PATH } = {}){
  const db = ensureFirestore();
  const ref = db.collection(path.col).doc(path.doc);
  const snap = await ref.get();
  const data = snap.exists ? snap.data() : {};
  return normalize(data[fieldName]);
}

export async function downloadKey(fieldName, filename = `${fieldName}.json`, opts = {}){
  const val = await getKey(fieldName, opts);
  const blob = new Blob([JSON.stringify(val, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(a.href), 0);
  return { ok:true, count: Array.isArray(val) ? val.length : 0 };
}

export function watchKey(fieldName, cb, { path = DEFAULT_PATH } = {}){
  const db = ensureFirestore();
  const ref = db.collection(path.col).doc(path.doc);
  const unsub = ref.onSnapshot(doc => {
    const data = doc.exists ? doc.data() : {};
    cb(normalize(data[fieldName]), data);
  }, err => console.error('[keyFetch] snapshot error', err));
  return unsub;
}

// Helpers específicos de produtos
function isActive(p){
  if(!p) return false;
  if ('ativo' in p) {
    const v = p.ativo;
    if (v === true || v === 1 || v === 'true' || v === '1') return true;
    if (v === false || v === 0 || v === 'false' || v === '0') return false;
  }
  if ('status' in p) {
    const s = String(p.status).toLowerCase();
    if (['ativo','active','on'].includes(s)) return true;
    if (['inativo','inactive','off'].includes(s)) return false;
  }
  return false;
}

export async function getProdutosAtivos(opts){
  const arr = await getKey('produtos', opts);
  return arr.filter(isActive);
}

// Export default utilitário
const KeyFetch = { getKey, downloadKey, watchKey, getProdutosAtivos };
export default KeyFetch;
if (typeof window !== 'undefined') window.KeyFetch = KeyFetch;