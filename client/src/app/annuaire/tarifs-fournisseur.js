import { urlFiche, TYPE_FICHE } from '../codes.js';
import { echapper, formatNombre, confirmer, ouvrirDialogue, telechargerCsv, nombreSaisi } from '@logibtp/socle/ui';
import { prixNetTarif } from '@logibtp/bibliotheque';
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
        : `<input data-c="recherche" list="tarifs-elements" size="22" placeholder="Élément : code, libellé, code-barres…" value="${echapper(t.recherche ?? '')}">`}</td>
      <td><input data-c="reference" value="${echapper(t.reference ?? '')}" size="9"></td>
      <td><input data-c="libelle" value="${echapper(t.libelle ?? '')}" size="18"></td>
      <td><input data-c="prix_public" inputmode="decimal" value="${saisi(t.prix_public)}" size="7"></td>
      <td><input data-c="remise1" inputmode="decimal" value="${saisi(t.remise1)}" size="3"></td>
      <td><input data-c="remise2" inputmode="decimal" value="${saisi(t.remise2)}" size="3"></td>
      <td><input data-c="prix" inputmode="decimal" value="${t.prix_public !== null && t.prix_public !== undefined ? '' : saisi(t.prix)}" size="7" placeholder="${t.prix_public !== null && t.prix_public !== undefined ? net(t) : ''}" title="Prix net : saisi sans prix public, sinon calculé"></td>
      <td><input data-c="unite" list="tarifs-unites" value="${echapper(t.unite ?? '')}" size="4"></td>
      <td><input data-c="delai" inputmode="numeric" value="${saisi(t.delai)}" size="3"></td>
      <td><input data-c="code_barre" value="${echapper(t.code_barre ?? '')}" size="11"></td>
      <td><input type="date" data-c="debut" value="${jour(t.debut)}"></td><td><input type="date" data-c="fin" value="${jour(t.fin)}"></td>
      <td><input type="checkbox" data-c="principal" ${t.principal ? 'checked' : ''} title="Tarif principal de l'élément"></td>
      <td class="cellule-boutons">${modifiable ? `<button type="button" class="bouton-icone" data-enregistrer title="${t.id ? 'Enregistrer le tarif' : 'Ajouter le tarif'}">${t.id ? '✓' : '＋'}</button>
        ${t.id ? '<button type="button" class="bouton-icone" data-supprimer title="Retirer ce tarif">✕</button>' : ''}` : ''}</td></tr>`;
    const lignes = modifiable ? [...tarifs, nouveau] : tarifs;
    corps.innerHTML = `<div class="annuaire-tarifs"><div class="titre-actions"><h3>Tarifs du fournisseur</h3><span class="titre-actions-boutons">
        ${modifiable ? `<button type="button" class="bouton-icone" data-importer title="Importer un fichier CSV de tarifs (format fixe)">📥</button>
        <button type="button" class="bouton-icone" data-modele title="Télécharger le modèle du fichier CSV">📄</button>` : ''}</span></div>
      <table class="tableau-compact largeur-contenu"><thead><tr><th>Élément</th><th>Réf.\nfournisseur</th><th>Libellé\nfournisseur</th><th>Prix\npublic</th><th>Rem.\n1 %</th><th>Rem.\n2 %</th>
        <th>Prix\nnet</th><th>U.</th><th>Délai\n(j)</th><th>Code-barres</th><th>Début</th><th>Fin</th><th>★</th><th></th></tr></thead>
      <tbody>${lignes.map(ligne).join('') || '<tr><td colspan="14" class="aide">Aucun tarif.</td></tr>'}</tbody></table>
      <datalist id="tarifs-elements">${elementsTrouves.map((e) => `<option value="${echapper(`${e.bib_code}:${e.code} – ${e.libelle ?? ''}`)}"></option>`).join('')}</datalist>
      <datalist id="tarifs-unites">${unites.map((u) => `<option value="${echapper(u.unt_code ?? u.code)}"></option>`).join('')}</datalist>
      <p class="aide">Prix net = prix public × (1 − remise 1) × (1 − remise 2), sinon le prix saisi ; il alimente le prix d'achat de l'élément (scénarios fournisseur principal et meilleur prix).</p></div>`;
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
      tr.querySelector('[data-enregistrer]')?.addEventListener('click', async () => {
        const v = { ...t };
        tr.querySelectorAll('[data-c]').forEach((el) => { if (el.dataset.c !== 'recherche') v[el.dataset.c] = el.type === 'checkbox' ? el.checked : el.value || null; });
        for (const c of ['prix', 'prix_public', 'remise1', 'remise2']) v[c] = nombreSaisi(v[c]);
        v.delai = v.delai === null ? null : Number(nombreSaisi(v.delai));
        if (v.prix === null) v.prix = v.prix_public === null ? null : '0';
        const eleId = t.id ? t.ele_id : nouveau.ele_id;
        if (!eleId) { message('Choisissez l\'élément dans la liste proposée', 'avertissement'); return; }
        if (v.prix === null) { message('Prix public ou prix net à saisir', 'avertissement'); return; }
        try {
          await bibliotheque.enregistrerTarif(eleId, { ...v, id: t.id ?? 0, fournisseur: tiers.nom, tiers_id: tiers.id });
          tarifs = await bibliotheque.tarifsTiers(tiers.id);
          if (!t.id) nouveau = { principal: false };
          message('Tarif enregistré (prix de l\'élément recalculé)', 'succes');
          rendre();
        } catch (e) { message(e.message, 'erreur'); }
      });
      tr.querySelector('[data-supprimer]')?.addEventListener('click', async () => {
        if (!await confirmer('Retirer ce tarif ?')) return;
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
    const libelles = { CREE: '＋ Création', MAJ: '✎ Mise à jour', ERREUR: '⚠ Erreur' };
    const ok = await ouvrirDialogue({
      titre: `📥 Import des tarifs : ${fichier.name}`,
      html: `<p>${r.crees} création(s), ${r.mises_a_jour} mise(s) à jour, ${r.erreurs + lu.erreurs.length} ligne(s) en erreur${lu.inconnues.length ? ` · colonnes ignorées : ${echapper(lu.inconnues.join(', '))}` : ''}.</p>
        <div class="tableau-defilant"><table class="tableau-compact"><thead><tr><th>Ligne</th><th>Élément</th><th>Action</th><th>Message</th></tr></thead><tbody>
        ${rapport.map((x) => `<tr class="${x.action === 'ERREUR' ? 'erreur' : ''}"><td>${x.rang}</td><td>${echapper(x.code ?? '')}</td><td>${libelles[x.action] ?? x.action}</td><td>${echapper(x.message ?? '')}</td></tr>`).join('')}</tbody></table></div>
        <p class="aide">Colonnes du format : ${COLONNES_TARIFS.map(([c, l]) => `<b>${c}</b> (${echapper(l)})`).join(', ')}.</p>`,
      boutons: [{ libelle: 'Annuler', valeur: false }, ...(valables ? [{ libelle: `Importer ${valables} ligne(s)`, principal: true, valeur: true }] : [])],
    });
    if (!ok) return false;
    try {
      const fin = await bibliotheque.importerTarifs({ ...demande, simulation: false });
      message(`Tarifs importés : ${fin.crees} création(s), ${fin.mises_a_jour} mise(s) à jour`, 'succes');
      return true;
    } catch (e) { message(e.message, 'erreur'); return false; }
  }

  rendre();
}
