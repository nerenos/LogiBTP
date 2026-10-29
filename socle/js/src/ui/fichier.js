// Fichiers produits dans le navigateur et proposés au téléchargement (export CSV, paquet JSON…).

/** Propose un contenu (texte ou Blob) au téléchargement sous ce nom. */
export function telechargerFichier(nom, contenu, type = 'application/octet-stream') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(contenu instanceof Blob ? contenu : new Blob([contenu], { type }));
  a.download = nom;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 60000);
}

/** Cellule CSV entre guillemets (guillemets doublés). */
export const celluleCsv = (v) => `"${String(v ?? '').replaceAll('"', '""')}"`;

/** Export CSV (texte ou lignes déjà formées, séparées par CRLF), précédé du BOM pour qu'Excel lise l'UTF-8. */
export function telechargerCsv(nom, contenu) {
  const texte = Array.isArray(contenu) ? contenu.join('\r\n') : String(contenu ?? '');
  telechargerFichier(nom, `﻿${texte}`, 'text/csv;charset=utf-8');
}
