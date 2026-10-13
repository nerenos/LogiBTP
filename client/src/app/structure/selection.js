import { echapper, formatNombre } from '@logibtp/socle/ui';

// Choix d'un projet, d'une affaire, d'un chantier ou d'un marché dans une liste (double-clic sur la zone de code du
// rattachement) : recherche sur le code, le libellé et le parent, flèches + Entrée ou double-clic pour choisir.

const FERMES = ['CLOSE', 'CLOS', 'PERDU', 'ABANDONNE', 'RESILIE', 'SOLDE'];
const LIBELLES_STATUT = {
  EN_COURS: 'En cours', REMIS: 'Offre remise', OBTENU: 'Obtenu', PERDU: 'Perdu', ABANDONNE: 'Abandonné', OUVERTE: 'Ouverte', CLOSE: 'Close',
  OUVERT: 'Ouvert', TERMINE: 'Terminé', CLOS: 'Clos', SOLDE: 'Soldé', RESILIE: 'Résilié',
};

/** Parent affiché dans la liste : affaire d'un chantier, chantier d'un marché. */
function parent(type, x, refs) {
  if (type === 'chantier') return [refs.affaires?.find((a) => a.id === x.aff_id)?.code, refs.projets?.find((p) => p.id === x.prj_id)?.code].filter(Boolean).join(' · ');
  if (type === 'marche') return refs.chantiers?.find((c) => c.id === x.cha_id)?.code ?? '';
  return '';
}

/**
 * Ouvre la liste ; résout l'élément choisi ou null. type : projet | affaire | chantier | marche ; liste : éléments
 * (id, code, libelle, statut…) ; refs : référentiels (parents) ; courant : ID sélectionné ; filtre : restriction
 * proposée (chantiers de l'affaire…) { libelle, test(x) }.
 */
export function choisirRattachement({ type, titre, liste, refs, courant = null, filtre = null }) {
  const dlg = document.createElement('dialog');
  dlg.className = 'dialogue-structure dialogue-selection';
  dlg.innerHTML = `<form method="dialog">
    <h3>${echapper(titre)}</h3>
    <div class="selection-barre">
      <input type="search" data-recherche placeholder="Rechercher (code, libellé, parent)">
      ${filtre ? `<label><input type="checkbox" data-filtre checked> ${echapper(filtre.libelle)}</label>` : ''}
      <label><input type="checkbox" data-fermes> Clos et soldés</label>
    </div>
    <div class="selection-liste"><table class="table-selection"><thead><tr><th>Code</th><th>Libellé</th><th>${type === 'marche' ? 'Chantier' : type === 'chantier' ? 'Affaire · projet' : ''}</th>
      <th>Statut</th>${type === 'marche' ? '<th class="col-nombre">Montant HT</th>' : ''}</tr></thead><tbody></tbody></table></div>
    <div class="boutons"><button value="annuler">Annuler</button><button type="button" data-vider title="Retirer le rattachement">Aucun</button>
      <button type="button" class="principal" data-choisir>Choisir</button></div></form>`;
  document.body.append(dlg);
  const $ = (s) => dlg.querySelector(s);
  let lignes = [];
  let index = 0;
  const rendre = () => {
    const mots = $('[data-recherche]').value.trim().toLowerCase().split(/\s+/).filter(Boolean);
    lignes = liste.filter((x) => ($('[data-fermes]').checked || !FERMES.includes(x.statut) || x.id === courant)
      && (!filtre || !$('[data-filtre]').checked || filtre.test(x) || x.id === courant)
      && mots.every((m) => `${x.code} ${x.libelle} ${parent(type, x, refs)}`.toLowerCase().includes(m)));
    index = Math.max(0, lignes.findIndex((x) => x.id === courant));
    $('tbody').innerHTML = lignes.map((x, i) => `<tr data-i="${i}" class="${i === index ? 'courante' : ''}"><td><b>${echapper(x.code)}</b></td><td>${echapper(x.libelle ?? '')}</td>
      <td>${echapper(parent(type, x, refs))}</td><td>${echapper(LIBELLES_STATUT[x.statut] ?? x.statut ?? '')}</td>
      ${type === 'marche' ? `<td class="col-nombre">${x.montant_ht === null || x.montant_ht === undefined ? '' : formatNombre(x.montant_ht, 2)}</td>` : ''}</tr>`).join('')
      || '<tr><td colspan="5" class="aide">Aucun élément</td></tr>';
  };
  const marquer = () => {
    dlg.querySelectorAll('tbody tr[data-i]').forEach((tr) => tr.classList.toggle('courante', Number(tr.dataset.i) === index));
    dlg.querySelector('tbody tr.courante')?.scrollIntoView({ block: 'nearest' });
  };
  return new Promise((resoudre) => {
    // Résolution directe (l'événement close peut tarder quand la fenêtre n'est pas affichée).
    let fini = false;
    const choisir = (x) => {
      if (fini) return;
      fini = true;
      if (dlg.open) dlg.close();
      dlg.remove();
      resoudre(x);
    };
    dlg.addEventListener('close', () => choisir(null));
    $('[data-recherche]').addEventListener('input', rendre);
    dlg.querySelectorAll('[data-filtre], [data-fermes]').forEach((c) => c.addEventListener('change', rendre));
    $('tbody').addEventListener('click', (e) => { const tr = e.target.closest('tr[data-i]'); if (tr) { index = Number(tr.dataset.i); marquer(); } });
    $('tbody').addEventListener('dblclick', (e) => { const tr = e.target.closest('tr[data-i]'); if (tr) choisir(lignes[Number(tr.dataset.i)]); });
    $('[data-choisir]').addEventListener('click', () => { if (lignes[index]) choisir(lignes[index]); });
    $('[data-vider]').addEventListener('click', () => choisir({ id: null }));
    dlg.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); index = Math.min(lignes.length - 1, Math.max(0, index + (e.key === 'ArrowDown' ? 1 : -1))); marquer(); }
      if (e.key === 'Enter') { e.preventDefault(); if (lignes[index]) choisir(lignes[index]); }
    });
    rendre();
    dlg.showModal();
    $('[data-recherche]').focus();
  });
}

