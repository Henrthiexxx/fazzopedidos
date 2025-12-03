// server.js — Firebase + Sistema Universal de Sincronização

// Importa SDKs
import "https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js";
import "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore-compat.js";

// Configuração
const firebaseConfig = {
  apiKey: "AIzaSyDUK1fhIKDKKGtxbJ4eyVyfmwOmDiUWtNk",
  authDomain: "fazzopdv.firebaseapp.com",
  projectId: "fazzopdv"
};

// Inicializa
if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
export const db = firebase.firestore();

console.log("%c🔥 Firebase conectado (server.js)", "color:#4f7cff");

// ===============================
// 📦 SISTEMA UNIVERSAL DE KEYS
// ===============================

// Salva UMA chave no Firestore
export async function saveKey(keyName, value) {
  await db.collection("data").doc("keys").update({
    [keyName]: value
  });
  console.log("✔ Enviado para Firestore:", keyName);
}

// Carrega UMA chave do Firestore
export async function loadKey(keyName) {
  const doc = await db.collection("data").doc("keys").get();
  if (!doc.exists) return null;
  return doc.data()[keyName] ?? null;
}

// Carrega TODAS as chaves
export async function loadAllKeys() {
  const doc = await db.collection("data").doc("keys").get();
  return doc.exists ? doc.data() : {};
}

// Sincroniza automaticamente TODAS as chaves do localStorage → Firestore
export async function syncAllKeys() {
  const all = {};

  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    const value = JSON.parse(localStorage.getItem(key));
    all[key] = value;
  }

  await db.collection("data").doc("keys").set(all, { merge: true });

  console.log("🔄 Todas as chaves sincronizadas com o Firebase");
}
