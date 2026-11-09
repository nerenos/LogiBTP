import { texte, texteHtml, icone, iconeHtml } from '@logibtp/socle/dictionnaire';
import { echapper, ouvrirDialogue } from '@logibtp/socle/ui';
import { api } from '../api.js';
import { estHorsLigne } from '../hors-ligne/attente.js';

// Bibliothèque simplifiée du terrain (plan terrain-suites, lot 18 ; TS17 b, TS15 a) : choix d'un article pour une
// demande d'approvisionnement. Articles du chantier (lignes de ses marchés, gardés hors ligne par le préchargement)
// filtrés sur l'appareil, recherche dans toute la bibliothèque avec le réseau ; fiche réduite (photo, notices
// techniques, unités, conditionnements), jamais de prix. Serveur : TerrainBibliothequeBtp.cs.

/** Texte sans accent ni casse (recherche sur l'appareil). */
const sansAccent = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/**
 * Articles filtrés sur l'appareil, sans réseau : chaque mot (cinq au plus) dans le code ou le libellé, sans accent ni
 * casse (règle du serveur, mots-clés et code-barres en moins : absents de la fiche réduite).
 */
export function filtrerArticles(articles, recherche) {
  const mots = sansAccent(recherche).split(/\s+/).filter(Boolean).slice(0, 5);
  if (!mots.length) return [...(articles ?? [])];
  return (articles ?? []).filter((a) => { const t = sansAccent(`${a.code} ${a.libelle}`); return mots.every((m) => t.includes(m)); });
}

/** Unités proposées pour un article : achat (défaut du serveur), stock, puis ses conversions, sans doublon. */
export function unitesArticle(a) {
  return [...new Set([a?.unite_achat, a?.unite, ...(a?.conditionnements ?? []).map((c) => c?.unite)].filter(Boolean))];
}

/** Ligne de demande d'un article choisi : { ele, quantite, unite } (quantité positive, défaut 1 ; unité de l'article). */
export function ligneDemande(article, quantite, unite) {
  const q = Number(String(quantite ?? '').replace(',', '.'));
  const unites = unitesArticle(article);
  return { ele: article.id, quantite: q > 0 ? q : 1, unite: unites.includes(unite) ? unite : unites[0] ?? null };
}

/** Fusion sans doublon (articles du chantier d'abord). */
const fusionner = (...listes) => [...new Map(listes.flat().map((a) => [a.id, a])).values()];

/** Fiche réduite d'un article (photo, unités, conditionnements, notices). */
function ficheHtml(a) {
  const conditionnements = (a.conditionnements ?? []).filter((c) => c?.unite)
    .map((c) => `<li>${texteHtml('terrain_btp.bibliotheque.conditionnement', { unite: c.unite, formule: c.formule ?? '', stock: a.unite })}</li>`).join('');
  const notices = (a.notices ?? []).map((n) => `<li><a href="${echapper(api.terrain.bibliotheque.urlPiece(n.id))}" target="_blank" rel="noopener">${iconeHtml('terrain_btp_piece')} ${echapper(n.titre ?? n.nom_fichier ?? '')}</a></li>`).join('');
  return `<div class="terrain-detail">
    ${a.photo ? `<img src="${echapper(api.terrain.bibliotheque.urlPiece(a.photo))}" alt="${texteHtml('terrain_btp.bibliotheque.photo', { article: a.libelle })}" loading="lazy" style="max-width: 100%">` : ''}
    <p>${texteHtml('terrain_btp.bibliotheque.unite', { unite: a.unite })}${a.unite_achat && a.unite_achat !== a.unite ? ` · ${texteHtml('terrain_btp.bibliotheque.unite_achat', { unite: a.unite_achat })}` : ''}</p>
    ${conditionnements ? `<div><b>${texteHtml('terrain_btp.bibliotheque.conditionnements')}</b><ul class="terrain-liens">${conditionnements}</ul></div>` : ''}
    ${notices ? `<div><b>${texteHtml('terrain_btp.bibliotheque.notices')}</b><ul class="terrain-liens">${notices}</ul></div>` : ''}
  </div>`;
}