const LISTES = { projet: 'projets', affaire: 'affaires', chantier: 'chantiers', marche: 'marches' };
const TITRES_CHOIX = { projet: 'Choisir le projet', affaire: "Choisir l'affaire", chantier: 'Choisir le chantier', marche: 'Choisir le marché' };

/**
 * Zone de rattachement (projet, affaire, chantier, marché) : saisie du code (exact, ou seul code commençant ainsi),
 * double-clic ou F4 : liste de choix ; sous la zone, le libellé de l'élément en lien vers sa fiche. Un code inconnu
 * ouvre la liste. choisir(id | null) reçoit le rattachement retenu ; filtre : restriction proposée dans la liste.
 * Utilisée par l'entête des documents (avec son libellé) et les fiches de la structure (libellé du bloc de la fiche).
 */
export function champRattachement({ type, refs, valeur, choisir, titre = null, lecture = false, filtre = null }) {
  const liste = refs[LISTES[type]] ?? [];
  const x = liste.find((y) => y.id === Number(valeur)) ?? null;
  const div = document.createElement('div');
  div.className = 'rattachement-champ champ-rattachement';
  div.innerHTML = `${titre ? `<label>${echapper(titre)} </label>` : ''}
    <input class="rattachement-code" value="${echapper(x?.code ?? '')}" placeholder="${lecture ? '' : 'Code'}" autocomplete="off"
      ${lecture ? 'readonly' : 'title="Code (double-clic ou F4 : choisir dans la liste)"'}>
    <span class="rattachement-libelle">${x ? `<a href="/fiche/${type}/${x.id}" title="Ouvrir la fiche">${echapper(x.libelle ?? '')}</a>` : '<span class="aide">—</span>'}</span>`;
  const input = div.querySelector('input');
  if (titre) div.querySelector('label').append(input);
  if (lecture) return div;
  const ouvrir = async () => {
    const choix = await choisirRattachement({ type, titre: TITRES_CHOIX[type], liste, refs, courant: x?.id ?? null, filtre });
    input.blur(); // le dialogue rend le focus à la zone : l'appelant redessine
    if (choix) choisir(choix.id);
    else input.value = x?.code ?? '';
  };
  input.addEventListener('dblclick', () => ouvrir());
  input.addEventListener('keydown', (e) => { if (e.key === 'F4') { e.preventDefault(); ouvrir(); } });
  input.addEventListener('change', () => {
    const code = input.value.trim().toLowerCase();
    if (!code) { input.blur(); choisir(null); return; }
    const debut = liste.filter((y) => y.code.toLowerCase().startsWith(code));
    const trouve = liste.find((y) => y.code.toLowerCase() === code) ?? (debut.length === 1 ? debut[0] : null);
    if (trouve) { input.blur(); choisir(trouve.id); } else ouvrir();
  });
  return div;
}
