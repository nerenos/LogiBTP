import { texte, texteHtml, icone } from '@logibtp/socle/dictionnaire';
import { TYPE_FICHE } from '../codes.js';
import { aujourdhui } from '@logibtp/socle';
import { echapper, formatNombre, creerCombo, ouvrirModale } from '@logibtp/socle/ui';

// Validation d'une commande client (CONCEPTION-ACHATS-MARCHES.md, Q16, Q17, 13.2) : le marché est obligatoire. Avant la
// validation, l'utilisateur choisit le chantier (existant, ou nouveau chantier pré-rempli avec les valeurs de la
// commande, de son affaire et de son projet, qu'il complète), puis crée le marché de la commande ou rattache la
// commande comme avenant d'un marché en cours du chantier. Le montant du marché est calculé (commandes validées).
// Annuler abandonne la validation.

const ouverts = (liste) => liste.filter((x) => !['CLOS', 'CLOSE', 'SOLDE', 'RESILIE', 'TERMINE'].includes(x.statut));
const NOUVEAU = 'nouveau';

/**
 * Adresse proposée au nouveau chantier : adresse des travaux ou de livraison de la commande, sinon celle du projet,
 * sinon celle du client (instantané de l'entête) ; { adresse, code_postal, ville } (champs vides si rien).
 */
export function adresseChantierInitiale(doc, projet) {
  const commande = doc.ent_adresse_livraison?.adresse ?? {};
  const client = doc.ent_contact_client?.adresse ?? {};
  const ligne = (a) => [a.ligne1, a.ligne2, a.ligne3].filter(Boolean).join(', ');
  const sources = [
    { adresse: ligne(commande), code_postal: commande.code_postal, ville: commande.ville },
    { adresse: projet?.adresse, code_postal: projet?.code_postal, ville: projet?.ville },
    { adresse: ligne(client), code_postal: client.code_postal, ville: client.ville },
  ];
  const source = sources.find((x) => x.adresse || x.code_postal || x.ville);
  return { adresse: source?.adresse ?? '', code_postal: source?.code_postal ?? '', ville: source?.ville ?? '' };
}

/**
 * Ouvre le dialogue ; résout { ent_marche_id, cree, avenant } ou null (abandon).
 * refs : référentiels de la structure ; doc : entête de la commande ; totalHt : total HT ;
 * creerChantier(valeurs) → { id } ; creerMarche(valeurs) → { id } ; codePrevisionnel(type, valeurs) → code prévisionnel
 * (texte indicatif ; code vide = calculé par le chrono à la création).
 */
