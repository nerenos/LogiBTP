import { PageBase } from '@logibtp/navigation';
import { echapper, creerCombo, confirmer, saisir } from '@logibtp/socle/ui';
import { api, ErreurApi } from '../api.js';
import { zoneRiche } from '../crm/crm.js';
import { pastilleCompteMail } from './parametres-mail.js';

const ETATS = {
  A_ENVOYER: ['⏳ En attente', 'attention'], EN_COURS: ['En cours', 'attention'], ENVOYE: ['Envoyé', 'ok'], ERREUR: ['Erreur', 'erreur'],
  ANNULE: ['Annulé', 'neutre'], SUSPENDU: ['Suspendu', 'erreur'], BROUILLON: ['Brouillon', 'neutre'],
  A_RAPPROCHER: ['À rapprocher', 'attention'], PROPOSE: ['Proposé', 'attention'], RAPPROCHE: ['Rapproché', 'ok'], IGNORE: ['Ignoré', 'neutre'], RECU: ['Reçu', 'neutre'],
};
const VUES = [['a-rapprocher', 'À rapprocher'], ['recus', 'Reçus'], ['envoyes', 'Envoyés'], ['attente', 'En attente'], ['erreurs', 'Erreurs'], ['tous', 'Envois'],
  ['envois', 'Suivi des envois']];
const VUES_RECUES = { 'a-rapprocher': 'a-rapprocher', recus: 'tous' };
const date = (d) => (d ? new Date(d).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : '');
const taille = (n) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} Mo` : `${Math.max(1, Math.round(n / 1024))} Ko`);

export const NATURES = { ARC: 'ARC', REPONSE_DEVIS: 'Réponse au devis', FACTURE_FOURNISSEUR: 'Facture fournisseur', BL: 'Livraison', RELANCE: 'Relance', AUTRE: 'Autre' };
const INDICES = { FIL: 'réponse à un envoi', NUMERO_OBJET: 'numéro dans l’objet', NUMERO_TEXTE: 'numéro dans le texte', NUMERO_PIECE: 'numéro dans le nom d’une pièce',
  NUMERO_PIECE_TEXTE: 'numéro dans une pièce', REFERENCE: 'référence citée', EXPEDITEUR: 'expéditeur = tiers', TIERS: 'tiers de l’expéditeur' };

export const pastilleMessage = (etat) => {
  const [l, c] = ETATS[etat] ?? [etat, 'neutre'];
  return `<span class="pastille-compte ${c}">${echapper(l)}</span>`;
};

/** Message affiché après la mise en file : parti tout de suite ou en attente (position, départ estimé, cause). */
export function messageEnvoi(r) {
  if (!r.en_attente) return [`Courriel envoyé à la file : départ immédiat${r.messages.length > 1 ? ` (${r.messages.length} courriels)` : ''}`, 'succes'];
  return [`Votre courriel est en attente d'envoi (position ${r.position + 1}, départ estimé vers ${date(r.depart)}${r.cause ? ` : ${r.cause}` : ''}). `
    + 'Vous serez prévenu de son départ.', 'avertissement'];
}

/**
 * Rédaction d'un courriel (module Mail) : depuis un élément (`/mail/nouveau?type=document&id=…&usage=`), valeurs
 * proposées par l'application (expéditeur de l'usage, destinataires, modèle, pièces « à envoyer ») ; tout envoi passe
 * par la file : l'utilisateur est prévenu d'une attente, un envoi groupé demande confirmation.
 */
export class PageRedactionMail extends PageBase {
  icone = '✉';

  get modifiee() { return Boolean(this.change); }

  async ouvrir() {
    const app = this.app;
    const r = this.requete ?? {};
    this.titre = 'Nouveau courriel';
    this.conteneur.innerHTML = '<div class="page-parametres page-mail"><p class="aide">Préparation…</p></div>';
    try {
      this.brouillon = await api.mail.preparer({ type: r.type, id: r.id, usage: r.usage });
    } catch (e) {
      this.conteneur.firstElementChild.innerHTML = `<p class="erreur">${echapper(e.message)}</p>`;
      return;
    }
    this.rendre();
  }

