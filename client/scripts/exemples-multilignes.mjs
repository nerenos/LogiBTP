// Ajoute des libellés multilignes d'exemple au devis de démonstration (document 1), par un enregistrement
// normal de l'API : recalcul, contrôle des écarts et historisation.
import { calculerDocument } from '../src/calcul/index.js';

const API = process.env.LOGIBTP_API ?? 'http://localhost:5080/api';
const H = { 'Content-Type': 'application/json', 'X-Utilisateur': 'demo', 'X-Profil': 'ADMIN' };
const appel = async (m, u, b) => {
  const r = await fetch(API + u, { method: m, headers: H, body: b && JSON.stringify(b) });
  const t = await r.text();
  if (!r.ok) throw new Error(`${m} ${u} : ${r.status} ${t}`);
  return t ? JSON.parse(t) : null;
};

const id = Number(process.argv[2] ?? 1);
const complet = await appel('GET', `/documents/${id}`);
const definition = await appel('GET', '/types-document/V_DEVIS/definition');
const lignes = complet.lignes;
const par = (debut) => lignes.find((l) => (l.lig_libelle_brut ?? l.lig_libelle_html ?? '').startsWith(debut));

const exemples = [
  ['Dalle béton', '<p><b>Dalle béton armé ép. 15 cm</b></p><p>Béton C25/30 dosé à 350 kg/m³, treillis soudé ST25 compris.<br>Finition talochée, joints de retrait tous les 25 m².</p>'],
  ['Murs parpaings', 'Murs parpaings – {{@surface}} m²<br><i>Parpaings creux 20 × 20 × 50, chaînages horizontaux et verticaux compris</i>'],
  ['Fenêtre PVC 120', '<p>Fenêtre PVC 120 × 135 posée</p><ul><li>Double vitrage 4/16/4 argon, Uw 1,3</li><li>Oscillo-battant, poignée centrée</li><li>Pose en rénovation sur dormant existant</li></ul>'],
];
for (const [debut, html] of exemples) {
  const l = par(debut);
  if (l) l.lig_libelle_html = html;
  else console.warn(`Ligne « ${debut} » introuvable`);
}

// Ligne de texte en tête du premier titre (non numérotée, hors calcul).
const titre = lignes.filter((l) => l.lig_tyl_id === 1 && l.lig_parent_id === null).sort((a, b) => a.lig_ordre - b.lig_ordre)[0];
if (titre && !lignes.some((l) => (l.lig_libelle_html ?? '').includes('Conditions d\'exécution'))) {
  lignes.push({
    lig_id: -1, lig_ent_id: id, lig_parent_id: titre.lig_id, lig_ordre: 0, lig_tyl_id: 4,
    lig_libelle_html: '<p><b>Conditions d\'exécution</b></p><p>Accès chantier par la rue des Lilas.<br>Stationnement et évacuation des gravats à la charge de l\'entreprise.</p>',
    lig_qte_source: 'S', lig_coef_perte: 1, lig_coef_fg: 1, lig_coef_benef: 1, lig_coef_fa: 1, lig_coef_prorata: 1, lig_coef_remise: 1,
    lig_precision_qte: 2, lig_precision_pv: 2, lig_type_prix: 'V', lig_proprietes: {},
  });
}

const r = calculerDocument({
  document: complet.document, lignes, metres: complet.metres,
  variables: complet.variables, taux_tva: definition.taux_tva,
});
const rep = await appel('PUT', `/documents/${id}`, {
  document: r.document, lignes: r.lignes, metres: r.metres, variables: r.variables,
  version_moteur_client: r.version_moteur,
});
console.log(`Document ${id} enregistré en version ${rep.document.document.ent_version}, ${rep.ecarts.length} écart(s)`);
for (const l of rep.document.lignes.filter((x) => /<(p|br|ul)/.test(x.lig_libelle_html ?? ''))) {
  console.log(`- ${l.lig_id} : ${l.lig_libelle_html}`);
}
