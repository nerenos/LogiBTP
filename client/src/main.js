import '@logibtp/socle/ui/socle.css';
import '@logibtp/document/ui/document.css';
import '@logibtp/metre/ui/metre.css';
import './styles.css';
import { echapper, formatNombre } from '@logibtp/socle/ui';
import { Disposition } from '@logibtp/document/ui';
import { PanneauMetre } from '@logibtp/metre/ui';
import { VERSION_MOTEUR } from './calcul/index.js';
import { api, ErreurApi } from './app/api.js';
import { DEFINITION_DEMO, DOCUMENT_DEMO } from './app/demo.js';
import { EditeurDevisBtp, PressePapiersBtp, DictionnaireBtp } from './app/editeur-btp.js';
import { PanneauxBtp } from './app/panneaux-btp.js';

const $ = (s) => document.querySelector(s);
const etat = { disposition: null, enLigne: false, editeur: null, panneaux: null, metre: null, types: [], selection: null, ecarts: null, dernierEnvoi: null };

function message(texte, niveau = 'info') {
  const zone = $('#message');
  zone.textContent = texte;
  zone.className = `message ${niveau}`;
  clearTimeout(message.t);
  message.t = setTimeout(() => { zone.textContent = ''; zone.className = 'message'; }, 6000);
}

function erreur(e) {
  console.error(e);
  if (e instanceof ErreurApi) {
    const details = Array.isArray(e.details) ? ` : ${e.details.map((d) => d.message).join(' · ')}` : '';
    message(`${e.message}${details}`, 'erreur');
  } else message(e.message ?? String(e), 'erreur');
}

/** Contenu de saisie à partir d'un document complet renvoyé par l'API. */
const versSaisie = (d) => ({
  document: d.document,
  lignes: d.lignes,
  metres: d.metres ?? [],
  metre_lignes: d.metre_lignes ?? [],
  variables: d.variables ?? [],
});

async function ouvrir(definition, complet) {
  const zone = $('#grille');
  etat.panneaux = null;
  zone.replaceChildren();
  etat.editeur = new EditeurDevisBtp(zone, {
    definition,
    saisie: versSaisie(complet),
    surSelection: (id) => {
      etat.selection = id;
      etat.panneaux?.rendreDetail($('#detail'), id);
      etat.metre?.suivre(id); // le métré ouvert suit la ligne sélectionnée
    },
    surMessage: (t) => message(t),
    ouvrirMetre: (ligId, mtrId) => etat.metre.ouvrir(ligId, mtrId),
  });
  etat.panneaux = new PanneauxBtp(etat.editeur);
  etat.metre = new PanneauMetre($('#metre'), etat.editeur, {
    fermer: (ligId) => { etat.editeur.grille.selectionner(ligId, { colonne: 3 }); etat.editeur.grille.focus(); },
    message: (t) => message(t),
    dictionnaire: new DictionnaireBtp(etat.editeur),
  });
  etat.editeur.magasin.abonner(rafraichir);
  etat.ecarts = null;
  rafraichir();
  if (etat.disposition.p.onglet === 'lignes') etat.editeur.grille.focus();
}

function rafraichir() {
  const ed = etat.editeur;
  if (!ed) return;
  const p = etat.panneaux;
  p.rendreEntete($('#entete'));
  p.rendreDetail($('#detail'), etat.selection);
  p.rendreTotaux($('#totaux'), { compact: true });
  p.rendreTotaux($('#totaux-entete'));
  const d = ed.resultat.document;
  $('#resume').textContent = `${ed.saisie.document.ent_numero ?? ''} · ${ed.saisie.document.ent_objet ?? ''} · Net à payer ${formatNombre(d.ent_net_a_payer, ed.saisie.document.ent_precision_montant ?? 2)} €`;
  p.rendreMessages($('#controles'), (id) => ed.grille.selectionner(id));
  p.rendreEcarts($('#ecarts'), etat.ecarts, arbitrer);
  $('#annuler').disabled = ed.magasin.pile.length === 0;
  $('#retablir').disabled = ed.magasin.pileRefaire.length === 0;
  const statut = ed.definition.statuts?.find((s) => s.std_id === ed.saisie.document.ent_std_id);
  const modifiable = statut?.std_modifiable !== false && !ed.saisie.document.ent_verrouille;
  $('#enregistrer').disabled = !etat.enLigne || !modifiable;
  $('#valider').disabled = !etat.enLigne || !modifiable;
  $('#transformer').disabled = !etat.enLigne || !(ed.definition.transformations?.length);
  document.body.classList.toggle('lecture-seule', !modifiable);
}

// ------------------------------------------------------------------ documents

