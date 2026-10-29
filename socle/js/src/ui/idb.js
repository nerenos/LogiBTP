// Magasin IndexedDB du navigateur (même origine, partagé entre fenêtres) : base ouverte le temps d'une opération.

/**
 * Opérations sur un magasin d'objets : `creer(db)` crée le magasin à la première ouverture (version 1) ;
 * renvoie `operation(mode, f)` où `f(magasin)` lance une requête dont le résultat est rendu à la fin de la transaction.
 */
export function magasinIdb(base, magasin, creer) {
  const ouvrir = () => new Promise((ok, ko) => {
    const r = indexedDB.open(base, 1);
    r.onupgradeneeded = () => creer(r.result);
    r.onsuccess = () => ok(r.result);
    r.onerror = () => ko(r.error);
  });
  return async function operation(mode, f) {
    const db = await ouvrir();
    try {
      return await new Promise((ok, ko) => {
        const tx = db.transaction(magasin, mode);
        const r = f(tx.objectStore(magasin));
        tx.oncomplete = () => ok(r?.result);
        tx.onerror = () => ko(tx.error);
      });
    } finally { db.close(); }
  };
}
