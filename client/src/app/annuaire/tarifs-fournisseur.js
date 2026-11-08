import { texte, texteHtml, icone, iconeHtml } from '@logibtp/socle/dictionnaire';
import { urlFiche, TYPE_FICHE } from '../codes.js';
import { echapper, formatNombre, confirmer, ouvrirDialogue, telechargerCsv, nombreSaisi } from '@logibtp/socle/ui';
import { prixNetTarif } from '@logibtp/bibliotheque';
import { actionsLigneTarif, tarifDepuisSaisie } from '@logibtp/bibliotheque/ui';
import { lireCsvTarifs, modeleCsvTarifs, COLONNES_TARIFS } from './import-tarifs.js';

// Onglet Tarifs de la fiche d'un fournisseur (lot 8 des demandes du 25/10/2026, A10 et A12) : tarifs de la bibliothèque
// reliés au fournisseur (tfo_tiers_id), saisis dans le tableau (élément cherché par code, libellé, mots-clés ou
// code-barres ; prix public et remises, prix net, unité, délai, code-barres, validité, principal), retirés ; import d'un
// fichier CSV à format fixe (import-tarifs.js) contrôlé par le serveur avant l'écriture (rapport ligne par ligne).

const jour = (d) => (d ? String(d).slice(0, 10) : '');
const saisi = (v) => echapper(v === undefined || v === null ? '' : String(v).replace('.', ','));
const net = (t) => {
  try { return formatNombre(String(prixNetTarif({ ...t, prix: t.prix ?? 0 })), 4); } catch { return ''; }
};

/**
 * Onglet Tarifs : bibliotheque (fournisseur du module), tiers { id, nom }, message(texte, niveau), ouvrir(type, id, e).
 */
