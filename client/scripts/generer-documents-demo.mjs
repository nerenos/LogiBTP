// Documents de démonstration créés par l'API (calcul, numérotation, liens et suivi réels) à partir du devis de démo :
// devis de projets, chaîne devis → commande → situation → facture d'avancement et bon de livraison (marché
// M-2026-002-1), achats (commande, réception, facture fournisseur), commande facturée en partie avec avoir (marché
// M-2026-003-1). L'API doit tourner (port 5080) ; la structure et l'annuaire de démonstration doivent être en base.
// Usage : node client/scripts/generer-documents-demo.mjs <host> <id du devis de démo>
//   base principale : localhost 2 ; base de démonstration : demo.localhost 1
import http from 'node:http';

const [hote, idDemo] = [process.argv[2] ?? 'localhost', Number(process.argv[3] ?? 2)];
const ENTETES = { 'Content-Type': 'application/json', 'X-Utilisateur': 'demo', 'X-Profil': 'ADMIN' };

function appel(methode, chemin, corps) {
  return new Promise((ok, ko) => {
    const donnees = corps === undefined ? null : JSON.stringify(corps);
    const req = http.request({ host: '127.0.0.1', port: 5080, path: `/api${chemin}`, method: methode,
      headers: { ...ENTETES, Host: `${hote}:5080`, ...(donnees ? { 'Content-Length': Buffer.byteLength(donnees) } : {}) } }, (r) => {
      let t = '';
      r.on('data', (c) => { t += c; });
      r.on('end', () => {
        const j = t ? JSON.parse(t) : null;
        if (r.statusCode >= 400) ko(new Error(`${methode} ${chemin} → ${r.statusCode} ${j?.code ?? ''} ${j?.title ?? t.slice(0, 200)} ${JSON.stringify(j?.details ?? '').slice(0, 300)}`));
        else ok(j);
      });
    });
    req.on('error', ko);
    if (donnees) req.write(donnees);
    req.end();
  });
}

const types = await appel('GET', '/types-document');
const tyd = (code) => types.find((t) => t.tyd_code === code).tyd_id;

/** Modification de l'entête (objet, tiers, date) par l'enregistrement du document. */
async function entete(id, valeurs) {
  const c = await appel('GET', `/documents/${id}`);
  Object.assign(c.document, valeurs);
  const r = await appel('PUT', `/documents/${id}`, c);
  return r.document?.document ?? r.document;
}
const rattacher = (id, r) => appel('PUT', `/structure/documents/${id}/rattachement`, r);
const valider = async (id) => {
  const c = await appel('GET', `/documents/${id}`);
  return appel('POST', `/documents/${id}/valider`, { ent_version: c.document.ent_version });
};
const id = (rep) => rep.document?.document?.ent_id ?? rep.document?.ent_id;

/** Transformation : toutes les lignes (part = 1) ou une partie (premières lignes de prix, quantité × part). */
async function transformer(source, cible, { part = 1, nb = null, avancement = null } = {}) {
  let lignes = [];
  if (part !== 1 || nb !== null || avancement !== null) {
    const suivi = await appel('GET', `/documents/${source}/suivi`);
    lignes = (nb ? suivi.slice(0, nb) : suivi).map((s) => ({
      lig_id: s.lig_id, ...(avancement !== null ? { avancement_pct: avancement } : { qte: Math.round(Number(s.qte ?? 1) * part * 100) / 100 || null }),
    }));
  }
  const rep = await appel('POST', `/documents/${source}/transformer`, { cible_tyd_id: tyd(cible), lignes });
  return id(rep);
}

async function copieDevis(objet, tiers, ratt, date, chantier) {
  const c = id(await appel('POST', `/documents/${idDemo}/copie`));
  // Chantier de la structure (rattachement) : la propriété libre « chantier » du devis copié est retirée.
  await entete(c, { ent_objet: objet, ent_tiers_id: tiers, ent_date: date, ent_validite_jours: 30, ent_proprietes: { chantier } });
  if (ratt) await rattacher(c, { ent_projet_id: null, ent_affaire_id: null, ent_chantier_id: null, ent_marche_id: null, ...ratt });
  return c;
}

const journal = [];
const etape = async (libelle, f) => { const r = await f(); journal.push(`${libelle} → ${r}`); return r; };

