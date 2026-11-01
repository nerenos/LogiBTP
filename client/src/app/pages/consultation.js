import { texte, texteHtml, pluriel, icone, iconeHtml } from '@logibtp/socle/dictionnaire';
import { urlDocument } from '../codes.js';
import { PageBase } from '@logibtp/navigation';
import { echapper, formatNombre, confirmer } from '@logibtp/socle/ui';
import { D, Dz } from '@logibtp/socle';
import { api } from '../api.js';
import { transformerDocument } from '../documents/transformation.js';

// Comparatif des offres d'un lot de consultation (Sous-traitance, lot 5 ; aussi pour les demandes de prix d'achat) :
// une rangée par ligne de prix rapprochée (code, sinon libellé), une colonne par offre (PU, montant), offre la moins
// chère de chaque ligne en évidence, totaux et écart au moins-disant. ✓ Retenir (lot 9, A24d) : l'offre choisie est
// transformée (fenêtre de transformation commune : commande), les autres offres en cours du lot passent « Non retenue ».

const f = (v) => formatNombre(v, 2);

export class PageComparatifConsultation extends PageBase {
  icone = icone('sous_traitance_btp_comparatif');

  async ouvrir() {
    const id = Number(new URLSearchParams(location.search).get('id'));
    this.titre = texte('sous_traitance_btp.routes.comparatif');
    this.conteneur.innerHTML = `<div class="page-parametres"><div class="entete-page"><h1 class="page-titre">${iconeHtml('sous_traitance_btp_comparatif')} ${texteHtml('sous_traitance_btp.routes.comparatif')}</h1></div><div data-corps><p class="aide">${texteHtml('sous_traitance_btp.paiements.chargement')}</p></div></div>`;
    const corps = this.conteneur.querySelector('[data-corps]');
    if (!id) { corps.innerHTML = `<p class="aide">${texteHtml('sous_traitance_btp.comparatif.sans_lot')}</p>`; return; }
    let c;
    try { c = await api.comparatifConsultation(id); } catch (e) { corps.innerHTML = `<p class="erreur">${echapper(e.message)}</p>`; return; }
    this.titre = texte('sous_traitance_btp.comparatif.titre', { code: c.code });
    const docs = c.documents;
    // Moins-disant de chaque ligne : plus petit montant non nul parmi les offres qui la portent.
    const meilleure = (l) => {
      const m = docs.map((d) => l.offres[d.id]).filter((o) => o && !Dz(o.montant).isZero());
      return m.length < 2 ? null : m.reduce((a, b) => (Dz(b.montant).lt(Dz(a.montant)) ? b : a));
    };
    const totaux = docs.map((d) => c.lignes.reduce((t, l) => t.plus(Dz(l.offres[d.id]?.montant)), D(0)));
    const min = totaux.filter((t) => !t.isZero()).reduce((a, b) => (b.lt(a) ? b : a), totaux.find((t) => !t.isZero()) ?? D(0));
    corps.innerHTML = `<p class="aide">${texteHtml('sous_traitance_btp.comparatif.aide', { code: c.code, offres: pluriel('sous_traitance_btp.comparatif.offres', docs.length), lignes: pluriel('sous_traitance_btp.comparatif.lignes', c.lignes.length) })}</p>
      <div class="tableau-defilant"><table class="tableau-compact"><thead><tr><th>${texteHtml('commun.code')}</th><th>${texteHtml('commun.libelle')}</th>
        ${docs.map((d) => `<th colspan="2" class="nombre"><a href="${urlDocument(d.id)}" title="${texteHtml('sous_traitance_btp.comparatif.ouvrir')}">${echapper(d.numero ?? `#${d.id}`)}</a><br>
          <small>${d.tiers ? echapper(d.tiers) : texteHtml('sous_traitance_btp.comparatif.sans_fournisseur')} · ${echapper(d.statut)}</small>
          ${d.valide && !d.terminal ? `<br><button type="button" data-retenir="${d.id}" title="${texteHtml('sous_traitance_btp.comparatif.retenir_titre')}">${iconeHtml('sous_traitance_btp_retenir')} ${texteHtml('sous_traitance_btp.comparatif.retenir')}</button>` : ''}</th>`).join('')}</tr>
        <tr><th></th><th></th>${docs.map(() => `<th class="nombre">${texteHtml('sous_traitance_btp.comparatif.qte_pu')}</th><th class="nombre">${texteHtml('sous_traitance_btp.paiements.montant')}</th>`).join('')}</tr></thead><tbody>
      ${c.lignes.map((l) => {
        const best = meilleure(l);
        return `<tr><td>${echapper(l.code ?? '')}</td><td>${echapper(l.libelle)}</td>${docs.map((d) => {
          const o = l.offres[d.id];
          if (!o) return '<td class="aide">—</td><td></td>';
          const gras = best === o ? ' style="font-weight:600"' : '';
          return `<td class="nombre"${gras}>${f(o.qte)} × ${f(o.pu)}</td><td class="nombre"${gras}>${f(o.montant)}</td>`;
        }).join('')}</tr>`;
      }).join('')}</tbody>
      <tfoot><tr><th colspan="2">${texteHtml('sous_traitance_btp.comparatif.total_lignes')}</th>${totaux.map((t) => `<th></th><th class="nombre"${t.equals(min) && !t.isZero() ? ' style="font-weight:700"' : ''}>${f(t.toString())}</th>`).join('')}</tr>
        <tr><th colspan="2">${texteHtml('sous_traitance_btp.comparatif.ecart')}</th>${totaux.map((t) => `<th></th><th class="nombre">${t.isZero() || min.isZero() ? '' : `${f(t.minus(min).toString())}${t.equals(min) ? '' : ` (+${formatNombre(t.minus(min).div(min).times(100).toDecimalPlaces(1).toString(), 1)} %)`}`}</th>`).join('')}</tr>
        <tr><th colspan="2">${texteHtml('sous_traitance_btp.comparatif.total_document')}</th>${docs.map((d) => `<th></th><th class="nombre">${f(d.total_ht)}</th>`).join('')}</tr></tfoot></table></div>`;
    corps.querySelectorAll('[data-retenir]').forEach((bouton) => bouton.addEventListener('click', () => this.retenir(docs.find((d) => d.id === Number(bouton.dataset.retenir)), docs)));
  }