async function chargerListe(selection) {
  const docs = await api.documents();
  const liste = $('#documents');
  liste.innerHTML = docs.map((d) => {
    const type = etat.types.find((t) => t.tyd_id === d.ent_tyd_id);
    return `<option value="${d.ent_id}">${echapper(type?.tyd_code ?? '')} ${echapper(d.ent_numero ?? '#' + d.ent_id)} ${d.ent_indice !== 'A' ? `(${echapper(d.ent_indice)})` : ''} – ${echapper(d.ent_objet ?? '')}</option>`;
  }).join('');
  if (selection) liste.value = String(selection);
  return docs;
}

async function ouvrirDocument(id) {
  const complet = await api.document(id);
  const type = etat.types.find((t) => t.tyd_id === complet.document.ent_tyd_id);
  const definition = await api.definition(type.tyd_code);
  await ouvrir(definition, complet);
  $('#documents').value = String(id);
}

/** Premier lancement : crée un devis de démonstration dans la base. */
async function creerDemo() {
  const devis = etat.types.find((t) => t.tyd_code === 'V_DEVIS');
  const cree = await api.creer({ ent_tyd_id: devis.tyd_id, ent_tiers_id: 1, ent_objet: DOCUMENT_DEMO.document.ent_objet,
    ent_num_format: DOCUMENT_DEMO.document.ent_num_format });
  const contenu = new PressePapiersBtp().renumeroter({ racines: [], ...DOCUMENT_DEMO }, -1);
  for (const l of contenu.lignes) l.lig_origine_id = null;
  const definition = await api.definition('V_DEVIS');
  const ed = new EditeurDevisBtp(document.createElement('div'), {
    definition,
    saisie: { document: { ...cree.document, ent_proprietes: DOCUMENT_DEMO.document.ent_proprietes }, ...contenu },
  });
  const r = ed.resultat;
  await api.enregistrer(cree.document.ent_id, {
    document: r.document, lignes: r.lignes, metres: r.metres, metre_lignes: r.metre_lignes, variables: r.variables,
    version_moteur_client: VERSION_MOTEUR,
  });
  return cree.document.ent_id;
}

async function nouveau() {
  const code = $('#nouveau-type').value;
  const type = etat.types.find((t) => t.tyd_code === code);
  const cree = await api.creer({ ent_tyd_id: type.tyd_id, ent_tiers_id: 1, ent_objet: `Nouveau ${type.tyd_libelle.toLowerCase()}` });
  await chargerListe(cree.document.ent_id);
  await ouvrirDocument(cree.document.ent_id);
  message(`${type.tyd_libelle} ${cree.document.ent_numero ?? ''} créé`);
}

/**
 * Enregistrement en un seul appel : le client envoie ses résultats, le serveur recalcule, compare,
 * renvoie les ID définitifs et les écarts. La pile d'annulation est conservée.
 */
async function enregistrer() {
  const ed = etat.editeur;
  const r = ed.resultat;
  const envoi = {
    document: r.document, lignes: r.lignes, metres: r.metres, metre_lignes: r.metre_lignes, variables: r.variables,
    version_moteur_client: VERSION_MOTEUR,
  };
  const saisieEnvoyee = structuredClone(ed.entree(ed.saisie));
  const rep = await api.enregistrer(ed.saisie.document.ent_id, envoi);
  const map = (table, id) => (id === null || id === undefined ? id : table[id] ?? id);
  // Correspondances des compléments du module Métré, par table (réponse générique du module Document).
  const cl = rep.correspondance_lignes;
  const { metres: cm = {}, metre_lignes: cml = {}, variables: cv = {} } = rep.correspondances ?? {};
  ed.magasin.appliquerServeur((d) => {
    d.document = rep.document.document;
    for (const l of d.lignes) {
      l.lig_id = map(cl, l.lig_id);
      l.lig_parent_id = map(cl, l.lig_parent_id);
      l.lig_st_depuis_id = map(cl, l.lig_st_depuis_id);
      l.lig_variante_de_id = map(cl, l.lig_variante_de_id);
      l.lig_mtr_id = map(cm, l.lig_mtr_id);
      l.lig_ent_id = d.document.ent_id;
    }
    for (const m of d.metres) { m.mtr_id = map(cm, m.mtr_id); m.mtr_lig_id = map(cl, m.mtr_lig_id); }
    for (const x of d.metre_lignes) {
      x.mli_id = map(cml, x.mli_id); x.mli_mtr_id = map(cm, x.mli_mtr_id);
      x.mli_parent_id = map(cml, x.mli_parent_id); x.mli_st_depuis_id = map(cml, x.mli_st_depuis_id);
    }
    for (const v of d.variables) { v.var_id = map(cv, v.var_id); v.var_lig_id = map(cl, v.var_lig_id); v.var_mtr_id = map(cm, v.var_mtr_id); }
  });
  if (etat.selection !== null) etat.selection = map(cl, etat.selection);
  etat.editeur.grille.courant = map(cl, etat.editeur.grille.courant);
  etat.editeur.grille.selection = etat.editeur.grille.selection.map((id) => map(cl, id));
  etat.ecarts = rep.ecarts.length ? rep.ecarts : null;
  etat.dernierEnvoi = { entree: saisieEnvoyee, client: envoi, serveur: rep.document };
  rafraichir();
  message(rep.ecarts.length ? `Enregistré avec ${rep.ecarts.length} écart(s) de calcul à arbitrer` : `Enregistré (version ${rep.document.document.ent_version})`,
    rep.ecarts.length ? 'avertissement' : 'succes');
}

