import { aujourdhui } from '@logibtp/socle';
import { echapper, formatNombre, creerCombo } from '@logibtp/socle/ui';
import { codeMarche, prochainCode } from '../fiches/fiche-structure.js';

// Validation d'une commande client (CONCEPTION-ACHATS-MARCHES.md, Q16, Q17, 13.2) : le marché est obligatoire. Avant la
// validation, l'utilisateur choisit le chantier (existant, ou nouveau chantier pré-rempli avec les valeurs de la
// commande, de son affaire et de son projet, qu'il complète), puis crée le marché de la commande ou rattache la
// commande comme avenant d'un marché en cours du chantier. Le montant du marché est calculé (commandes validées).
// Annuler abandonne la validation.

const ouverts = (liste) => liste.filter((x) => !['CLOS', 'CLOSE', 'SOLDE', 'RESILIE', 'TERMINE'].includes(x.statut));
const NOUVEAU = 'nouveau';

/**
 * Ouvre le dialogue ; résout { ent_marche_id, cree, avenant } ou null (abandon).
 * refs : référentiels de la structure ; doc : entête de la commande ; totalHt : total HT ;
 * creerChantier(valeurs) → { id } ; creerMarche(valeurs) → { id }.
 */
export function proposerMarche({ refs, doc, totalHt, creerChantier, creerMarche, individus = [] }) {
  const chantiers = ouverts(refs.chantiers ?? []);
  const client = doc.ent_tiers_id ?? null;
  const projet = (refs.projets ?? []).find((p) => p.id === doc.ent_projet_id) ?? null;
  // Chantier proposé : celui de la commande, sinon celui de son projet, sinon un nouveau chantier.
  const initial = chantiers.find((c) => c.id === doc.ent_chantier_id) ?? chantiers.find((c) => projet && c.prj_id === projet.id) ?? null;
  const tries = [...chantiers].sort((a, b) => Number(b.tiers_id === client) - Number(a.tiers_id === client) || a.code.localeCompare(b.code));
  const comboChantier = creerCombo({
    vide: false, valeur: initial?.id ?? NOUVEAU,
    options: [{ valeur: NOUVEAU, libelle: '＋ Nouveau chantier' }, ...tries.map((c) => ({ valeur: c.id, libelle: `${c.code} – ${c.libelle}`, detail: c.ville ?? '' }))],
  });
  const comboAffaire = creerCombo({
    valeur: doc.ent_affaire_id ?? '',
    options: ouverts(refs.affaires ?? []).map((a) => ({ valeur: a.id, libelle: `${a.code} – ${a.libelle}` })),
  });
  const comboNature = creerCombo({ vide: false, valeur: 'P', options: [{ valeur: 'P', libelle: 'Marché privé' }, { valeur: 'U', libelle: 'Marché public' }] });
  let comboMarche = null;
  const codesChantiers = (refs.chantiers ?? []).map((c) => c.code);

  const dlg = document.createElement('dialog');
  dlg.className = 'dialogue-structure';
  dlg.innerHTML = `<form method="dialog">
    <h3>Marché de la commande ${echapper(doc.ent_numero ?? '')}</h3>
    <p class="aide">Une commande client se valide dans un marché, qui suit ses livraisons, situations et factures. Le montant du
      marché est le total des commandes validées (commande de base et avenants).</p>
    <label class="large">Chantier <span data-chantier></span></label>
    <fieldset data-nouveau-chantier><legend>Nouveau chantier</legend>
      <div class="grille-champs">
        <label>Code <input data-cha="code" required value="${echapper(prochainCode('chantier', codesChantiers))}"></label>
        <label class="large">Libellé <input data-cha="libelle" required value="${echapper(doc.ent_objet ?? projet?.libelle ?? '')}"></label>
        <label class="large">Adresse <input data-cha="adresse"></label>
        <label>Code postal <input data-cha="code_postal"></label>
        <label>Ville <input data-cha="ville" value="${echapper(projet?.ville ?? '')}"></label>
        <label class="large">Affaire <span data-affaire></span></label>
        <label>Conducteur de travaux <span data-conducteur></span></label>
        <label>Fin prévue <input type="date" data-cha="date_fin_prevue"></label>
        <label>Dépôt de stock <input type="checkbox" data-cha="depot"></label>
        <label>Tient un stock <input type="checkbox" data-cha="stock_tenu"></label>
      </div>
    </fieldset>
    <fieldset><legend>Marché</legend>
      <label><input type="radio" name="choix" value="creer" checked> Nouveau marché (cette commande en est la base)</label>
      <label><input type="radio" name="choix" value="avenant"> Avenant d'un marché en cours du chantier</label>
      <div data-creer class="grille-champs">
        <label>Code <input data-code required></label>
        <label class="large">Libellé <input data-libelle required value="${echapper(doc.ent_objet ?? '')}"></label>
        <label>Nature <span data-nature></span></label>
        <label>Retenue de garantie (%) <input data-retenue value="5"></label>
        <p class="aide">Montant de la commande : ${totalHt === null || totalHt === undefined ? '—' : `${formatNombre(totalHt, 2)} € HT`}</p>
      </div>
      <div data-avenant hidden><span data-marche></span></div>
    </fieldset>
    <p class="erreur" data-erreur></p>
    <div class="boutons"><button value="annuler">Annuler</button><button type="button" class="principal" data-valider>Valider la commande</button></div></form>`;
  document.body.append(dlg);
  const $ = (s) => dlg.querySelector(s);
  $('[data-chantier]').append(comboChantier);
  // Conducteur de travaux : individu de notre structure (annuaire).
  const comboConducteur = creerCombo({ options: individus.map((x) => ({ valeur: x.valeur, libelle: x.libelle, detail: x.detail })) });
  $('[data-conducteur]').replaceWith(comboConducteur);
  $('[data-affaire]').append(comboAffaire);
  $('[data-nature]').append(comboNature);
  const choix = () => dlg.querySelector('[name="choix"]:checked').value;
  const nouveauChantier = () => comboChantier.valeurCombo === NOUVEAU;
  const chantier = () => chantiers.find((c) => c.id === Number(comboChantier.valeurCombo)) ?? null;
  const marchesDuChantier = () => (chantier() ? ouverts(refs.marches ?? []).filter((m) => m.cha_id === chantier().id) : []);

  const majChantier = () => {
    $('[data-nouveau-chantier]').hidden = !nouveauChantier();
    const c = nouveauChantier() ? { code: $('[data-cha="code"]').value } : chantier();
    $('[data-code]').value = c ? codeMarche(c, refs.marches ?? []) : '';
    const marches = marchesDuChantier().sort((a, b) => Number(b.tiers_id === client) - Number(a.tiers_id === client));
    const options = marches.map((m) => ({ valeur: m.id, libelle: `${m.code} – ${m.libelle}`, detail: m.montant_ht !== null ? `${formatNombre(m.montant_ht, 2)} € HT` : '' }));
    comboMarche = creerCombo({ vide: false, valeur: options[0]?.valeur ?? '', options });
    $('[data-marche]').replaceChildren(comboMarche);
    const avenantPossible = marches.length > 0;
    dlg.querySelector('[name="choix"][value="avenant"]').disabled = !avenantPossible;
    if (!avenantPossible && choix() === 'avenant') dlg.querySelector('[name="choix"][value="creer"]').checked = true;
    majChoix();
  };
  const majChoix = () => {
    $('[data-creer]').hidden = choix() !== 'creer';
    $('[data-avenant]').hidden = choix() !== 'avenant';
  };
  comboChantier.addEventListener('change', majChantier);
  $('[data-cha="code"]').addEventListener('input', () => { if (nouveauChantier()) $('[data-code]').value = codeMarche({ code: $('[data-cha="code"]').value }, refs.marches ?? []); });
  dlg.querySelectorAll('[name="choix"]').forEach((r) => r.addEventListener('change', majChoix));
  majChantier();

  return new Promise((resoudre) => {
    let fini = false;
    const finir = (r) => {
      if (fini) return;
      fini = true;
      if (dlg.open) dlg.close();
      dlg.remove();
      resoudre(r);
    };
    dlg.addEventListener('close', () => finir(null));
    $('[data-valider]').addEventListener('click', async () => {
      const erreur = (t) => { $('[data-erreur]').textContent = t; };
      const bouton = $('[data-valider]');
      try {
        bouton.disabled = true;
        if (choix() === 'avenant') {
          const id = Number(comboMarche?.valeurCombo);
          if (!id) { erreur('Choisissez le marché dont la commande est un avenant'); return; }
          finir({ ent_marche_id: id, cree: false, avenant: true });
          return;
        }
        if (!$('[data-code]').value.trim() || !$('[data-libelle]').value.trim()) { erreur('Code et libellé du marché obligatoires'); return; }
        let chaId = chantier()?.id ?? null;
        if (nouveauChantier()) {
          const v = Object.fromEntries([...dlg.querySelectorAll('[data-cha]')].map((el) => [el.dataset.cha, el.type === 'checkbox' ? el.checked : (el.value.trim() || null)]));
          if (!v.code || !v.libelle) { erreur('Code et libellé du chantier obligatoires'); return; }
          const cree = await creerChantier({
            ...v, conducteur_ind_id: comboConducteur.resoudre() === '' ? null : Number(comboConducteur.resoudre()), tiers_id: client, aff_id: comboAffaire.valeurCombo === '' ? null : Number(comboAffaire.valeurCombo),
            prj_id: projet?.id ?? null, statut: 'OUVERT', date_ouverture: aujourdhui(),
          });
          chaId = cree.id;
        }
        if (!chaId) { erreur('Choisissez le chantier'); return; }
        const nombre = (s) => (s.value.trim() === '' ? null : s.value.replace(/\s/g, '').replace(',', '.'));
        const marche = await creerMarche({
          code: $('[data-code]').value.trim(), libelle: $('[data-libelle]').value.trim(), cha_id: chaId, tiers_id: client,
          ent_id: doc.ent_id, nature: comboNature.valeurCombo, retenue_pct: nombre($('[data-retenue]')),
          date: doc.ent_date ?? aujourdhui(), statut: 'EN_COURS',
        });
        finir({ ent_marche_id: marche.id, cree: true, avenant: false });
      } catch (e) {
        erreur(e.message);
      } finally {
        bouton.disabled = false;
      }
    });
    dlg.showModal();
  });
}
