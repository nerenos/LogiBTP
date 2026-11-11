import { test, expect, Locator } from '@playwright/test';
import { ouvrirConnecte } from './outils/connexion';

/**
 * Helper pour sélectionner une option dans un champ combo LogiBTP (`creerCombo`).
 * Tape le texte de l'option puis valide via la liste déroulante ou la touche Entrée.
 */
async function selectionnerCombo(champLocator: Locator, texteOption: string) {
  const input = champLocator.locator('input');
  await input.click();
  await input.fill(texteOption);

  const popupOption = champLocator.page().locator(`.liste-deroulante [data-index]:has-text("${texteOption}")`).first();
  if (await popupOption.isVisible({ timeout: 1000 }).catch(() => false)) {
    await popupOption.click();
  } else {
    await input.press('Enter');
  }
}

test.describe('Gestion du matériel', () => {

  test('Création d’une fiche matériel avec champs obligatoires et facultatifs', async ({ page }) => {
    // Données uniques pour le test
    const suffixe = Date.now().toString().slice(-4);
    const codeMateriel = `MAT${suffixe}`;
    const designationMateriel = `Mini-pelle 3.5T ${suffixe}`;
    const typeMateriel = 'Mini-pelle';
    const marqueMateriel = 'Caterpillar';
    const modeleMateriel = '303.5 CR';
    const numeroSerie = `SN-CAT-${suffixe}`;
    const immatriculation = `AA-${suffixe.slice(0, 3)}-BB`;
    const heuresUtilisation = '450';
    const dateAchat = '2025-04-12';
    const valeurAchat = '48500';
    const coutHoraire = '38.50';
    const observations = 'Matériel de terrassement en parfait état avec attache rapide.';

    // 1-2. Connexion du compte administrateur (e2e/.env) puis ouverture de la création de fiche matériel
    await ouvrirConnecte(page, '/fiche/materiel/nouveau', 'admin');

    // 3. Attente du chargement complet du formulaire de fiche
    const formFiche = page.locator('.fiche');
    await expect(formFiche).toBeVisible({ timeout: 10000 });

    // Vérification que le mode initial est bien "Création"
    await expect(page.locator('.fiche-mode')).toContainText(/création/i);

    // =========================================================================
    // 4. Remplissage des champs OBLIGATOIRES
    // =========================================================================

    // Désignation (obligatoire)
    const champDesignation = page.locator('.fiche-champ[data-champ="designation"] input');
    await expect(champDesignation).toBeVisible();
    await champDesignation.fill(designationMateriel);

    // Type / Famille de matériel (obligatoire) : champ combo
    const champFamille = page.locator('.fiche-champ[data-champ="famille"]');
    await selectionnerCombo(champFamille, typeMateriel);

    // Code matériel (obligatoire) : pré-rempli par le chrono ou à saisir
    const champCode = page.locator('.fiche-champ[data-champ="code"] input');
    const codeExistant = await champCode.inputValue();
    if (!codeExistant || codeExistant.trim() === '') {
      await champCode.fill(codeMateriel);
    }

    // =========================================================================
    // 5. Remplissage de champs FACULTATIFS
    // =========================================================================

    // Marque
    const champMarque = page.locator('.fiche-champ[data-champ="marque"] input');
    if (await champMarque.isVisible()) {
      await champMarque.fill(marqueMateriel);
    }

    // Modèle
    const champModele = page.locator('.fiche-champ[data-champ="modele"] input');
    if (await champModele.isVisible()) {
      await champModele.fill(modeleMateriel);
    }

    // Numéro de série
    const champNumeroSerie = page.locator('.fiche-champ[data-champ="numero_serie"] input');
    if (await champNumeroSerie.isVisible()) {
      await champNumeroSerie.fill(numeroSerie);
    }

    // Immatriculation
    const champImmatriculation = page.locator('.fiche-champ[data-champ="immatriculation"] input');
    if (await champImmatriculation.isVisible()) {
      await champImmatriculation.fill(immatriculation);
    }

    // Heures d'utilisation initiales (saisie autorisée à la création)
    const champHeures = page.locator('.fiche-champ[data-champ="heures_utilisation"] input');
    if (await champHeures.isVisible()) {
      await champHeures.fill(heuresUtilisation);
    }

    // Date d'achat
    const champDateAchat = page.locator('.fiche-champ[data-champ="date_achat"] input');
    if (await champDateAchat.isVisible()) {
      await champDateAchat.fill(dateAchat);
    }

    // Valeur d'achat
    const champValeurAchat = page.locator('.fiche-champ[data-champ="valeur_achat"] input');
    if (await champValeurAchat.isVisible()) {
      await champValeurAchat.fill(valeurAchat);
    }

    // Coût moyen horaire
    const champCoutHoraire = page.locator('.fiche-champ[data-champ="cout_horaire"] input');
    if (await champCoutHoraire.isVisible()) {
      await champCoutHoraire.fill(coutHoraire);
    }

    // Observations
    const champObservations = page.locator('.fiche-champ[data-champ="observations"] textarea, .fiche-champ[data-champ="observations"] input');
    if (await champObservations.isVisible()) {
      await champObservations.fill(observations);
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

    // C. Notification de succès visible ("Matériel créé")
    await expect(page.getByRole('status').filter({ hasText: /matériel créé/i })).toBeVisible({ timeout: 5000 });

    // D. Bascule automatique en mode Consultation
    await expect(page.getByText('Consultation', { exact: true })).toBeVisible();

    // E. Présence des actions de consultation (Modifier, Copier)
    await expect(page.getByRole('button', { name: 'Modifier', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Copier', exact: true })).toBeVisible();

    // F. L'en-tête de la fiche affiche bien la désignation du matériel créé
    await expect(page.getByRole('heading', { level: 2 })).toContainText(designationMateriel);

    // G. L'URL a été mise à jour avec l'identifiant numérique de la nouvelle fiche
    expect(page.url()).toMatch(/\/fiche\/materiel\/\d+/);
  });

});
