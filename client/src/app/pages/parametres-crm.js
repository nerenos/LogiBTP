import { PageBase } from '@logibtp/navigation';
import { echapper, creerCombo } from '@logibtp/socle/ui';
import { api } from '../api.js';
import { contexteCrm } from '../crm/crm.js';

/**
 * Paramétrage du CRM (administrateur) : types de notes (appel, courriel, visite…), globaux ou propres à un service ;
 * un type retiré déjà utilisé est désactivé.
 */
export class PageParametresCrm extends PageBase {
  icone = '☑';

  get modifiee() { return Boolean(this.modifie); }

  async ouvrir() {
    const app = this.app;
    this.titre = 'Paramétrage du suivi (CRM)';
    this.conteneur.innerHTML = '<div class="page-parametres"><h1 class="page-titre">☑ Paramétrage du suivi (CRM)</h1><h2>Types de notes</h2><div data-types></div></div>';
    if (!app.enLigne) { this.conteneur.querySelector('[data-types]').innerHTML = '<p class="aide">Disponible en ligne seulement.</p>'; return; }
    this.ctx = await contexteCrm(app);
    this.types = await api.crm.typesNotes();
    this.rendreTypes();
  }

  rendreTypes() {
    const admin = this.app.estAdmin();
    const zone = this.conteneur.querySelector('[data-types]');
    zone.innerHTML = `<table><thead><tr><th>Icône</th><th>Code</th><th>Libellé</th><th>Service</th><th>Ordre</th><th>Actif</th><th></th></tr></thead><tbody>
      ${this.types.map((t, i) => `<tr data-i="${i}"${t.actif ? '' : ' class="discret"'}>
        <td><input data-c="icone" value="${echapper(t.icone ?? '')}" size="3" maxlength="8" ${admin ? '' : 'disabled'}></td>
        <td><input data-c="code" value="${echapper(t.code)}" size="10" maxlength="20" ${admin ? '' : 'disabled'}></td>
        <td><input data-c="libelle" value="${echapper(t.libelle)}" size="28" maxlength="80" ${admin ? '' : 'disabled'}></td>
        <td><span data-srv></span></td>
        <td><input data-c="ordre" value="${Number(t.ordre ?? 0)}" size="4" ${admin ? '' : 'disabled'}></td>
        <td><input type="checkbox" data-c="actif" ${t.actif ? 'checked' : ''} ${admin ? '' : 'disabled'}></td>
        <td>${admin ? '<button type="button" data-retirer title="Retirer (désactivé s\'il est utilisé)">✕</button>' : ''}</td></tr>`).join('')}</tbody></table>
      ${admin ? '<div class="boutons"><button type="button" data-ajouter>＋ Type</button> <button type="button" class="principal" data-enregistrer>Enregistrer les types</button></div>' : ''}`;
    zone.querySelectorAll('tr[data-i]').forEach((tr) => {
      const t = this.types[Number(tr.dataset.i)];
      const srv = creerCombo({ options: this.ctx.tous_services.map((s) => ({ valeur: s.id, libelle: s.libelle })), valeur: t.srv_id ?? '', titre: 'Vide : type global' });
      srv.readOnly = !admin;
      srv.addEventListener('change', () => { t.srv_id = srv.valeurCombo === '' ? null : Number(srv.valeurCombo); this.modifie = true; });
      tr.querySelector('[data-srv]').replaceWith(srv);
      tr.querySelectorAll('[data-c]').forEach((c) => c.addEventListener('change', () => {
        t[c.dataset.c] = c.type === 'checkbox' ? c.checked : c.dataset.c === 'ordre' ? Number(c.value) || 0 : c.value;
        this.modifie = true;
      }));
      tr.querySelector('[data-retirer]')?.addEventListener('click', () => { this.types.splice(Number(tr.dataset.i), 1); this.modifie = true; this.rendreTypes(); });
    });
    zone.querySelector('[data-ajouter]')?.addEventListener('click', () => {
      this.types.push({ id: null, code: '', libelle: '', srv_id: null, icone: '', modele_html: null, ordre: (this.types.length + 1) * 10, actif: true });
      this.modifie = true;
      this.rendreTypes();
    });
    zone.querySelector('[data-enregistrer]')?.addEventListener('click', async () => {
      try {
        this.types = await api.crm.enregistrerTypesNotes(this.types);
        this.modifie = false;
        this.app.contexteCrm = null;
        this.app.message('Types de notes enregistrés', 'succes');
        this.rendreTypes();
      } catch (e) { this.app.erreur(e); }
    });
  }
}
