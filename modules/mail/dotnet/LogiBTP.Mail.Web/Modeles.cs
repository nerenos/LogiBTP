namespace LogiBTP.Mail.Web;

/// <summary>Serveur SMTP ou IMAP : sécurité SSL (connexion chiffrée), STARTTLS ; mot de passe absent en OAuth 2.0.</summary>
public sealed record ServeurMail(string Hote, int Port, string Securite, string? Identifiant, string? MotDePasse);

/// <summary>Connexion d'un compte (valeur déchiffrée de mco_connexion).</summary>
public sealed record ConfigConnexion(ServeurMail? Smtp, ServeurMail? Imap);

/// <summary>Identité d'un compte (valeur déchiffrée de mco_identite).</summary>
public sealed record IdentiteCompte(string Adresse, string? NomAffiche);

/// <summary>
/// Options de réception d'un compte (choisies à sa configuration) : intervalle de relève, marquer comme lus, après un
/// rattachement (RIEN, DEPLACER vers le dossier des traités, RETIRER_DRAPEAU), drapeau « à suivre » = à rapprocher.
/// </summary>
public sealed record OptionsCompte(int IntervalleMinutes = 60, bool MarquerLus = false, string ApresRattachement = "RIEN", string? DossierTraites = "LogiBTP/Traités",
    bool DrapeauASuivre = false);

/// <summary>Dossier relevé d'un compte : RECEPTION (reconnaissance), A_TRAITER (toujours à rapprocher).</summary>
public sealed record DossierCompte(string Nom, string Role);

/// <summary>Saisie d'un compte : adresse et serveurs facultatifs en modification (absents : inchangés ; mot de passe vide : inchangé).</summary>
public sealed record SaisieCompte(string Code, string? Adresse, string? NomAffiche, bool Envoi, bool Reception, string Authentification, long? OcoId,
    ServeurMail? Smtp, ServeurMail? Imap, long? RepondreAId, string? SignatureHtml, string Hebergeur, Limites? Limites, bool CopieEnvoyes,
    List<string>? Services, bool Actif, string? AliasPrincipal, OptionsCompte? Options = null, List<DossierCompte>? Dossiers = null);

public sealed record CompteDto(long Id, string Code, string Alias, List<string> AutresAlias, bool Envoi, bool Reception, string Authentification,
    long? OcoId, string Hebergeur, Limites Limites, Limites LimitesSaisies, bool CopieEnvoyes, List<string> Services, bool Actif, string Etat,
    string? DerniereErreur, DateTimeOffset? VerifieLe, long? RepondreAId, string? SignatureHtml, ServeurPublic? Smtp, ServeurPublic? Imap,
    OptionsCompte Options, List<DossierCompte> Dossiers, DateTimeOffset? ReleveLe, string? ReleveErreur);

/// <summary>Serveur sans identifiant ni mot de passe (paramétrage) : hôte, port, sécurité, identifiant et mot de passe renseignés ou non.</summary>
public sealed record ServeurPublic(string Hote, int Port, string Securite, bool IdentifiantConfigure, bool MotDePasseConfigure);

public sealed record AliasDto(long Id, string Nom, long CompteId, bool Principal, bool Actif, bool Envoi, bool CompteActif);
public sealed record UsageDto(string Usage, string Portee, long AliasId);
public sealed record UsageConnu(string Code, string Libelle);
public sealed record ModeleDto(long Id, string Code, string Libelle, string Usage, string Type, string Objet, string CorpsHtml, bool Defaut, bool Actif);

/// <summary>Élément de l'application d'où part un envoi, décrit par la spécialisation.</summary>
public sealed record ElementMail(string Type, string Id, string Libelle, string? Url, string Usage, string? TypeModele,
    Dictionary<string, string?> Variables, List<DestinatairePropose> Destinataires, List<PieceProposee> Pieces);

