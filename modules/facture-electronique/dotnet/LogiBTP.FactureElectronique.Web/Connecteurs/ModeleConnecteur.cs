namespace LogiBTP.FactureElectronique.Web.Connecteurs;

// Modèle des échanges avec une plateforme agréée, indépendant du connecteur : termes de l'API XP Z12-013 (Flow Service et
// Directory Service 1.3.0) en français ; codes des valeurs dans Codes.cs (TypeFlux, SensFlux, Syntaxe, ProfilFacture,
// RegleTraitement, EtatAccuse, MotifAccuse, TypeDocumentFlux…). Listes jamais nulles.

/// <summary>
/// Paramètres d'un connecteur pour une société : code (<see cref="ConnecteurFe"/> ou code d'une PA enregistrée), base
/// de la société (état propre à la société : plateforme simulée, dépôts manuels), adresses du Flow Service et du
/// Directory Service (…/flow-service, …/directory-service), connexion OAuth (jeton par <c>IFournisseurJeton</c>),
/// organisation visée (en-tête Organization-Id), délai d'attente.
/// </summary>
public sealed record ParametresConnecteur(string Code, string Base)
{
    public Uri? AdresseFlux { get; init; }
    public Uri? AdresseAnnuaire { get; init; }
    public long? ConnexionOAuth { get; init; }
    public string? Organisation { get; init; }
    public TimeSpan Delai { get; init; } = TimeSpan.FromSeconds(100);
}

/// <summary>
/// Flux à déposer (FlowInfo + file) : contenu, nom du fichier, syntaxe (<see cref="Syntaxe"/>), profil
/// (<see cref="ProfilFacture"/>), règle de traitement (<see cref="RegleTraitement"/>, calculée par la plateforme si
/// absente), identifiant de suivi (trackingId, notre identifiant, 64 caractères au plus).
/// </summary>
public sealed record FluxADeposer(byte[] Contenu, string Nom, string Syntaxe)
{
    public string? Profil { get; init; }
    public string? RegleTraitement { get; init; }
    public string? IdentifiantSuivi { get; init; }
}

/// <summary>Flux prêt à l'envoi, contrôlé par la classe mère : empreinte SHA-256 en hexadécimal minuscule (sha256).</summary>
public sealed record FluxPrepare(FluxADeposer Flux, string Empreinte);

/// <summary>Réponse au dépôt (FullFlowInfo, 202) : identifiant de la plateforme (flowId), date de dépôt (submittedAt, référence de temps), empreinte.</summary>
public sealed record FluxDepose(string IdFlux, DateTimeOffset DeposeLe, string? IdentifiantSuivi, string Nom, string Syntaxe)
{
    public string? Profil { get; init; }
    public string? RegleTraitement { get; init; }
    public string? Empreinte { get; init; }
}

/// <summary>Détail d'un accusé (AcknowledgementDetail) : niveau (<see cref="NiveauAccuse"/>), élément visé, motif (<see cref="MotifAccuse"/> ou propre à la PA), message.</summary>
public sealed record DetailAccuse(string Niveau, string Element, string Motif, string Message);

/// <summary>Accusé d'un flux (Acknowledgement) : état (<see cref="EtatAccuse"/>) et détails.</summary>
public sealed record AccuseFlux(string Etat, IReadOnlyList<DetailAccuse> Details)
{
    public static AccuseFlux EnAttente { get; } = new(EtatAccuse.EnAttente, []);
}

/// <summary>
/// Métadonnées d'un flux (Flow) : identifiants, nom, syntaxe, profil, règle et son origine (<see cref="OrigineRegle"/>),
/// type (<see cref="TypeFlux"/>), sens (<see cref="SensFlux"/>), dates de dépôt et de dernière modification, accusé.
/// </summary>
public sealed record Flux(
    string IdFlux, string? IdentifiantSuivi, string Nom, string Syntaxe, string Profil, string RegleTraitement, string OrigineRegle,
    string Type, string Sens, DateTimeOffset DeposeLe, DateTimeOffset ModifieLe, AccuseFlux Accuse)
{
    public string? Empreinte { get; init; }
}

/// <summary>
/// Critères de recherche des flux (SearchFlowFilters ; au moins un) : modifiés strictement après / avant, règles, types,
/// sens, identifiant de suivi, état de l'accusé.
/// </summary>
public sealed record CriteresFlux
{
    public DateTimeOffset? ModifieApres { get; init; }
    public DateTimeOffset? ModifieAvant { get; init; }
    public IReadOnlyList<string> Regles { get; init; } = [];
    public IReadOnlyList<string> Types { get; init; } = [];
    public IReadOnlyList<string> Sens { get; init; } = [];
    public string? IdentifiantSuivi { get; init; }
    public string? EtatAccuse { get; init; }

