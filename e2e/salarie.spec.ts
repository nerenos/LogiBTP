import { test, expect, Locator } from '@playwright/test';
import { ouvrirConnecte, TAG_API } from './outils/connexion';

/**
 * Helper pour sélectionner une option dans un champ combo LogiBTP (`creerCombo`).
 * Tape le texte de l'option puis valide via la liste déroulante ou la touche Entrée.
 */
async function selectionnerCombo(champLocator: Locator, texteOption: string) {
  const input = champLocator.locator('input');
  await input.click();
  await input.fill(texteOption);
  
  const popup = champLocator.page().locator(`.liste-deroulante [data-index]:has-text("${texteOption}")`);
  if (await popup.isVisible({ timeout: 1000 }).catch(() => false)) {
    await popup.click();
  } else {
    await input.press('Enter');
  }
}

test.describe('Gestion des salariés', { tag: TAG_API }, () => {

  test('Création d’une fiche salarié avec champs obligatoires et facultatifs', async ({ page }) => {
    // Données uniques pour le test
    const suffixe = Date.now().toString().slice(-4);
    const nomSalarie = `Dupont${suffixe}`;
    const prenomSalarie = 'Lucas';
    const posteSalarie = 'Conducteur de travaux principal';
    const telephonePro = '06 12 34 56 78';
    const emailPro = `lucas.dupont${suffixe}@entreprise.fr`;
    const matriculePaie = `MAT-${suffixe}`;
    const dateEntree = '2026-01-15';
    const commentaire = 'Salarié qualifié, affecté aux chantiers de gros-œuvre.';

    // 1-2. Connexion du compte administrateur (e2e/.env) puis création d'une fiche salarié
    await ouvrirConnecte(page, '/fiche/salarie/nouveau', 'admin');

    // 3. Attente du chargement complet du formulaire de fiche
    const formFiche = page.locator('.fiche');
    await expect(formFiche).toBeVisible({ timeout: 10000 });

    // Vérification que le mode initial est bien "Création"
    await expect(page.locator('.fiche-mode')).toContainText(/création/i);

    // =========================================================================
    // 4. Remplissage des champs OBLIGATOIRES
    // =========================================================================

    // Nom (obligatoire)
    const champNom = page.locator('.fiche-champ[data-champ="nom"] input');
    await expect(champNom).toBeVisible();
    await champNom.fill(nomSalarie);

    // Prénom (obligatoire)
    const champPrenom = page.locator('.fiche-champ[data-champ="prenom"] input');
    await expect(champPrenom).toBeVisible();
    await champPrenom.fill(prenomSalarie);

    // Code salarié (obligatoire) : pré-rempli par le chrono ou à saisir
    const champCode = page.locator('.fiche-champ[data-champ="code"] input');
    const codeExistant = await champCode.inputValue();
    if (!codeExistant || codeExistant.trim() === '') {
      await champCode.fill(`S${suffixe}`);
    }

    // Service principal (obligatoire) : champ combo
    const champService = page.locator('.fiche-champ[data-champ="service"]');
    await selectionnerCombo(champService, 'Chantier (travaux)');

    // Téléphone professionnel (obligatoire selon le paramétrage standard LogiBTP)
    const champTelephone = page.locator('.fiche-champ[data-champ="telephone"] input');
    await champTelephone.fill(telephonePro);

    // =========================================================================
    // 5. Remplissage de champs FACULTATIFS
    // =========================================================================

    // Poste occupé
    const champPoste = page.locator('.fiche-champ[data-champ="poste"] input');
    if (await champPoste.isVisible()) {
      await champPoste.fill(posteSalarie);
    }

    // E-mail professionnel
    const champEmail = page.locator('.fiche-champ[data-champ="email"] input');
    if (await champEmail.isVisible()) {
      await champEmail.fill(emailPro);
    }

    // Matricule de paie
    const champMatricule = page.locator('.fiche-champ[data-champ="matricule_paie"] input');
    if (await champMatricule.isVisible()) {
      await champMatricule.fill(matriculePaie);
    }

    // Type de contrat / statut (combo : CDI)
    const champStatut = page.locator('.fiche-champ[data-champ="statut"]');
    if (await champStatut.isVisible()) {
      await selectionnerCombo(champStatut, 'CDI');
    }

    // Date d'entrée
    const champDateEntree = page.locator('.fiche-champ[data-champ="date_entree"] input');
    if (await champDateEntree.isVisible()) {
      await champDateEntree.fill(dateEntree);
    }

    // Note professionnelle / commentaire
    const champCommentaire = page.locator('.fiche-champ[data-champ="commentaire"] textarea, .fiche-champ[data-champ="commentaire"] input');
    if (await champCommentaire.isVisible()) {
      await champCommentaire.fill(commentaire);
    }

    // =========================================================================
    // 6. Enregistrement de la fiche
    // =========================================================================

    // Bouton Enregistrer dans la barre d'outils
    const boutonEnregistrer = page.locator('.barre-outils button.principal, button[aria-label="Enregistrer"]');
    await expect(boutonEnregistrer).toBeVisible();
    await boutonEnregistrer.click();

    // =========================================================================
    // 7. Vérifications : la fiche est créée sans erreur
    // =========================================================================

    // A. Aucun message d'erreur de validation affiché sous les champs
    const messagesErreur = page.locator('.fiche-champ .fiche-message');
    await expect(messagesErreur).toHaveCount(0);

    // B. Aucune notification d'erreur système affichée
    const notificationErreur = page.locator('.notification.erreur');
    await expect(notificationErreur).toHaveCount(0);

    // C. Notification de succès visible ("Salarié créé")
    await expect(page.getByRole('status').filter({ hasText: /salarié créé/i })).toBeVisible({ timeout: 5000 });

    // D. Bascule automatique en mode Consultation
    // (en consultation, le bouton principal de la barre est « Modifier » : on contrôle le libellé du mode)
    await expect(page.getByText('Consultation', { exact: true })).toBeVisible();

    // E. Présence des actions de consultation (Modifier, Copier)
    await expect(page.getByRole('button', { name: 'Modifier', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Copier', exact: true })).toBeVisible();

    // F. L'en-tête de la fiche affiche bien le nom et prénom du nouveau salarié
    await expect(page.getByRole('heading', { level: 2 })).toContainText(`${prenomSalarie} ${nomSalarie}`);

    // G. L'URL a été mise à jour avec l'identifiant numérique de la nouvelle fiche
    expect(page.url()).toMatch(/\/fiche\/salarie\/\d+/);
  });

});
