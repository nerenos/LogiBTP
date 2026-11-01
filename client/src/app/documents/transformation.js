import { texte, texteHtml, pluriel, icone, iconeHtml, textesParCode } from '@logibtp/socle/dictionnaire';
import { echapper, formatNombre, ouvrirModale, lireNombre } from '@logibtp/socle/ui';
import { D } from '@logibtp/socle';
import { unitesOptionnelles, FAMILLE_DOCUMENT } from '@logibtp/document';
import { api } from '../api.js';
import { confirmerAvertissements } from './avertissements.js';

// Transformation d'un document (devis → commande, commande → livraison, situation, facture…) : fenêtre de choix du
// type cible, regroupée par étape (commande, livraison, situation, facturation, retour et avoir) puis ventes / achats,
// chaque choix décrit en une ligne ; un clic (ou flèches et Entrée) choisit. Tout le reliquat est transformé.
// Options et variantes du document : chacune est retenue (prix vendu) ou non (non reprise), la ligne de base d'une
// variante peut aussi être écartée (choisirOptions). Hors marché, « Choisir les lignes » transforme ligne à ligne : les
// lignes décochées restent en reliquat, la quantité se modifie (choisirLignes, décision du 31/10/2026). Utilisée par la
// page document et par les listes de documents.

const etape = (code) => ({
  code,
  get titre() { return texte(`documents_btp.transformation.etapes.${code}.titre`); },
  get aide() { return texte(`documents_btp.transformation.etapes.${code}.aide`); },
});
const ETAPES = ['COMMANDE', 'RECEPTION', 'SITUATION', 'PRODUCTION', 'FACTURATION', 'RETOUR', 'AVOIR'].map(etape);
const ICONES = Object.fromEntries(['V_COMMANDE', 'V_RECEPTION', 'V_RETOUR', 'V_SITUATION', 'V_PRODUCTION', 'V_FACTURE', 'V_FACTURE_AVT', 'V_AVOIR', 'A_COMMANDE', 'A_RECEPTION', 'A_RETOUR', 'A_FACTURE', 'A_FACTURE_AVT', 'A_AVOIR', 'S_RESERVATION', 'S_SORTIE'].map((c) => [c, icone(`documents_btp_${c.toLowerCase()}`)]));
const DESCRIPTIONS = textesParCode('documents_btp.transformation.descriptions', ['V_COMMANDE', 'V_RECEPTION', 'V_RETOUR', 'V_SITUATION', 'V_PRODUCTION', 'V_FACTURE', 'V_FACTURE_AVT', 'V_AVOIR', 'A_COMMANDE', 'A_RECEPTION', 'A_RETOUR', 'A_FACTURE', 'A_FACTURE_AVT', 'A_AVOIR']);

/**
 * Cibles possibles d'un type de document, dans un ordre logique : [{ tyd_id, code, libelle, famille, etape, vaut }].
 * definition : définition du type source (transformations) ; types : types de documents.
 */
export function ciblesTransformation(definition, types) {
  const rang = (e) => { const i = ETAPES.findIndex((x) => x.code === e); return i < 0 ? 99 : i; };
  return (definition.transformations ?? []).map((t) => {
    const ty = types.find((x) => x.tyd_id === t.tra_cible_tyd_id);
    const inter = t.tra_intermediaire_tyd_id ? types.find((x) => x.tyd_id === t.tra_intermediaire_tyd_id) : null;
    return ty ? {
      tyd_id: ty.tyd_id, code: ty.tyd_code, libelle: ty.tyd_libelle, famille: ty.tyd_famille, etape: t.tra_etape, vaut: t.tra_vaut_etapes ?? [],
      intermediaire: inter?.tyd_libelle ?? null,
    } : null;
  }).filter(Boolean).sort((a, b) => rang(a.etape) - rang(b.etape) || (a.famille === b.famille ? 0 : a.famille === FAMILLE_DOCUMENT.VENTE ? -1 : 1) || a.libelle.localeCompare(b.libelle, 'fr'));
}

/**
 * Fenêtre de choix ; résout la cible choisie ou null. source : { numero, libelle_type, objet } ; ligneALigne : case
 * « Choisir les lignes et les quantités » proposée (la cible résolue porte alors parLignes).
 */
