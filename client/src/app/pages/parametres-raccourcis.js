import { texte, texteHtml, icone, iconeHtml } from '@logibtp/socle/dictionnaire';
import { PageBase } from '@logibtp/navigation';
import { echapper, catalogueRaccourcis, combinaison, estModificateur, libelleTouches, conflitsRaccourci, personnaliserRaccourci, reinitialiserRaccourcis, confirmer } from '@logibtp/socle/ui';
import '../raccourcis.js';

/**
 * Raccourcis clavier : toutes les fonctions déclarées (grille des lignes, application, page document…), leurs touches
 * par défaut et celles de l'utilisateur. Personnalisation gardée dans ce navigateur (toutes les fenêtres), jamais en base.
 */
export class PageParametresRaccourcis extends PageBase {
  icone = icone('parametres_btp_raccourcis');

  async ouvrir() {
    this.titre = texte('parametres_btp.general.raccourcis.titre');
    this.rendre();
  }

  rendre() {
    const groupes = catalogueRaccourcis();
    this.conteneur.innerHTML = `<div class="page-parametres page-raccourcis">
      <h1 class="page-titre">${iconeHtml('parametres_btp_raccourcis')} ${texteHtml('parametres_btp.general.raccourcis.titre')}</h1>
      <p class="aide">${texteHtml('parametres_btp.raccourcis.aide')}</p>
      <p><button type="button" data-tout>${iconeHtml('parametres_btp_retablir')} ${texteHtml('parametres_btp.raccourcis.tout')}</button></p>
      ${groupes.map((g) => `<section class="carte"><h2>${echapper(g.libelle)}</h2>
        <table class="table-raccourcis tableau-compact largeur-contenu"><thead><tr><th>${texteHtml('parametres_btp.raccourcis.fonction')}</th><th>${texteHtml('parametres_btp.raccourcis.raccourci')}</th><th>${texteHtml('parametres_btp.raccourcis.defaut')}</th><th></th></tr></thead><tbody>
        ${g.actions.map((a) => `<tr data-groupe="${echapper(g.groupe)}" data-action="${echapper(a.action)}" class="${a.personnalise ? 'personnalise' : ''}">
          <td>${echapper(a.libelle)}</td>
          <td class="touches">${a.touches.map((t) => `<kbd>${echapper(libelleTouches(t))}</kbd>`).join(' ') || '<span class="aide">—</span>'}</td>
          <td class="aide">${a.defaut.map((t) => echapper(libelleTouches(t))).join(', ') || '—'}</td>
          <td class="actions"><button type="button" data-modifier>${texteHtml('commun.modifier')}</button>
            <button type="button" data-aucun title="${texteHtml('parametres_btp.raccourcis.aucun')}" ${a.touches.length ? '' : 'disabled'}>${iconeHtml('retirer')}</button>
            <button type="button" data-defaut title="${texteHtml('parametres_btp.raccourcis.revenir')}" ${a.personnalise ? '' : 'disabled'}>${iconeHtml('parametres_btp_retablir')}</button></td></tr>`).join('')}
        </tbody></table></section>`).join('')}
    </div>`;
    this.conteneur.querySelector('[data-tout]').addEventListener('click', async () => {
      if (!await confirmer(texte('parametres_btp.raccourcis.tout_confirmer'))) return;
      reinitialiserRaccourcis();
      this.app.message(texte('parametres_btp.raccourcis.retablis'), 'succes');
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
    zone.innerHTML = `<span class="capture">${texteHtml('parametres_btp.raccourcis.capture')}</span>`;
    bouton.textContent = texte('commun.annuler');
    const fin = () => {
      document.removeEventListener('keydown', clavier, true);
      bouton.removeEventListener('click', annuler, true);
      this.arreterCapture = null;
    };
    const annuler = (e) => { e?.stopImmediatePropagation(); fin(); zone.innerHTML = avant; bouton.textContent = texte('commun.modifier'); };
    const clavier = async (e) => {
      if (estModificateur(e)) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape' && !e.ctrlKey && !e.altKey && !e.shiftKey) { annuler(); return; }
      const touche = combinaison(e);
      const conflits = conflitsRaccourci(groupe, touche, action);
      const bloquants = conflits.filter((c) => c.bloquant);
      if (bloquants.length) {
        this.app.message(texte('parametres_btp.raccourcis.pris', { touches: libelleTouches(touche), fonction: bloquants[0].libelle, groupe: bloquants[0].libelleGroupe }), 'erreur');
        return;
      }
      fin();
      if (conflits.length && !await confirmer(texte('parametres_btp.raccourcis.conflit', { touches: libelleTouches(touche), fonction: conflits[0].libelle, groupe: conflits[0].libelleGroupe }))) {
        this.rendre();
        return;
      }
      personnaliserRaccourci(groupe, action, [touche]);
      this.app.message(texte('parametres_btp.raccourcis.enregistre', { touches: libelleTouches(touche) }), 'succes');
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