  rendre() {
    const b = this.brouillon;
    const el = b.element;
    if (el) this.titre = `Courriel : ${el.libelle}`;
    const champ = (role, libelle) => `<tr><th>${libelle}</th><td><textarea data-role="${role}" rows="1" cols="70" placeholder="Nom <adresse@domaine.fr>, …"></textarea></td></tr>`;
    this.conteneur.innerHTML = `<div class="page-parametres page-mail">
      <div class="entete-page"><h1 class="page-titre">✉ ${echapper(this.titre)}</h1>
        <span><button type="button" class="principal" data-envoyer title="Mettre le courriel dans la file d'envoi">📤 Envoyer</button>
        <button type="button" data-fermer>✕ Fermer</button></span></div>
      ${el ? `<p class="aide">Depuis <a href="${echapper(el.url ?? '#')}" data-lien>${echapper(el.libelle)}</a> : le courriel envoyé est rangé dans la GED et le suivi de l'élément.</p>` : ''}
      <table class="pleine-largeur"><tbody>
        <tr><th>De</th><td><span data-expediteur></span> <span class="aide" data-estimation></span></td></tr>
        ${champ('a', 'À')}${champ('cc', 'Cc')}${champ('cci', 'Cci')}
        ${b.destinataires.length ? `<tr><th></th><td>Proposés : ${b.destinataires.map((d, i) => `<button type="button" class="etiquette" data-propose="${i}"
          title="${echapper(d.adresse)}">＋ ${echapper(d.nom ?? d.adresse)}${d.role ? ` <span class="aide">(${echapper(d.role)})</span>` : ''}</button>`).join(' ')}</td></tr>` : ''}
        <tr><th>Objet</th><td><input data-objet size="80" value="${echapper(b.objet)}"></td></tr>
        <tr><th>Message</th><td data-corps></td></tr>
        <tr><th>Pièces jointes</th><td>${b.pieces.length ? b.pieces.map((p, i) => `<label class="ligne"><input type="checkbox" data-piece="${i}" ${p.cochee ? 'checked' : ''}>
          📎 ${echapper(p.nom)} <span class="aide">${taille(p.taille)}</span></label>`).join('<br>') : '<span class="aide">Aucune pièce marquée « à envoyer » (📧 dans l’onglet Pièces).</span>'}
          <div class="aide" data-taille></div></td></tr>
        <tr><th></th><td><label class="ligne"><input type="checkbox" data-copie> Copie à moi (Cci)</label></td></tr>
      </tbody></table></div>`;
    const expediteur = creerCombo({ options: b.expediteurs.map((a) => ({ valeur: a.id, libelle: a.nom })), valeur: b.alias_id });
    this.conteneur.querySelector('[data-expediteur]').replaceWith(expediteur);
    this.expediteur = expediteur;
    this.corps = zoneRiche(b.corps_html, { surChange: () => { this.change = true; } });
    this.conteneur.querySelector('[data-corps]').append(this.corps.element);
    const a = this.conteneur.querySelector('[data-role="a"]');
    const parDefaut = b.destinataires.filter((d) => d.par_defaut);
    a.value = parDefaut.map((d) => (d.nom ? `${d.nom} <${d.adresse}>` : d.adresse)).join(', ');
    this.conteneur.querySelectorAll('[data-propose]').forEach((bt) => bt.addEventListener('click', () => {
      const d = b.destinataires[Number(bt.dataset.propose)];
      a.value = [a.value.trim(), d.nom ? `${d.nom} <${d.adresse}>` : d.adresse].filter(Boolean).join(', ');
      this.change = true;
      this.estimer();
    }));
    this.conteneur.querySelectorAll('textarea, input').forEach((x) => x.addEventListener('change', () => { this.change = true; this.majTaille(); this.estimer(); }));
    expediteur.addEventListener('change', () => this.estimer());
    this.conteneur.querySelector('[data-lien]')?.addEventListener('click', (e) => { e.preventDefault(); this.app.naviguer(b.element.url, { nouvelleFenetre: true }); });
    this.conteneur.querySelector('[data-fermer]').addEventListener('click', () => this.app.fermerPage('/mail'));
    this.conteneur.querySelector('[data-envoyer]').addEventListener('click', () => this.envoyer(false));
    this.majTaille();
    this.estimer();
  }

  destinataires(role) {
    return (this.conteneur.querySelector(`[data-role="${role}"]`).value ?? '').split(/[,;\n]/).map((x) => x.trim()).filter(Boolean).map((x) => {
      const m = /^"?([^"<]*?)"?\s*<([^>]+)>$/.exec(x);
      const proposee = this.brouillon.destinataires.find((d) => d.adresse.toLowerCase() === (m ? m[2] : x).toLowerCase());
      return { adresse: m ? m[2].trim() : x, nom: m ? m[1].trim() || null : proposee?.nom ?? null, per_id: proposee?.per_id ?? null, ind_id: proposee?.ind_id ?? null };
    });
  }

  pieces() {
    return [...this.conteneur.querySelectorAll('[data-piece]')].filter((c) => c.checked).map((c) => this.brouillon.pieces[Number(c.dataset.piece)]);
  }

  majTaille() {
    const total = this.pieces().reduce((t, p) => t + p.taille, 0);
    const z = this.conteneur.querySelector('[data-taille]');
    if (!z) return;
    z.textContent = total ? `Total ${taille(total)} (au plus ${taille(this.brouillon.taille_max)} par courriel)` : '';
    z.classList.toggle('erreur', total * 4 / 3 > this.brouillon.taille_max);
  }

  /** Départ estimé selon la file et les limitations du compte de l'expéditeur. */
  async estimer() {
    const n = ['a', 'cc', 'cci'].reduce((t, r) => t + this.destinataires(r).length, 0);
    const z = this.conteneur.querySelector('[data-estimation]');
    if (!z || !n) { if (z) z.textContent = ''; return; }
    try {
      const e = await api.mail.estimer({ alias_id: Number(this.expediteur.valeurCombo), messages: 1, destinataires_par_message: n, priorite: 'HAUTE' });
      z.textContent = e.immediat ? `Départ immédiat · quota du jour utilisé à ${e.taux_quota} %`
        : `⏳ Départ estimé vers ${date(e.depart)}${e.cause ? ` (${e.cause})` : ''} · ${e.position} courriel(s) en file`;
    } catch { z.textContent = ''; }
  }

  async envoyer(confirmation) {
    const demande = {
      alias_id: Number(this.expediteur.valeurCombo), a: this.destinataires('a'), cc: this.destinataires('cc'), cci: this.destinataires('cci'),
      objet: this.conteneur.querySelector('[data-objet]').value, corps_html: this.corps.valeur() ?? '', pieces: this.pieces().map((p) => p.reference),
      type_element: this.brouillon.element?.type ?? null, id_element: this.brouillon.element?.id ?? null, usage: this.brouillon.element?.usage ?? null,
      copie_moi: this.conteneur.querySelector('[data-copie]').checked, confirmation_massive: confirmation, priorite: 'HAUTE',
    };
    try {
      const r = await api.mail.envoyer(demande);
      this.change = false;
      const [texte, niveau] = messageEnvoi(r);
      this.app.message(texte, niveau);
      this.app.publier('mail', { messages: r.messages });
      this.app.fermerPage(r.messages.length === 1 ? `/mail/message/${r.messages[0]}` : '/mail?vue=attente');
    } catch (e) {
      if (e instanceof ErreurApi && e.code === 'MAIL_CONFIRMATION') {
        if (await confirmer(`${e.details?.avertissement ?? e.message}\n\nConfirmer l'envoi ?`)) await this.envoyer(true);
        return;
      }
      this.app.erreur(e);
    }
  }
}