function listeHtml(articles) {
  if (!articles.length) return `<p class="terrain-vide">${texteHtml('terrain_btp.bibliotheque.aucun')}</p>`;
  return articles.map((a) => `<details class="terrain-tache">
      <summary><b class="terrain-libelle">${echapper(a.code)}</b> ${echapper(a.libelle)}
        <button type="button" class="principal" data-choisir="${a.id}">${texteHtml('terrain_btp.bibliotheque.choisir')}</button></summary>
      ${ficheHtml(a)}
    </details>`).join('');
}

/**
 * Choix d'un article de la bibliothèque pour le chantier `chantier` ({ id, code, libelle }) ; renvoie l'article (fiche
 * réduite) ou null. Sans réseau : articles du chantier gardés sur l'appareil seulement.
 */
export async function choisirArticle(app, chantier) {
  let duChantier = [];
  let horsLigne = false;
  try { duChantier = await api.terrain.bibliotheque.chantier(chantier.id); } catch (e) { if (!estHorsLigne(e)) { app.erreur(e); return null; } horsLigne = true; }
  let trouves = [];
  return ouvrirDialogue({
    titre: `${icone('terrain_btp_bibliotheque')} ${texte('terrain_btp.bibliotheque.titre', { chantier: `${chantier.code ?? ''} ${chantier.libelle ?? ''}`.trim() })}`,
    html: `<form data-recherche class="ligne">
        <input type="search" data-mots size="24" placeholder="${texteHtml('terrain_btp.bibliotheque.recherche')}">
        <button type="submit" title="${texteHtml('terrain_btp.bibliotheque.chercher')}">${iconeHtml('rechercher')} ${texteHtml('terrain_btp.bibliotheque.chercher')}</button>
      </form>
      ${horsLigne ? `<p class="carte avertissement">${iconeHtml('terrain_btp_hors_ligne')} ${texteHtml('terrain_btp.bibliotheque.indisponible')}</p>` : ''}
      <p class="aide" data-aide></p>
      <div class="terrain-liste" data-articles></div>`,
    boutons: [{ libelle: texte('commun.annuler'), valeur: null }],
    construire: (dlg, fermer) => {
      const mots = dlg.querySelector('[data-mots]');
      const zone = dlg.querySelector('[data-articles]');
      const afficher = () => {
        const proposes = fusionner(filtrerArticles(duChantier, mots.value), filtrerArticles(trouves, mots.value));
        dlg.querySelector('[data-aide]').textContent = texte(trouves.length ? 'terrain_btp.bibliotheque.resultats' : 'terrain_btp.bibliotheque.du_chantier');
        zone.innerHTML = listeHtml(proposes);
        zone.querySelectorAll('[data-choisir]').forEach((b) => b.addEventListener('click', (e) => {
          e.preventDefault();
          fermer(proposes.find((a) => String(a.id) === b.dataset.choisir) ?? null);
        }));
      };
      mots.addEventListener('input', afficher);
      dlg.querySelector('[data-recherche]').addEventListener('submit', async (e) => {
        e.preventDefault();
        if (mots.value.trim().length < 2) { mots.focus(); return; }
        try { trouves = await api.terrain.bibliotheque.articles(mots.value.trim()); } catch (x) {
          if (!estHorsLigne(x)) { app.erreur(x); return; }
          app.message(texte('terrain_btp.bibliotheque.hors_ligne'), 'avertissement');
        }
        afficher();
      });
      afficher();
    },
  });
}

/** Libellé d'une ligne d'article choisie (fenêtre de la demande, Mes demandes). */
export const libelleLigneArticle = (a) => texte('terrain_btp.bibliotheque.ligne', { code: a.code ?? '', libelle: a.libelle ?? '', quantite: a.quantite ?? '', unite: a.unite ?? '' });