    public bool EstVide => ModifieApres is null && ModifieAvant is null && Regles.Count == 0 && Types.Count == 0 && Sens.Count == 0
        && IdentifiantSuivi is null && EtatAccuse is null;
}

/// <summary>Page de résultats (SearchFlowContent) : flux et curseur de la page suivante (absent : dernière page).</summary>
public sealed record PageFlux(IReadOnlyList<Flux> Flux, string? CurseurSuivant);

/// <summary>Fichier d'un flux téléchargé (docType Original, Converted ou ReadableView) : contenu, nom (Content-Disposition), type MIME.</summary>
public sealed record FichierFlux(byte[] Contenu, string? Nom, string? TypeMime);

/// <summary>Demande d'abonnement aux événements (WebhookParams, réservé : la relève se fait par curseur, Q11).</summary>
public sealed record DemandeAbonnement(Uri AdresseRappel)
{
    public IReadOnlyList<string> Types { get; init; } = [];
    public string? Sens { get; init; }
    public string? EtatAccuse { get; init; }
}

/// <summary>Abonnement créé (WebhookIdParam) : identifiant, clé de signature des rappels, date.</summary>
public sealed record Abonnement(string Id, string? CleSignature, DateTimeOffset? CreeLe);

/// <summary>État de la plateforme (healthcheck) : disponible ou non, code d'erreur, durée de l'appel.</summary>
public sealed record EtatSante(bool Disponible, string? Code, TimeSpan Duree);

// ---------------------------------------------------------------- annuaire (Directory Service)

/// <summary>Filtre d'une recherche dans l'annuaire : champ (siren, siret, businessName…), valeur, opérateur (<see cref="OperateurAnnuaire"/>).</summary>
public sealed record FiltreAnnuaire(string Champ, string Valeur, string Operateur = OperateurAnnuaire.Egal);

/// <summary>Recherche dans l'annuaire : filtres, nombre de résultats au plus (limit), résultats à sauter (ignore).</summary>
public sealed record RechercheAnnuaire(IReadOnlyList<FiltreAnnuaire> Filtres)
{
    public int? Limite { get; init; }
    public int? Ignorer { get; init; }
}

/// <summary>Résultats d'une recherche dans l'annuaire : nombre total et résultats de la page.</summary>
public sealed record ResultatsAnnuaire<T>(int Total, IReadOnlyList<T> Resultats);

/// <summary>Adresse d'un établissement ou d'un code de routage (addressRead).</summary>
public sealed record AdresseAnnuaire(
    string? Ligne1, string? Ligne2, string? Ligne3, string? CodePostal, string? Subdivision, string? Localite, string? CodePays, string? Pays);

/// <summary>Unité légale (SIREN) : raison sociale, type (Public, PrivateVatRegistered), état administratif (A, C).</summary>
public sealed record UniteLegale(string Siren, string? RaisonSociale, string? TypeEntite, string? EtatAdministratif);

/// <summary>Données B2G d'un établissement : gestion du statut de paiement, du numéro d'engagement, du code service.</summary>
public sealed record DonneesB2g(
    bool? MoaPublic, bool? MoaSeul, bool? GereStatutPaiement, bool? GereEngagement, bool? GereEngagementOuService, bool? GereCodeService);

/// <summary>Établissement (SIRET) : nom, type (P principal, S secondaire), état administratif, adresse, données B2G, unité légale incluse.</summary>
public sealed record Etablissement(
    string Siret, string? Siren, string? Nom, string? TypeEtablissement, string? EtatAdministratif, AdresseAnnuaire? Adresse,
    DonneesB2g? DonneesB2g, UniteLegale? UniteLegale);

/// <summary>Code de routage d'un établissement : identifiant, type, nom, gestion de l'engagement, état, adresse.</summary>
public sealed record CodeRoutage(
    string IdentifiantRoutage, string? Siret, string? TypeIdentifiant, string? Nom, bool? GereEngagement, string? EtatAdministratif,
    AdresseAnnuaire? Adresse);

/// <summary>
/// Ligne d'annuaire : identifiant d'adressage (adresse électronique de facturation), plateforme de réception
/// (<see cref="TypePlateformeAnnuaire"/>), état (<see cref="EtatLigneAnnuaire"/>), SIREN, SIRET, code de routage,
/// suffixe ; unité légale, établissement et code de routage inclus si demandés.
/// </summary>
public sealed record LigneAnnuaire(
    string IdentifiantAdressage, string? TypePlateforme, string? Etat, string? Siren, string? Siret, string? IdentifiantRoutage,
    string? Suffixe)
{
    public UniteLegale? UniteLegale { get; init; }
    public Etablissement? Etablissement { get; init; }
    public CodeRoutage? CodeRoutage { get; init; }
}