/** Courriels de l'utilisateur (tous pour un administrateur) par état ; suivi des envois (administrateur) : compteurs, lots, journal. */
export class PageMail extends PageBase {
  icone = '📬';

  urlCourante() { return `/mail?vue=${this.vue}${this.lot ? `&lot=${this.lot}` : ''}`; }

  async ouvrir() {
    const app = this.app;
    const r = this.requete ?? {};
    this.vue = r.vue ?? 'a-rapprocher';
    this.compte = r.compte ? Number(r.compte) : null;
    this.lot = r.lot ?? null;
    this.titre = 'Courriels';
    const vues = VUES.filter(([v]) => v !== 'envois' || app.estAdmin());
    this.conteneur.innerHTML = `<div class="page-parametres">
      <div class="entete-page"><h1 class="page-titre">📬 Courriels</h1><span><button type="button" data-nouveau>✉ Nouveau courriel</button>
        ${app.estAdmin() ? '<button type="button" data-parametres>⚙ Messagerie</button>' : ''}</span></div>
      <p class="ligne">${vues.map(([v, l]) => `<label class="ligne"><input type="radio" name="vue" value="${v}" ${v === this.vue ? 'checked' : ''}> ${l}</label>`).join(' ')}</p>
      <div data-liste></div></div>`;
    this.conteneur.querySelectorAll('[name="vue"]').forEach((x) => x.addEventListener('change', () => { this.vue = x.value; this.lot = null; this.charger(); }));
    this.conteneur.querySelector('[data-nouveau]').addEventListener('click', () => app.naviguer('/mail/nouveau', { nouvelleFenetre: true }));
    this.conteneur.querySelector('[data-parametres]')?.addEventListener('click', () => app.naviguer('/parametres/mail'));
    this.desabonner = app.abonner('mail', () => this.charger());
    await this.charger();
  }

