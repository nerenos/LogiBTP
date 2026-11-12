// Jeu de démonstration de la facturation électronique (plans/facturation-electronique.md, lot 29), créé par l'API (règles,
// contrôles et journal réels) : module activé, plateforme simulée réglée (connecteur SIMULE, aucun accès extérieur),
// factures reçues importées depuis les exemples FNFE du module (Factur-X, CII, avoir LogiBTP) → pièces d'achat en
// brouillon, fiches provisoires des fournisseurs et chronologie ; factures de vente validées de la base émises (bouton
// « Émettre » : CII / Factur-X déposé, ou envoi habituel pour un particulier, un client étranger ou hors annuaire) ;
// relève des accusés et statuts ; périodes d'e-reporting du mois précédent préparées (transactions et paiements), à
// envoyer depuis l'onglet E-reporting. Une étape en échec est notée et le jeu continue.
// L'API doit tourner (port 5080) avec db/295 à db/305 appliqués et les documents de démonstration (generer-documents-demo.mjs).
// Usage : node client/scripts/generer-facture-electronique-demo.mjs [host]   (host par défaut : demo.localhost)
// Session : LOGIBTP_COMPTE (administrateur, défaut gerant) et LOGIBTP_MDP ; sans mot de passe, connexion de test.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { clientDemo } from './api-demo.mjs';

const hote = process.argv.slice(2).find((a) => !a.startsWith('--')) ?? 'demo.localhost';
const appel = clientDemo(hote);
const compte = process.env.LOGIBTP_COMPTE ?? 'gerant';
await (process.env.LOGIBTP_MDP
  ? appel('POST', '/auth/connexion', { identifiant: compte, mot_de_passe: process.env.LOGIBTP_MDP })
  : appel('POST', '/auth/test/connexion', { identifiant: compte }));

const journal = [];
/** Étape tolérante : une erreur est notée et le jeu continue (données partielles plutôt qu'aucune). */
async function etape(libelle, f) {
  try {
    const r = await f();
    journal.push(`✔ ${libelle}${r !== undefined ? ` → ${r}` : ''}`);
    return r;
  } catch (e) {
    journal.push(`✘ ${libelle} : ${e.message}`);
    return null;
  }
}

const exemples = fileURLToPath(new URL('../../modules/facture-electronique/tests/exemples/', import.meta.url));
const iso = (d) => d.toISOString().slice(0, 10);
const aujourdhui = new Date();
const moisPrecedent = new Date(Date.UTC(aujourdhui.getUTCFullYear(), aujourdhui.getUTCMonth() - 1, 1));

// ---------------------------------------------------------------- activation et plateforme simulée
await etape('Module Facturation électronique activé', async () => {
  await appel('PUT', '/modules/facture_electronique', { actif: true });
  return 'actif';
});
await etape('Plateforme simulée réglée', async () => {
  const p = await appel('GET', '/facture-electronique/parametres');
  await appel('PUT', '/facture-electronique/parametres', { ...p, actif: true, connecteur: 'SIMULE', adresse_flux: null, connexion_oauth: null });
  return 'connecteur SIMULE';
});
await etape('Émission automatique à la validation', async () => {
  await appel('PUT', '/facture-electronique/emission/option', { automatique: true });
  return 'activée';
});

// ---------------------------------------------------------------- factures reçues
const recues = [
  'factur-x/en16931/UC1_F202500003_00-INV_20250701_EN16931_FX.pdf',
  'cii/en16931/UC2_F202500004_00-INV_20250701_EN16931_FX_CII_Commentee.xml',
  'cii/en16931/UC5_F202500007_00-INV_20250702_EN16931_FX_CII_Commentee.xml',
  'logibtp/AVOIR_F202500011_EN16931_CII.xml',
];
for (const relatif of recues) {
  const nom = relatif.split('/').pop();
  await etape(`Facture reçue ${nom}`, async () => {
    const f = await appel('POST', '/facture-electronique/import', { nom, contenu: readFileSync(exemples + relatif).toString('base64') });
    return `flux ${f.id} ${f.etat}${f.id_element ? ` (pièce ${f.id_element})` : ''}`;
  });
}

// ---------------------------------------------------------------- factures émises
const emises = [];
for (const type of ['V_FACTURE', 'V_FACTURE_AVT', 'V_AVOIR']) {
  await etape(`Pièces validées ${type}`, async () => {
    const l = (await appel('GET', `/documents?type=${type}`)).filter((d) => d.ent_verrouille).slice(0, 3);
    emises.push(...l.map((d) => ({ id: d.ent_id, numero: d.ent_numero, type })));
    return `${l.length} retenue(s)`;
  });
}
for (const piece of emises) {
  await etape(`Émission ${piece.type} ${piece.numero ?? piece.id}`, async () => {
    const etat = await appel('GET', `/facture-electronique/documents/${piece.id}/envoi`);
    const e = etat.emettable ? await appel('POST', `/facture-electronique/documents/${piece.id}/envoi`) : etat;
    return `${e.etat ?? '—'}${e.motif ? ` (${e.motif})` : ''}${e.flux_id ? `, flux ${e.flux_id}` : ''}`;
  });
}

// ---------------------------------------------------------------- relève et e-reporting
await etape('Relève des accusés et statuts', async () => {
  await appel('POST', '/facture-electronique/releve');
  return 'faite (les statuts suivants arrivent au fil des passages de la tâche de fond)';
});
for (const nature of ['TRANSACTIONS', 'PAIEMENTS']) {
  await etape(`E-reporting ${nature} du ${iso(moisPrecedent)}`, async () => {
    const p = await appel('POST', '/facture-electronique/ereporting/periodes/preparation', { nature, jour: iso(moisPrecedent) });
    return `période ${p.id} ${p.etat}, ${p.envois.length} transmission(s), ${p.ecarts.length} écart(s)`;
  });
}

console.log(journal.join('\n'));
