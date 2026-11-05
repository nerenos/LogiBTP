import { texte, texteHtml, icone, iconeHtml } from '@logibtp/socle/dictionnaire';
import { PageBase } from '@logibtp/navigation';
import { echapper, formatNombre, formatDate, formatDateHeure } from '@logibtp/socle/ui';
import { urlFiche, urlDocument, TYPE_FICHE } from '../codes.js';
import { api } from '../api.js';

// Module Stock, lots et numéros de série, lot S24-c (ANALYSE-MODULE-STOCK.md § 11, S24.5, S24.6) : fiche d'un lot —
// article et suivi, stock actuel par lieu, certificats matière (GED du lot, catégorie certificat_matiere ; copiés dans
// la GED des chantiers servis par la tâche de fond du serveur), chantiers où le lot est sorti, traçabilité complète
// (mouvements avec leur pièce, comptages d'inventaire).
export class PageLotStock extends PageBase {
  icone = icone('stock_btp_lot');

  async ouvrir() {
    this.titre = texte('stock_btp.routes.lot');
    this.conteneur.innerHTML = '<div class="page-parametres page-lot-stock"></div>';
    await this.#charger();
  }

  async #charger() {
    this.lot = await api.stock.lot(this.params.id);
    this.titre = texte('stock_btp.lot.titre', { numero: this.lot.numero });
    this.#rendre();
  }

  #rendre() {
    const l = this.lot;
    const nb = (v) => formatNombre(v, 3);
    const unite = echapper(l.article?.unite ?? '');
    const exige = l.suivi?.certificat;
    const z = this.conteneur.querySelector('.page-lot-stock');
    const lien = (url, contenu) => `<a href="${url}" data-url>${contenu}</a>`;
    z.innerHTML = `<div class="entete-page"><h1 class="page-titre">${iconeHtml('stock_btp_lot')} ${texteHtml('stock_btp.lot.titre', { numero: l.numero })}</h1>
        ${l.perime ? `<span class="avertissement">${texteHtml('stock_btp.lots.perime')}</span>` : ''}
        ${exige && !l.certificats.length ? `<span class="avertissement">${texteHtml('stock_btp.lot.sans_certificat')}</span>` : ''}</div>
      <table class="tableau-compact largeur-contenu"><tbody>
        <tr><th>${texteHtml('stock_btp.lot.article')}</th><td>${l.article ? lien(urlFiche(TYPE_FICHE.ELEMENT, l.article.id), `${echapper(l.article.code)} ${echapper(l.article.libelle ?? '')}`) : ''}</td></tr>
        <tr><th>${texteHtml('stock_btp.lots.suivi')}</th><td>${texteHtml(`stock_btp.lots.suivis.${l.suivi?.suivi ?? 'AUCUN'}`)}${l.suivi?.perissable ? ` · ${texteHtml('stock_btp.lots.perissable')}` : ''}</td></tr>
        <tr><th>${texteHtml('stock_btp.lots.fournisseur')}</th><td>${l.fournisseur ? lien(urlFiche(TYPE_FICHE.PERSONNE, l.fournisseur.id), echapper(l.fournisseur.nom ?? '')) : ''}</td></tr>
        <tr><th>${texteHtml('stock_btp.lots.fabrication')}</th><td>${formatDate(l.fabrication)}</td></tr>
        <tr><th>${texteHtml('stock_btp.lots.limite')}</th><td${l.perime ? ' class="avertissement"' : ''}>${formatDate(l.limite)}</td></tr>
        <tr><th>${texteHtml('stock_btp.lots.coulee')}</th><td>${echapper(l.coulee ?? '')}</td></tr>
        <tr><th>${texteHtml('stock_btp.lots.norme')}</th><td>${echapper(l.norme ?? '')}</td></tr>
        <tr><th>${texteHtml('stock_btp.lots.commentaire')}</th><td>${echapper(l.commentaire ?? '')}</td></tr>
        <tr><th>${texteHtml('stock_btp.lot.cree')}</th><td>${formatDateHeure(l.cree_le)} · ${echapper(l.cree_par ?? '')}</td></tr>
      </tbody></table>
      <h2>${texteHtml('stock_btp.lot.stock')}</h2>
      ${l.stock.length ? `<table class="tableau-compact largeur-contenu"><thead><tr><th>${texteHtml('stock_btp.lot.lieu')}</th><th>${texteHtml('stock_btp.colonnes.quantite')}</th></tr></thead><tbody>
        ${l.stock.map((s) => `<tr><td>${iconeHtml(s.depot ? 'stock_btp_stock' : 'stock_btp_chantier')} ${echapper(s.code)} ${echapper(s.libelle ?? '')}</td><td class="nombre">${nb(s.quantite)} ${unite}</td></tr>`).join('')}
      </tbody></table>` : `<p class="aide">${texteHtml('stock_btp.lot.aucun_stock')}</p>`}
      <h2>${texteHtml('stock_btp.lot.certificats')}</h2>
      ${l.certificats.length ? `<ul>${l.certificats.map((c) => `<li>${c.version ? `<a href="/api/ged/versions/${c.version}/contenu" target="_blank" rel="noopener">${echapper(c.titre)}</a>` : echapper(c.titre)}
        <span class="aide">${formatDateHeure(c.le)}</span></li>`).join('')}</ul>` : `<p class="aide">${texteHtml('stock_btp.lot.aucun_certificat')}</p>`}
      <p class="ligne"><input type="file" data-fichier> <input data-titre size="30" placeholder="${texteHtml('stock_btp.lot.titre_certificat')}">
        <button type="button" data-deposer title="${texteHtml('stock_btp.lot.deposer_titre')}">${iconeHtml('stock_btp_entree')} ${texteHtml('stock_btp.lot.deposer')}</button></p>
      <h2>${texteHtml('stock_btp.lot.chantiers')}</h2>
      ${l.chantiers.length ? `<p>${l.chantiers.map((c) => lien(urlFiche(TYPE_FICHE.CHANTIER, c.id), `${echapper(c.code)} ${echapper(c.libelle ?? '')}`)).join(' · ')}</p>`
        : `<p class="aide">${texteHtml('stock_btp.lot.aucun_chantier')}</p>`}
      <h2>${texteHtml('stock_btp.lot.tracabilite')}</h2>
      ${l.mouvements.length ? `<table class="tableau-compact"><thead><tr><th>${texteHtml('stock_btp.lot.date')}</th><th>${texteHtml('stock_btp.lot.lieu')}</th>
        <th>${texteHtml('stock_btp.colonnes.quantite')}</th><th>${texteHtml('stock_btp.lot.piece')}</th><th>${texteHtml('stock_btp.lot.tiers')}</th><th>${texteHtml('stock_btp.lot.vers')}</th></tr></thead><tbody>
        ${l.mouvements.map((m) => `<tr><td>${formatDateHeure(m.date)}</td><td>${echapper(m.lieu)} ${echapper(m.lieu_libelle ?? '')}</td>
          <td class="nombre">${nb(m.quantite)} ${unite}</td><td>${m.ent_id ? lien(urlDocument(m.ent_id), `${echapper(m.type_piece ?? '')} ${echapper(m.piece ?? '')}`) : echapper(m.origine ?? '')}</td>
          <td>${echapper(m.tiers ?? '')}</td><td>${echapper(m.chantier ?? '')}</td></tr>`).join('')}
      </tbody></table>` : `<p class="aide">${texteHtml('stock_btp.lot.aucun_mouvement')}</p>`}
      ${l.comptages.length ? `<h2>${texteHtml('stock_btp.lot.comptages')}</h2><table class="tableau-compact"><thead><tr><th>${texteHtml('stock_btp.lot.date')}</th>
        <th>${texteHtml('stock_btp.lot.lieu')}</th><th>${texteHtml('stock_btp.colonnes.quantite')}</th><th>${texteHtml('stock_btp.lots.commentaire')}</th></tr></thead><tbody>
        ${l.comptages.map((k) => `<tr><td>${k.inventaire ? lien(`/stock/inventaire/${k.inventaire}`, formatDateHeure(k.date)) : formatDateHeure(k.date)}</td><td>${echapper(k.lieu)}</td>
          <td class="nombre">${nb(k.quantite)} ${unite}</td><td>${echapper(k.commentaire ?? '')}</td></tr>`).join('')}
      </tbody></table>` : ''}`;
    z.querySelector('[data-deposer]').addEventListener('click', async () => {
      const fichier = z.querySelector('[data-fichier]').files[0];
      if (!fichier) { this.app.message(texte('stock_btp.lot.fichier_attendu'), 'erreur'); return; }
      const f = new FormData();
      f.append('fichier', fichier);
      f.append('titre', z.querySelector('[data-titre]').value.trim());
      try {
        await api.stock.deposerCertificat(this.params.id, f);
        this.app.message(texte('stock_btp.lot.certificat_depose'));
        await this.#charger();
      } catch (e) { this.app.erreur(e); }
    });
  }
}
