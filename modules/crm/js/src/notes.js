// Notes du CRM (ANALYSE-MODULE-CRM.md, § 2.3, C2 à C17, C24, C28), contrôle répliqué dans ReglesNote.cs
// (jeu modules/crm/tests/cas/01_note.json).
//
// Une note est une action, un message ou une tâche. Une tâche a un responsable (individu) ou un service qui la prendra,
// et une échéance ; un message a au moins un destinataire, sauf une réponse dans un fil. Une note privée ou de données
// personnelles (RGPD) ne paraît jamais dans le fil d'actualité.

export const NATURES_NOTE = [
  { valeur: 'ACTION', libelle: 'Action', icone: '⚡' },
  { valeur: 'MESSAGE', libelle: 'Message', icone: '💬' },
  { valeur: 'TACHE', libelle: 'Tâche', icone: '☑' },
];

export const ETATS_NOTE = [
  { valeur: 'A_FAIRE', libelle: 'À faire' },
  { valeur: 'EN_COURS', libelle: 'En cours' },
  { valeur: 'TERMINE', libelle: 'Terminé' },
  { valeur: 'MEMO', libelle: 'Pour mémo' },
  { valeur: 'ANNULEE', libelle: 'Annulée' },
];

/** États qui sortent une note des listes de travail et des rappels. */
export const ETATS_CLOS = ['TERMINE', 'MEMO', 'ANNULEE'];

export const LONGUEUR_OBJET = 200;

const vide = (v) => v === null || v === undefined || String(v).trim() === '';

/**
 * Erreurs d'une note (codes, dans cet ordre) : NOTE_NATURE, NOTE_ETAT, NOTE_OBJET, NOTE_RESPONSABLE, NOTE_ECHEANCE,
 * NOTE_DESTINATAIRE, NOTE_PRIVEE_FIL, NOTE_RGPD_FIL.
 * note : { nature, etat, objet, responsable_id, srv_id, echeance, destinataires: [ind_id], parent_id, prive, rgpd, dans_fil }.
 */
export function controlerNote(note) {
  const erreurs = [];
  if (!NATURES_NOTE.some((n) => n.valeur === note.nature)) erreurs.push('NOTE_NATURE');
  if (!ETATS_NOTE.some((e) => e.valeur === note.etat)) erreurs.push('NOTE_ETAT');
  if (vide(note.objet) || String(note.objet).trim().length > LONGUEUR_OBJET) erreurs.push('NOTE_OBJET');
  if (note.nature === 'TACHE') {
    if (vide(note.responsable_id) && vide(note.srv_id)) erreurs.push('NOTE_RESPONSABLE');
    if (vide(note.echeance)) erreurs.push('NOTE_ECHEANCE');
  }
  if (note.nature === 'MESSAGE' && vide(note.parent_id) && !(note.destinataires ?? []).length) erreurs.push('NOTE_DESTINATAIRE');
  if (note.dans_fil && note.prive) erreurs.push('NOTE_PRIVEE_FIL');
  if (note.dans_fil && note.rgpd) erreurs.push('NOTE_RGPD_FIL');
  return erreurs;
}

/** Libellés des erreurs de controlerNote. */
export const MESSAGES_NOTE = {
  NOTE_NATURE: 'Nature inconnue (action, message ou tâche)',
  NOTE_ETAT: 'État inconnu',
  NOTE_OBJET: `Objet obligatoire (${LONGUEUR_OBJET} caractères au plus)`,
  NOTE_RESPONSABLE: 'Une tâche a un responsable, ou un service qui la prendra',
  NOTE_ECHEANCE: 'Une tâche a une échéance',
  NOTE_DESTINATAIRE: 'Un message a au moins un destinataire',
  NOTE_PRIVEE_FIL: 'Une note privée ne paraît pas dans le fil d\'actualité',
  NOTE_RGPD_FIL: 'Une note de données personnelles ne paraît pas dans le fil d\'actualité',
};