export function choisirTransformation({ source, cibles, ligneALigne = false }) {
  const dlg = document.createElement('dialog');
  dlg.className = 'dialogue-structure dialogue-transformation';
  const groupes = ETAPES.map((e) => ({ ...e, cibles: cibles.filter((c) => c.etape === e.code) }))
    .concat([{ code: 'AUTRE', titre: texte('documents_btp.transformation.autres'), aide: '', cibles: cibles.filter((c) => !ETAPES.some((e) => e.code === c.etape)) }])
    .filter((g) => g.cibles.length);
  let i = 0;
  dlg.innerHTML = `<form method="dialog">
    <h3>${texteHtml('documents_btp.transformation.titre', { type: source.libelle_type ?? texte('documents_btp.transformation.le_document'), numero: source.numero ?? '' })}</h3>
    ${source.objet ? `<p class="aide">${echapper(source.objet)}</p>` : ''}
    <div class="transformation-choix">${groupes.map((g) => `<section><h4>${echapper(g.titre)}${g.aide ? ` <small>${echapper(g.aide)}</small>` : ''}</h4>
      ${g.cibles.map((c) => `<button type="button" class="transformation-cible" data-i="${i++}">
        <span class="transformation-icone">${ICONES[c.code] ?? iconeHtml('documents_btp_document')}</span>
        <span><b>${echapper(c.libelle)}</b>${c.famille === FAMILLE_DOCUMENT.ACHAT ? ` <span class="pastille">${texteHtml('documents_btp.transformation.achat')}</span>` : c.famille === FAMILLE_DOCUMENT.SOUS_TRAITANCE ? ` <span class="pastille">${texteHtml('documents_btp.transformation.sous_traitance')}</span>` : ''}<small>${echapper(DESCRIPTIONS[c.code] ?? '')}${c.intermediaire ? ` ${texteHtml('documents_btp.transformation.intermediaire', { type: c.intermediaire.toLowerCase() })}` : c.vaut.length ? ` ${texteHtml('documents_btp.transformation.vaut_aussi', { etapes: c.vaut.map((v) => ETAPES.find((e) => e.code === v)?.titre.toLowerCase() ?? v).join(', ') })}` : ''}</small></span>
      </button>`).join('')}</section>`).join('')}</div>
    ${ligneALigne ? `<label class="coche" title="${texteHtml('documents_btp.transformation.par_lignes_aide')}"><input type="checkbox" data-par-lignes> ${texteHtml('documents_btp.transformation.par_lignes')}</label>`
      : `<p class="aide">${texteHtml('documents_btp.transformation.reliquat')}</p>`}
    <div class="boutons"><button value="annuler">${texteHtml('commun.annuler')}</button></div></form>`;
  document.body.append(dlg);
  const ordre = groupes.flatMap((g) => g.cibles);
  const boutons = [...dlg.querySelectorAll('[data-i]')];
  return new Promise((resoudre) => {
    let fini = false;
    const finir = (c) => {
      if (fini) return;
      fini = true;
      if (dlg.open) dlg.close();
      dlg.remove();
      resoudre(c);
    };
    dlg.addEventListener('close', () => finir(null));
    boutons.forEach((b) => b.addEventListener('click', () => {
      const c = ordre[Number(b.dataset.i)];
      finir({ ...c, parLignes: Boolean(dlg.querySelector('[data-par-lignes]')?.checked) });
    }));
    dlg.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      e.preventDefault();
      const k = boutons.indexOf(document.activeElement);
      boutons[(k + (e.key === 'ArrowDown' ? 1 : -1) + boutons.length) % boutons.length]?.focus();
    });
    ouvrirModale(dlg, () => dlg.close());
    boutons[0]?.focus();
  });
}

/**
 * Choix des options et variantes à la transformation : chaque unité (option ou variante, ligne ou tranche) est retenue
 * (passe en prix vendu) ou non retenue (non reprise) ; la ligne de base d'une variante est gardée par défaut et peut
 * être écartée. Résout [{ lig_id, retenue }] ou null (abandon). lignes : lignes enregistrées du document.
 */
