import { texte, texteHtml, iconeHtml } from '@logibtp/socle/dictionnaire';
import { TYPE_DOCUMENT } from '../codes.js';
import { echapper, creerCombo, ouvrirModale } from '@logibtp/socle/ui';
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
  dlg.innerHTML = `<form method="dialog" class="assistant-sous-traiter"><h3>${iconeHtml('sous_traitance_btp_sous_traiter')} ${texteHtml('sous_traitance_btp.assistant.titre')}</h3>
    <p class="ligne"><label><input type="radio" name="portee" value="selection" ${selection.length ? 'checked' : 'disabled'}> ${texteHtml('sous_traitance_btp.assistant.selection', { nombre: selection.length })}</label>
      <label><input type="radio" name="portee" value="tout" ${selection.length ? '' : 'checked'}> ${texteHtml('sous_traitance_btp.assistant.tout')}</label></p>
    <p class="ligne">${texteHtml('sous_traitance_btp.assistant.creer_titre')} <span data-cible></span></p>
    <p class="aide" data-aide></p>
    <p class="ligne"><input type="search" data-filtre placeholder="${texteHtml('sous_traitance_btp.assistant.filtre')}" size="30"></p>
    <div class="liste-choix" data-liste style="max-height: 16rem; overflow: auto">
      ${sousTraitants.length ? sousTraitants.map((s) => `<label class="ligne-choix"><input type="checkbox" value="${s.id}"> ${echapper(s.libelle)}</label>`).join('<br>')
        : `<span class="aide">${texteHtml('sous_traitance_btp.assistant.aucun')}</span>`}
    </div>
    <p class="ligne"><button type="button" class="principal" data-creer>${texteHtml('commun.creer')}</button> <button value="annuler">${texteHtml('commun.annuler')}</button></p></form>`;
  document.body.append(dlg);
  const cible = creerCombo({ vide: false, valeur: TYPE_DOCUMENT.T_AO, options: [{ valeur: TYPE_DOCUMENT.T_AO, libelle: texte('sous_traitance_btp.assistant.t_ao') }, { valeur: TYPE_DOCUMENT.T_COMMANDE, libelle: texte('sous_traitance_btp.assistant.t_commande') }] });
  dlg.querySelector('[data-cible]').replaceWith(cible);
  const aide = () => {
    dlg.querySelector('[data-aide]').textContent = cible.resoudre() === TYPE_DOCUMENT.T_AO
      ? texte('sous_traitance_btp.assistant.aide_ao')
      : texte('sous_traitance_btp.assistant.aide_commande');
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
      if (type === TYPE_DOCUMENT.T_COMMANDE && sts.length > 1) { message(texte('sous_traitance_btp.assistant.un_seul'), 'erreur'); return; }
      const lignes = dlg.querySelector('input[name="portee"]:checked')?.value === 'selection' ? selection : [];
      try {
        const r = await api.sousTraiter(entId, { cible: type, lignes, sous_traitants: sts });
        dlg.remove();
        resoudre(r.documents);
      } catch (e) { message(e.message, 'erreur'); }
    });
    ouvrirModale(dlg, () => dlg.close());
  });
}
