import { echapper } from '@logibtp/socle/ui';

/**
 * Erreurs et avertissements des scripts d'un résultat de l'hôte (resultat.scripts), dans l'ordre des scripts :
 * [{ gravite, ligId, lig_id, mtrId, ligne, colonne, code, message }] (aussi source du panneau des notifications de l'hôte).
 */
export function messagesMetres(resultat) {
  const res = [];
  for (const s of resultat?.scripts ?? []) {
    for (const e of s.erreurs ?? []) res.push({ gravite: 'erreur', ligId: s.lig_id, lig_id: s.lig_id, mtrId: s.mtr_id, ...e });
    for (const a of s.avertissements ?? []) res.push({ gravite: 'avertissement', ligId: s.lig_id, lig_id: s.lig_id, mtrId: s.mtr_id, ...a });
  }
  return res;
}

/**
 * Notifications des métrés, comme dans un IDE : toutes les erreurs et tous les avertissements des scripts du document
 * (ligne de l'hôte, position dans le script, message), dans l'ordre des lignes. Un clic ouvre le métré à l'erreur.
 * Les erreurs ne bloquent ni la saisie ni l'enregistrement.
 *
 * hote : { magasin, saisie.metres, resultat.lignes, resultat.scripts ([{ mtr_id, lig_id, erreurs, avertissements }]),
 *          titreLigne(ligId) } ;
 * options : ouvrir(ligId, mtrId, { ligne, colonne }), surCompte({ erreurs, avertissements }).
 */
export class NotificationsMetre {
  constructor(racine, hote, { ouvrir, surCompte } = {}) {
    this.racine = racine;
    this.hote = hote;
    this.ouvrir = ouvrir;
    this.surCompte = surCompte;
    racine.classList.add('notifications-metre');
    hote.magasin.abonner(() => this.rendre());
    this.rendre();
  }

  /** Messages : { gravite 'erreur' | 'avertissement', ligId, mtrId, ligne, colonne, code, message }. */
  messages() {
    const rang = new Map((this.hote.resultat.lignes ?? []).map((l, i) => [l.lig_id, i]));
    return messagesMetres(this.hote.resultat).sort((a, b) => ((rang.get(a.ligId) ?? 0) - (rang.get(b.ligId) ?? 0))
      || (a.gravite === b.gravite ? 0 : a.gravite === 'erreur' ? -1 : 1) || ((a.ligne ?? 0) - (b.ligne ?? 0)));
  }

  rendre() {
    const messages = this.messages();
    const erreurs = messages.filter((m) => m.gravite === 'erreur').length;
    this.surCompte?.({ erreurs, avertissements: messages.length - erreurs });
    this.racine.innerHTML = messages.length ? `<ul>${messages.map((m, i) => `<li>
        <button type="button" class="${m.gravite}" data-message="${i}" title="Ouvrir le métré à cette position">
          <span class="icone">${m.gravite === 'erreur' ? '⛔' : '⚠'}</span>
          <span class="ligne">${echapper(this.hote.titreLigne(m.ligId).trim())}</span>
          ${m.ligne ? `<code>${m.ligne}:${m.colonne}</code>` : ''}
          <span class="message">${echapper(m.message)}</span>
        </button></li>`).join('')}</ul>`
      : '<p class="aide">Aucune erreur ni avertissement dans les métrés du document.</p>';
    this.racine.querySelectorAll('[data-message]').forEach((b) => b.addEventListener('click', () => {
      const m = messages[Number(b.dataset.message)];
      this.ouvrir?.(m.ligId, m.mtrId, m.ligne ? { ligne: m.ligne, colonne: m.colonne } : null);
    }));
  }
}