  /** Offre retenue : transformation (commande), puis les autres offres en cours du lot passent « Non retenue ». */
  async retenir(offre, docs) {
    const autres = docs.filter((d) => d.id !== offre.id && !d.terminal).length;
    if (!await confirmer(texte('sous_traitance_btp.comparatif.confirmer', { numero: offre.numero ?? '', tiers: offre.tiers ?? texte('sous_traitance_btp.comparatif.sans_fournisseur_court'), autres: autres ? pluriel('sous_traitance_btp.comparatif.autres', autres) : '' }), { titre: `${icone('sous_traitance_btp_retenir')} ${texte('sous_traitance_btp.comparatif.retenue')}`, ok: texte('sous_traitance_btp.comparatif.retenir') })) return;
    try {
      const cree = await transformerDocument({ entId: offre.id, typeCode: offre.type_code, numero: offre.numero, message: (m, n) => this.app.message(m, n) });
      if (!cree) return;
      const r = await api.retenirConsultation(offre.id);
      this.app.message(texte('sous_traitance_btp.comparatif.cree', { document: `${cree.libelle} ${cree.ent_numero ?? ''}`, non_retenues: pluriel('sous_traitance_btp.comparatif.non_retenues', r.non_retenues) }), 'succes');
      this.app.publier?.('enregistre', { ids: docs.map((d) => d.id) });
      this.app.naviguer(urlDocument(cree.ent_id), { nouvelleFenetre: true });
      await this.ouvrir();
    } catch (e) { this.app.erreur(e); }
  }
}
