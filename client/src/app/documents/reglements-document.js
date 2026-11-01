import { texte, texteHtml, iconeHtml, textesParCode } from '@logibtp/socle/dictionnaire';
import { urlDocument, TYPE_FICHE, urlFiche } from '../codes.js';
import { estFamilleAchat, montantRetenue } from '@logibtp/document';
import { MODE_REGLEMENT_SYSTEME, SOURCE_POINTAGE, maximumImputation } from '@logibtp/reglement';
import { echapper, formatNombre, formatDate, lireNombre, creerCombo, confirmer, ouvrirDialogue } from '@logibtp/socle/ui';
import { D, aujourdhui } from '@logibtp/socle';
import { api } from '../api.js';

// Onglet Règlements de la page document (décisions du 31/10/2026) :
// - échéancier d'une pièce validée : proposition calculée à la validation, « ⟳ Rafraîchir » la recalcule, modifiable à la
//   main (ajout, suppression, découpage des montants, dates, modes) ; avertissement si la somme diffère du net à payer
//   ou de la retenue ; retenue de garantie : libération prévue du marché (réception + 1 an, réserves), date modifiable ;
// - pointé et reste de chaque échéance, règlements et imputations qui la pointent (module Règlements) ; retenue de
//   garantie : part cautionnée (lot F, calculée : exigible avec la pièce, la caution ne règle rien) ;
// - imputation d'un avoir ou d'un trop-perçu sur une facture (ou d'un avoir sur une facture suivante) ;
// - déductions d'acompte d'une facture d'avancement d'un marché : aperçu avant la validation, écrites ensuite.

const NATURE = { NORMALE: 'NORMALE', RETENUE: 'RETENUE' };
const DEDUCTIONS = textesParCode('reglements_btp.document.deductions', ['PREMIERE', 'DERNIERE', 'LINEAIRE']);

/** Écarts de l'échéancier : somme des échéances normales ≠ net à payer, somme des retenues ≠ retenue de la pièce. */
export function ecartsEcheancier(echeances, { netAPayer, retenue }) {
  const somme = (nature) => echeances.filter((e) => e.nature === nature).reduce((t, e) => t.plus(D(e.montant ?? 0)), D(0));
  const ecarts = [];
  const normales = somme(NATURE.NORMALE).minus(D(netAPayer ?? 0));
  if (!normales.isZero()) ecarts.push({ nature: NATURE.NORMALE, ecart: normales.toString() });
  const retenues = somme(NATURE.RETENUE).minus(D(retenue ?? 0));
  if (!retenues.isZero()) ecarts.push({ nature: NATURE.RETENUE, ecart: retenues.toString() });
  return ecarts;
}

/** Libération prévue d'une retenue (ReglesRetenue du marché) : texte court. */
function texteLiberation(l) {
  if (!l) return '';
  if (l.motif === 'RET_RECEPTION') return texte('reglements_btp.document.liberation.non_receptionnes');
  if (l.motif === 'RET_RESERVES') return texte('reglements_btp.document.liberation.reserves', { date: formatDate(l.echeance) });
  return texte(l.date !== l.echeance ? 'reglements_btp.document.liberation.levee' : 'reglements_btp.document.liberation.reception', { date: formatDate(l.date) });
}

/**
 * Rendu de l'onglet. ctx : { app, page (page document : editeur, chargerDocument), modes [[code, libellé]] }.
 */
