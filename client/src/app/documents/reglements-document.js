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
// - pointé et reste de chaque échéance, règlements, cautions et imputations qui la pointent (module Règlements) ;
// - imputation d'un avoir ou d'un trop-perçu sur une facture (ou d'un avoir sur une facture suivante) ;
// - déductions d'acompte d'une facture d'avancement d'un marché : aperçu avant la validation, écrites ensuite.

const NATURE = { NORMALE: 'NORMALE', RETENUE: 'RETENUE' };

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
  if (l.motif === 'RET_RECEPTION') return 'travaux non réceptionnés';
  if (l.motif === 'RET_RESERVES') return `bloquée : réserves non levées (échéance ${formatDate(l.echeance)})`;
  return `libérable le ${formatDate(l.date)}${l.date !== l.echeance ? ' (levée des réserves)' : ' (réception + 1 an)'}`;
}

/**
 * Rendu de l'onglet. ctx : { app, page (page document : editeur, chargerDocument), modes [[code, libellé]] }.
 */
export async function afficherReglements(zone, { app, page, modes }) {
  const ed = page.editeur;
  const doc = ed.saisie.document;
  if (!doc.ent_id) { zone.innerHTML = '<p class="aide">Règlements disponibles pour les documents enregistrés.</p>'; return; }
  zone.innerHTML = '<p class="aide">Chargement…</p>';
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
  const libelleMode = (v) => (v === MODE_REGLEMENT_SYSTEME.IMPUTATION ? 'Imputation' : modes.find(([c]) => c === v)?.[1] ?? v ?? '');
  const netAPayer = doc.ent_net_a_payer ?? ed.resultat?.document?.ent_net_a_payer ?? 0;
  const retenuePiece = montantRetenue(ed.resultat?.lignes ?? ed.saisie.lignes ?? []);

  // Saisie de l'échéancier (copie modifiable de l'échéancier enregistré).
  let saisie = echeancesDoc.map((e) => ({ id: e.ech_id, date: e.ech_date, montant: String(e.ech_montant), mode: e.ech_mode, nature: e.ech_nature, manuel: e.ech_manuel }));
  const modifiable = doc.ent_verrouille && echeancesDoc.length > 0;

  const rendre = () => {
    const ecarts = ecartsEcheancier(saisie, { netAPayer, retenue: retenuePiece });
    const ouvertes = etat.filter((e) => !e.reglee);
    zone.innerHTML = `<div class="reglements-document page-parametres">
      <section><div class="entete-page"><h3>Échéancier</h3>${modifiable ? `<span class="boutons">
        <button type="button" data-ech="ajouter" title="Nouvelle échéance (le montant se reprend sur les autres)">＋ Échéance</button>
        <button type="button" data-ech="rafraichir" title="Revenir à la proposition calculée par la condition de paiement de la pièce">⟳ Rafraîchir</button>
        <button type="button" class="principal" data-ech="enregistrer">Enregistrer l'échéancier</button></span>` : ''}</div>
      ${!echeancesDoc.length ? `<p class="aide">L'échéancier est calculé à la validation des factures et des avoirs (aperçu dans l'entête, section Règlement).</p>` : `
      <table class="tableau-compact echeancier-document"><thead><tr><th>N°</th><th>Nature</th><th>Échéance</th><th class="nombre">Montant</th><th>Mode</th>
        ${moduleReglement ? '<th class="nombre">Pointé</th><th class="nombre">Reste</th>' : ''}<th class="cellule-boutons"></th></tr></thead>
      <tbody>${saisie.map((e, i) => {
        const x = e.id ? etatParId.get(e.id) : null;
        const retenueLigne = e.nature === NATURE.RETENUE;
        return `<tr data-i="${i}"${x?.reglee ? ' class="discret"' : ''}><td>${i + 1}${e.manuel ? ' ✎' : ''}</td>
          <td>${retenueLigne ? 'Retenue de garantie' : 'Échéance'}</td>
          <td><input type="date" data-champ="date" value="${echapper(e.date ?? '')}" ${modifiable ? '' : 'disabled'}
            title="${retenueLigne ? 'Vide : à la libération (marché) ; une date rend la retenue exigible' : 'Date d\'échéance'}">
            ${retenueLigne && !e.date && retenue ? `<small class="aide">${echapper(texteLiberation(retenue.liberation))}</small>` : ''}</td>
          <td class="nombre"><input data-champ="montant" size="12" inputmode="decimal" value="${echapper(formatNombre(e.montant, pm))}" ${modifiable ? '' : 'disabled'}></td>
          <td><span data-mode="${i}"></span></td>
          ${moduleReglement ? `<td class="nombre">${x ? f(x.pointe) : ''}</td><td class="nombre">${x ? f(x.reste) : ''}</td>` : ''}
          <td class="cellule-boutons">${modifiable && !(x && !D(x.pointe ?? 0).isZero()) ? `<button type="button" data-supprimer="${i}" title="Retirer l'échéance">✕</button>` : ''}</td></tr>`;
      }).join('')}</tbody></table>
      ${ecarts.map((e) => `<p class="avertissement">⚠ ${e.nature === NATURE.NORMALE ? `La somme des échéances diffère du net à payer (${f(netAPayer)}) de ${f(e.ecart)}`
        : `La somme des retenues diffère de la retenue de la pièce (${f(retenuePiece)}) de ${f(e.ecart)}`}.</p>`).join('')}`}
      </section>
      ${moduleReglement && echeancesDoc.length ? `<section><div class="entete-page"><h3>Règlements et imputations</h3><span class="boutons">
        ${doc.ent_verrouille && ouvertes.length ? `<button type="button" data-imputer title="${D(netAPayer).isNegative() ? 'Imputer cet avoir sur une facture du tiers' : 'Imputer un avoir ou le trop-perçu d\'un règlement du tiers'}">⇄ Imputer…</button>` : ''}
        ${doc.ent_tiers_id ? `<a href="/reglements?sens=${sens}&tiers=${doc.ent_tiers_id}" data-lien>💳 Règlements du tiers</a>` : ''}</span></div>
        ${pointages.length ? `<table class="tableau-compact"><thead><tr><th>Date</th><th>Origine</th><th>Référence</th><th>Échéance</th><th class="nombre">Montant</th></tr></thead>
        <tbody>${pointages.map((p) => `<tr><td>${formatDate(p.date)}</td><td>${p.source === SOURCE_POINTAGE.CAUTION ? `Caution ${echapper(p.commentaire ?? '')}`
          : p.source === SOURCE_POINTAGE.IMPUTATION ? `Imputation : ${p.contreparties.map((c) => `<a href="${urlDocument(c.piece_id)}" data-lien>${echapper(c.type)} ${echapper(c.piece ?? `#${c.piece_id}`)}</a>`).join(', ')}`
          : `Règlement ${echapper(libelleMode(p.mode))}`}</td><td>${echapper(p.reference ?? '')}</td>
          <td>${(saisie.findIndex((e) => e.id === p.echeance_id) + 1) || ''}</td><td class="nombre">${f(p.montant)}</td></tr>`).join('')}</tbody></table>`
        : '<p class="aide">Aucun règlement pointé.</p>'}
        ${etat.length ? `<p>Reste à payer : <b>${f(etat.reduce((t, e) => t.plus(D(e.reste ?? 0)), D(0)))}</b></p>` : ''}</section>` : ''}
      ${acomptes ? `<section><h3>Déductions d'acompte${acomptes.valide ? '' : ' (aperçu : posées à la validation, sur la saisie enregistrée)'}</h3>
        ${acomptes.deductions.length ? `<table class="tableau-compact"><thead><tr><th>Acompte</th><th>Déduction</th><th class="nombre">Acompte</th><th class="nombre">Déjà déduit</th>
          <th class="nombre">Ce document</th><th class="nombre">Reste</th></tr></thead><tbody>${acomptes.deductions.map((a) => `<tr><td>n° ${a.rang}${a.libelle ? ` · ${echapper(a.libelle)}` : ''}</td>
          <td>${echapper({ PREMIERE: 'Première facture', DERNIERE: 'Dernière facture', LINEAIRE: 'Linéaire' }[a.deduction] ?? a.deduction)}${a.mode === 'CA' ? ' (HT)' : ' (TTC)'}</td>
          <td class="nombre">${f(a.montant_acompte)}</td><td class="nombre">${f(a.deja_deduit)}</td><td class="nombre">${f(a.a_deduire)}</td><td class="nombre">${f(a.reste)}</td></tr>`).join('')}</tbody></table>`
          : '<p class="aide">Aucun acompte émis à déduire.</p>'}
        ${doc.ent_marche_id ? `<p><a href="${urlFiche(TYPE_FICHE.MARCHE, doc.ent_marche_id)}" data-lien>Acomptes du marché</a></p>` : ''}</section>` : ''}
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
        if (n === undefined) { app.message('Montant invalide', 'avertissement'); return; }
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
      if (!(await confirmer('Remplacer l\'échéancier par la proposition calculée (condition de paiement de la pièce) ?'))) return;
      try { await api.recalculerEcheances(doc.ent_id); await page.chargerDocument(doc.ent_id); page.afficherReglements(); app.message('Échéancier recalculé', 'succes'); } catch (e) { app.message(e.message, 'erreur'); }
    });
    zone.querySelector('[data-ech="enregistrer"]')?.addEventListener('click', async () => {
      const ecarts = ecartsEcheancier(saisie, { netAPayer, retenue: retenuePiece });
      if (ecarts.length && !(await confirmer('La somme des échéances diffère du montant à payer. Enregistrer quand même ?'))) return;
      try {
        await api.modifierEcheances(doc.ent_id, saisie.map((e) => ({ id: e.id ?? null, date: e.date || null, montant: e.montant, mode: e.mode ?? null, nature: e.nature })));
        await page.chargerDocument(doc.ent_id); page.afficherReglements();
        app.message('Échéancier enregistré', 'succes');
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
      if (!source) { app.message('Avoir déjà entièrement imputé', 'avertissement'); return; }
      for (const e of tiers.filter((x) => x.piece_id !== doc.ent_id && x.nature === NATURE.NORMALE && D(x.reste).gt(0))) {
        choix.push({ libelle: `${e.type} ${e.piece ?? `#${e.piece_id}`} · échéance ${formatDate(e.date)} · reste ${f(e.reste)}`, cible: e.id, avoir: source.id,
          max: maximumImputation(source.reste, e.reste) });
      }
    } else {
      const cible = ouvertes.find((e) => D(e.reste).gt(0));
      if (!cible) { app.message('Aucune échéance à régler', 'avertissement'); return; }
      for (const e of tiers.filter((x) => x.piece_id !== doc.ent_id && D(x.reste).isNegative())) {
        choix.push({ libelle: `${e.type} ${e.piece ?? `#${e.piece_id}`} · reste ${f(e.reste)}`, cible: cible.id, avoir: e.id, max: maximumImputation(e.reste, cible.reste) });
      }
      const reglements = await api.reglements({ tiers: doc.ent_tiers_id, sens });
      for (const r of reglements.filter((x) => x.mode !== MODE_REGLEMENT_SYSTEME.IMPUTATION && D(x.non_pointe).gt(0))) {
        choix.push({ libelle: `Trop-perçu du règlement du ${formatDate(r.date)} (${libelleMode(r.mode)}${r.reference ? ` ${r.reference}` : ''}) · ${f(r.non_pointe)}`,
          cible: cible.id, reglement: r.id, max: maximumImputation(r.non_pointe, cible.reste) });
      }
    }
    if (!choix.length) { app.message(avoir ? 'Aucune facture ouverte du tiers' : 'Aucun avoir ni trop-perçu du tiers à imputer', 'avertissement'); return; }
    const r = await ouvrirDialogue({
      titre: avoir ? 'Imputer l\'avoir sur une facture' : 'Imputer un avoir ou un trop-perçu',
      html: `<div class="formulaire"><label>${avoir ? 'Facture' : 'Avoir ou règlement'} <span data-choix></span></label>
        <label>Montant <input data-montant size="12" inputmode="decimal" value="${echapper(formatNombre(choix[0].max, pm))}"></label>
        <label>Date <input type="date" data-date value="${aujourdhui()}"></label>
        <label>Commentaire <input data-commentaire maxlength="200"></label></div>`,
      boutons: [{ libelle: 'Annuler', valeur: null }, {
        libelle: 'Imputer', principal: true,
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
    if (!r.montant || D(r.montant).lte(0)) { app.message('Montant positif à saisir', 'avertissement'); return; }
    const x = choix[r.i];
    await api.imputer({ echeance_id: x.cible, montant: r.montant, avoir_echeance_id: x.avoir ?? null, reglement_id: x.reglement ?? null, date: r.date, commentaire: r.commentaire });
    app.message('Imputation enregistrée', 'succes');
    await afficherReglements(zone, { app, page, modes });
  };

  rendre();
}
