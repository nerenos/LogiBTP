namespace LogiBTP.Socle;

/// <summary>
/// Variables d'environnement de l'installation (fichier .env, lu par AjouterFichierEnv). Les scripts d'installation
/// (modules/installation/windows, linux) et le modèle .env.exemple les nomment aussi.
/// </summary>
public static class VariablesEnv
{
    public const string AdressesConfiance = "LOGIBTP_ADRESSES_CONFIANCE";
    public const string BaseAdressesApi = "LOGIBTP_BASE_ADRESSES_API";
    public const string BaseHote = "LOGIBTP_BASE_HOTE";
    public const string BaseMemoireMo = "LOGIBTP_BASE_MEMOIRE_MO";
    public const string BaseMotDePasseAdmin = "LOGIBTP_BASE_MOT_DE_PASSE_ADMIN";
    public const string BaseMotDePasseApp = "LOGIBTP_BASE_MOT_DE_PASSE_APP";
    public const string BaseMotDePasseLecture = "LOGIBTP_BASE_MOT_DE_PASSE_LECTURE";
    public const string BaseMotDePasseSchema = "LOGIBTP_BASE_MOT_DE_PASSE_SCHEMA";
    public const string BasePort = "LOGIBTP_BASE_PORT";
    public const string BasePrefixe = "LOGIBTP_BASE_PREFIXE";
    public const string BaseRacine = "LOGIBTP_BASE_RACINE";
    public const string BaseReseau = "LOGIBTP_BASE_RESEAU";
    public const string BaseSsl = "LOGIBTP_BASE_SSL";
    public const string BaseSslServeur = "LOGIBTP_BASE_SSL_SERVEUR";
    public const string BaseUtilisateur = "LOGIBTP_BASE_UTILISATEUR";
    public const string Certificats = "LOGIBTP_CERTIFICATS";
    public const string CertificatMotDePasse = "LOGIBTP_CERTIFICAT_MOT_DE_PASSE";
    public const string CleChiffrement = "LOGIBTP_CLE_CHIFFREMENT";
    public const string CleChiffrementPrecedentes = "LOGIBTP_CLE_CHIFFREMENT_PRECEDENTES";
    public const string Config = "LOGIBTP_CONFIG";
    public const string ConfigBase = "LOGIBTP_CONFIG_BASE";
    public const string CorsOrigines = "LOGIBTP_CORS_ORIGINES";
    public const string Deploiement = "LOGIBTP_DEPLOIEMENT";
    public const string Domaine = "LOGIBTP_DOMAINE";
    public const string JournalNiveau = "LOGIBTP_JOURNAL_NIVEAU";
    public const string PortHttpsPublic = "LOGIBTP_PORT_HTTPS_PUBLIC";
    public const string Proxys = "LOGIBTP_PROXYS";
    public const string Sauvegardes = "LOGIBTP_SAUVEGARDES";
    public const string Sql = "LOGIBTP_SQL";
}