  fermer() { this.desabonner?.(); }

  async charger() {
    const zone = this.conteneur.querySelector('[data-liste]');
    try {
      if (this.vue === 'envois') { await this.rendreSuivi(zone); return; }
      if (VUES_RECUES[this.vue]) { await this.rendreRecus(zone); return; }
      const l = await api.mail.messages({ vue: this.vue, lot: this.lot });
      zone.innerHTML = l.length ? tableMessages(l) : '<p class="aide">Aucun courriel.</p>';
      brancherMessages(zone, this.app);
    } catch (e) { zone.innerHTML = `<p class="erreur">${echapper(e.message)}</p>`; }
  }

  /** Courriels reçus des boîtes visibles : à rapprocher ou tous ; « Relever maintenant » par boîte. */
  async rendreRecus(zone) {
    const [boites, l] = await Promise.all([api.mail.boites(), api.mail.recus({ vue: VUES_RECUES[this.vue], compte: this.compte })]);
    if (!boites.length) { zone.innerHTML = '<p class="aide">Aucune boîte de réception visible (compte de réception et services de la boîte : Paramètres › Messagerie).</p>'; return; }
    zone.innerHTML = `<p class="ligne">${boites.map((b) => `<span class="etiquette-choix"><label class="ligne"><input type="radio" name="boite" value="${b.id}" ${this.compte === b.id ? 'checked' : ''}>
        📥 ${echapper(b.alias)}</label><button type="button" data-relever="${b.id}" title="Relever maintenant (dernière relève : ${date(b.releve_le) || 'jamais'}${b.releve_erreur ? ` — ${echapper(b.releve_erreur)}` : ''})">⟳</button></span>`).join(' ')}
      <label class="ligne"><input type="radio" name="boite" value="" ${this.compte ? '' : 'checked'}> toutes</label></p>
      ${l.length ? tableMessages(l) : '<p class="aide">Aucun courriel.</p>'}`;
    zone.querySelectorAll('[name="boite"]').forEach((x) => x.addEventListener('change', () => { this.compte = x.value ? Number(x.value) : null; this.charger(); }));
    zone.querySelectorAll('[data-relever]').forEach((b) => b.addEventListener('click', async () => {
      try { const r = await api.mail.relever(Number(b.dataset.relever)); this.app.message(`${r.nouveaux} nouveau(x) courriel(s)`, 'succes'); await this.charger(); } catch (e) { this.app.erreur(e); }
    }));
    brancherMessages(zone, this.app);
  }