// Projet 4 (garage) et projet 3 (école) : devis en cours de chiffrage / offre remise.
await etape('Devis garage (brouillon)', () => copieDevis('Extension de l\'atelier poids lourds', 40, { ent_projet_id: 4 }, '2026-09-28', 'Atelier poids lourds – Vénissieux'));
const ecole = await etape('Devis école (validé)', () => copieDevis('Réhabilitation de l\'école – offre de base', 15, { ent_projet_id: 3 }, '2026-09-30', 'École de Belleroche'));
await valider(ecole);

// Résidence Les Érables, bâtiment A (marché M-2026-002-1) : devis → commande → livraisons, situations, factures ; achats.
const devisA = await etape('Devis bâtiment A', () => copieDevis('Résidence Les Érables – gros œuvre bâtiment A', 14, { ent_marche_id: 1 }, '2026-02-02', 'Résidence Les Érables – bâtiment A'));
await valider(devisA);
const cdeA = await etape('Commande bâtiment A', () => transformer(devisA, 'V_COMMANDE'));
await entete(cdeA, { ent_objet: 'Commande – gros œuvre bâtiment A', ent_date: '2026-02-10' });
await valider(cdeA);
const st1 = await etape('Situation n° 1 (30 %)', () => transformer(cdeA, 'V_SITUATION', { part: 0.3 }));
await entete(st1, { ent_objet: 'Situation n° 1 – avancement 30 %', ent_date: '2026-04-30' });
await valider(st1);
const fa1 = await etape('Facture d\'avancement n° 1', () => transformer(st1, 'V_FACTURE_AVT'));
await valider(fa1);
const bl1 = await etape('Bon de livraison (partiel)', () => transformer(cdeA, 'V_RECEPTION', { nb: 12, part: 0.5 }));
await entete(bl1, { ent_objet: 'Livraison préfabriqués – première partie', ent_date: '2026-05-12' });
await valider(bl1);
const cfA = await etape('Commande fournisseur béton', () => transformer(devisA, 'A_COMMANDE', { nb: 8 }));
await entete(cfA, { ent_objet: 'Béton et aciers – bâtiment A', ent_tiers_id: 24, ent_date: '2026-02-20' });
await valider(cfA);
const brA = await etape('Réception fournisseur', () => transformer(cfA, 'A_RECEPTION', { part: 0.6 }));
await valider(brA);
const ffA = await etape('Facture fournisseur', () => transformer(brA, 'A_FACTURE'));
await entete(ffA, { ent_objet: 'Facture Béton Lyonnais n° 2026-0412', ent_date: '2026-05-31' });
await valider(ffA);

// Bâtiment B (marché M-2026-003-1) : commande facturée en partie, avoir.
const devisB = await etape('Devis bâtiment B', () => copieDevis('Résidence Les Érables – gros œuvre bâtiment B', 14, { ent_marche_id: 2 }, '2026-03-18', 'Résidence Les Érables – bâtiment B'));
await valider(devisB);
const cdeB = await etape('Commande bâtiment B', () => transformer(devisB, 'V_COMMANDE'));
await valider(cdeB);
const facB = await etape('Facture (partielle)', () => transformer(cdeB, 'V_FACTURE', { nb: 20 }));
await entete(facB, { ent_objet: 'Facture – fondations bâtiment B', ent_date: '2026-06-15' });
await valider(facB);
const avB = await etape('Avoir', () => transformer(facB, 'V_AVOIR', { nb: 2 }));
await entete(avB, { ent_objet: 'Avoir – reprise de quantités fondations' });
await valider(avB);
const cfB = await etape('Commande fournisseur aciers (en cours)', () => transformer(devisB, 'A_COMMANDE', { nb: 5 }));
await entete(cfB, { ent_objet: 'Aciers HA – bâtiment B', ent_tiers_id: 22, ent_date: '2026-04-02' });

// Maison Martin (chantier CH-2026-001) : variante en brouillon.
await etape('Devis variante maison Martin', () => copieDevis('Extension maison individuelle – variante toiture terrasse', 18, { ent_chantier_id: 1 }, '2026-10-06', 'Maison Martin – Lyon'));

console.log(journal.join('\n'));
