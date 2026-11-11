// Module Facturation électronique, statut posé par l'utilisateur (lot 13) : fenêtre du socle (<dialog>) qui demande le
// motif (combo de la liste autorisée du statut, obligatoire selon BR-FR-CDV-15) et un commentaire (note du CDAR), puis
// appel de POST /flux/{id}/statut. Le serveur contrôle l'enchaînement (ReglesCycleVie) et écrit le CDAR mis en file.
import { texte } from '@logibtp/socle/dictionnaire';
import { ouvrirDialogue, creerCombo, echapper } from '@logibtp/socle/ui';
import { motifsProposes, demandeStatutValable, LONGUEUR_COMMENTAIRE_STATUT } from './modeles.js';

/** Libellé « code libellé » d'un statut du cycle de vie. */
export const libelleStatut = (code) => texte('facture_electronique.statut_code', { code, libelle: texte(`facture_electronique.statuts.${code}`) });

/**
 * Fenêtre de saisie d'un statut à poser sur la facture d'un flux (sens du flux : In / Out) : rend { code, motif,
 * commentaire } ou null (annulé). Valider reste grisé tant que la demande n'est pas valable (demandeStatutValable).
 */
export function demanderStatut(code, { sensFlux, numero = '' } = {}) {
  const { motifs, obligatoire } = motifsProposes(sensFlux, code);
  let combo = null;
  const lire = (d) => ({
    code,
    motif: combo?.valeurCombo ? combo.valeurCombo : null,
    commentaire: d.querySelector('[data-commentaire]').value.trim() || null,
  });
  return ouvrirDialogue({
    titre: texte('facture_electronique.statut_pose.titre', { statut: libelleStatut(code), numero }),
    classe: 'fe-dialogue-statut',
    html: `<p class="dialogue-message">${echapper(texte(`facture_electronique.statut_pose.aide_${obligatoire ? 'motif_obligatoire' : 'motif_facultatif'}`))}</p>
      ${motifs.length ? `<label class="dialogue-saisie">${echapper(texte('facture_electronique.statut_pose.motif'))}<span data-motif></span></label>` : ''}
      <label class="dialogue-saisie">${echapper(texte('facture_electronique.statut_pose.commentaire'))}
        <textarea data-commentaire rows="3" maxlength="${LONGUEUR_COMMENTAIRE_STATUT}"></textarea></label>`,
    boutons: [
      { libelle: texte('commun.annuler'), valeur: null },
      { libelle: texte('facture_electronique.statut_pose.poser'), valeur: lire, principal: true },
    ],
    focus: motifs.length ? '[data-motif] .combo' : '[data-commentaire]',
    construire: (d) => {
      if (motifs.length) {
        combo = creerCombo({ options: motifs.map((m) => ({ valeur: m, libelle: `${m} ${texte(`facture_electronique.motifs_statut.${m}`)}` })), vide: !obligatoire, valeur: '' });
        d.querySelector('[data-motif]').append(combo);
      }
      const bouton = d.querySelector('.principal');
      const maj = () => { bouton.disabled = !demandeStatutValable(sensFlux, lire(d)); };
      d.addEventListener('change', maj);
      d.addEventListener('input', maj);
      maj();
    },
  });
}
