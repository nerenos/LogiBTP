// Dépôt temporaire d'un import entre la page d'import et la fenêtre du devis importé (vérification avant création) :
// IndexedDB du navigateur (même origine, partagé entre fenêtres), fichier source compris. L'entrée est retirée à la
// création du devis ou à l'abandon ; les entrées de plus d'un jour sont purgées.

const BASE = 'logibtp-imports';
const MAGASIN = 'imports';
const UN_JOUR = 24 * 3600 * 1000;

function ouvrir() {
  return new Promise((ok, ko) => {
    const r = indexedDB.open(BASE, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(MAGASIN);
    r.onsuccess = () => ok(r.result);
    r.onerror = () => ko(r.error);
  });
}

async function operation(mode, f) {
  const db = await ouvrir();
  try {
    return await new Promise((ok, ko) => {
      const tx = db.transaction(MAGASIN, mode);
      const r = f(tx.objectStore(MAGASIN));
      tx.oncomplete = () => ok(r?.result);
      tx.onerror = () => ko(tx.error);
    });
  } finally { db.close(); }
}

/** Dépose un import : { format, nom_fichier, fichier (Blob), ... } ; renvoie le jeton à passer à la fenêtre. */
export async function deposerImport(entree) {
  const jeton = crypto.randomUUID();
  await operation('readwrite', (m) => {
    const cle = m.getAllKeys();
    cle.onsuccess = () => {
      // Purge des imports abandonnés.
      for (const k of cle.result) {
        const g = m.get(k);
        g.onsuccess = () => { if (!g.result || Date.now() - g.result.depose_le > UN_JOUR) m.delete(k); };
      }
    };
    return m.put({ ...entree, depose_le: Date.now() }, jeton);
  });
  return jeton;
}

export const lireImport = (jeton) => operation('readonly', (m) => m.get(jeton));
export const retirerImport = (jeton) => operation('readwrite', (m) => m.delete(jeton));
