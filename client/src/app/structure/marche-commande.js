import { echapper, formatNombre } from '@logibtp/socle/ui';
import { codeMarche } from '../fiches/fiche-structure.js';

// Validation d'une commande client : le marché qui suivra sa facturation est proposé. Création d'un marché sur un
// chantier (code M-<chantier>-<rang>, libellé = objet, montant = total HT de la commande) ou rattachement à un marché
// existant du chantier ; « Plus tard » laisse la commande sans marché (rattachement possible depuis l'entête).

const ouverts = (liste) => liste.filter((x) => !['CLOS', 'CLOSE', 'SOLDE', 'RESILIE'].includes(x.statut));

/**
 * Ouvre le dialogue ; résout { ent_marche_id } (marché créé ou choisi) ou null.
 * refs : référentiels de la structure ; doc : entête du document validé ; totalHt : total HT ; creerMarche(valeurs) → { id }.
 */
export function proposerMarche({ refs, doc, totalHt, creerMarche }) {
  const chantiers = ouverts(refs.chantiers ?? []);
  const chantierInitial = doc.ent_chantier_id ?? null;
  const dlg = document.createElement('dialog');
  dlg.className = 'dialogue-structure';
  dlg.innerHTML = `<form method="dialog">
    <h3>Marché de la commande ${echapper(doc.ent_numero ?? '')}</h3>
    <p class="aide">Le marché suit la facturation de la commande (situations, factures d'avancement, factures et avoirs).</p>
    <label>Chantier <select data-chantier required><option value=""></option>${chantiers.map((c) => `<option value="${c.id}" ${c.id === chantierInitial ? 'selected' : ''}>${echapper(`${c.code} – ${c.libelle}`)}</option>`).join('')}</select></label>
    ${chantiers.length ? '' : '<p class="aide">Aucun chantier ouvert : créez d\'abord le chantier (menu Affaires).</p>'}
    <fieldset><legend>Marché</legend>
      <label><input type="radio" name="choix" value="creer" checked> Créer un nouveau marché</label>
      <label><input type="radio" name="choix" value="existant"> Rattacher à un marché existant du chantier</label>
      <div data-creer class="grille-champs">
        <label>Code <input data-code required></label>
        <label class="large">Libellé <input data-libelle required value="${echapper(doc.ent_objet ?? '')}"></label>
        <label>Montant HT <input data-montant value="${totalHt === null || totalHt === undefined ? '' : formatNombre(totalHt, 2)}"></label>
        <label>Nature <select data-nature><option value="P">Marché privé</option><option value="U">Marché public</option></select></label>
        <label>Retenue de garantie (%) <input data-retenue value="5"></label>
      </div>
      <div data-existant hidden><select data-marche></select></div>
    </fieldset>
    <p class="erreur" data-erreur></p>
    <div class="boutons"><button value="plus-tard">Plus tard</button><button type="button" class="principal" data-valider>Valider</button></div></form>`;
  document.body.append(dlg);
  const $ = (s) => dlg.querySelector(s);
  const chantier = () => chantiers.find((c) => c.id === Number($('[data-chantier]').value)) ?? null;
  const choix = () => dlg.querySelector('[name="choix"]:checked').value;
  const majChantier = () => {
    const c = chantier();
    $('[data-code]').value = c ? codeMarche(c, refs.marches ?? []) : '';
    const marches = c ? ouverts(refs.marches ?? []).filter((m) => m.cha_id === c.id) : [];
    $('[data-marche]').innerHTML = marches.length
      ? marches.map((m) => `<option value="${m.id}">${echapper(`${m.code} – ${m.libelle}`)}${m.montant_ht !== null ? ` (${formatNombre(m.montant_ht, 2)} € HT)` : ''}</option>`).join('')
      : '<option value="">Aucun marché en cours sur ce chantier</option>';
  };
  majChantier();
  $('[data-chantier]').addEventListener('change', majChantier);
  dlg.querySelectorAll('[name="choix"]').forEach((r) => r.addEventListener('change', () => {
    $('[data-creer]').hidden = choix() !== 'creer';
    $('[data-existant]').hidden = choix() !== 'existant';
  }));
  return new Promise((resoudre) => {
    dlg.addEventListener('close', () => { dlg.remove(); resoudre(null); });
    $('[data-valider]').addEventListener('click', async () => {
      const erreur = (t) => { $('[data-erreur]').textContent = t; };
      const c = chantier();
      if (!c) { erreur('Choisissez le chantier'); return; }
      try {
        if (choix() === 'existant') {
          const id = Number($('[data-marche]').value);
          if (!id) { erreur('Aucun marché à rattacher'); return; }
          resoudre({ ent_marche_id: id });
        } else {
          const nombre = (s) => (s.value.trim() === '' ? null : Number(s.value.replace(/\s/g, '').replace(',', '.')));
          if (!$('[data-code]').value.trim() || !$('[data-libelle]').value.trim()) { erreur('Code et libellé obligatoires'); return; }
          const marche = await creerMarche({
            code: $('[data-code]').value.trim(), libelle: $('[data-libelle]').value.trim(), cha_id: c.id, tiers_id: doc.ent_tiers_id ?? c.tiers_id ?? null,
            ent_id: doc.ent_id, nature: $('[data-nature]').value, montant_ht: nombre($('[data-montant]')), retenue_pct: nombre($('[data-retenue]')),
            date: doc.ent_date ?? new Date().toISOString().slice(0, 10), statut: 'EN_COURS',
          });
          resoudre({ ent_marche_id: marche.id, cree: true });
        }
        dlg.close();
      } catch (e) { erreur(e.message); }
    });
    dlg.showModal();
  });
}
