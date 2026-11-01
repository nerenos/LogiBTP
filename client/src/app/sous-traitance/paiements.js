import { texte, texteHtml, iconeHtml } from '@logibtp/socle/dictionnaire';
import { urlDocument } from '../codes.js';
import { D, aujourdhui } from '@logibtp/socle';
import { echapper, formatNombre, lireNombre, creerCombo, confirmer } from '@logibtp/socle/ui';
import { ETATS_PAIEMENT_DIRECT, MESSAGES_PAIEMENT_DIRECT, MESSAGES_RETENUE, controlerAcceptation } from '@logibtp/sous-traitance';
import { api } from '../api.js';

// Module Sous-traitance, lot 4 (ANALYSE-MODULE-SOUS-TRAITANCE.md § 5.5, ST14 à ST16, ST23) : onglet « Paiements » d'un
// marché de sous-traitance. Paiement direct (public) ou délégation (privé) : demande reçue d'une facture validée, délai
// d'acceptation (15 jours, alerte à J-3), acceptation totale ou partielle motivée (contrôle paiement-direct.js avant
// l'envoi, rejoué par le serveur), transmission au maître d'ouvrage avec notre facture qui porte la déduction, paiement
// constaté ; cumul accepté et reste du montant agréé. Réception et retenue de garantie (aussi pour un marché de vente) :
// échéance de libération (retenue.js ↔ ReglesRetenue.cs), retenues des pièces, cautions, libération.

const jour = (d) => (d ? String(d).slice(0, 10).split('-').reverse().join('/') : '');
const f = (v) => formatNombre(v, 2);

/** Onglet complet d'un marché de sous-traitance : paiements puis retenue. */
export async function rendrePaiements(corps, { marche, message }) {
  corps.innerHTML = `<div class="paiements-st"><section data-paiements><p class="aide">${texteHtml('sous_traitance_btp.paiements.chargement')}</p></section><section data-retenue></section></div>`;
  await Promise.all([
    rendreDemandes(corps.querySelector('[data-paiements]'), { marche, message }),
    rendreRetenue(corps.querySelector('[data-retenue]'), { marche, message }),
  ]);
}