export async function afficherReglements(zone, { app, page, modes }) {
  const ed = page.editeur;
  const doc = ed.saisie.document;
  if (!doc.ent_id) { zone.innerHTML = `<p class="aide">${texteHtml('reglements_btp.document.non_enregistre')}</p>`; return; }
  zone.innerHTML = `<p class="aide">${texteHtml('reglements_btp.document.chargement')}</p>`;
  const type = ed.definition.type ?? {};
  const sens = estFamilleAchat(type.tyd_famille) ? 'D' : 'E';
  const moduleReglement = app.moduleActif('reglement');
  const pm = doc.ent_precision_montant ?? 2;
  const f = (v) => formatNombre(v ?? 0, pm);
  const echeancesDoc = ed.saisie.echeances ?? [];
  const [etat, pointages, retenue, acomptes] = await Promise.all([
    moduleReglement && echeancesDoc.length ? api.echeancesReglement({ piece: doc.ent_id }).catch(() => []) : [],
    moduleReglement && echeancesDoc.length ? api.pointagesPiece(doc.ent_id).catch(() => []) : [],
    doc.ent_marche_id && echeancesDoc.some((e) => e.ech_nature === NATURE.RETENUE) ? api.retenueMarche(doc.ent_marche_id).catch(() => null) : null,
    type.tyd_avancement === 'F' && doc.ent_marche_id && !doc.ent_nature_avoir ? api.acomptesDocument(doc.ent_id).catch(() => null) : null,
  ]);
  const etatParId = new Map(etat.map((e) => [e.id, e]));
  const libelleMode = (v) => (v === MODE_REGLEMENT_SYSTEME.IMPUTATION ? texte('reglements_btp.document.imputation') : modes.find(([c]) => c === v)?.[1] ?? v ?? '');
  const netAPayer = doc.ent_net_a_payer ?? ed.resultat?.document?.ent_net_a_payer ?? 0;
  const retenuePiece = montantRetenue(ed.resultat?.lignes ?? ed.saisie.lignes ?? []);

  // Saisie de l'échéancier (copie modifiable de l'échéancier enregistré).
  let saisie = echeancesDoc.map((e) => ({ id: e.ech_id, date: e.ech_date, montant: String(e.ech_montant), mode: e.ech_mode, nature: e.ech_nature, manuel: e.ech_manuel }));
  const modifiable = doc.ent_verrouille && echeancesDoc.length > 0;

  const rendre = () => {
    const ecarts = ecartsEcheancier(saisie, { netAPayer, retenue: retenuePiece });
    const ouvertes = etat.filter((e) => !e.reglee);
    zone.innerHTML = `<div class="reglements-document page-parametres">
      <section><div class="entete-page"><h3>${texteHtml('reglements_btp.document.echeancier')}</h3>${modifiable ? `<span class="boutons">
        <button type="button" data-ech="ajouter" title="${texteHtml('reglements_btp.document.ajouter_aide')}">${iconeHtml('ajouter')} ${texteHtml('reglements_btp.document.ajouter')}</button>
        <button type="button" data-ech="rafraichir" title="${texteHtml('reglements_btp.document.rafraichir_aide')}">${iconeHtml('reglements_btp_rafraichir')} ${texteHtml('reglements_btp.document.rafraichir')}</button>
        <button type="button" class="principal" data-ech="enregistrer">${texteHtml('reglements_btp.document.enregistrer')}</button></span>` : ''}</div>
      ${!echeancesDoc.length ? `<p class="aide">${texteHtml('reglements_btp.document.sans_echeancier')}</p>` : `
      <table class="tableau-compact echeancier-document"><thead><tr><th>${texteHtml('reglements_btp.document.col.numero')}</th><th>${texteHtml('reglements_btp.document.col.nature')}</th><th>${texteHtml('reglements_btp.colonnes.echeance')}</th><th class="nombre">${texteHtml('reglements_btp.colonnes.montant')}</th><th>${texteHtml('reglements_btp.colonnes.mode')}</th>
        ${moduleReglement ? `<th class="nombre" title="${texteHtml('reglements_btp.colonnes.cautionne_aide')}">${texteHtml('reglements_btp.colonnes.cautionne')}</th><th class="nombre">${texteHtml('reglements_btp.colonnes.pointe')}</th><th class="nombre">${texteHtml('reglements_btp.colonnes.reste')}</th>` : ''}<th class="cellule-boutons"></th></tr></thead>
      <tbody>${saisie.map((e, i) => {
        const x = e.id ? etatParId.get(e.id) : null;
        const retenueLigne = e.nature === NATURE.RETENUE;
        return `<tr data-i="${i}"${x?.reglee ? ' class="discret"' : ''}><td>${i + 1}${e.manuel ? ` ${iconeHtml('reglements_btp_manuel')}` : ''}</td>
          <td>${retenueLigne ? texteHtml('reglements_btp.retenue') : texteHtml('reglements_btp.document.echeance')}</td>
          <td><input type="date" data-champ="date" value="${echapper(e.date ?? '')}" ${modifiable ? '' : 'disabled'}
            title="${retenueLigne ? texteHtml('reglements_btp.document.date_retenue_aide') : texteHtml('reglements_btp.document.date_aide')}">
            ${retenueLigne && !e.date && retenue ? `<small class="aide">${echapper(texteLiberation(retenue.liberation))}</small>` : ''}</td>
          <td class="nombre"><input data-champ="montant" size="12" inputmode="decimal" value="${echapper(formatNombre(e.montant, pm))}" ${modifiable ? '' : 'disabled'}></td>
          <td><span data-mode="${i}"></span></td>
          ${moduleReglement ? `<td class="nombre">${x && !D(x.cautionne ?? 0).isZero() ? f(x.cautionne) : ''}</td><td class="nombre">${x ? f(x.pointe) : ''}</td><td class="nombre">${x ? f(x.reste) : ''}</td>` : ''}
          <td class="cellule-boutons">${modifiable && !(x && !D(x.pointe ?? 0).isZero()) ? `<button type="button" data-supprimer="${i}" title="${texteHtml('reglements_btp.document.retirer')}">${iconeHtml('retirer')}</button>` : ''}</td></tr>`;
      }).join('')}</tbody></table>
      ${ecarts.map((e) => `<p class="avertissement">${iconeHtml('avertissement')} ${e.nature === NATURE.NORMALE ? texteHtml('reglements_btp.document.ecart_normal', { net: f(netAPayer), ecart: f(e.ecart) })
        : texteHtml('reglements_btp.document.ecart_retenue', { retenue: f(retenuePiece), ecart: f(e.ecart) })}</p>`).join('')}`}
      </section>
      ${moduleReglement && echeancesDoc.length ? `<section><div class="entete-page"><h3>${texteHtml('reglements_btp.document.reglements')}</h3><span class="boutons">
        ${doc.ent_verrouille && ouvertes.length ? `<button type="button" data-imputer title="${D(netAPayer).isNegative() ? texteHtml('reglements_btp.document.imputer_avoir_aide') : texteHtml('reglements_btp.document.imputer_aide')}">${iconeHtml('reglements_btp_imputer')} ${texteHtml('reglements_btp.document.imputer')}</button>` : ''}
        ${doc.ent_tiers_id ? `<a href="/reglements?sens=${sens}&tiers=${doc.ent_tiers_id}" data-lien>${iconeHtml('reglements_btp_tiers')} ${texteHtml('reglements_btp.document.reglements_tiers')}</a>` : ''}</span></div>
        ${pointages.length ? `<table class="tableau-compact"><thead><tr><th>${texteHtml('reglements_btp.colonnes.date')}</th><th>${texteHtml('reglements_btp.document.col.origine')}</th><th>${texteHtml('reglements_btp.colonnes.reference')}</th><th>${texteHtml('reglements_btp.colonnes.echeance')}</th><th class="nombre">${texteHtml('reglements_btp.colonnes.montant')}</th></tr></thead>
        <tbody>${pointages.map((p) => `<tr><td>${formatDate(p.date)}</td><td>${p.source === SOURCE_POINTAGE.CAUTION ? `${texteHtml('reglements_btp.document.origine_caution', { caution: p.commentaire ?? '' })} <small class="aide">${texteHtml('reglements_btp.document.origine_caution_aide')}</small>`
          : p.source === SOURCE_POINTAGE.IMPUTATION ? `${texteHtml('reglements_btp.document.origine_imputation')} ${p.contreparties.map((c) => `<a href="${urlDocument(c.piece_id)}" data-lien>${echapper(c.type)} ${echapper(c.piece ?? `#${c.piece_id}`)}</a>`).join(', ')}`
          : `${texteHtml('reglements_btp.document.origine_reglement', { mode: libelleMode(p.mode) })}`}</td><td>${echapper(p.reference ?? '')}</td>
          <td>${(saisie.findIndex((e) => e.id === p.echeance_id) + 1) || ''}</td><td class="nombre">${f(p.montant)}</td></tr>`).join('')}</tbody></table>`
        : `<p class="aide">${texteHtml('reglements_btp.document.aucun_pointage')}</p>`}
        ${etat.length ? `<p>${texteHtml('reglements_btp.document.reste')} <b>${f(etat.reduce((t, e) => t.plus(D(e.reste ?? 0)), D(0)))}</b></p>` : ''}</section>` : ''}
      ${acomptes ? `<section><h3>${texteHtml('reglements_btp.document.acomptes.titre')}${acomptes.valide ? '' : ` ${texteHtml('reglements_btp.document.acomptes.apercu')}`}</h3>
        ${acomptes.deductions.length ? `<table class="tableau-compact"><thead><tr><th>${texteHtml('reglements_btp.document.acomptes.acompte')}</th><th>${texteHtml('reglements_btp.document.acomptes.deduction')}</th><th class="nombre">${texteHtml('reglements_btp.document.acomptes.acompte')}</th><th class="nombre">${texteHtml('reglements_btp.document.acomptes.deja')}</th>
          <th class="nombre">${texteHtml('reglements_btp.document.acomptes.document')}</th><th class="nombre">${texteHtml('reglements_btp.colonnes.reste')}</th></tr></thead><tbody>${acomptes.deductions.map((a) => `<tr><td>${texteHtml('reglements_btp.document.acomptes.rang', { rang: a.rang })}${a.libelle ? ` · ${echapper(a.libelle)}` : ''}</td>
          <td>${echapper(DEDUCTIONS[a.deduction] ?? a.deduction)} ${a.mode === 'CA' ? texteHtml('reglements_btp.document.acomptes.ht') : texteHtml('reglements_btp.document.acomptes.ttc')}</td>
          <td class="nombre">${f(a.montant_acompte)}</td><td class="nombre">${f(a.deja_deduit)}</td><td class="nombre">${f(a.a_deduire)}</td><td class="nombre">${f(a.reste)}</td></tr>`).join('')}</tbody></table>`
          : `<p class="aide">${texteHtml('reglements_btp.document.acomptes.aucun')}</p>`}
        ${doc.ent_marche_id ? `<p><a href="${urlFiche(TYPE_FICHE.MARCHE, doc.ent_marche_id)}" data-lien>${texteHtml('reglements_btp.document.acomptes.marche')}</a></p>` : ''}</section>` : ''}
    </div>`;
    lier();
  };

  const lier = () => {
    zone.querySelectorAll('[data-lien]').forEach((a) => a.addEventListener('click', (e) => {
      e.preventDefault();
      app.naviguer(a.getAttribute('href'), { nouvelleFenetre: Boolean(e.ctrlKey || e.shiftKey) });
    }));
    zone.querySelectorAll('[data-mode]').forEach((place) => {
      const i = Number(place.dataset.mode);
      const c = creerCombo({ options: modes.filter(([, , actif]) => actif !== false).map(([valeur, libelle]) => ({ valeur, libelle })), valeur: saisie[i].mode ?? '' });
      c.readOnly = !modifiable;
      c.addEventListener('change', () => { saisie[i].mode = c.valeurCombo || null; });
      place.replaceWith(c);
    });
    zone.querySelectorAll('tr[data-i] [data-champ]').forEach((el) => el.addEventListener('change', () => {
      const i = Number(el.closest('tr').dataset.i);
      if (el.dataset.champ === 'date') saisie[i].date = el.value || null;
      else {
        const n = lireNombre(el.value);
        if (n === undefined) { app.message(texte('reglements_btp.document.montant_invalide'), 'avertissement'); return; }
        saisie[i].montant = n ?? '0';
      }
      saisie[i].manuel = true;
      rendre();
    }));
    zone.querySelectorAll('[data-supprimer]').forEach((b) => b.addEventListener('click', () => { saisie.splice(Number(b.dataset.supprimer), 1); rendre(); }));
    zone.querySelector('[data-ech="ajouter"]')?.addEventListener('click', () => {
      const derniere = [...saisie].reverse().find((e) => e.nature === NATURE.NORMALE);
      saisie.splice(derniere ? saisie.indexOf(derniere) + 1 : saisie.length, 0, { id: null, date: derniere?.date ?? aujourdhui(), montant: '0', mode: derniere?.mode ?? null, nature: NATURE.NORMALE, manuel: true });
      rendre();
    });
    zone.querySelector('[data-ech="rafraichir"]')?.addEventListener('click', async () => {
      if (!(await confirmer(texte('reglements_btp.document.rafraichir_confirmer')))) return;
      try { await api.recalculerEcheances(doc.ent_id); await page.chargerDocument(doc.ent_id); page.afficherReglements(); app.message(texte('reglements_btp.document.recalcule'), 'succes'); } catch (e) { app.message(e.message, 'erreur'); }
    });
    zone.querySelector('[data-ech="enregistrer"]')?.addEventListener('click', async () => {
      const ecarts = ecartsEcheancier(saisie, { netAPayer, retenue: retenuePiece });
      if (ecarts.length && !(await confirmer(texte('reglements_btp.document.ecart_confirmer')))) return;
      try {
        await api.modifierEcheances(doc.ent_id, saisie.map((e) => ({ id: e.id ?? null, date: e.date || null, montant: e.montant, mode: e.mode ?? null, nature: e.nature })));
        await page.chargerDocument(doc.ent_id); page.afficherReglements();
        app.message(texte('reglements_btp.document.enregistre'), 'succes');
      } catch (e) { app.message(e.message, 'erreur'); }
    });
    zone.querySelector('[data-imputer]')?.addEventListener('click', () => imputer().catch((e) => app.message(e.message, 'erreur')));
  };

  /**
   * Imputation : facture → un avoir ouvert du tiers ou le trop-perçu d'un règlement ; avoir → une facture ouverte du
   * tiers. Montant proposé : le plus petit des deux restes (maximumImputation).
   */
  const imputer = async () => {
    const avoir = D(netAPayer).isNegative();
    const ouvertes = etat.filter((e) => !e.reglee && e.nature === NATURE.NORMALE);
    const tiers = await api.echeancesReglement({ tiers: doc.ent_tiers_id, sens, ouvertes: true });
    const choix = [];
    if (avoir) {
      // Cet avoir s'impute sur une facture ouverte du tiers (échéance positive) ; source : sa première échéance ouverte.
      const source = ouvertes.find((e) => D(e.reste).isNegative());
      if (!source) { app.message(texte('reglements_btp.document.avoir_impute'), 'avertissement'); return; }
      for (const e of tiers.filter((x) => x.piece_id !== doc.ent_id && x.nature === NATURE.NORMALE && D(x.reste).gt(0))) {
        choix.push({ libelle: texte('reglements_btp.document.choix.facture', { type: e.type, piece: e.piece ?? `#${e.piece_id}`, date: formatDate(e.date), reste: f(e.reste) }), cible: e.id, avoir: source.id,
          max: maximumImputation(source.reste, e.reste) });
      }
    } else {
      const cible = ouvertes.find((e) => D(e.reste).gt(0));
      if (!cible) { app.message(texte('reglements_btp.document.aucune_a_regler'), 'avertissement'); return; }
      for (const e of tiers.filter((x) => x.piece_id !== doc.ent_id && D(x.reste).isNegative())) {
        choix.push({ libelle: texte('reglements_btp.document.choix.avoir', { type: e.type, piece: e.piece ?? `#${e.piece_id}`, reste: f(e.reste) }), cible: cible.id, avoir: e.id, max: maximumImputation(e.reste, cible.reste) });
      }
      const reglements = await api.reglements({ tiers: doc.ent_tiers_id, sens });
      for (const r of reglements.filter((x) => x.mode !== MODE_REGLEMENT_SYSTEME.IMPUTATION && D(x.non_pointe).gt(0))) {
        choix.push({ libelle: texte('reglements_btp.document.choix.trop_percu', { date: formatDate(r.date), mode: `${libelleMode(r.mode)}${r.reference ? ` ${r.reference}` : ''}`, montant: f(r.non_pointe) }),
          cible: cible.id, reglement: r.id, max: maximumImputation(r.non_pointe, cible.reste) });
      }
    }
    if (!choix.length) { app.message(avoir ? texte('reglements_btp.document.aucune_facture') : texte('reglements_btp.document.aucun_avoir'), 'avertissement'); return; }
    const r = await ouvrirDialogue({
      titre: avoir ? texte('reglements_btp.document.dialogue.titre_avoir') : texte('reglements_btp.document.dialogue.titre'),
      html: `<div class="formulaire"><label>${avoir ? texteHtml('reglements_btp.document.dialogue.facture') : texteHtml('reglements_btp.document.dialogue.avoir')} <span data-choix></span></label>
        <label>${texteHtml('reglements_btp.champs.montant')} <input data-montant size="12" inputmode="decimal" value="${echapper(formatNombre(choix[0].max, pm))}"></label>
        <label>${texteHtml('reglements_btp.champs.date')} <input type="date" data-date value="${aujourdhui()}"></label>
        <label>${texteHtml('reglements_btp.document.dialogue.commentaire')} <input data-commentaire maxlength="200"></label></div>`,
      boutons: [{ libelle: texte('commun.annuler'), valeur: null }, {
        libelle: texte('reglements_btp.document.dialogue.imputer'), principal: true,
        valeur: (d) => ({ i: Number(d.querySelector('[data-choix-combo]')?.valeurCombo ?? 0), montant: lireNombre(d.querySelector('[data-montant]').value), date: d.querySelector('[data-date]').value || null, commentaire: d.querySelector('[data-commentaire]').value.trim() || null }),
      }],
      construire: (d) => {
        const c = creerCombo({ options: choix.map((x, i) => ({ valeur: String(i), libelle: x.libelle })), valeur: '0', vide: false });
        c.dataset.choixCombo = '';
        c.addEventListener('change', () => { d.querySelector('[data-montant]').value = formatNombre(choix[Number(c.valeurCombo || 0)].max, pm); });
        d.querySelector('[data-choix]').replaceWith(c);
      },
    });
    if (!r) return;
    if (!r.montant || D(r.montant).lte(0)) { app.message(texte('reglements_btp.document.montant_positif'), 'avertissement'); return; }
    const x = choix[r.i];
    await api.imputer({ echeance_id: x.cible, montant: r.montant, avoir_echeance_id: x.avoir ?? null, reglement_id: x.reglement ?? null, date: r.date, commentaire: r.commentaire });
    app.message(texte('reglements_btp.document.impute'), 'succes');
    await afficherReglements(zone, { app, page, modes });
  };

  rendre();
}