  async rendreSuivi(zone) {
    const [compteurs, lots, journal] = await Promise.all([api.mail.compteurs(), api.mail.lots(), api.mail.journal()]);
    zone.innerHTML = `<h2>Comptes</h2><table class="tableau-compact largeur-contenu"><thead><tr><th>Compte</th><th>État</th><th class="nombre">Dest. / heure</th>
      <th class="nombre">Dest. / jour</th><th class="nombre">Quota</th><th class="nombre">En file</th><th class="nombre">Suspendus</th><th class="nombre">Échecs (24 h)</th>
      <th>Prochain départ</th><th class="cellule-boutons"></th></tr></thead><tbody>
      ${compteurs.map((c) => `<tr data-compte="${c.compte}"><td>${echapper(c.alias)}</td><td>${pastilleCompteMail(c.etat)}</td>
        <td class="nombre">${c.destinataires_heure} / ${c.limites.destinataires_par_heure}</td><td class="nombre">${c.destinataires_jour} / ${c.limites.destinataires_par_jour}</td>
        <td class="nombre">${c.taux_quota} %</td><td class="nombre">${c.en_file}</td><td class="nombre">${c.suspendus}</td><td class="nombre">${c.erreurs_jour}</td>
        <td>${date(c.prochain_depart)}</td><td class="cellule-boutons">${c.etat === 'SUSPENDU' ? '<button type="button" data-reprendre>▶ Reprendre</button>' : ''}</td></tr>`).join('')}
      </tbody></table><div class="boutons"><button type="button" data-traiter title="Traiter la file maintenant (tâche de fond)">⟳ Traiter la file</button></div>
      <h2>Envois groupés</h2>${lots.length ? `<table class="tableau-compact largeur-contenu"><thead><tr><th>Le</th><th>Objet</th><th>Auteur</th><th class="nombre">Courriels</th>
        <th class="nombre">Destinataires</th><th class="nombre">Envoyés</th><th class="nombre">Erreurs</th><th>Fin estimée</th></tr></thead><tbody>
        ${lots.map((l) => `<tr data-lot="${l.id}" class="ligne-actions-survol" title="${echapper(l.avertissement ?? '')}"><td>${date(l.cree_le)}</td><td>${echapper(l.libelle ?? '')}</td>
          <td>${echapper(l.auteur)}</td><td class="nombre">${l.messages}</td><td class="nombre">${l.destinataires}</td><td class="nombre">${l.envoyes}</td>
          <td class="nombre">${l.erreurs}</td><td>${date(l.fin_estimee)}</td></tr>`).join('')}</tbody></table>` : '<p class="aide">Aucun.</p>'}
      <h2>Journal des envois</h2>${journal.length ? `<table class="tableau-compact largeur-contenu"><thead><tr><th>Le</th><th>Compte</th><th>Par</th><th>Origine</th>
        <th class="nombre">Dest.</th><th class="nombre">Nouveaux</th><th>Résultat</th><th>Réponse</th></tr></thead><tbody>
        ${journal.map((j) => `<tr${j.message ? ` data-message="${j.message}" class="ligne-actions-survol"` : ''}><td>${date(j.le)}</td><td>${echapper(j.alias ?? '')}</td>
          <td>${echapper(j.utilisateur)}</td><td>${echapper(j.origine ?? '')}</td><td class="nombre">${j.destinataires}</td><td class="nombre">${j.nouveaux}</td>
          <td>${pastilleMessage(j.resultat === 'OK' ? 'ENVOYE' : j.resultat === 'REPORT' ? 'A_ENVOYER' : 'ERREUR')}</td>
          <td>${echapper([j.code, j.reponse].filter(Boolean).join(' '))}</td></tr>`).join('')}</tbody></table>` : '<p class="aide">Vide.</p>'}`;
    zone.querySelectorAll('[data-reprendre]').forEach((b) => b.addEventListener('click', async () => {
      try { await api.mail.reprendre(Number(b.closest('tr').dataset.compte)); await this.charger(); } catch (e) { this.app.erreur(e); }
    }));
    zone.querySelector('[data-traiter]').addEventListener('click', async () => {
      try { const r = await api.mail.traiter(); this.app.message(`${r.envoyes} courriel(s) envoyé(s)`, 'succes'); await this.charger(); } catch (e) { this.app.erreur(e); }
    });
    zone.querySelectorAll('tr[data-lot]').forEach((tr) => tr.addEventListener('click', () => { this.vue = 'tous'; this.lot = Number(tr.dataset.lot); this.charger(); }));
    zone.querySelectorAll('tr[data-message]').forEach((tr) => tr.addEventListener('click', () => this.app.naviguer(`/mail/message/${tr.dataset.message}`)));
  }
}