async function rendreDemandes(zone, { marche, message }) {
  const s = await api.sousTraitance.paiements(marche);
  if (!s.mode) {
    zone.innerHTML = `<h3>${texteHtml('sous_traitance_btp.paiements.titre')}</h3><p class="aide">${texteHtml('sous_traitance_btp.paiements.sans_mode')}</p>`;
    return;
  }
  const direct = s.mode === 'DIRECT';
  const recharger = () => rendreDemandes(zone, { marche, message });
  const lienDoc = (id, numero) => `<a href="${urlDocument(Number(id))}" title="${texteHtml('sous_traitance_btp.paiements.ouvrir')}">${echapper(numero ?? `#${id}`)}</a>`;
  const clients = s.factures_clients ?? [];
  const client = (id) => clients.find((c) => Number(c.id) === Number(id));
  const delai = (d) => (d.etat !== 'RECUE' ? '' : `<span class="${d.delai.depasse ? 'erreur' : d.delai.alerte ? 'avertissement' : 'aide'}">${iconeHtml('sous_traitance_btp_delai')} ${texteHtml('sous_traitance_btp.paiements.avant', { date: jour(d.delai.echeance) })}</span>`);
  zone.innerHTML = `<h3>${direct ? texteHtml('sous_traitance_btp.paiements.direct') : texteHtml('sous_traitance_btp.paiements.delegation')}</h3>
    <p class="ligne">${s.montant_agree !== null && direct ? `${texteHtml('sous_traitance_btp.paiements.agree')} <strong>${f(s.montant_agree)}</strong> · ` : ''}${texteHtml('sous_traitance_btp.paiements.accepte')} <strong>${f(s.cumul_accepte)}</strong>
      ${s.reste_agree !== null && direct ? ` · ${texteHtml('sous_traitance_btp.paiements.reste')} <strong>${f(s.reste_agree)}</strong>` : ''} · ${texteHtml('sous_traitance_btp.paiements.paye')} <strong>${f(s.cumul_paye)}</strong></p>
    ${direct ? `<p class="aide">${texteHtml('sous_traitance_btp.paiements.aide_direct')}</p>`
      : `<p class="aide">${texteHtml('sous_traitance_btp.paiements.aide_delegation')}</p>`}
    <table class="tableau-compact"><thead><tr><th>${texteHtml('sous_traitance_btp.paiements.facture')}</th><th>${texteHtml('sous_traitance_btp.paiements.date')}</th><th class="nombre">${direct ? texteHtml('sous_traitance_btp.paiements.montant_paye') : texteHtml('sous_traitance_btp.paiements.montant')}</th><th>${texteHtml('sous_traitance_btp.paiements.demande')}</th>
      <th class="nombre">${texteHtml('sous_traitance_btp.paiements.accepte')}</th><th>${texteHtml('sous_traitance_btp.paiements.motif')}</th>${direct ? `<th>${texteHtml('sous_traitance_btp.paiements.notre_facture')}</th>` : ''}<th class="cellule-boutons"></th></tr></thead><tbody>
    ${s.factures.length ? s.factures.map((l, i) => {
      const d = l.demande;
      const fa = l.facture;
      const etat = d ? ETATS_PAIEMENT_DIRECT[d.etat] : null;
      const modifiable = d && (d.etat === 'RECUE' || d.etat === 'ACCEPTEE' || d.etat === 'PARTIELLE');
      return `<tr data-i="${i}">
        <td>${lienDoc(fa.id, fa.numero)}${fa.reference ? `<br><small class="aide">${echapper(fa.reference)}</small>` : ''}${fa.valide ? '' : ` <small class="aide">${texteHtml('sous_traitance_btp.paiements.brouillon')}</small>`}</td>
        <td>${jour(fa.date)}</td><td class="nombre">${f(d ? d.montant_demande : l.montant_propose)}</td>
        <td>${d ? `${etat?.icone ?? ''} ${echapper(etat?.libelle ?? d.etat)}<br><small class="aide">${texteHtml('sous_traitance_btp.paiements.recue', { date: jour(d.recue_le) })}${d.transmise_le ? `, ${texteHtml('sous_traitance_btp.paiements.transmise', { date: jour(d.transmise_le) })}` : ''}${d.payee_le ? `, ${texteHtml('sous_traitance_btp.paiements.payee', { date: jour(d.payee_le) })}` : ''}</small> ${delai(d)}`
          : (fa.valide && !fa.annule ? '<span class="aide">—</span>' : `<span class="aide">${texteHtml('sous_traitance_btp.paiements.a_valider')}</span>`)}</td>
        <td class="nombre">${modifiable ? `<input data-montant size="10" value="${echapper(d.montant_accepte ?? d.montant_demande)}">` : f(d?.montant_accepte)}</td>
        <td>${modifiable ? `<input data-motif size="20" value="${echapper(d.motif ?? '')}" placeholder="${texteHtml('sous_traitance_btp.paiements.motif_aide')}">` : echapper(d?.motif ?? '')}</td>
        ${direct ? `<td>${d && d.etat !== 'TRANSMISE' && d.etat !== 'PAYEE' && d.etat !== 'REFUSEE' ? '<span data-client></span>' : (d?.facture_client_id ? lienDoc(d.facture_client_id, client(d.facture_client_id)?.numero) : '')}</td>` : ''}
        <td class="cellule-boutons">${!d && fa.valide && !fa.annule ? `<button type="button" data-declarer title="${texteHtml('sous_traitance_btp.paiements.declarer')}">${iconeHtml('sous_traitance_btp_declarer')}</button>` : ''}
          ${modifiable ? `<button type="button" data-accepter title="${texteHtml('sous_traitance_btp.paiements.accepter')}">${iconeHtml('sous_traitance_btp_accepter')}</button>` : ''}
          ${d && (d.etat === 'ACCEPTEE' || d.etat === 'PARTIELLE') ? `<button type="button" data-transmettre title="${direct ? texteHtml('sous_traitance_btp.paiements.transmettre_direct') : texteHtml('sous_traitance_btp.paiements.transmettre')}">${iconeHtml('sous_traitance_btp_transmettre')}</button>` : ''}
          ${d?.etat === 'TRANSMISE' ? `<button type="button" data-payer title="${texteHtml('sous_traitance_btp.paiements.payer')}">${iconeHtml('sous_traitance_btp_payer')}</button>` : ''}
          ${modifiable ? `<button type="button" data-supprimer title="${texteHtml('sous_traitance_btp.paiements.supprimer')}">${iconeHtml('supprimer')}</button>` : ''}</td></tr>`;
    }).join('') : `<tr><td colspan="${direct ? 8 : 7}" class="aide">${texteHtml('sous_traitance_btp.paiements.aucune')}</td></tr>`}
    </tbody></table>`;

  const agir = async (promesse, ok) => {
    try { await promesse; if (ok) message(ok, 'succes'); await recharger(); } catch (e) { message(e.message, 'erreur'); }
  };
  zone.querySelectorAll('tr[data-i]').forEach((tr) => {
    const l = s.factures[Number(tr.dataset.i)];
    const d = l.demande;
    let combo = null;
    const place = tr.querySelector('[data-client]');
    if (place) {
      combo = creerCombo({
        options: clients.map((c) => ({ valeur: String(c.id), libelle: `${c.numero ?? `#${c.id}`} · ${jour(c.date)} · ${f(c.ttc)}${c.valide ? ` ${texte('sous_traitance_btp.paiements.validee')}` : ''}` })),
        valeur: d?.facture_client_id ? String(d.facture_client_id) : String(clients.find((c) => !c.valide)?.id ?? ''),
        titre: texte('sous_traitance_btp.paiements.facture_client'),
      });
      place.replaceWith(combo);
    }
    const valeurClient = () => {
      const v = combo?.resoudre() ?? '';
      return v ? Number(v) : null;
    };
    tr.querySelector('[data-declarer]')?.addEventListener('click', () => agir(api.sousTraitance.declarerPaiement(l.facture.id, { recue_le: aujourdhui() }), texte('sous_traitance_btp.paiements.enregistree')));
    tr.querySelector('[data-accepter]')?.addEventListener('click', () => {
      const montant = lireNombre(tr.querySelector('[data-montant]').value);
      const motif = tr.querySelector('[data-motif]').value.trim() || null;
      // Contrôle local (même règle que le serveur) : message clair avant l'envoi.
      const precedent = s.factures.filter((x) => x.demande && x.demande.id !== d.id && ['ACCEPTEE', 'PARTIELLE', 'TRANSMISE', 'PAYEE'].includes(x.demande.etat))
        .reduce((t, x) => t + Number(x.demande.montant_accepte ?? 0), 0);
      const r = controlerAcceptation({ demande: d.montant_demande, accepte: montant ?? 0, cumulPrecedent: String(precedent), montantAgree: direct ? s.montant_agree : null, motif });
      if (r.erreurs.length) { message(r.erreurs.map((e) => MESSAGES_PAIEMENT_DIRECT[e] ?? e).join(' ; '), 'erreur'); return; }
      agir(api.sousTraitance.accepterPaiement(d.id, { montant: montant ?? 0, motif, le: aujourdhui() }), texte('sous_traitance_btp.paiements.traitee'));
    });
    tr.querySelector('[data-transmettre]')?.addEventListener('click', () => {
      const fc = valeurClient();
      if (direct && !fc) { message(texte('sous_traitance_btp.paiements.choisir'), 'erreur'); return; }
      agir(api.sousTraitance.transmettrePaiement(d.id, { le: aujourdhui(), facture_client_id: fc }), texte('sous_traitance_btp.paiements.transmise_ok'));
    });
    tr.querySelector('[data-payer]')?.addEventListener('click', () => agir(api.sousTraitance.payerPaiement(d.id, { le: aujourdhui() }), texte('sous_traitance_btp.paiements.payee_ok')));
    tr.querySelector('[data-supprimer]')?.addEventListener('click', async () => {
      if (await confirmer(texte('sous_traitance_btp.paiements.confirmer'))) agir(api.sousTraitance.supprimerPaiement(d.id), texte('sous_traitance_btp.paiements.supprimee'));
    });
  });
}

/** Réception, réserves, retenue de garantie et cautions d'un marché (vente ou sous-traitance). */
export async function rendreRetenue(zone, { marche, message }) {
  const r = await api.retenueMarche(marche);
  const lib = r.liberation;
  const etat = r.liberee_le ? `${iconeHtml('sous_traitance_btp_liberee')} ${texteHtml('sous_traitance_btp.retenue.liberee', { date: jour(r.liberee_le) })}`
    : lib.bloquee ? `${iconeHtml('sous_traitance_btp_bloquee')} ${echapper(MESSAGES_RETENUE[lib.motif] ?? lib.motif)}`
      : lib.liberable ? `${iconeHtml('sous_traitance_btp_liberable')} ${texteHtml('sous_traitance_btp.retenue.liberable_depuis', { date: jour(lib.date) })}` : `${iconeHtml('sous_traitance_btp_attente')} ${texteHtml('sous_traitance_btp.retenue.liberable', { date: jour(lib.date) })}`;
  const nonDatees = r.retenues.filter((x) => !x.date);
  zone.innerHTML = `<h3>${texteHtml('sous_traitance_btp.retenue.titre')}</h3>
    <p class="ligne">${texteHtml('sous_traitance_btp.retenue.reception')} ${r.reception ? `<strong>${texteHtml('sous_traitance_btp.retenue.reception_le', { date: jour(r.reception) })}</strong>` : `<strong>${texteHtml('sous_traitance_btp.retenue.non_faite')}</strong>`}
      · ${r.reserves ? (r.levees_le ? texteHtml('sous_traitance_btp.retenue.levees', { date: jour(r.levees_le) }) : texteHtml('sous_traitance_btp.retenue.en_cours')) : texteHtml('sous_traitance_btp.retenue.sans')}
      ${lib.echeance ? ` · ${texteHtml('sous_traitance_btp.retenue.echeance', { date: jour(lib.echeance) })}` : ''} · ${etat}
      ${!r.liberee_le && lib.liberable && nonDatees.length ? `<button type="button" data-liberer title="${texteHtml('sous_traitance_btp.retenue.liberer_titre')}">${iconeHtml('sous_traitance_btp_liberable')} ${texteHtml('sous_traitance_btp.retenue.liberer')}</button>` : ''}</p>
    <p class="aide">${texteHtml('sous_traitance_btp.retenue.aide')}</p>
    <table class="tableau-compact"><thead><tr><th>${texteHtml('sous_traitance_btp.retenue.piece')}</th><th>${texteHtml('sous_traitance_btp.paiements.date')}</th><th class="nombre">${texteHtml('sous_traitance_btp.retenue.retenue')}</th><th class="nombre" title="${texteHtml('sous_traitance_btp.retenue.cautionne_aide')}">${texteHtml('sous_traitance_btp.retenue.cautionne')}</th><th>${texteHtml('sous_traitance_btp.retenue.echeance_titre')}</th></tr></thead><tbody>
    ${r.retenues.length ? r.retenues.map((x) => `<tr><td><a href="${urlDocument(Number(x.ent_id))}">${echapper(x.numero ?? `#${x.ent_id}`)}</a> <small class="aide">${echapper(x.type)}</small></td>
      <td>${jour(x.date_document)}</td><td class="nombre">${f(x.montant)}</td><td class="nombre">${!D(x.cautionne ?? 0).isZero() ? f(x.cautionne) : ''}</td><td>${x.date ? jour(x.date) : `<span class="aide">${texteHtml('sous_traitance_btp.retenue.a_liberation')}</span>`}</td></tr>`).join('')
    : `<tr><td colspan="5" class="aide">${texteHtml('sous_traitance_btp.retenue.aucune')}</td></tr>`}
    </tbody><tfoot><tr><th colspan="2">${texteHtml('commun.total')}</th><th class="nombre">${f(r.total)}</th><th class="nombre">${!D(r.cautionne ?? 0).isZero() ? f(r.cautionne) : ''}</th><th></th></tr></tfoot></table>
    ${r.cautions.length ? `<h4>${texteHtml('sous_traitance_btp.retenue.cautions')}</h4><p class="aide">${texteHtml('sous_traitance_btp.retenue.cautions_aide')}</p>
      <table class="tableau-compact"><thead><tr><th>${texteHtml('sous_traitance_btp.retenue.organisme')}</th><th>${texteHtml('sous_traitance_btp.retenue.reference')}</th><th class="nombre">${texteHtml('sous_traitance_btp.paiements.montant')}</th><th class="nombre">${texteHtml('sous_traitance_btp.retenue.consomme')}</th><th>${texteHtml('sous_traitance_btp.retenue.portee')}</th><th>${texteHtml('sous_traitance_btp.retenue.du')}</th><th>${texteHtml('sous_traitance_btp.retenue.au')}</th><th>${texteHtml('sous_traitance_btp.retenue.mainlevee')}</th></tr></thead><tbody>
      ${r.cautions.map((c) => `<tr><td>${echapper(c.organisme)}</td><td>${echapper(c.reference ?? '')}</td><td class="nombre">${f(c.montant)}</td><td class="nombre">${f(c.consomme)}</td>
        <td>${c.objet_id ? texteHtml('sous_traitance_btp.retenue.portee_marche') : texteHtml('sous_traitance_btp.retenue.portee_tiers')}</td><td>${jour(c.date)}</td>
        <td>${jour(c.date_fin)}</td><td>${jour(c.mainlevee)}</td></tr>`).join('')}</tbody></table>` : ''}`;
  zone.querySelector('[data-liberer]')?.addEventListener('click', async () => {
    try {
      await api.libererRetenue(marche, aujourdhui());
      message(texte('sous_traitance_btp.retenue.liberee_ok'), 'succes');
      await rendreRetenue(zone, { marche, message });
    } catch (e) { message(e.message, 'erreur'); }
  });
}
