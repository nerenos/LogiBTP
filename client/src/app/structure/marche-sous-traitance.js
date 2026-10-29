import { aujourdhui } from '@logibtp/socle';
import { echapper, formatNombre, creerCombo, alerter, ouvrirModale } from '@logibtp/socle/ui';
import { codeMarche } from '../fiches/fiche-structure.js';

// Validation d'une commande de sous-traitance (ANALYSE-MODULE-SOUS-TRAITANCE.md ST2, ST4, ST5, ST14) : le marché de
// sous-traitance est obligatoire. Avant la validation, l'utilisateur rattache la commande comme avenant d'un marché de
// ce sous-traitant sur le chantier (un marché par axe de facturation) ou crée un nouveau marché : marché de vente lié
// (facultatif), nature reprise du marché de vente (publique ou privée), garantie selon la nature, montant agréé.

const ouverts = (liste) => liste.filter((x) => !['SOLDE', 'RESILIE'].includes(x.statut));
const GARANTIES = {
  U: [{ valeur: 'PAIEMENT_DIRECT', libelle: 'Paiement direct' }, { valeur: 'AUCUNE', libelle: 'Aucune (sous le seuil)' }],
  P: [{ valeur: 'CAUTION', libelle: 'Caution' }, { valeur: 'DELEGATION', libelle: 'Délégation de paiement' }, { valeur: 'AUCUNE', libelle: 'Aucune' }],
};

/**
 * Ouvre le dialogue ; résout { ent_marche_id, cree } ou null (abandon). refs : référentiels de la structure ; doc :
 * entête de la commande (sous-traitant et chantier obligatoires) ; creerMarche(valeurs) → { id }.
 */
export async function proposerMarcheSousTraitance({ refs, doc, totalHt, nomTiers = '', creerMarche }) {
  const chantier = (refs.chantiers ?? []).find((c) => c.id === doc.ent_chantier_id);
  if (!chantier || !doc.ent_tiers_id) {
    await alerter('Commande de sous-traitance : choisissez le sous-traitant (intervenant) et le chantier (rattachement) avant de la valider.');
    return Promise.resolve(null);
  }
  const marches = refs.marches ?? [];
  const axes = ouverts(marches).filter((m) => m.sens === 'ST' && m.cha_id === chantier.id && m.tiers_id === doc.ent_tiers_id);
  const ventes = ouverts(marches).filter((m) => (m.sens ?? 'V') === 'V' && m.cha_id === chantier.id);
  const comboAxe = axes.length ? creerCombo({ vide: false, valeur: axes[0].id, options: axes.map((m) => ({ valeur: m.id, libelle: `${m.code} – ${m.libelle}`, detail: formatNombre(Number(m.montant_ht ?? 0), 2) })) }) : null;
  const comboVente = creerCombo({ valeur: ventes.length === 1 ? ventes[0].id : '', options: ventes.map((m) => ({ valeur: m.id, libelle: `${m.code} – ${m.libelle}` })) });
  const nature = () => ventes.find((m) => m.id === Number(comboVente.valeurCombo))?.nature ?? 'P';
  let comboGarantie;

  const dlg = document.createElement('dialog');
  dlg.className = 'dialogue-structure';
  dlg.innerHTML = `<form method="dialog">
    <h3>Marché de sous-traitance de la commande ${echapper(doc.ent_numero ?? '')}</h3>
    <p class="aide">${echapper(nomTiers)} sur le chantier ${echapper(`${chantier.code} – ${chantier.libelle}`)}. Une commande de sous-traitance se valide dans un
      marché : un marché par axe de facturation du sous-traitant (un seul s'il facture tout ensemble).${totalHt !== null ? ` Montant de la commande : ${formatNombre(Number(totalHt), 2)} € HT.` : ''}</p>
    <fieldset><legend>Marché</legend>
      <label><input type="radio" name="choix" value="avenant" ${axes.length ? 'checked' : 'disabled'}> Avenant du marché ${axes.length ? '<span data-axe></span>' : '(aucun marché de ce sous-traitant sur le chantier)'}</label>
      <label><input type="radio" name="choix" value="creer" ${axes.length ? '' : 'checked'}> Nouveau marché (nouvel axe de facturation)</label>
      <div data-creer class="grille-champs">
        <label>Code <input data-code required value="${echapper(codeMarche(chantier, marches, 'ST'))}"></label>
        <label class="large">Libellé <input data-libelle required value="${echapper(doc.ent_objet ?? '')}"></label>
        <label class="large">Marché de vente lié <span data-vente></span></label>
        <label>Nature <input data-nature readonly></label>
        <label>Garantie de paiement <span data-garantie></span></label>
        <label>Montant agréé (DC4) <input data-agree inputmode="decimal" size="12"></label>
        <label><input type="checkbox" data-auto checked> Autoliquidation de la TVA</label>
      </div>
    </fieldset>
    <p class="connexion-erreur" data-erreur hidden></p>
    <p class="ligne"><button value="ok" class="principal">Valider la commande</button> <button value="annuler" formnovalidate>Annuler</button></p>
  </form>`;
  const $ = (s) => dlg.querySelector(s);
  if (comboAxe) $('[data-axe]').append(comboAxe);
  $('[data-vente]').append(comboVente);
  const majNature = () => {
    const n = nature();
    $('[data-nature]').value = n === 'U' ? 'Marché public' : 'Marché privé';
    const g = creerCombo({ vide: false, valeur: GARANTIES[n][0].valeur, options: GARANTIES[n] });
    if (comboGarantie) comboGarantie.replaceWith(g); else $('[data-garantie]').append(g);
    comboGarantie = g;
  };
  comboVente.addEventListener('change', majNature);
  majNature();
  const majChoix = () => { $('[data-creer]').hidden = dlg.querySelector('input[name="choix"]:checked')?.value !== 'creer'; };
  dlg.querySelectorAll('input[name="choix"]').forEach((r) => r.addEventListener('change', majChoix));
  majChoix();
  document.body.append(dlg);
  return new Promise((resoudre) => {
    dlg.querySelector('form').addEventListener('submit', async (e) => {
      if (e.submitter?.value !== 'ok') return;
      e.preventDefault();
      const choix = dlg.querySelector('input[name="choix"]:checked')?.value;
      try {
        if (choix === 'avenant') { dlg.close(); resoudre({ ent_marche_id: Number(comboAxe.valeurCombo), cree: false }); return; }
        const agree = $('[data-agree]').value.trim();
        const m = await creerMarche({
          sens: 'ST', code: $('[data-code]').value.trim(), libelle: $('[data-libelle]').value.trim(), cha_id: chantier.id, tiers_id: doc.ent_tiers_id,
          marche_vente_id: comboVente.valeurCombo ? Number(comboVente.valeurCombo) : null, nature: nature(), garantie: comboGarantie.valeurCombo,
          montant_agree: agree ? Number(agree.replace(/\s/g, '').replace(',', '.')) : null, autoliquidation: $('[data-auto]').checked,
          date: aujourdhui(), statut: 'EN_COURS', depassement_autorise: false,
        });
        dlg.close();
        resoudre({ ent_marche_id: Number(m.id), cree: true });
      } catch (x) { $('[data-erreur]').textContent = x.message; $('[data-erreur]').hidden = false; }
    });
    dlg.addEventListener('close', () => { dlg.remove(); resoudre(null); });
    ouvrirModale(dlg, () => dlg.close());
  });
}