/** Tableau de courriels (boîte, onglet d'un élément). */
export function tableMessages(l) {
  return `<table class="tableau-compact largeur-contenu"><thead><tr><th>État</th><th>Créé le</th><th>De</th><th>À</th><th>Objet</th><th>📎</th><th>Envoyé / départ</th></tr></thead><tbody>
    ${l.map((m) => `<tr data-id="${m.id}" class="ligne-actions-survol" title="${echapper(m.erreur ?? m.attente ?? '')}"><td>${pastilleMessage(m.etat)}</td><td>${date(m.cree_le)}</td>
      <td>${echapper(m.expediteur ?? '')}</td><td>${echapper(m.a.join(', '))}${m.nb_destinataires > m.a.length ? ` <span class="aide">+${m.nb_destinataires - m.a.length}</span>` : ''}</td>
      <td>${m.nature ? `<span class="etiquette-choix">${echapper(NATURES[m.nature] ?? m.nature)}</span> ` : ''}${echapper(m.objet)}</td><td>${m.nb_pieces || ''}</td><td>${m.envoye_le ? date(m.envoye_le) : m.prochain_essai && m.etat === 'A_ENVOYER' ? `⏳ ${date(m.prochain_essai)}` : ''}</td></tr>`).join('')}
    </tbody></table>`;
}

export function brancherMessages(zone, app) {
  zone.querySelectorAll('tr[data-id]').forEach((tr) => tr.addEventListener('click', () => app.naviguer(`/mail/message/${tr.dataset.id}`, { nouvelleFenetre: true })));
}

/** Détail d'un courriel : état, attente ou erreur, destinataires, pièces, journal ; annuler (en attente) ou relancer (erreur). */
export class PageMessageMail extends PageBase {
  icone = '✉';

  async ouvrir() {
    this.titre = 'Courriel';
    this.conteneur.innerHTML = '<div class="page-parametres" data-detail></div>';
    this.desabonner = this.app.abonner('mail', () => this.charger());
    await this.charger();
  }

  fermer() { this.desabonner?.(); }

