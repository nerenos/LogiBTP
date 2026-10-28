import { aujourdhui } from '@logibtp/socle';
import { echapper, formatNombre, lireNombre, creerCombo } from '@logibtp/socle/ui';
import { ETATS_PAIEMENT_DIRECT, MESSAGES_PAIEMENT_DIRECT, MESSAGES_RETENUE, controlerAcceptation } from '@logibtp/sous-traitance';
import { api } from '../api.js';

// Module Sous-traitance, lot 4 (ANALYSE-MODULE-SOUS-TRAITANCE.md § 5.5, ST14 à ST16, ST23) : onglet « Paiements » d'un
// marché de sous-traitance. Paiement direct (public) ou délégation (privé) : demande reçue d'une facture validée, délai
// d'acceptation (15 jours, alerte à J-3), acceptation totale ou partielle motivée (contrôle paiement-direct.js avant
// l'envoi, rejoué par le serveur), transmission au maître d'ouvrage avec notre facture qui porte la déduction, paiement
// constaté ; cumul accepté et reste du montant agréé. Réception et retenue de garantie (aussi pour un marché de vente) :
// échéance de libération (retenue.js ↔ ReglesRetenue.cs), retenues des pièces, cautions, libération.

const jour = (d) => (d ? String(d).slice(0, 10).split('-').reverse().join('/') : '');
const f = (v) => (v === null || v === undefined ? '' : formatNombre(v, 2));

/** Onglet complet d'un marché de sous-traitance : paiements puis retenue. */
export async function rendrePaiements(corps, { marche, message }) {
  corps.innerHTML = '<div class="paiements-st"><section data-paiements><p class="aide">Chargement…</p></section><section data-retenue></section></div>';
  await Promise.all([
    rendreDemandes(corps.querySelector('[data-paiements]'), { marche, message }),
    rendreRetenue(corps.querySelector('[data-retenue]'), { marche, message }),
  ]);
}

