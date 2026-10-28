import { TYPE_DOCUMENT } from '../codes.js';
import { echapper, creerCombo } from '@logibtp/socle/ui';
import { api } from '../api.js';

// Module Sous-traitance, lot 5 : assistant « Sous-traiter » d'une commande ou d'un devis client (ANALYSE § 5.1) :
// lignes sélectionnées dans la grille (titres compris : leurs lignes de prix) ou tout le reliquat, appel d'offres à un
// ou plusieurs sous-traitants (un document du même lot de consultation chacun) ou commande à un seul sous-traitant.
// Le serveur transforme le document (POST /api/structure/documents/{id}/sous-traiter) ; le premier créé s'ouvre.


/** Fenêtre de l'assistant ; rend les identifiants créés (null si abandon). */
export async function sousTraiter({ entId, selection = [], message }) {
  const sousTraitants = await api.sousTraitants();
  const dlg = document.createElement('dialog');
  dlg.className = 'dialogue-structure';
  dlg.innerHTML = `<form method="dialog" class="assistant-sous-traiter"><h3>🤝 Sous-traiter</h3>
    <p class="ligne"><label><input type="radio" name="portee" value="selection" ${selection.length ? 'checked' : 'disabled'}> Lignes sélectionnées (${selection.length})</label>
      <label><input type="radio" name="portee" value="tout" ${selection.length ? '' : 'checked'}> Tout le reliquat</label></p>
    <p class="ligne">Créer : <span data-cible></span></p>
    <p class="aide" data-aide></p>
    <p class="ligne"><input type="search" data-filtre placeholder="Filtrer les sous-traitants" size="30"></p>
    <div class="liste-choix" data-liste style="max-height: 16rem; overflow: auto">
      ${sousTraitants.length ? sousTraitants.map((s) => `<label class="ligne-choix"><input type="checkbox" value="${s.id}"> ${echapper(s.libelle)}</label>`).join('<br>')
        : '<span class="aide">Aucun sous-traitant dans l\'annuaire (relation « Sous-traitant »).</span>'}
    </div>
    <p class="ligne"><button type="button" class="principal" data-creer>Créer</button> <button value="annuler">Annuler</button></p></form>`;
  document.body.append(dlg);
  const cible = creerCombo({ vide: false, valeur: TYPE_DOCUMENT.T_AO, options: [{ valeur: TYPE_DOCUMENT.T_AO, libelle: 'Appel d\'offres de sous-traitance' }, { valeur: TYPE_DOCUMENT.T_COMMANDE, libelle: 'Commande de sous-traitance' }] });
  dlg.querySelector('[data-cible]').replaceWith(cible);
  const aide = () => {
    dlg.querySelector('[data-aide]').textContent = cible.resoudre() === TYPE_DOCUMENT.T_AO
      ? 'Un appel d\'offres par sous-traitant coché, dans le même lot de consultation (comparatif des offres).'
      : 'Une commande pour un seul sous-traitant ; elle se valide dans un marché de sous-traitance.';
  };
  cible.addEventListener('change', aide);
  cible.addEventListener('blur', aide);
  aide();
  dlg.querySelector('[data-filtre]').addEventListener('input', (e) => {
    const t = e.target.value.trim().toLowerCase();
    dlg.querySelectorAll('.ligne-choix').forEach((l) => { l.hidden = Boolean(t) && !l.textContent.toLowerCase().includes(t); });
  });
  return new Promise((resoudre) => {
    dlg.addEventListener('close', () => { dlg.remove(); resoudre(null); });
    dlg.querySelector('[data-creer]').addEventListener('click', async () => {
      const type = cible.resoudre();
      const sts = [...dlg.querySelectorAll('[data-liste] input:checked')].map((c) => Number(c.value));
      if (type === TYPE_DOCUMENT.T_COMMANDE && sts.length > 1) { message('Une commande de sous-traitance va à un seul sous-traitant', 'erreur'); return; }
      const lignes = dlg.querySelector('input[name="portee"]:checked')?.value === 'selection' ? selection : [];
      try {
        const r = await api.sousTraiter(entId, { cible: type, lignes, sous_traitants: sts });
        dlg.remove();
        resoudre(r.documents);
      } catch (e) { message(e.message, 'erreur'); }
    });
    dlg.showModal();
  });
}