  async charger() {
    const zone = this.conteneur.querySelector('[data-detail]');
    let d;
    try { d = await api.mail.message(Number(this.params.id)); } catch (e) { zone.innerHTML = `<p class="erreur">${echapper(e.message)}</p>`; return; }
    const m = d.message;
    this.titre = `Courriel : ${m.objet}`;
    zone.innerHTML = `<div class="entete-page"><h1 class="page-titre">✉ ${echapper(m.objet)}</h1><span>
        ${['A_ENVOYER', 'SUSPENDU'].includes(m.etat) ? '<button type="button" data-annuler>✕ Annuler l’envoi</button>' : ''}
        ${m.etat === 'ERREUR' ? '<button type="button" data-relancer>↻ Nouvel essai</button>' : ''}
        ${m.type_element === 'document' ? `<button type="button" data-element>📄 Document</button>` : ''}</span></div>
      <table><tbody><tr><th>État</th><td>${pastilleMessage(m.etat)} ${m.attente ? `<span class="aide">${echapper(m.attente)}</span>` : ''}
          ${m.erreur ? `<div class="erreur">${echapper(m.erreur)}</div>` : ''}</td></tr>
        <tr><th>De</th><td>${echapper(m.sens === 'R' ? d.de ?? '' : m.expediteur ?? '')}</td></tr>
        ${m.sens === 'R' ? `<tr><th>Boîte</th><td>${echapper(m.a.join(', '))}${d.auto ? ' <span class="aide">(réponse automatique)</span>' : ''}</td></tr>` : ''}
        ${['A', 'CC', 'CCI'].map((r) => d.destinataires.some((x) => x.role === r) ? `<tr><th>${r === 'A' ? 'À' : r === 'CC' ? 'Cc' : 'Cci'}</th><td>${d.destinataires.filter((x) => x.role === r)
          .map((x) => `${echapper(x.nom ? `${x.nom} <${x.adresse}>` : x.adresse)}${x.non_remis ? ` <span class="erreur">non remis : ${echapper(x.non_remis)}</span>
            <button type="button" data-marquer="${echapper(x.adresse)}" title="Signaler cette adresse non remise sur les coordonnées de l'annuaire">⚠ Signaler dans l'annuaire</button>` : ''}`).join(', ')}</td></tr>` : '').join('')}
        <tr><th>Créé</th><td>${date(m.cree_le)} par ${echapper(m.cree_par)}</td></tr>
        <tr><th>${m.envoye_le ? 'Envoyé' : 'Départ prévu'}</th><td>${date(m.envoye_le ?? m.prochain_essai)}${m.tentatives ? ` · ${m.tentatives} essai(s)` : ''}</td></tr>
        ${d.pieces.length ? `<tr><th>Pièces</th><td>${d.pieces.map((p) => `📎 ${echapper(p.nom)} <span class="aide">${taille(p.taille)}</span>`).join('<br>')}</td></tr>` : ''}
      </tbody></table>
      ${m.sens === 'R' ? `<h2>Rattachements</h2>${d.liens.length ? `<ul>${d.liens.map((l) => `<li>${l.url ? `<a href="${echapper(l.url)}" data-lien>${echapper(l.libelle ?? `${l.type} ${l.id}`)}</a>` : echapper(l.libelle ?? `${l.type} ${l.id}`)}
          <span class="aide">${echapper(l.origine.toLowerCase())}${l.score != null ? ` ${l.score} %` : ''}, ${echapper(l.par)}</span>
          <button type="button" data-detacher="${echapper(l.type)}|${echapper(l.id)}" title="Retirer ce rattachement">✕</button></li>`).join('')}</ul>` : '<p class="aide">Aucun.</p>'}
        ${d.propositions.filter((p) => !d.liens.some((l) => l.type === p.type && l.id === p.id)).length ? `<p>Propositions${m.nature ? ` (${echapper(NATURES[m.nature] ?? m.nature)})` : ''} :</p><ul>${d.propositions
          .filter((p) => !d.liens.some((l) => l.type === p.type && l.id === p.id)).map((p) => `<li><button type="button" data-proposition="${echapper(p.type)}|${echapper(p.id)}" title="Rattacher">✓</button>
          ${p.url ? `<a href="${echapper(p.url)}" data-lien>${echapper(p.libelle ?? `${p.type} ${p.id}`)}</a>` : echapper(p.libelle ?? `${p.type} ${p.id}`)}
          <span class="aide">${p.score} % : ${p.indices.map((i) => echapper(INDICES[i] ?? i)).join(', ')}</span></li>`).join('')}</ul>` : ''}
        <p class="ligne"><span data-type-rattachement></span> <input data-code size="20" placeholder="numéro ou code"> <button type="button" data-rattacher>🔗 Rattacher</button>
          ${m.etat !== 'IGNORE' ? '<button type="button" data-ignorer title="Courriel sans rapport (publicité, personnel) : retiré de la liste et de la GED">🚫 Ignorer…</button>' : ''}</p>` : ''}
      <iframe class="mail-corps" sandbox="allow-popups allow-popups-to-escape-sandbox" title="Corps du courriel" data-corps></iframe>
      ${d.journal.length ? `<h2>Journal</h2><table class="tableau-compact largeur-contenu"><thead><tr><th>Le</th><th>Résultat</th><th>Réponse du serveur</th><th class="nombre">Durée</th></tr></thead><tbody>
        ${d.journal.map((j) => `<tr><td>${date(j.le)}</td><td>${echapper(j.resultat)}</td><td>${echapper([j.code, j.reponse].filter(Boolean).join(' '))}</td>
          <td class="nombre">${j.duree_ms ?? ''} ms</td></tr>`).join('')}</tbody></table>` : ''}`;
    // Corps du courriel isolé (module Droits, lot 5) : cadre sans script ni accès à l'application, liens dans un nouvel onglet.
    zone.querySelector('[data-corps]').srcdoc = `<!doctype html><meta charset="utf-8"><base target="_blank"><style>body{font-family:sans-serif;margin:.6rem;color:#1f2328;background:#fff}</style>${d.corps_html ?? ''}`;
    const action = (sel, f) => zone.querySelector(sel)?.addEventListener('click', async () => {
      try { await f(); this.app.publier('mail', {}); await this.charger(); } catch (e) { this.app.erreur(e); }
    });
    action('[data-annuler]', () => api.mail.annuler(m.id));
    action('[data-relancer]', () => api.mail.relancer(m.id));
    zone.querySelector('[data-element]')?.addEventListener('click', () => this.app.naviguer(`/document/${m.id_element}`, { nouvelleFenetre: true }));
    zone.querySelectorAll('[data-lien]').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); this.app.naviguer(a.getAttribute('href'), { nouvelleFenetre: true }); }));
    zone.querySelectorAll('[data-marquer]').forEach((b) => b.addEventListener('click', async () => {
      try { const r = await api.mail.marquerAdresse(m.id, b.dataset.marquer); this.app.message(`${r.coordonnees} coordonnée(s) signalée(s) dans l'annuaire`, 'succes'); } catch (e) { this.app.erreur(e); }
    }));
    zone.querySelectorAll('[data-detacher]').forEach((b) => b.addEventListener('click', async () => {
      const [type, id] = b.dataset.detacher.split('|');
      try { await api.mail.detacher(m.id, type, id); this.app.publier('mail', {}); await this.charger(); } catch (e) { this.app.erreur(e); }
    }));
    if (m.sens !== 'R') return;
    zone.querySelectorAll('[data-proposition]').forEach((b) => b.addEventListener('click', async () => {
      const [type, id] = b.dataset.proposition.split('|');
      try { await api.mail.rattacher(m.id, { type, id }); this.app.publier('mail', {}); await this.charger(); } catch (e) { this.app.erreur(e); }
    }));
    const types = await api.mail.typesRattachement().catch(() => []);
    const type = creerCombo({ options: types.map((t) => ({ valeur: t.type, libelle: t.libelle, detail: t.aide })), valeur: types[0]?.type ?? '' });
    zone.querySelector('[data-type-rattachement]')?.replaceWith(type);
    const code = zone.querySelector('[data-code]');
    type.addEventListener('change', () => { code.placeholder = types.find((t) => t.type === type.valeurCombo)?.aide ?? ''; });
    code.placeholder = types[0]?.aide ?? '';
    const rattacher = async () => {
      if (!code.value.trim()) return;
      try { await api.mail.rattacher(m.id, { type: type.valeurCombo, code: code.value.trim() }); this.app.publier('mail', {}); await this.charger(); } catch (e) { this.app.erreur(e); }
    };
    zone.querySelector('[data-rattacher]').addEventListener('click', rattacher);
    code.addEventListener('keydown', (e) => { if (e.key === 'Enter') rattacher(); });
    zone.querySelector('[data-ignorer]')?.addEventListener('click', async () => {
      const motif = await saisir('Ignorer ce courriel (il est retiré de la liste et de la GED). Motif :', '');
      if (motif === null) return;
      try { await api.mail.ignorer(m.id, motif); this.app.publier('mail', {}); await this.charger(); } catch (e) { this.app.erreur(e); }
    });
  }
}
