import { PageBase } from '@logibtp/navigation';
import { echapper, formatNombre, confirmer } from '@logibtp/socle/ui';
import { D, Dz } from '@logibtp/socle';
import { api } from '../api.js';
import { transformerDocument } from '../documents/transformation.js';

// Comparatif des offres d'un lot de consultation (Sous-traitance, lot 5 ; aussi pour les demandes de prix d'achat) :
// une rangée par ligne de prix rapprochée (code, sinon libellé), une colonne par offre (PU, montant), offre la moins
// chère de chaque ligne en évidence, totaux et écart au moins-disant. ✓ Retenir (lot 9, A24d) : l'offre choisie est
// transformée (fenêtre de transformation commune : commande), les autres offres en cours du lot passent « Non retenue ».

const f = (v) => (v === null || v === undefined ? '' : formatNombre(v, 2));

export class PageComparatifConsultation extends PageBase {
  icone = '⚖';

  async ouvrir() {
    const id = Number(new URLSearchParams(location.search).get('id'));
    this.titre = 'Comparatif des offres';
    this.conteneur.innerHTML = '<div class="page-parametres"><div class="entete-page"><h1 class="page-titre">⚖ Comparatif des offres</h1></div><div data-corps><p class="aide">Chargement…</p></div></div>';
    const corps = this.conteneur.querySelector('[data-corps]');
    if (!id) { corps.innerHTML = '<p class="aide">En ligne seulement, depuis un document du lot.</p>'; return; }
    let c;
    try { c = await api.comparatifConsultation(id); } catch (e) { corps.innerHTML = `<p class="erreur">${echapper(e.message)}</p>`; return; }
    this.titre = `Comparatif ${c.code}`;
    const docs = c.documents;
    // Moins-disant de chaque ligne : plus petit montant non nul parmi les offres qui la portent.
    const meilleure = (l) => {
      const m = docs.map((d) => l.offres[d.id]).filter((o) => o && !Dz(o.montant).isZero());
      return m.length < 2 ? null : m.reduce((a, b) => (Dz(b.montant).lt(Dz(a.montant)) ? b : a));
    };
    const totaux = docs.map((d) => c.lignes.reduce((t, l) => t.plus(Dz(l.offres[d.id]?.montant)), D(0)));
    const min = totaux.filter((t) => !t.isZero()).reduce((a, b) => (b.lt(a) ? b : a), totaux.find((t) => !t.isZero()) ?? D(0));
    corps.innerHTML = `<p class="aide">Lot ${echapper(c.code)} : ${docs.length} offre(s), ${c.lignes.length} ligne(s) rapprochée(s) par leur code, sinon leur libellé.
      L'offre la moins chère de chaque ligne est en gras ; ouvrez l'offre retenue pour la transformer en commande.</p>
      <div class="tableau-defilant"><table class="tableau-compact"><thead><tr><th>Code</th><th>Libellé</th>
        ${docs.map((d) => `<th colspan="2" class="nombre"><a href="/document/${d.id}" title="Ouvrir l'offre (Ctrl : nouvelle fenêtre)">${echapper(d.numero ?? `#${d.id}`)}</a><br>
          <small>${echapper(d.tiers ?? '— sans fournisseur —')} · ${echapper(d.statut)}</small>
          ${d.valide && !d.terminal ? `<br><button type="button" data-retenir="${d.id}" title="Transformer cette offre (commande) ; les autres offres du lot passent « Non retenue »">✓ Retenir</button>` : ''}</th>`).join('')}</tr>
        <tr><th></th><th></th>${docs.map(() => '<th class="nombre">Qté × PU</th><th class="nombre">Montant</th>').join('')}</tr></thead><tbody>
      ${c.lignes.map((l) => {
        const best = meilleure(l);
        return `<tr><td>${echapper(l.code ?? '')}</td><td>${echapper(l.libelle)}</td>${docs.map((d) => {
          const o = l.offres[d.id];
          if (!o) return '<td class="aide">—</td><td></td>';
          const gras = best === o ? ' style="font-weight:600"' : '';
          return `<td class="nombre"${gras}>${f(o.qte)} × ${f(o.pu)}</td><td class="nombre"${gras}>${f(o.montant)}</td>`;
        }).join('')}</tr>`;
      }).join('')}</tbody>
      <tfoot><tr><th colspan="2">Total HT des lignes</th>${totaux.map((t) => `<th></th><th class="nombre"${t.equals(min) && !t.isZero() ? ' style="font-weight:700"' : ''}>${f(t.toString())}</th>`).join('')}</tr>
        <tr><th colspan="2">Écart au moins-disant</th>${totaux.map((t) => `<th></th><th class="nombre">${t.isZero() || min.isZero() ? '' : `${f(t.minus(min).toString())}${t.equals(min) ? '' : ` (+${formatNombre(t.minus(min).div(min).times(100).toDecimalPlaces(1).toString(), 1)} %)`}`}</th>`).join('')}</tr>
        <tr><th colspan="2">Total HT du document</th>${docs.map((d) => `<th></th><th class="nombre">${f(d.total_ht)}</th>`).join('')}</tr></tfoot></table></div>`;
    corps.querySelectorAll('[data-retenir]').forEach((bouton) => bouton.addEventListener('click', () => this.retenir(docs.find((d) => d.id === Number(bouton.dataset.retenir)), docs)));
  }

  /** Offre retenue : transformation (commande), puis les autres offres en cours du lot passent « Non retenue ». */
  async retenir(offre, docs) {
    const autres = docs.filter((d) => d.id !== offre.id && !d.terminal).length;
    if (!await confirmer(`Retenir l’offre ${offre.numero ?? ''} (${offre.tiers ?? 'sans fournisseur'}) ? Elle sera transformée${autres ? ` et les ${autres} autre(s) offre(s) du lot passeront « Non retenue »` : ''}.`, { titre: '✓ Offre retenue', ok: 'Retenir' })) return;
    try {
      const cree = await transformerDocument({ entId: offre.id, typeCode: offre.type_code, numero: offre.numero, message: (m, n) => this.app.message(m, n) });
      if (!cree) return;
      const r = await api.retenirConsultation(offre.id);
      this.app.message(`${cree.libelle} ${cree.ent_numero ?? ''} créé(e) ; ${r.non_retenues} offre(s) non retenue(s)`, 'succes');
      this.app.publier?.('enregistre', { ids: docs.map((d) => d.id) });
      this.app.naviguer(`/document/${cree.ent_id}`, { nouvelleFenetre: true });
      await this.ouvrir();
    } catch (e) { this.app.erreur(e); }
  }
}
