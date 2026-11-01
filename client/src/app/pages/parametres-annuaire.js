import { texte, texteHtml, icone, iconeHtml } from '@logibtp/socle/dictionnaire';
import { urlFiche, TYPE_FICHE } from '../codes.js';
import { PageBase } from '@logibtp/navigation';
import { GestionReferentielsAnnuaire } from '@logibtp/annuaire/ui';
import { TYPES_FICHE } from '../fiches/definitions.js';

/** Paramétrage de l'annuaire : niveaux, relations (groupes de champs déverrouillés), types de lien, rôles des individus. */
export class PageParametresAnnuaire extends PageBase {
  icone = icone('parametres_btp_annuaire');

  async ouvrir() {
    const app = this.app;
    this.titre = texte('parametres_btp.annuaire.titre');
    this.conteneur.innerHTML = `<div class="page-parametres page-bibliotheque"><h1 class="page-titre">${iconeHtml('parametres_btp_annuaire')} ${texteHtml('parametres_btp.annuaire.titre')}</h1><div class="page-bibliotheque-corps"></div></div>`;
    const s = await app.services();
    // Groupes déverrouillables par une relation : ceux de l'onglet Par relation de la fiche personne.
    const groupes = TYPES_FICHE.personne.definition.sections.find((x) => x.code === 'casquettes').groupes.map((g) => ({ code: g.code, titre: g.titre }));
    const gestion = new GestionReferentielsAnnuaire(this.conteneur.querySelector('.page-bibliotheque-corps'), {
      fournisseur: s.annuaire, groupes, message: (t, n) => app.message(t, n), admin: app.estAdmin(),
    });
    await gestion.ouvrir();
  }
}

/** Notre société : fiche de la personne « société de cette base », ou création si elle n'existe pas encore. */
export class PageNotreSociete extends PageBase {
  icone = icone('parametres_btp_societe');

  async ouvrir() {
    const app = this.app;
    this.titre = texte('parametres_btp.societe.titre');
    const s = await app.services();
    const societe = await s.annuaire.societeBase();
    if (societe) {
      setTimeout(() => app.naviguer(urlFiche(TYPE_FICHE.PERSONNE, societe.id), { remplacer: true }), 0);
      this.conteneur.innerHTML = `<p class="aide">${texteHtml('parametres_btp.societe.ouverture')}</p>`;
      return;
    }
    this.conteneur.innerHTML = `<div class="page-parametres"><h1 class="page-titre">${iconeHtml('parametres_btp_societe')} ${texteHtml('parametres_btp.societe.titre')}</h1>
      <p>${texteHtml('parametres_btp.societe.absente')}</p><p><a href="/fiche/personne/nouveau?societe=1">${iconeHtml('ajouter')} ${texteHtml('parametres_btp.societe.creer')}</a></p></div>`;
  }
}