export function choisirOptions({ lignes, unites, precision = 2 }) {
  const parId = new Map(lignes.map((l) => [l.lig_id, l]));
  const variantes = unites.filter((u) => u.base_id !== null);
  const options = unites.filter((u) => u.base_id === null);
  const bases = [...new Set(variantes.map((u) => u.base_id))];
  const ligne = (id, genre) => {
    const l = parId.get(id) ?? {};
    const libelle = String(l.lig_libelle_brut ?? l.lig_libelle_html ?? '').replace(/<[^>]*>/g, '').trim();
    const pastille = texte(`documents_btp.options.genres.${genre}`);
    return `<tr data-id="${id}" data-genre="${genre}">
      <td><span class="pastille">${pastille}</span></td><td>${echapper(l.lig_numerotation ?? '')}</td>
      <td class="libelle">${echapper(libelle || '—')}</td><td class="nombre">${formatNombre(l.lig_montant_ht ?? 0, precision)}</td>
      <td><label><input type="radio" name="c-${id}" value="1" ${genre === 'base' ? 'checked' : ''}> ${texteHtml(genre === 'base' ? 'documents_btp.options.gardee' : 'documents_btp.options.retenue')}</label></td>
      <td><label><input type="radio" name="c-${id}" value="0"> ${texteHtml(genre === 'base' ? 'documents_btp.options.ecartee' : 'documents_btp.options.non_retenue')}</label></td></tr>`;
  };
  const dlg = document.createElement('dialog');
  dlg.className = 'dialogue-structure dialogue-options';
  dlg.innerHTML = `<form method="dialog">
    <h3>${texteHtml('documents_btp.options.titre')}</h3>
    <p class="aide">${texteHtml('documents_btp.options.aide')}</p>
    <div class="options-choix"><table>
      ${options.length ? `<tbody>${options.map((u) => ligne(u.lig_id, u.type_prix)).join('')}</tbody>` : ''}
      ${bases.map((b) => `<tbody class="groupe-variante">${ligne(b, 'base')}${variantes.filter((u) => u.base_id === b).map((u) => ligne(u.lig_id, 'A')).join('')}</tbody>`).join('')}
    </table></div>
    <p class="erreur" data-erreur></p>
    <div class="boutons"><button type="button" data-tout="1">${texteHtml('documents_btp.options.tout')}</button><button type="button" data-tout="0">${texteHtml('documents_btp.options.rien')}</button>
      <button value="annuler">${texteHtml('commun.annuler')}</button><button type="button" class="principal" data-valider>${texteHtml('documents_btp.options.transformer')}</button></div></form>`;
  document.body.append(dlg);
  const choixDe = (id) => dlg.querySelector(`input[name="c-${id}"]:checked`)?.value ?? null;
  dlg.querySelectorAll('[data-tout]').forEach((b) => b.addEventListener('click', () => {
    for (const u of unites) dlg.querySelector(`input[name="c-${u.lig_id}"][value="${b.dataset.tout}"]`).checked = true;
  }));
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
    dlg.querySelector('[data-valider]').addEventListener('click', () => {
      const manquants = unites.filter((u) => choixDe(u.lig_id) === null);
      if (manquants.length) {
        dlg.querySelector('[data-erreur]').textContent = pluriel('documents_btp.options.sans_choix', manquants.length);
        dlg.querySelector(`tr[data-id="${manquants[0].lig_id}"] input`)?.focus();
        return;
      }
      finir([...unites.map((u) => u.lig_id), ...bases].map((id) => ({ lig_id: id, retenue: choixDe(id) === '1' })));
    });
    ouvrirModale(dlg, () => dlg.close());
  });
}

/**
 * Choix des lignes à transformer et de leur quantité (hors marché) : reliquat de l'étape (le plus petit des étapes
 * couvertes par la cible) proposé, case décochée = ligne laissée en reliquat. Résout [{ lig_id, qte }] ou null.
 * suivi : suivi des lignes de prix (GET /documents/{id}/suivi) ; etapes : étapes couvertes par la cible.
 */
