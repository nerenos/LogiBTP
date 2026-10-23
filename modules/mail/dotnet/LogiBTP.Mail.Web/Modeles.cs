namespace LogiBTP.Mail.Web;

/// <summary>Serveur SMTP ou IMAP : sécurité SSL (connexion chiffrée), STARTTLS ; mot de passe absent en OAuth 2.0.</summary>
public sealed record ServeurMail(string Hote, int Port, string Securite, string? Identifiant, string? MotDePasse);

/// <summary>Connexion d'un compte (valeur déchiffrée de mco_connexion).</summary>
public sealed record ConfigConnexion(ServeurMail? Smtp, ServeurMail? Imap);

/// <summary>Identité d'un compte (valeur déchiffrée de mco_identite).</summary>
public sealed record IdentiteCompte(string Adresse, string? NomAffiche);

/// <summary>Saisie d'un compte : adresse et serveurs facultatifs en modification (absents : inchangés ; mot de passe vide : inchangé).</summary>
public sealed record SaisieCompte(string Code, string? Adresse, string? NomAffiche, bool Envoi, bool Reception, string Authentification, long? OcoId,
    ServeurMail? Smtp, ServeurMail? Imap, long? RepondreAId, string? SignatureHtml, string Hebergeur, Limites? Limites, bool CopieEnvoyes,
    List<string>? Services, bool Actif, string? AliasPrincipal);

public sealed record CompteDto(long Id, string Code, string Alias, List<string> AutresAlias, bool Envoi, bool Reception, string Authentification,
    long? OcoId, string Hebergeur, Limites Limites, Limites LimitesSaisies, bool CopieEnvoyes, List<string> Services, bool Actif, string Etat,
    string? DerniereErreur, DateTimeOffset? VerifieLe, long? RepondreAId, string? SignatureHtml, ServeurPublic? Smtp, ServeurPublic? Imap);

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

public sealed record ResultatEnvoi(List<long> Messages, string Etat, int Position, DateTimeOffset Depart, DateTimeOffset Fin, string? Cause, bool EnAttente, long? Lot);

public sealed record DemandeEstimation(long AliasId, int Messages, int DestinatairesParMessage, string Priorite = "NORMALE");

public sealed record EstimationDto(bool Immediat, DateTimeOffset Depart, DateTimeOffset Fin, string? Cause, int Position, int TauxQuota,
    bool ConfirmationRequise, string? Avertissement);

public sealed record MessageDto(long Id, string Sens, string Etat, string Priorite, string? Expediteur, string Objet, List<string> A, int NbDestinataires,
    int NbPieces, string? TypeElement, string? IdElement, long? Lot, DateTimeOffset CreeLe, string CreePar, DateTimeOffset? EnvoyeLe,
    DateTimeOffset? ProchainEssai, string? Attente, string? Erreur, int Tentatives, long? DgeId);

public sealed record DestinataireDto(string Role, string Adresse, string? Nom, string? NonRemis);
public sealed record PieceDto(string Reference, string Nom, string? Type, long Taille);
public sealed record LigneJournalDto(long Id, long? Message, long? Lot, long Compte, string? Alias, string Utilisateur, string? Origine, int Destinataires,
    int Nouveaux, List<string> Domaines, string Resultat, string? Code, string? Reponse, int? DureeMs, DateTimeOffset Le);
public sealed record DetailMessageDto(MessageDto Message, string? CorpsHtml, List<DestinataireDto> Destinataires, List<PieceDto> Pieces, List<LigneJournalDto> Journal);

public sealed record CompteurCompte(long Compte, string Alias, string Etat, Limites Limites, int DestinatairesHeure, int DestinatairesJour, int TauxQuota,
    int EnFile, int Suspendus, int ErreursJour, DateTimeOffset? ProchainDepart);

public sealed record LotDto(long Id, string Origine, string? Libelle, string Auteur, int Messages, int Destinataires, int Envoyes, int Erreurs,
    DateTimeOffset? FinEstimee, string? Avertissement, DateTimeOffset CreeLe);

/// <summary>Courriel envoyé, remis à l'application (GED, statut du document, note du suivi).</summary>
public sealed record CourrielEnvoye(long Id, string? TypeElement, string? IdElement, string? Usage, string Objet, string Expediteur,
    IReadOnlyList<string> A, IReadOnlyList<string> Cc, IReadOnlyList<string> Cci, string CorpsHtml, DateTimeOffset Le, byte[] Eml,
    IReadOnlyList<string> Pieces, string Auteur, string MessageId);

/// <summary>Signal à publier (notification) : erreur d'envoi, blocage, quota, volume inhabituel, départ d'un courriel en attente.</summary>
public sealed record SignalMail(string Genre, string Titre, string? Texte, string Niveau, string? Url, string Cle, string? TypeElement = null, string? IdElement = null);
