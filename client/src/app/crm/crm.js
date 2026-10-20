import { echapper, htmlSur } from '@logibtp/socle/ui';
import { NATURES_NOTE, ETATS_NOTE, ETATS_CLOS } from '@logibtp/crm';
import { lireMail } from '@logibtp/ged';
import { api } from '../api.js';
import { individusSociete } from '../panneaux-btp.js';

// Outils communs des écrans du CRM (module CRM, ANALYSE-MODULE-CRM.md) : contexte de l'utilisateur, individus de notre
// société, libellés, échéances, saisie d'une note, courriel déposé, zone de texte mis en forme.

/** Contexte de l'utilisateur (individu, services, droits, types), lu une fois par fenêtre. */
export function contexteCrm(app) {
  app.contexteCrm ??= api.crm.contexte().catch((e) => { app.contexteCrm = null; throw e; });
  return app.contexteCrm;
}

/** Individus de notre société (responsables, destinataires) pour les combos, lus une fois par fenêtre. */
export async function individusCrm(app) {
  app.individusCrm ??= app.services().then((s) => individusSociete(s.annuaire));
  return app.individusCrm;
}

export const libelleNature = (code) => NATURES_NOTE.find((n) => n.valeur === code)?.libelle ?? code;
export const iconeNature = (code) => NATURES_NOTE.find((n) => n.valeur === code)?.icone ?? '•';
export const libelleEtat = (code) => ETATS_NOTE.find((e) => e.valeur === code)?.libelle ?? code;
export const estClose = (note) => ETATS_CLOS.includes(note.etat);

/** Date-heure locale lisible (sans les secondes). */
export function formatDateHeure(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.toLocaleDateString('fr-FR')} ${d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`;
}

/** Valeur d'un champ datetime-local pour une date ISO (heure locale). */
export function versChampDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const z = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}T${z(d.getHours())}:${z(d.getMinutes())}`;
}

/** Date ISO (UTC) d'un champ datetime-local ; vide → null. */
export const depuisChampDate = (v) => (v ? new Date(v).toISOString() : null);

/** Échéance d'une note : texte et classe (en retard si dépassée et note ouverte). */
export function echeanceNote(note) {
  if (!note.echeance) return { texte: '', classe: '' };
  const retard = !estClose(note) && new Date(note.echeance) < new Date();
  return { texte: formatDateHeure(note.echeance), classe: retard ? 'crm-retard' : '' };
}

/** Pastille d'état d'une note. */
export const pastilleEtat = (note) => `<span class="crm-etat crm-etat-${String(note.etat).toLowerCase()}">${echapper(libelleEtat(note.etat))}</span>`;

const COULEURS_RAPPEL = { ROUGE: 'Échu ou imminent', ORANGE: 'Bientôt', VERT: 'À venir' };

/** Pastille de couleur d'un rappel (rouge, orange, vert). */
export const pastilleRappel = (r) => (r.couleur ? `<span class="crm-pastille crm-pastille-${r.couleur.toLowerCase()}" title="${COULEURS_RAPPEL[r.couleur] ?? ''}"></span>` : '<span class="crm-pastille"></span>');

/** Description d'un rappel : à date, ou n jours avant l'échéance. */
export function libelleRappel(r, seuils = null) {
  if (r.type === 'DATE') return `Le ${formatDateHeure(r.quand)}`;
  const j = r.delai_jours ?? seuils?.orange;
  return `${j === null || j === undefined ? 'Avant' : `${j} j avant`} l'échéance${r.reference ? ` (${formatDateHeure(r.reference)})` : ''}`;
}

/** Lien HTML vers l'élément principal d'une note. */
export function lienElement(e) {
  if (!e) return '';
  const texte = `${e.icone ? `${e.icone} ` : ''}${echapper(e.libelle)}`;
  return e.url ? `<a href="${echapper(e.url)}">${texte}</a>` : texte;
}

/** Note à créer : valeurs par défaut (lien vers l'élément de départ). */
export function nouvelleSaisie({ nature = 'ACTION', etat = 'A_FAIRE', element = null, parent = null } = {}) {
  return {
    nature, etat, tno_id: null, srv_id: null, objet: '', message_html: null, responsable_id: null, echeance: null, parent_id: parent,
    prive: false, rgpd: false, dans_fil: false, liens: element ? [{ type_element: element.type, id_element: String(element.id), principal: true }] : [], destinataires: [],
  };
}