export async function rendreTarifsFournisseur(corps, { bibliotheque, tiers, message, ouvrir, modifiable = true }) {
  const unites = await bibliotheque.unites().catch(() => []);
  let tarifs = await bibliotheque.tarifsTiers(tiers.id);
  let nouveau = { principal: false };
  let elementsTrouves = [];
  const rendre = () => {
    const ligne = (t, i) => `<tr data-i="${i}">
      <td>${t.id ? `<a href="${urlFiche(TYPE_FICHE.ELEMENT, t.ele_id)}" data-element="${t.ele_id}"><b>${echapper(t.bib_code ?? '')}:${echapper(t.code ?? '')}</b></a><br><small>${echapper(t.element ?? '')}</small>`
        : `<input data-c="recherche" list="tarifs-elements" size="22" placeholder="${texteHtml('annuaire_btp.tarifs.recherche')}" value="${echapper(t.recherche ?? '')}">`}</td>
      <td><input data-c="reference" value="${echapper(t.reference ?? '')}" size="9"></td>
      <td><input data-c="libelle" value="${echapper(t.libelle ?? '')}" size="18"></td>
      <td><input data-c="prix_public" inputmode="decimal" value="${saisi(t.prix_public)}" size="7"></td>
      <td><input data-c="remise1" inputmode="decimal" value="${saisi(t.remise1)}" size="3"></td>
      <td><input data-c="remise2" inputmode="decimal" value="${saisi(t.remise2)}" size="3"></td>
      <td><input data-c="prix" inputmode="decimal" value="${t.prix_public !== null && t.prix_public !== undefined ? '' : saisi(t.prix)}" size="7" placeholder="${t.prix_public !== null && t.prix_public !== undefined ? net(t) : ''}" title="${texteHtml('annuaire_btp.tarifs.prix_net')}"></td>
      <td><input data-c="unite" list="tarifs-unites" value="${echapper(t.unite ?? '')}" size="4"></td>
      <td><input data-c="delai" inputmode="numeric" value="${saisi(t.delai)}" size="3"></td>
      <td><input data-c="code_barre" value="${echapper(t.code_barre ?? '')}" size="11"></td>
      <td><input type="date" data-c="debut" value="${jour(t.debut)}"></td><td><input type="date" data-c="fin" value="${jour(t.fin)}"></td>
      <td><input type="checkbox" data-c="principal" ${t.principal ? 'checked' : ''} title="${texteHtml('annuaire_btp.tarifs.principal')}"></td>
      <td class="cellule-boutons">${actionsLigneTarif(t, modifiable).map((a) => (a === 'enregistrer'
        ? `<button type="button" class="bouton-icone" data-enregistrer title="${texteHtml('annuaire_btp.tarifs.ajouter')}">${iconeHtml('ajouter')}</button>`
        : `<button type="button" class="bouton-icone" data-supprimer title="${texteHtml('annuaire_btp.tarifs.retirer')}">${iconeHtml('retirer')}</button>`)).join('')}</td></tr>`;
    const lignes = modifiable ? [...tarifs, nouveau] : tarifs;
    corps.innerHTML = `<div class="annuaire-tarifs"><div class="titre-actions"><h3>${texteHtml('annuaire_btp.tarifs.titre')}</h3><span class="titre-actions-boutons">
        ${modifiable ? `<button type="button" class="bouton-icone" data-importer title="${texteHtml('annuaire_btp.tarifs.importer')}">${iconeHtml('annuaire_btp_tarif_importer')}</button>
        <button type="button" class="bouton-icone" data-modele title="${texteHtml('annuaire_btp.tarifs.modele')}">${iconeHtml('annuaire_btp_tarif_modele')}</button>` : ''}</span></div>
      <table class="tableau-compact largeur-contenu"><thead><tr>${['element', 'reference', 'libelle', 'prix_public', 'remise1', 'remise2', 'prix', 'unite', 'delai', 'code_barre', 'debut', 'fin'].map((c) => `<th>${texteHtml(`annuaire_btp.tarifs.colonnes.${c}`)}</th>`).join('')}
        <th title="${texteHtml('annuaire_btp.tarifs.principal')}">${iconeHtml('annuaire_btp_tarif_principal')}</th><th></th></tr></thead>
      <tbody>${lignes.map(ligne).join('') || `<tr><td colspan="14" class="aide">${texteHtml('annuaire_btp.tarifs.aucun')}</td></tr>`}</tbody></table>
      <datalist id="tarifs-elements">${elementsTrouves.map((e) => `<option value="${echapper(`${e.bib_code}:${e.code} – ${e.libelle ?? ''}`)}"></option>`).join('')}</datalist>
      <datalist id="tarifs-unites">${unites.map((u) => `<option value="${echapper(u.unt_code ?? u.code)}"></option>`).join('')}</datalist>
      <p class="aide">${texteHtml('annuaire_btp.tarifs.aide')}</p></div>`;
    corps.querySelectorAll('[data-element]').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); ouvrir('element', Number(a.dataset.element), e); }));
    const champRecherche = corps.querySelector('[data-c="recherche"]');
    let minuterie;
    champRecherche?.addEventListener('input', () => {
      nouveau.recherche = champRecherche.value;
      const choisi = elementsTrouves.find((e) => `${e.bib_code}:${e.code} – ${e.libelle ?? ''}` === champRecherche.value);
      nouveau.ele_id = choisi?.id ?? null;
      if (choisi && !nouveau.unite) { nouveau.unite = choisi.unite_stock; corps.querySelector('tr:last-child [data-c="unite"]').value = choisi.unite_stock; }
      clearTimeout(minuterie);
      if (choisi) return;
      minuterie = setTimeout(async () => {
        elementsTrouves = (await bibliotheque.rechercher({ recherche: champRecherche.value }).catch(() => [])).filter((e) => ['ARTICLE', 'OUVRAGE'].includes(e.type));
        corps.querySelector('#tarifs-elements').innerHTML = elementsTrouves.map((e) => `<option value="${echapper(`${e.bib_code}:${e.code} – ${e.libelle ?? ''}`)}"></option>`).join('');
      }, 250);
    });
    corps.querySelectorAll('tr[data-i]').forEach((tr) => {
      const t = lignes[Number(tr.dataset.i)];
      // Une ligne existante modifiée s'enregistre quand on la quitte ; la ligne vide garde son bouton d'ajout.
      const enregistrer = async () => {
        const saisie = {};
        tr.querySelectorAll('[data-c]').forEach((el) => { if (el.dataset.c !== 'recherche') saisie[el.dataset.c] = el.type === 'checkbox' ? el.checked : el.value || null; });
        const v = tarifDepuisSaisie(t, saisie);
        const eleId = t.id ? t.ele_id : nouveau.ele_id;
        if (!eleId) { message(texte('annuaire_btp.tarifs.choisir'), 'avertissement'); return; }
        if (v.prix === null) { message(texte('annuaire_btp.tarifs.sans_prix'), 'avertissement'); return; }
        try {
          await bibliotheque.enregistrerTarif(eleId, { ...v, id: t.id ?? 0, fournisseur: tiers.nom, tiers_id: tiers.id });
          tarifs = await bibliotheque.tarifsTiers(tiers.id);
          if (!t.id) nouveau = { principal: false };
          message(texte('annuaire_btp.tarifs.enregistre'), 'succes');
          rendre();
        } catch (e) { tr.classList.add('erreur'); tr.title = e.message; message(e.message, 'erreur'); }
      };
      tr.querySelector('[data-enregistrer]')?.addEventListener('click', enregistrer);
      if (t.id) {
        let sale = false;
        tr.addEventListener('change', () => { sale = true; });
        tr.addEventListener('focusout', (e) => {
          if (!sale || tr.contains(e.relatedTarget)) return;
          sale = false;
          enregistrer();
        });
      }
      tr.querySelector('[data-supprimer]')?.addEventListener('click', async () => {
        if (!await confirmer(texte('annuaire_btp.tarifs.retirer_confirmer'))) return;
        try { await bibliotheque.supprimerTarif(t.ele_id, t.id); tarifs = await bibliotheque.tarifsTiers(tiers.id); rendre(); } catch (e) { message(e.message, 'erreur'); }
      });
    });
    corps.querySelector('[data-modele]')?.addEventListener('click', () => telechargerCsv('modele-tarifs.csv', modeleCsvTarifs()));
    corps.querySelector('[data-importer]')?.addEventListener('click', () => {
      const f = document.createElement('input');
      f.type = 'file';
      f.accept = '.csv,.txt,text/csv';
      f.addEventListener('change', async () => {
        const fichier = f.files?.[0];
        if (!fichier) return;
        if (await importer(fichier)) { tarifs = await bibliotheque.tarifsTiers(tiers.id); rendre(); }
      });
      f.click();
    });
  };

  /** Contrôle du fichier par le serveur (simulation), rapport, puis import des lignes valables sur confirmation. */
  async function importer(fichier) {
    const lu = lireCsvTarifs(await fichier.text());
    if (lu.erreurs.some((e) => e.rang === 0)) { message(lu.erreurs[0].message, 'erreur'); return false; }
    const demande = { tiers_id: tiers.id, fournisseur: tiers.nom, fichier: fichier.name, lignes: lu.lignes };
    let r;
    try { r = await bibliotheque.importerTarifs({ ...demande, simulation: true }); } catch (e) { message(e.message, 'erreur'); return false; }
    // Rang du fichier : erreurs de forme (lecture) et rapport du serveur (rangs des lignes envoyées).
    const rapport = [
      ...lu.erreurs.map((e) => ({ rang: e.rang, code: '', action: 'ERREUR', message: e.message })),
      ...r.lignes.map((x) => ({ ...x, rang: lu.lignes[x.rang - 1]?.rang ?? x.rang })),
    ].sort((a, b) => a.rang - b.rang);
    const valables = r.crees + r.mises_a_jour;
    const icones = { CREE: 'annuaire_btp_tarif_cree', MAJ: 'annuaire_btp_tarif_maj', ERREUR: 'avertissement' };
    const ok = await ouvrirDialogue({
      titre: `${icone('annuaire_btp_tarif_importer')} ${texte('annuaire_btp.tarifs.import.titre', { fichier: fichier.name })}`,
      html: `<p>${texteHtml('annuaire_btp.tarifs.import.bilan', { crees: r.crees, maj: r.mises_a_jour, erreurs: r.erreurs + lu.erreurs.length })}${lu.inconnues.length ? ` · ${texteHtml('annuaire_btp.tarifs.import.ignorees', { colonnes: lu.inconnues.join(', ') })}` : ''}.</p>
        <div class="tableau-defilant"><table class="tableau-compact"><thead><tr><th>${texteHtml('annuaire_btp.tarifs.import.ligne')}</th><th>${texteHtml('annuaire_btp.tarifs.colonnes.element')}</th><th>${texteHtml('annuaire_btp.tarifs.import.action')}</th><th>${texteHtml('annuaire_btp.tarifs.import.message')}</th></tr></thead><tbody>
        ${rapport.map((x) => `<tr class="${x.action === 'ERREUR' ? 'erreur' : ''}"><td>${x.rang}</td><td>${echapper(x.code ?? '')}</td><td>${icones[x.action] ? `${iconeHtml(icones[x.action])} ${texteHtml(`annuaire_btp.tarifs.actions.${x.action}`)}` : echapper(x.action)}</td><td>${echapper(x.message ?? '')}</td></tr>`).join('')}</tbody></table></div>
        <p class="aide">${texteHtml('annuaire_btp.tarifs.import.colonnes')} ${COLONNES_TARIFS.map(([c, l]) => `<b>${c}</b> (${echapper(l)})`).join(', ')}.</p>`,
      boutons: [{ libelle: texte('commun.annuler'), valeur: false }, ...(valables ? [{ libelle: texte('annuaire_btp.tarifs.import.importer', { nombre: valables }), principal: true, valeur: true }] : [])],
    });
    if (!ok) return false;
    try {
      const fin = await bibliotheque.importerTarifs({ ...demande, simulation: false });
      message(texte('annuaire_btp.tarifs.import.fait', { crees: fin.crees, maj: fin.mises_a_jour }), 'succes');
      return true;
    } catch (e) { message(e.message, 'erreur'); return false; }
  }

  rendre();
}