async function rendreDemandes(zone, { marche, message }) {
  const s = await api.sousTraitance.paiements(marche);
  if (!s.mode) {
    zone.innerHTML = `<h3>Paiement du sous-traitant</h3><p class="aide">Ni paiement direct ni délégation de paiement : le sous-traitant est payé par nous
      (garantie du marché : caution ou aucune). Les factures se règlent au module Règlements.</p>`;
    return;
  }
  const direct = s.mode === 'DIRECT';
  const recharger = () => rendreDemandes(zone, { marche, message });
  const lienDoc = (id, numero) => `<a href="/document/${Number(id)}" title="Ouvrir (Ctrl : nouvelle fenêtre)">${echapper(numero ?? `#${id}`)}</a>`;
  const clients = s.factures_clients ?? [];
  const client = (id) => clients.find((c) => Number(c.id) === Number(id));
  const delai = (d) => (d.etat !== 'RECUE' ? '' : `<span class="${d.delai.depasse ? 'erreur' : d.delai.alerte ? 'avertissement' : 'aide'}">⏳ avant le ${jour(d.delai.echeance)}</span>`);
  zone.innerHTML = `<h3>${direct ? 'Paiement direct (marché public)' : 'Délégation de paiement (marché privé)'}</h3>
    <p class="ligne">${s.montant_agree !== null && direct ? `Montant agréé <strong>${f(s.montant_agree)}</strong> · ` : ''}Accepté <strong>${f(s.cumul_accepte)}</strong>
      ${s.reste_agree !== null && direct ? ` · Reste agréé <strong>${f(s.reste_agree)}</strong>` : ''} · Payé par le maître d'ouvrage <strong>${f(s.cumul_paye)}</strong></p>
    ${direct ? '<p class="aide">Le montant accepté est déduit de notre facture au client (poste « Paiement direct » du marché de vente) ; en autoliquidation, le HT.</p>'
      : '<p class="aide">Délégation : le maître d\'ouvrage paie le sous-traitant pour notre compte ; aucune déduction de notre facture.</p>'}
    <table class="tableau-compact"><thead><tr><th>Facture</th><th>Date</th><th class="nombre">${direct ? 'Montant payé' : 'Montant'}</th><th>Demande</th>
      <th class="nombre">Accepté</th><th>Motif</th>${direct ? '<th>Notre facture</th>' : ''}<th class="cellule-boutons"></th></tr></thead><tbody>
    ${s.factures.length ? s.factures.map((l, i) => {
      const d = l.demande;
      const fa = l.facture;
      const etat = d ? ETATS_PAIEMENT_DIRECT[d.etat] : null;
      const modifiable = d && (d.etat === 'RECUE' || d.etat === 'ACCEPTEE' || d.etat === 'PARTIELLE');
      return `<tr data-i="${i}">
        <td>${lienDoc(fa.id, fa.numero)}${fa.reference ? `<br><small class="aide">${echapper(fa.reference)}</small>` : ''}${fa.valide ? '' : ' <small class="aide">(brouillon)</small>'}</td>
        <td>${jour(fa.date)}</td><td class="nombre">${f(d ? d.montant_demande : l.montant_propose)}</td>
        <td>${d ? `${etat?.icone ?? ''} ${echapper(etat?.libelle ?? d.etat)}<br><small class="aide">reçue le ${jour(d.recue_le)}${d.transmise_le ? `, transmise le ${jour(d.transmise_le)}` : ''}${d.payee_le ? `, payée le ${jour(d.payee_le)}` : ''}</small> ${delai(d)}`
          : (fa.valide && !fa.annule ? '<span class="aide">—</span>' : '<span class="aide">facture à valider</span>')}</td>
        <td class="nombre">${modifiable ? `<input data-montant size="10" value="${echapper(d.montant_accepte ?? d.montant_demande)}">` : f(d?.montant_accepte)}</td>
        <td>${modifiable ? `<input data-motif size="20" value="${echapper(d.motif ?? '')}" placeholder="Refus total ou partiel : motif">` : echapper(d?.motif ?? '')}</td>
        ${direct ? `<td>${d && d.etat !== 'TRANSMISE' && d.etat !== 'PAYEE' && d.etat !== 'REFUSEE' ? '<span data-client></span>' : (d?.facture_client_id ? lienDoc(d.facture_client_id, client(d.facture_client_id)?.numero) : '')}</td>` : ''}
        <td class="cellule-boutons">${!d && fa.valide && !fa.annule ? '<button type="button" data-declarer title="Demande de paiement reçue du sous-traitant (date de réception : aujourd\'hui)">📥</button>' : ''}
          ${modifiable ? '<button type="button" data-accepter title="Accepter le montant saisi (inférieur : partiel, 0 : refus ; motif obligatoire)">✅</button>' : ''}
          ${d && (d.etat === 'ACCEPTEE' || d.etat === 'PARTIELLE') ? `<button type="button" data-transmettre title="Transmise au maître d'ouvrage${direct ? ' (avec notre facture choisie)' : ''}">📤</button>` : ''}
          ${d?.etat === 'TRANSMISE' ? '<button type="button" data-payer title="Payée par le maître d\'ouvrage">💶</button>' : ''}
          ${modifiable ? '<button type="button" data-supprimer title="Supprimer la demande">🗑</button>' : ''}</td></tr>`;
    }).join('') : `<tr><td colspan="${direct ? 8 : 7}" class="aide">Aucune facture de sous-traitance sur ce marché.</td></tr>`}
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
        options: clients.map((c) => ({ valeur: String(c.id), libelle: `${c.numero ?? `#${c.id}`} · ${jour(c.date)} · ${f(c.ttc)}${c.valide ? ' (validée)' : ''}` })),
        valeur: d?.facture_client_id ? String(d.facture_client_id) : String(clients.find((c) => !c.valide)?.id ?? ''),
        titre: 'Notre facture au client qui porte la déduction (brouillon : la déduction y est posée tout de suite)',
      });
      place.replaceWith(combo);
    }
    const valeurClient = () => {
      const v = combo?.resoudre() ?? '';
      return v ? Number(v) : null;
    };
    tr.querySelector('[data-declarer]')?.addEventListener('click', () => agir(api.sousTraitance.declarerPaiement(l.facture.id, { recue_le: aujourdhui() }), 'Demande enregistrée'));
    tr.querySelector('[data-accepter]')?.addEventListener('click', () => {
      const montant = lireNombre(tr.querySelector('[data-montant]').value);
      const motif = tr.querySelector('[data-motif]').value.trim() || null;
      // Contrôle local (même règle que le serveur) : message clair avant l'envoi.
      const precedent = s.factures.filter((x) => x.demande && x.demande.id !== d.id && ['ACCEPTEE', 'PARTIELLE', 'TRANSMISE', 'PAYEE'].includes(x.demande.etat))
        .reduce((t, x) => t + Number(x.demande.montant_accepte ?? 0), 0);
      const r = controlerAcceptation({ demande: d.montant_demande, accepte: montant ?? 0, cumulPrecedent: String(precedent), montantAgree: direct ? s.montant_agree : null, motif });
      if (r.erreurs.length) { message(r.erreurs.map((e) => MESSAGES_PAIEMENT_DIRECT[e] ?? e).join(' ; '), 'erreur'); return; }
      agir(api.sousTraitance.accepterPaiement(d.id, { montant: montant ?? 0, motif, le: aujourdhui() }), 'Demande traitée');
    });
    tr.querySelector('[data-transmettre]')?.addEventListener('click', () => {
      const fc = valeurClient();
      if (direct && !fc) { message('Choisir notre facture au client qui porte le paiement direct', 'erreur'); return; }
      agir(api.sousTraitance.transmettrePaiement(d.id, { le: aujourdhui(), facture_client_id: fc }), 'Demande transmise');
    });
    tr.querySelector('[data-payer]')?.addEventListener('click', () => agir(api.sousTraitance.payerPaiement(d.id, { le: aujourdhui() }), 'Paiement constaté'));
    tr.querySelector('[data-supprimer]')?.addEventListener('click', () => {
      if (globalThis.confirm?.('Supprimer la demande de paiement ?')) agir(api.sousTraitance.supprimerPaiement(d.id), 'Demande supprimée');
    });
  });
}

/** Réception, réserves, retenue de garantie et cautions d'un marché (vente ou sous-traitance). */
export async function rendreRetenue(zone, { marche, message }) {
  const r = await api.retenueMarche(marche);
  const lib = r.liberation;
  const etat = r.liberee_le ? `✅ Libérée le ${jour(r.liberee_le)}`
    : lib.bloquee ? `⛔ ${echapper(MESSAGES_RETENUE[lib.motif] ?? lib.motif)}`
      : lib.liberable ? `🔓 Libérable depuis le ${jour(lib.date)}` : `⏳ Libérable le ${jour(lib.date)}`;
  const nonDatees = r.retenues.filter((x) => !x.date);
  zone.innerHTML = `<h3>Réception et retenue de garantie</h3>
    <p class="ligne">Réception ${r.reception ? `le <strong>${jour(r.reception)}</strong>` : '<strong>non faite</strong>'}
      · ${r.reserves ? (r.levees_le ? `réserves levées le ${jour(r.levees_le)}` : 'réserves en cours') : 'sans réserves'}
      ${lib.echeance ? ` · échéance ${jour(lib.echeance)}` : ''} · ${etat}
      ${!r.liberee_le && lib.liberable && nonDatees.length ? '<button type="button" data-liberer title="Dater les échéances de retenue au jour : le module Règlements les propose au pointage">🔓 Libérer</button>' : ''}</p>
    <p class="aide">Réception, réserves et levée se saisissent dans l'onglet du marché (groupe Conditions).</p>
    <table class="tableau-compact"><thead><tr><th>Pièce</th><th>Date</th><th class="nombre">Retenue</th><th>Échéance</th></tr></thead><tbody>
    ${r.retenues.length ? r.retenues.map((x) => `<tr><td><a href="/document/${Number(x.ent_id)}">${echapper(x.numero ?? `#${x.ent_id}`)}</a> <small class="aide">${echapper(x.type)}</small></td>
      <td>${jour(x.date_document)}</td><td class="nombre">${f(x.montant)}</td><td>${x.date ? jour(x.date) : '<span class="aide">à la libération</span>'}</td></tr>`).join('')
    : '<tr><td colspan="4" class="aide">Aucune retenue sur les pièces validées du marché.</td></tr>'}
    </tbody><tfoot><tr><th colspan="2">Total</th><th class="nombre">${f(r.total)}</th><th></th></tr></tfoot></table>
    ${r.cautions.length ? `<h4>Cautions</h4><table class="tableau-compact"><thead><tr><th>Organisme</th><th>Référence</th><th class="nombre">Montant</th><th>Du</th><th>Au</th><th>Mainlevée</th></tr></thead><tbody>
      ${r.cautions.map((c) => `<tr><td>${echapper(c.organisme)}</td><td>${echapper(c.reference ?? '')}</td><td class="nombre">${f(c.montant)}</td><td>${jour(c.date)}</td>
        <td>${jour(c.date_fin)}</td><td>${jour(c.mainlevee)}</td></tr>`).join('')}</tbody></table>` : ''}`;
  zone.querySelector('[data-liberer]')?.addEventListener('click', async () => {
    try {
      await api.libererRetenue(marche, aujourdhui());
      message('Retenue libérée', 'succes');
      await rendreRetenue(zone, { marche, message });
    } catch (e) { message(e.message, 'erreur'); }
  });
}