/** Saisie d'une note lue (détail du serveur) pour l'enregistrer de nouveau. */
export function saisieDeNote(d) {
  const n = d.note;
  return {
    nature: n.nature, etat: n.etat, tno_id: n.tno_id, srv_id: n.srv_id, objet: n.objet, message_html: n.message_html, responsable_id: n.responsable_id,
    echeance: n.echeance, parent_id: n.parent_id, prive: n.prive, rgpd: n.rgpd, dans_fil: n.dans_fil,
    liens: d.liens.map((l, i) => ({ type_element: l.type, id_element: l.id, principal: i === 0 })),
    destinataires: d.destinataires.map((x) => x.ind_id), maj_le: n.maj_le,
  };
}

/** Texte brut en HTML (paragraphes échappés). */
export const texteEnHtml = (texte) => String(texte ?? '').split(/\n{2,}/).map((p) => `<p>${echapper(p).replace(/\n/g, '<br>')}</p>`).join('');

/** Fichier courriel (.eml, .msg) ? */
export const estCourriel = (fichier) => /\.(eml|msg)$/i.test(fichier?.name ?? '');

/**
 * Note créée depuis un courriel déposé : objet, expéditeur et date dans le message, type COURRIEL, pour mémo ; le
 * fichier du courriel est rangé dans la GED de la note. Renvoie le détail de la note créée.
 */
export async function noteDepuisCourriel(app, fichier, element) {
  const mail = await lireMail(fichier);
  const ctx = await contexteCrm(app);
  const s = nouvelleSaisie({ etat: 'MEMO', element });
  s.tno_id = ctx.types.find((t) => t.code === 'COURRIEL')?.id ?? null;
  s.objet = (mail.objet || fichier.name).slice(0, 200);
  s.message_html = `<p><b>De :</b> ${echapper(mail.de)}${mail.a ? `<br><b>À :</b> ${echapper(mail.a)}` : ''}${mail.date ? `<br><b>Date :</b> ${echapper(formatDateHeure(mail.date))}` : ''}</p>${texteEnHtml(mail.message)}`;
  const d = await api.crm.creer(s);
  const { ged } = await app.services();
  await ged.deposer({ fichier, nom_fichier: fichier.name, meta: { titre: s.objet, categorie: 'crm', type_element: 'crm_note', id_element: String(d.note.id), date_document: mail.date?.slice(0, 10) ?? null } });
  return d;
}

/**
 * Zone de texte mis en forme (gras, italique, souligné, listes) : contenteditable, HTML relu par htmlSur (même liste
 * blanche que le serveur). Renvoie { element, valeur() }.
 */
export function zoneRiche(html, { lecture = false, surChange = () => {} } = {}) {
  const div = document.createElement('div');
  div.className = 'crm-riche';
  div.innerHTML = `${lecture ? '' : `<div class="crm-riche-outils" role="toolbar">
    <button type="button" data-cmd="bold" title="Gras (Ctrl+B)"><b>G</b></button><button type="button" data-cmd="italic" title="Italique (Ctrl+I)"><i>I</i></button>
    <button type="button" data-cmd="underline" title="Souligné (Ctrl+U)"><u>S</u></button><button type="button" data-cmd="insertUnorderedList" title="Liste à puces">• ≡</button>
    <button type="button" data-cmd="insertOrderedList" title="Liste numérotée">1. ≡</button><button type="button" data-cmd="removeFormat" title="Effacer la mise en forme">⌫</button></div>`}
    <div class="crm-riche-texte" ${lecture ? '' : 'contenteditable="true"'}>${htmlSur(html ?? '')}</div>`;
  const texte = div.querySelector('.crm-riche-texte');
  div.querySelectorAll('[data-cmd]').forEach((b) => b.addEventListener('mousedown', (e) => {
    e.preventDefault();
    document.execCommand(b.dataset.cmd);
    surChange();
  }));
  texte.addEventListener('input', () => surChange());
  return { element: div, valeur: () => { const h = htmlSur(texte.innerHTML).trim(); return h && texte.textContent.trim() ? h : null; } };
}