public sealed record DestinatairePropose(string Adresse, string? Nom, string? Role, bool ParDefaut, long? PerId = null, long? IndId = null);
public sealed record PieceProposee(string Reference, string Nom, long Taille, bool Cochee);
public sealed record PieceInfo(string Reference, string Nom, string? Type, long Taille);
public sealed record PieceContenu(string Nom, string Type, byte[] Octets);

/// <summary>Courriel prêt à rédiger : expéditeurs possibles, valeurs proposées.</summary>
public sealed record Brouillon(List<AliasDto> Expediteurs, long? AliasId, ElementMail? Element, List<DestinatairePropose> Destinataires,
    string Objet, string CorpsHtml, List<PieceProposee> Pieces, long TailleMax, int SeuilEnvoiGroupe);

public sealed record DestinataireSaisi(string Adresse, string? Nom = null, long? PerId = null, long? IndId = null);

public sealed record DemandeEnvoi(long AliasId, List<DestinataireSaisi> A, List<DestinataireSaisi>? Cc, List<DestinataireSaisi>? Cci, string Objet,
    string CorpsHtml, List<string>? Pieces, string? TypeElement, string? IdElement, string? Usage, bool CopieMoi = false, bool ConfirmationMassive = false,
    string? InReplyTo = null, string Priorite = "NORMALE");

/// <summary>Envoi produit par l'application (usage → expéditeur ; lot : envoi en nombre, priorité basse).</summary>
public sealed record EnvoiAutomatique(string Usage, List<DestinataireSaisi> A, string Objet, string CorpsHtml, string Auteur, string Priorite = "NORMALE",
    string? TypeElement = null, string? IdElement = null, List<string>? Pieces = null, string? TypeModele = null, List<DestinataireSaisi>? Cc = null,
    List<DestinataireSaisi>? Cci = null, long? Lot = null);

public sealed record ResultatEnvoi(List<long> Messages, string Etat, int Position, DateTimeOffset Depart, DateTimeOffset Fin, string? Cause, bool EnAttente, long? Lot);

public sealed record DemandeEstimation(long AliasId, int Messages, int DestinatairesParMessage, string Priorite = "NORMALE");

public sealed record EstimationDto(bool Immediat, DateTimeOffset Depart, DateTimeOffset Fin, string? Cause, int Position, int TauxQuota,
    bool ConfirmationRequise, string? Avertissement);

public sealed record MessageDto(long Id, string Sens, string Etat, string Priorite, string? Expediteur, string Objet, List<string> A, int NbDestinataires,
    int NbPieces, string? TypeElement, string? IdElement, long? Lot, DateTimeOffset CreeLe, string CreePar, DateTimeOffset? EnvoyeLe,
    DateTimeOffset? ProchainEssai, string? Attente, string? Erreur, int Tentatives, long? DgeId, string? Nature = null);

public sealed record DestinataireDto(string Role, string Adresse, string? Nom, string? NonRemis);
public sealed record PieceDto(string Reference, string Nom, string? Type, long Taille);
public sealed record LigneJournalDto(long Id, long? Message, long? Lot, long Compte, string? Alias, string Utilisateur, string? Origine, int Destinataires,
    int Nouveaux, List<string> Domaines, string Resultat, string? Code, string? Reponse, int? DureeMs, DateTimeOffset Le);
public sealed record DetailMessageDto(MessageDto Message, string? CorpsHtml, List<DestinataireDto> Destinataires, List<PieceDto> Pieces, List<LigneJournalDto> Journal,
    List<LienDto> Liens, string? De, bool Auto, long Compte, List<PropositionDto> Propositions);

public sealed record PropositionDto(string Type, string Id, string? Libelle, string? Url, int Score, List<string> Indices);

public sealed record RegleDto(long Id, string Code, string Libelle, string Nature, List<string> Mots, List<string> Dans, string? Expediteur, string? Service,
    long? Compte, string Action, int Ordre, bool Actif);

/// <summary>Courriel reçu à reconnaître, remis à l'application pour trouver les candidats (documents cités, tiers de l'expéditeur).</summary>
public sealed record AnalyseCourriel(long Id, string Objet, string Texte, IReadOnlyList<string> Pieces, string TextePieces, string? De);

