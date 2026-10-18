// Jeux de cas partagés du moteur d'édition (modules/edition/tests/cas) : lecture, données (fichier ou générées).
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const DOSSIER_TESTS = fileURLToPath(new URL('../../tests/', import.meta.url));

/** Données générées de façon déterministe (volume). */
export function generer({ lignes = 1000, groupes = 0 }) {
  const mots = ['dalle', 'béton', 'armé', 'treillis', 'soudé', 'coffrage', 'enduit', 'cloison', 'plâtre', 'isolant', 'laine', 'minérale', 'tuile', 'charpente', 'fermette', 'chape', 'carrelage', 'faïence', 'peinture', 'acrylique'];
  const res = [];
  for (let i = 0; i < lignes; i++) {
    const n = 3 + ((i * 7) % 23);
    const lib = Array.from({ length: n }, (_, k) => mots[(i * 3 + k * 5) % mots.length]).join(' ');
    const qte = ((i % 37) + 1) * 1.5;
    const pu = ((i * 13) % 997) / 10 + 1;
    res.push({ code: `E${String(i + 1).padStart(5, '0')}`, libelle: `Ligne ${i + 1} : ${lib}`, qte: String(qte), pu: pu.toFixed(2), montant: (Math.round(qte * pu * 100) / 100).toFixed(2),
      ...(groupes ? { groupe: `Lot ${String(Math.floor((i * groupes) / lignes) + 1).padStart(2, '0')}` } : {}) });
  }
  return { numero: 'VOL-0001', lignes: res };
}

export function lireCasEdition() {
  const dossier = DOSSIER_TESTS + 'cas/';
  return readdirSync(dossier).filter((f) => f.endsWith('.json')).sort().map((f) => {
    const cas = JSON.parse(readFileSync(dossier + f, 'utf8'));
    const donnees = cas.generer ? generer(cas.generer) : JSON.parse(readFileSync(DOSSIER_TESTS + cas.donnees, 'utf8'));
    return { ...cas, donnees };
  });
}
