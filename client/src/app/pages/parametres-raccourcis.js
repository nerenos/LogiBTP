import { PageBase } from '@logibtp/navigation';
import { echapper, catalogueRaccourcis, combinaison, estModificateur, libelleTouches, conflitsRaccourci, personnaliserRaccourci, reinitialiserRaccourcis, confirmer } from '@logibtp/socle/ui';
import '../raccourcis.js';

/**
 * Raccourcis clavier : toutes les fonctions déclarées (grille des lignes, application, page document…), leurs touches
 * par défaut et celles de l'utilisateur. Personnalisation gardée dans ce navigateur (toutes les fenêtres), jamais en base.
 */
export class PageParametresRaccourcis extends PageBase {
  icone = '⌨';

  async ouvrir() {
    this.titre = 'Raccourcis clavier';
    this.rendre();
  }

  rendre() {
    const groupes = catalogueRaccourcis();
    this.conteneur.innerHTML = `<div class="page-parametres page-raccourcis">
      <h1 class="page-titre">⌨ Raccourcis clavier</h1>
      <p class="aide">« Modifier » puis appuyez sur la combinaison voulue (Échap : annuler). Une combinaison déjà prise dans le même écran
        (ou par toute l'application) est refusée ; prise dans un autre écran, elle est acceptée après confirmation.
        Le clic droit sur une ligne rappelle ces raccourcis. Évitez AltGr, Alt+Maj et Ctrl+N/T/W (réservés par le système ou le navigateur).</p>
      <p><button type="button" data-tout>↺ Tout remettre par défaut</button></p>
      ${groupes.map((g) => `<section class="carte"><h2>${echapper(g.libelle)}</h2>
        <table class="table-raccourcis tableau-compact largeur-contenu"><thead><tr><th>Fonction</th><th>Raccourci</th><th>Par défaut</th><th></th></tr></thead><tbody>
        ${g.actions.map((a) => `<tr data-groupe="${echapper(g.groupe)}" data-action="${echapper(a.action)}" class="${a.personnalise ? 'personnalise' : ''}">
          <td>${echapper(a.libelle)}</td>
          <td class="touches">${a.touches.map((t) => `<kbd>${echapper(libelleTouches(t))}</kbd>`).join(' ') || '<span class="aide">—</span>'}</td>
          <td class="aide">${a.defaut.map((t) => echapper(libelleTouches(t))).join(', ') || '—'}</td>
          <td class="actions"><button type="button" data-modifier>Modifier</button>
            <button type="button" data-aucun title="Aucun raccourci" ${a.touches.length ? '' : 'disabled'}>✕</button>
            <button type="button" data-defaut title="Revenir au raccourci par défaut" ${a.personnalise ? '' : 'disabled'}>↺</button></td></tr>`).join('')}
        </tbody></table></section>`).join('')}
    </div>`;
    this.conteneur.querySelector('[data-tout]').addEventListener('click', async () => {
      if (!await confirmer('Remettre tous les raccourcis par défaut ?')) return;
      reinitialiserRaccourcis();
      this.app.message('Raccourcis par défaut rétablis', 'succes');
      this.rendre();
    });
    this.conteneur.querySelectorAll('tr[data-action]').forEach((tr) => {
      const { groupe, action } = tr.dataset;
      tr.querySelector('[data-modifier]').addEventListener('click', (e) => this.#capturer(tr, groupe, action, e.currentTarget));
      tr.querySelector('[data-aucun]').addEventListener('click', () => { personnaliserRaccourci(groupe, action, []); this.rendre(); });
      tr.querySelector('[data-defaut]').addEventListener('click', () => { personnaliserRaccourci(groupe, action, null); this.rendre(); });
    });
  }

  /** Attente de la combinaison : la touche suivante (hors Ctrl, Maj, Alt seuls) devient le raccourci. */
  #capturer(tr, groupe, action, bouton) {
    this.arreterCapture?.();
    const zone = tr.querySelector('.touches');
    const avant = zone.innerHTML;
    zone.innerHTML = '<span class="capture">Appuyez sur la combinaison…</span>';
    bouton.textContent = 'Annuler';
    const fin = () => {
      document.removeEventListener('keydown', clavier, true);
      bouton.removeEventListener('click', annuler, true);
      this.arreterCapture = null;
    };
    const annuler = (e) => { e?.stopImmediatePropagation(); fin(); zone.innerHTML = avant; bouton.textContent = 'Modifier'; };
    const clavier = async (e) => {
      if (estModificateur(e)) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape' && !e.ctrlKey && !e.altKey && !e.shiftKey) { annuler(); return; }
      const touche = combinaison(e);
      const conflits = conflitsRaccourci(groupe, touche, action);
      const bloquants = conflits.filter((c) => c.bloquant);
      if (bloquants.length) {
        this.app.message(`${libelleTouches(touche)} est déjà utilisé par « ${bloquants[0].libelle} » (${bloquants[0].libelleGroupe})`, 'erreur');
        return;
      }
      fin();
      if (conflits.length && !await confirmer(`${libelleTouches(touche)} sert aussi à « ${conflits[0].libelle} » (${conflits[0].libelleGroupe}). L'utiliser quand même ?`)) {
        this.rendre();
        return;
      }
      personnaliserRaccourci(groupe, action, [touche]);
      this.app.message(`Raccourci ${libelleTouches(touche)} enregistré`, 'succes');
      this.rendre();
    };
    bouton.addEventListener('click', annuler, true);
    document.addEventListener('keydown', clavier, true);
    this.arreterCapture = annuler;
  }

  fermer() {
    this.arreterCapture?.();
  }
}