async function arbitrer(decision, commentaire) {
  const e = etat.dernierEnvoi;
  const rep = await api.casTest({
    ent_id: etat.editeur.saisie.document.ent_id, cas_decision: decision, cas_commentaire: commentaire || null,
    version_client: VERSION_MOTEUR, document_entree: e.entree, resultat_client: e.client, resultat_serveur: e.serveur, ecarts: etat.ecarts,
  });
  etat.ecarts = null;
  rafraichir();
  message(`Cas de test n° ${rep.cas_id} enregistré (${decision === 'S' ? 'serveur validé' : 'anomalie'})`, 'succes');
}

async function valider() {
  const ed = etat.editeur;
  if (ed.magasin.pile.length && !confirm('Le document doit d\'abord être enregistré. Enregistrer puis valider ?')) return;
  if (ed.magasin.pile.length) await enregistrer();
  const rep = await api.valider(ed.saisie.document.ent_id, ed.saisie.document.ent_version);
  await chargerListe(rep.document.document.ent_id);
  await ouvrirDocument(rep.document.document.ent_id);
  message(`Document validé : ${rep.document.document.ent_numero}`, 'succes');
}

async function transformer() {
  const ed = etat.editeur;
  const cibles = ed.definition.transformations.map((t) => etat.types.find((x) => x.tyd_id === t.tra_cible_tyd_id));
  const choix = prompt(`Transformer en (tout le reliquat) :\n${cibles.map((c, i) => `${i + 1}. ${c.tyd_libelle}`).join('\n')}`, '1');
  const cible = cibles[Number(choix) - 1];
  if (!cible) return;
  const rep = await api.transformer(ed.saisie.document.ent_id, { cible_tyd_id: cible.tyd_id, lignes: [] });
  await chargerListe(rep.document.ent_id);
  await ouvrirDocument(rep.document.ent_id);
  message(`${cible.tyd_libelle} ${rep.document.ent_numero ?? ''} créé`, 'succes');
}

// ------------------------------------------------------------------ démarrage

function brancher(id, f) {
  $(id).addEventListener('click', () => Promise.resolve(f()).catch(erreur));
}

async function demarrer() {
  etat.disposition = new Disposition({
    surOnglet: (o) => { if (o === 'lignes') etat.editeur?.grille.focus(); },
  });
  brancher('#enregistrer', enregistrer);
  brancher('#valider', valider);
  brancher('#transformer', transformer);
  brancher('#nouveau', nouveau);
  brancher('#annuler', () => etat.editeur?.magasin.annuler());
  brancher('#retablir', () => etat.editeur?.magasin.retablir());
  $('#documents').addEventListener('change', (e) => ouvrirDocument(Number(e.target.value)).catch(erreur));
  document.addEventListener('keydown', (e) => {
    // Alt+1 / Alt+2 : onglets Entête et Lignes.
    if (e.altKey && !e.ctrlKey && (e.key === '1' || e.key === '2' || e.code === 'Digit1' || e.code === 'Digit2')) {
      e.preventDefault();
      etat.disposition.onglet(e.code === 'Digit1' || e.key === '1' ? 'entete' : 'lignes');
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); if (!$('#enregistrer').disabled) enregistrer().catch(erreur); }
  });

  etat.enLigne = await api.disponible();
  document.body.classList.toggle('hors-ligne', !etat.enLigne);
  $('#mode').textContent = etat.enLigne ? 'API connectée' : 'Démo hors ligne (calcul local)';
  if (!etat.enLigne) {
    $('#barre-documents').hidden = true;
    await ouvrir(DEFINITION_DEMO, DOCUMENT_DEMO);
    return;
  }
  etat.types = await api.typesDocument();
  $('#nouveau-type').innerHTML = etat.types.map((t) => `<option value="${t.tyd_code}">${echapper(t.tyd_libelle)}</option>`).join('');
  let docs = await chargerListe();
  if (docs.length === 0) {
    await creerDemo();
    docs = await chargerListe();
  }
  await ouvrirDocument(docs[docs.length - 1].ent_id);
}

demarrer().catch(erreur);