export function choisirLignes({ suivi, etapes, precision = 3 }) {
  const reliquat = (s) => s.etapes.filter((e) => etapes.includes(e.etape)).reduce((m, e) => (m === null || D(e.reliquat).lt(m) ? D(e.reliquat) : m), null) ?? D(s.qte ?? 0);
  const lignes = suivi.map((s) => ({ ...s, reliquat: reliquat(s) }));
  const dlg = document.createElement('dialog');
  dlg.className = 'dialogue-structure dialogue-lignes-transformation';
  dlg.innerHTML = `<form method="dialog">
    <h3>${texteHtml('documents_btp.lignes.titre')}</h3>
    <p class="aide">${texteHtml('documents_btp.lignes.aide')}</p>
    <div class="options-choix"><table class="tableau-compact"><thead><tr><th><input type="checkbox" data-toutes checked title="${texteHtml('documents_btp.lignes.toutes')}"></th>
      <th>${texteHtml('documents_btp.lignes.numero')}</th><th>${texteHtml('documents_btp.lignes.libelle')}</th><th class="nombre">${texteHtml('documents_btp.lignes.quantite')}</th><th class="nombre">${texteHtml('documents_btp.lignes.reste')}</th><th class="nombre">${texteHtml('documents_btp.lignes.a_transformer')}</th></tr></thead>
      <tbody>${lignes.map((l, i) => `<tr data-i="${i}"><td><input type="checkbox" data-coche ${l.reliquat.gt(0) ? 'checked' : ''}></td>
        <td>${echapper(l.numerotation ?? '')}</td><td class="libelle">${echapper(String(l.libelle ?? '').replace(/<[^>]*>/g, '').trim() || '—')}</td>
        <td class="nombre">${formatNombre(l.qte ?? 0, precision)}</td><td class="nombre">${formatNombre(l.reliquat.toString(), precision)}</td>
        <td class="nombre"><input data-qte size="10" inputmode="decimal" value="${echapper(formatNombre(l.reliquat.toString(), precision))}"></td></tr>`).join('')}</tbody></table></div>
    <p class="erreur" data-erreur></p>
    <div class="boutons"><button value="annuler">${texteHtml('commun.annuler')}</button><button type="button" class="principal" data-valider>${texteHtml('documents_btp.options.transformer')}</button></div></form>`;
  document.body.append(dlg);
  dlg.querySelector('[data-toutes]').addEventListener('change', (e) => dlg.querySelectorAll('[data-coche]').forEach((c) => { c.checked = e.target.checked; }));
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
    dlg.querySelector('[data-valider]').addEventListener('click', () => {
      const res = [];
      for (const tr of dlg.querySelectorAll('tbody tr')) {
        if (!tr.querySelector('[data-coche]').checked) continue;
        const qte = lireNombre(tr.querySelector('[data-qte]').value);
        if (qte === undefined || qte === null) { dlg.querySelector('[data-erreur]').textContent = texte('documents_btp.lignes.quantite_invalide'); tr.querySelector('[data-qte]').focus(); return; }
        if (!D(qte).isZero()) res.push({ lig_id: lignes[Number(tr.dataset.i)].lig_id, qte });
      }
      if (!res.length) { dlg.querySelector('[data-erreur]').textContent = texte('documents_btp.lignes.aucune'); return; }
      finir(res);
    });
    ouvrirModale(dlg, () => dlg.close());
  });
}

/**
 * Transformation complète d'un document : choix de la cible, des options et variantes, puis transformation du
 * reliquat. Renvoie le document créé ({ ent_id, ent_numero, libelle }) ou null (aucune cible, choix abandonné).
 */
export async function transformerDocument({ entId, typeCode, numero, objet, types = null, definition = null, message = () => {} }) {
  const lesTypes = types ?? await api.typesDocument();
  const def = definition ?? await api.definition(typeCode);
  const cibles = ciblesTransformation(def, lesTypes);
  if (!cibles.length) { message(texte('documents_btp.transformation.aucune_cible'), 'avertissement'); return null; }
  // Validité dépassée, document rejeté : avertissement, l'utilisateur choisit (R3, P25).
  if (!(await confirmerAvertissements(entId, 'TRANSFORMER', texte('documents_btp.options.transformer')))) return null;
  const complet = await api.document(entId);
  // Ligne à ligne : hors marché (les documents d'un marché se créent depuis le marché, avec toutes ses commandes).
  const cible = await choisirTransformation({ source: { numero, objet, libelle_type: def.type?.tyd_libelle }, cibles, ligneALigne: !complet.document?.ent_marche_id });
  if (!cible) return null;
  const unites = unitesOptionnelles(complet.lignes);
  let choix = [];
  if (unites.length) {
    choix = await choisirOptions({ lignes: complet.lignes, unites, precision: complet.document?.ent_precision_montant ?? 2 });
    if (!choix) return null;
  }
  let lignes = [];
  if (cible.parLignes) {
    lignes = await choisirLignes({ suivi: await api.suivi(entId), etapes: [cible.etape, ...cible.vaut] });
    if (!lignes) return null;
  }
  const rep = await api.transformer(entId, { cible_tyd_id: cible.tyd_id, lignes, choix });
  return { ent_id: rep.document.ent_id, ent_numero: rep.document.ent_numero, libelle: cible.libelle };
}