export function proposerMarche({ refs, doc, totalHt, creerChantier, creerMarche, individus = [], codePrevisionnel = async () => '' }) {
  const chantiers = ouverts(refs.chantiers ?? []);
  const client = doc.ent_tiers_id ?? null;
  const projet = (refs.projets ?? []).find((p) => p.id === doc.ent_projet_id) ?? null;
  // Chantier proposé : celui de la commande, sinon celui de son projet, sinon un nouveau chantier.
  const initial = chantiers.find((c) => c.id === doc.ent_chantier_id) ?? chantiers.find((c) => projet && c.prj_id === projet.id) ?? null;
  const tries = [...chantiers].sort((a, b) => Number(b.tiers_id === client) - Number(a.tiers_id === client) || a.code.localeCompare(b.code));
  const adresseInitiale = adresseChantierInitiale(doc, projet);
  const comboChantier = creerCombo({
    vide: false, valeur: initial?.id ?? NOUVEAU,
    options: [{ valeur: NOUVEAU, libelle: `${icone('ajouter')} ${texte('structure_btp.marche_commande.nouveau_chantier')}` }, ...tries.map((c) => ({ valeur: c.id, libelle: `${c.code} – ${c.libelle}`, detail: c.ville ?? '' }))],
  });
  const comboAffaire = creerCombo({
    valeur: doc.ent_affaire_id ?? '',
    options: ouverts(refs.affaires ?? []).map((a) => ({ valeur: a.id, libelle: `${a.code} – ${a.libelle}` })),
  });
  const comboNature = creerCombo({ vide: false, valeur: 'P', options: [{ valeur: 'P', libelle: texte('structure_btp.marche_commande.prive') }, { valeur: 'U', libelle: texte('structure_btp.marche_commande.public') }] });
  let comboMarche = null;

  const dlg = document.createElement('dialog');
  dlg.className = 'dialogue-structure';
  dlg.innerHTML = `<form method="dialog">
    <h3>${texteHtml('structure_btp.marche_commande.titre', { numero: doc.ent_numero ?? '' })}</h3>
    <p class="aide">${texteHtml('structure_btp.marche_commande.aide')}</p>
    <label class="large">${texteHtml('structure_btp.marche_commande.chantier')} <span data-chantier></span></label>
    <fieldset data-nouveau-chantier><legend>${texteHtml('structure_btp.marche_commande.nouveau_chantier')}</legend>
      <div class="grille-champs">
        <label>${texteHtml('commun.code')} <input data-cha="code" class="code-previsionnel" title="${texteHtml('structure_btp.marche_commande.code_aide')}"></label>
        <label class="large">${texteHtml('commun.libelle')} <input data-cha="libelle" required value="${echapper(doc.ent_objet ?? projet?.libelle ?? '')}"></label>
        <label class="large">${texteHtml('structure_btp.marche_commande.adresse')} <input data-cha="adresse" value="${echapper(adresseInitiale.adresse)}"></label>
        <label>${texteHtml('structure_btp.marche_commande.code_postal')} <input data-cha="code_postal" value="${echapper(adresseInitiale.code_postal)}"></label>
        <label>${texteHtml('structure_btp.marche_commande.ville')} <input data-cha="ville" value="${echapper(adresseInitiale.ville)}"></label>
        <label class="large">${texteHtml('structure_btp.marche_commande.affaire')} <span data-affaire></span></label>
        <label>${texteHtml('structure_btp.marche_commande.conducteur')} <span data-conducteur></span></label>
        <label>${texteHtml('structure_btp.marche_commande.fin_prevue')} <input type="date" data-cha="date_fin_prevue"></label>
        <label>${texteHtml('structure_btp.marche_commande.depot')} <input type="checkbox" data-cha="depot"></label>
        <label>${texteHtml('structure_btp.marche_commande.stock_tenu')} <input type="checkbox" data-cha="stock_tenu"></label>
      </div>
    </fieldset>
    <fieldset><legend>${texteHtml('structure_btp.marche_commande.marche')}</legend>
      <label><input type="radio" name="choix" value="creer" checked> ${texteHtml('structure_btp.marche_commande.nouveau_marche')}</label>
      <label><input type="radio" name="choix" value="avenant"> ${texteHtml('structure_btp.marche_commande.avenant')}</label>
      <div data-creer class="grille-champs">
        <label>${texteHtml('commun.code')} <input data-code class="code-previsionnel" title="${texteHtml('structure_btp.marche_commande.code_aide')}"></label>
        <label class="large">${texteHtml('commun.libelle')} <input data-libelle required value="${echapper(doc.ent_objet ?? '')}"></label>
        <label>${texteHtml('structure_btp.marche_commande.nature')} <span data-nature></span></label>
        <label>${texteHtml('structure_btp.marche_commande.retenue')} <input data-retenue value="5"></label>
        <p class="aide">${texteHtml('structure_btp.marche_commande.montant', { montant: totalHt === null || totalHt === undefined ? '—' : texte('structure_btp.montant_ht', { montant: formatNombre(totalHt, 2) }) })}</p>
      </div>
      <div data-avenant hidden><span data-marche></span></div>
    </fieldset>
    <p class="erreur" data-erreur></p>
    <div class="boutons"><button value="annuler">${texteHtml('commun.annuler')}</button><button type="button" class="principal" data-valider>${texteHtml('structure_btp.marche_commande.valider')}</button></div></form>`;
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
    // Code du marché : prévisionnel du chantier existant (le chrono le calcule d'après le code du chantier).
    $('[data-code]').placeholder = nouveauChantier() ? texte('structure_btp.marche_commande.code_chantier') : '';
    if (chantier()) codePrevisionnel(TYPE_FICHE.MARCHE, { cha_id: chantier().id, sens: 'V' }).then((c) => { if (chantier() && c) $('[data-code]').placeholder = c; });
    const marches = marchesDuChantier().sort((a, b) => Number(b.tiers_id === client) - Number(a.tiers_id === client));
    const options = marches.map((m) => ({ valeur: m.id, libelle: `${m.code} – ${m.libelle}`, detail: m.montant_ht !== null ? texte('structure_btp.montant_ht', { montant: formatNombre(m.montant_ht, 2) }) : '' }));
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
  codePrevisionnel(TYPE_FICHE.CHANTIER, {}).then((c) => { if (c) $('[data-cha="code"]').placeholder = c; });
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
          if (!id) { erreur(texte('structure_btp.marche_commande.erreurs.marche')); return; }
          finir({ ent_marche_id: id, cree: false, avenant: true });
          return;
        }
        if (!$('[data-libelle]').value.trim()) { erreur(texte('structure_btp.marche_commande.erreurs.libelle_marche')); return; }
        let chaId = chantier()?.id ?? null;
        if (nouveauChantier()) {
          const v = Object.fromEntries([...dlg.querySelectorAll('[data-cha]')].map((el) => [el.dataset.cha, el.type === 'checkbox' ? el.checked : (el.value.trim() || null)]));
          if (!v.libelle) { erreur(texte('structure_btp.marche_commande.erreurs.libelle_chantier')); return; }
          const cree = await creerChantier({
            ...v, conducteur_ind_id: comboConducteur.resoudre() === '' ? null : Number(comboConducteur.resoudre()), tiers_id: client, aff_id: comboAffaire.valeurCombo === '' ? null : Number(comboAffaire.valeurCombo),
            prj_id: projet?.id ?? null, statut: 'OUVERT', date_ouverture: aujourdhui(),
          });
          chaId = cree.id;
        }
        if (!chaId) { erreur(texte('structure_btp.marche_commande.erreurs.chantier')); return; }
        const nombre = (s) => (s.value.trim() === '' ? null : s.value.replace(/\s/g, '').replace(',', '.'));
        const marche = await creerMarche({
          code: $('[data-code]').value.trim() || null, libelle: $('[data-libelle]').value.trim(), cha_id: chaId, tiers_id: client,
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
    ouvrirModale(dlg, () => dlg.close());
  });
}