/// <summary>Candidats trouvés par l'application : éléments cités, tiers de l'expéditeur (identifiants), tiers proposés.</summary>
public sealed record CandidatsReconnaissance(List<Candidat> Candidats, List<long> ExpediteurTiers, List<ElementCible> Tiers);

public sealed record CompteurCompte(long Compte, string Alias, string Etat, Limites Limites, int DestinatairesHeure, int DestinatairesJour, int TauxQuota,
    int EnFile, int Suspendus, int ErreursJour, DateTimeOffset? ProchainDepart);

public sealed record LotDto(long Id, string Origine, string? Libelle, string Auteur, int Messages, int Destinataires, int Envoyes, int Erreurs,
    DateTimeOffset? FinEstimee, string? Avertissement, DateTimeOffset CreeLe);

/// <summary>Courriel envoyé, remis à l'application (GED, statut du document, note du suivi).</summary>
public sealed record CourrielEnvoye(long Id, string? TypeElement, string? IdElement, string? Usage, string Objet, string Expediteur,
    IReadOnlyList<string> A, IReadOnlyList<string> Cc, IReadOnlyList<string> Cci, string CorpsHtml, DateTimeOffset Le, byte[] Eml,
    IReadOnlyList<string> Pieces, string Auteur, string MessageId);

/// <summary>Courriel reçu remis à l'application pour être rangé (GED de la boîte) : contenu, texte, pièces.</summary>
public sealed record CourrielRecu(long Id, long Compte, string Objet, AdresseLue? De, DateTimeOffset? Date, byte[] Eml, string Texte, IReadOnlyList<PieceLue> Pieces,
    IReadOnlyList<string> A, IReadOnlyList<string> Cc);

/// <summary>Courriel rangé : document de la GED et pièces jointes (références « ged:&lt;id&gt; »).</summary>
public sealed record DepotRecu(long? DgeId, List<PieceInfo> Pieces, string TextePieces = "");

/// <summary>Élément de l'application désigné pour un rattachement (type, identifiant, libellé, page).</summary>
public sealed record ElementTrouve(string Type, string Id, string Libelle, string? Url);

/// <summary>Type d'élément proposé au rattachement manuel (saisie d'un code ou d'un numéro).</summary>
public sealed record TypeRattachement(string Type, string Libelle, string Aide);

/// <summary>Courriel reçu rattaché à un élément : l'application le range avec l'élément et le suit.</summary>
public sealed record MessageRattache(long Id, long Compte, long? DgeId, string Objet, string? De, DateTimeOffset? Date, string CorpsHtml, IReadOnlyList<string> Pieces,
    string Origine, string Utilisateur);

public sealed record LienDto(string Type, string Id, string? Libelle, string? Url, string Origine, int? Score, string Par, DateTimeOffset Le);

public sealed record DemandeRattachement(string Type, string? Id, string? Code);
public sealed record DemandeIgnorer(string? Motif);
public sealed record DemandeAdresse(string Adresse);

/// <summary>Signal à publier (notification) : erreur d'envoi, blocage, quota, volume inhabituel, départ d'un courriel en attente.</summary>
public sealed record SignalMail(string Genre, string Titre, string? Texte, string Niveau, string? Url, string Cle, string? TypeElement = null, string? IdElement = null);

/// <summary>Paramètres fournis par l'application à la reconnaissance des accusés de réception (préfixes de numérotation des commandes, année de référence, motifs).</summary>
public sealed record ParametresAccuse(IReadOnlyList<string> Prefixes, int? AnneeReference, IReadOnlyList<string> Motifs);

/// <summary>Accusé de réception reconnu dans un courriel reçu : message, compte, objet et résultat de la reconnaissance (numéro, livraison annoncée).</summary>
public sealed record AccuseRecu(long Id, long Compte, string Objet, ResultatAccuse Accuse);
