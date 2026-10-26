using System.Security.Cryptography.X509Certificates;
using LogiBTP.Installation;
using LogiBTP.Socle;
using LogiBTP.Socle.Web;

namespace LogiBTP.Api.Btp;

/// <summary>
/// Commandes de l'installeur (ANALYSE-MODULE-INSTALLATION.md § 6), lancées dans l'image de l'API
/// (« docker compose run --rm logibtp-installation installation … ») ou depuis le dépôt :
///   preparer --domaine D [--deploiement LOCAL|INTERNET] [--confiance CIDR,…] [--reseau CIDR] [--memoire Mo]
///            [--libelle L] [--base-hote H] : .env complété (secrets générés, un .env fourni est conservé), societes.json,
///            pg_hba.conf et postgresql.conf du conteneur de la base ;
///   base creer : rôles, base principale, scripts du manifeste sous logibtp_schema, script des rôles ;
///   societe ajouter CODE [--libelle L] : base de la société et déclaration dans societes.json ;
///   societes : sociétés déclarées ; scripts verifier : manifeste ↔ dépôt ; conversions : conversions de données
///   (métrés) sous le rôle de schéma ; etat : bases et scripts appliqués ;
///   certificat creer [--organisation O] [--jours N] [--nouvelle-racine] : autorité LogiBTP (créée une fois, clé chiffrée
///   par la clé des données) et certificat du domaine et de son joker ; certificat renouveler [--avant N] : nouveau
///   certificat N jours (60) avant l'échéance ; certificat importer --certificat F [--cle K] [--origine IMPORTE|LETSENCRYPT] :
///   certificat fourni (PKCS#12 : mot de passe dans LOGIBTP_CERTIFICAT_MOT_DE_PASSE) ; certificat etat ;
///   certificat base --nom N --adresses-api A : base sur une autre machine (TLS) ; base droits : roles.sql sur toutes les bases ;
///   sauvegarde chiffrer|dechiffrer DOSSIER : fichiers d'un jeu de sauvegarde chiffrés par la clé des données ;
///   base mettre-a-jour : scripts du manifeste non appliqués, droits, conversions, sur toutes les bases ; base adopter :
///   base existante inscrite au journal ; cle-donnees changer | rechiffrer : rotation de la clé des données.
/// Aucun secret n'est jamais affiché.
/// </summary>
public static class CommandeInstallation
{
    public const string FichierSocietes = "societes.json";
    private const string RoleSchema = "logibtp_schema";

    private static readonly string Usage = """
        Usage : installation preparer --domaine D [--deploiement LOCAL|INTERNET] [--confiance CIDR,…] [--reseau CIDR] [--memoire Mo] [--libelle L] [--base-hote H]
                installation base creer
                installation societe ajouter CODE [--libelle L]
                installation societes | scripts verifier | conversions | etat
                installation certificat creer [--organisation O] [--jours N] [--nouvelle-racine] | renouveler [--avant N]
                installation certificat importer --certificat F [--cle K] [--origine IMPORTE|LETSENCRYPT] | etat
                installation certificat base --nom N --adresses-api A [--certificat F --cle K] | installation base droits
                installation sauvegarde chiffrer|dechiffrer DOSSIER
                installation base mettre-a-jour | base adopter (--base NOM | --toutes) --confirmer | cle-donnees changer | rechiffrer
        """;

    public static async Task<int> ExecuterAsync(string[] args, string dossier, TextWriter sortie)
    {
        Console.OutputEncoding = System.Text.Encoding.UTF8;
        try
        {
            return (args.ElementAtOrDefault(0), args.ElementAtOrDefault(1)) switch
            {
                ("preparer", _) => Preparer(args, dossier, sortie),
                ("base", "creer") => await CreerBaseAsync(null, null, dossier, sortie),
                ("societe", "ajouter") when args.Length > 2 && !args[2].StartsWith("--") =>
                    await CreerBaseAsync(SocietesInstallation.VerifierCode(args[2]), Option(args, "--libelle"), dossier, sortie),
                ("societes", _) => ListerSocietes(dossier, sortie),
                ("scripts", "verifier") => VerifierScripts(sortie),
                ("conversions", _) => await ConvertirAsync(dossier, sortie),
                ("etat", _) => await EtatAsync(dossier, sortie),
                ("certificat", "creer") => CreerCertificat(args, dossier, sortie),
                ("certificat", "renouveler") => RenouvelerCertificat(args, dossier, sortie),
                ("certificat", "importer") => ImporterCertificat(args, dossier, sortie),
                ("certificat", "etat") => EtatCertificat(sortie),
                ("certificat", "base") => CertificatBase(args, dossier, sortie),
                ("base", "droits") => await DroitsBasesAsync(dossier, sortie),
                ("base", "mettre-a-jour") => await MettreAJourAsync(dossier, sortie),
                ("base", "adopter") => await AdopterAsync(args, dossier, sortie),
                ("cle-donnees", "changer") => await ChangerCleAsync(dossier, sortie),
                ("cle-donnees", "rechiffrer") => await RechiffrerAsync(dossier, sortie),
                ("sauvegarde", "chiffrer" or "dechiffrer") when args.Length > 2 => ChiffrerSauvegarde(args[1] == "chiffrer", args[2], dossier, sortie),
                _ => Erreur(sortie, Usage),
            };
        }
        catch (Exception e) when (e is ArgumentException or InvalidOperationException or FormatException or IOException or Npgsql.NpgsqlException)
        {
            return Erreur(sortie, Masquage.Texte(e.Message) ?? e.GetType().Name);
        }
    }

    // ---------------------------------------------------------------- préparation

    private static int Preparer(string[] args, string dossier, TextWriter sortie)
    {
        var domaine = Option(args, "--domaine") ?? throw new ArgumentException("--domaine obligatoire (ex. logibtp.entreprise.fr)");
        domaine = VerifierDomaine(domaine);
        Directory.CreateDirectory(dossier);
        var env = Path.Combine(dossier, ".env");
        if (!File.Exists(env))
        {
            var deploiement = (Option(args, "--deploiement") ?? "LOCAL").ToUpperInvariant();
            if (deploiement is not ("LOCAL" or "INTERNET")) throw new ArgumentException("--deploiement : LOCAL ou INTERNET");
            CommandeEnv.Executer(["initialiser", deploiement], dossier, TextWriter.Null);
            sortie.WriteLine($".env créé : {env} (déploiement {deploiement})");
        }
        else sortie.WriteLine($".env existant conservé : {env} (variables manquantes ajoutées)");
        var reseau = Option(args, "--reseau");
        var memoire = Option(args, "--memoire");
        var ajoutees = CompleterEnv(env,
        [
            ("LOGIBTP_DOMAINE", domaine, "Nom de l'installation : base principale sur ce nom, chaque société sur un sous-domaine (certificat joker)."),
            ("LOGIBTP_BASE_HOTE", Option(args, "--base-hote") ?? "logibtp-base", "Serveur PostgreSQL : bases logibtp (principale) et logibtp_<code> (sociétés)."),
            ("LOGIBTP_BASE_PORT", "5432", null),
            ("LOGIBTP_BASE_RESEAU", reseau ?? "172.30.70.0/24", "Réseau Docker « logibtp » (pg_hba.conf), mémoire de PostgreSQL (Mo)."),
            ("LOGIBTP_BASE_MEMOIRE_MO", memoire ?? "2048", null),
            ("LOGIBTP_BASE_MOT_DE_PASSE_ADMIN", Secrets.MotDePasse(), "Mots de passe des rôles PostgreSQL (générés) : superutilisateur, schéma, application, lecture."),
            ("LOGIBTP_BASE_MOT_DE_PASSE_SCHEMA", Secrets.MotDePasse(), null),
            ("LOGIBTP_BASE_MOT_DE_PASSE_APP", Secrets.MotDePasse(), null),
            ("LOGIBTP_BASE_MOT_DE_PASSE_LECTURE", Secrets.MotDePasse(), null),
        ]);
        // Réglages explicites : remplacent ceux du .env (relance de « preparer » pour changer le réseau ou la mémoire).
        var remplaces = new Dictionary<string, string>();
        if (reseau is not null) remplaces["LOGIBTP_BASE_RESEAU"] = reseau;
        if (memoire is not null) remplaces["LOGIBTP_BASE_MEMOIRE_MO"] = memoire;
        if (Option(args, "--confiance") is { } confiance) remplaces["LOGIBTP_ADRESSES_CONFIANCE"] = confiance;
        RemplacerEnv(env, remplaces);
        sortie.WriteLine($"{ajoutees} variable(s) ajoutée(s), {remplaces.Count} réglage(s) mis à jour ; valeurs sensibles chiffrées");

        var societes = Path.Combine(dossier, FichierSocietes);
        SocietesInstallation.Ecrire(societes, SocietesInstallation.Preparer(SocietesInstallation.Lire(societes), domaine, Option(args, "--libelle")));
        sortie.WriteLine($"{FichierSocietes} : domaine {domaine}");

        var dossierBase = DossierBase();
        Directory.CreateDirectory(dossierBase);
        // TLS de la base toujours actif (A35) : certificat de la base émis avant d'écrire une configuration « ssl = on ».
        CertificatBaseLocal(Configuration(dossier), env, domaine, sortie);
        var config = Configuration(dossier);
        var reglages = Reglages(config);
        File.WriteAllText(Path.Combine(dossierBase, "pg_hba.conf"), ConfigurationPostgres.PgHba(reglages));
        File.WriteAllText(Path.Combine(dossierBase, "postgresql.conf"), ConfigurationPostgres.PostgresqlConf(reglages));
        // Mot de passe du superutilisateur pour la première initialisation du conteneur de la base (POSTGRES_PASSWORD_FILE),
        // vidé par « base creer » : ensuite inutile (le conteneur ne le relit qu'à la création de ses données).
        var mdp = Path.Combine(dossierBase, "postgres-mdp");
        if (!File.Exists(Path.Combine(dossierBase, "base-initialisee")))
        {
            File.WriteAllText(mdp, config["LOGIBTP_BASE_MOT_DE_PASSE_ADMIN"]);
            if (!OperatingSystem.IsWindows()) File.SetUnixFileMode(mdp, UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.GroupRead | UnixFileMode.OtherRead);
        }
        else if (!File.Exists(mdp)) File.WriteAllText(mdp, "");
        sortie.WriteLine($"Configuration de PostgreSQL écrite dans {dossierBase} (réseau {reglages.Reseau}, {reglages.MemoireMo} Mo)");
        return 0;
    }

    // ---------------------------------------------------------------- bases

    private static async Task<int> CreerBaseAsync(string? societe, string? libelle, string dossier, TextWriter sortie)
    {
        var config = Configuration(dossier);
        var modele = Modele(config);
        var admin = modele.Chaine("postgres", "postgres", Exiger(config, "LOGIBTP_BASE_MOT_DE_PASSE_ADMIN"));
        var base_ = modele.NomBase(societe);
        var bd = new BaseDonnees(sortie);
        await bd.DefinirRolesAsync(admin, new Dictionary<string, string?>
        {
            [RoleSchema] = Exiger(config, "LOGIBTP_BASE_MOT_DE_PASSE_SCHEMA"),
            ["logibtp_app"] = Exiger(config, "LOGIBTP_BASE_MOT_DE_PASSE_APP"),
            ["logibtp_lecture"] = Exiger(config, "LOGIBTP_BASE_MOT_DE_PASSE_LECTURE"),
        });
        var neuve = await bd.CreerBaseAsync(admin, base_, RoleSchema);
        var racine = RacineSql();
        var manifeste = ManifesteScripts.Lire(racine);
        var applique = await BaseDonnees.ScriptsAppliquesAsync(modele.Chaine(base_, RoleSchema, config["LOGIBTP_BASE_MOT_DE_PASSE_SCHEMA"]));
        if (!neuve && applique.Count == 0) throw new InvalidOperationException($"La base {base_} existe sans journal des scripts : elle n'a pas été créée par l'installeur");
        // Base neuve, ou reprise d'une création interrompue : scripts absents du journal, dans l'ordre.
        await bd.AppliquerAsync(modele.Chaine(base_, RoleSchema, config["LOGIBTP_BASE_MOT_DE_PASSE_SCHEMA"]), racine, manifeste.Scripts);
        await bd.ExecuterFichierAsync(modele.Chaine(base_, "postgres", config["LOGIBTP_BASE_MOT_DE_PASSE_ADMIN"]), Path.Combine(racine, "db/installation/roles.sql"));
        if (societe is not null)
        {
            var chemin = Path.Combine(dossier, FichierSocietes);
            SocietesInstallation.Ecrire(chemin, SocietesInstallation.Ajouter(SocietesInstallation.Lire(chemin), societe, libelle));
            sortie.WriteLine($"Société {societe} déclarée dans {FichierSocietes} : redémarrer l'API pour l'ouvrir");
        }
        // Le conteneur de la base est initialisé : le mot de passe de première initialisation n'a plus d'usage.
        var dossierBase = DossierBase();
        if (Directory.Exists(dossierBase))
        {
            File.WriteAllText(Path.Combine(dossierBase, "postgres-mdp"), "");
            File.WriteAllText(Path.Combine(dossierBase, "base-initialisee"), DateTimeOffset.Now.ToString("O"));
        }
        sortie.WriteLine($"Base {base_} prête");
        return 0;
    }

    private static int ListerSocietes(string dossier, TextWriter sortie)
    {
        var config = Configuration(dossier);
        var modele = ModeleConnexion.Lire(k => config[k]);
        sortie.WriteLine($"(principale) {config["Societes:LibellePrincipale"] ?? "Société principale"} : {config["LOGIBTP_DOMAINE"]} → {modele?.NomBase(null)}");
        foreach (var (code, libelle) in SocietesInstallation.Societes(SocietesInstallation.Lire(Path.Combine(dossier, FichierSocietes))))
            sortie.WriteLine($"{code} {libelle} : {code}.{config["LOGIBTP_DOMAINE"]} → {modele?.NomBase(code)}");
        return 0;
    }

    private static int VerifierScripts(TextWriter sortie)
    {
        var racine = RacineSql();
        var manifeste = ManifesteScripts.Lire(racine);
        var ecarts = manifeste.Ecarts(racine);
        foreach (var e in ecarts) sortie.WriteLine(e);
        sortie.WriteLine($"{manifeste.Scripts.Count} script(s) au manifeste, {ecarts.Count} écart(s)");
        return ecarts.Count == 0 ? 0 : 1;
    }

    /// <summary>Bases de l'installation : principale puis sociétés déclarées (code, nom de base).</summary>
    private static List<(string? Code, string Base)> Bases(string dossier, ModeleConnexion modele) =>
        [(null, modele.NomBase(null)), .. SocietesInstallation.Societes(SocietesInstallation.Lire(Path.Combine(dossier, FichierSocietes))).Select(s => ((string?)s.Code, modele.NomBase(s.Code)))];

    private static async Task<int> ConvertirAsync(string dossier, TextWriter sortie)
    {
        var config = Configuration(dossier);
        var modele = Modele(config);
        foreach (var (_, base_) in Bases(dossier, modele))
        {
            var (metres, elements) = await ConversionMetresBases.ConvertirBaseAsync(modele.Chaine(base_, RoleSchema, Exiger(config, "LOGIBTP_BASE_MOT_DE_PASSE_SCHEMA")));
            sortie.WriteLine(metres < 0 ? $"{base_} : rien à convertir" : $"{base_} : {metres} métré(s), {elements} composition(s) convertis");
        }
        return 0;
    }

    private static async Task<int> EtatAsync(string dossier, TextWriter sortie)
    {
        var config = Configuration(dossier);
        var modele = Modele(config);
        var manifeste = ManifesteScripts.Lire(RacineSql());
        sortie.WriteLine($"Installation {config["LOGIBTP_DOMAINE"]} ({config["LOGIBTP_DEPLOIEMENT"] ?? "LOCAL"}), serveur {modele.Hote}:{modele.Port}");
        foreach (var (code, base_) in Bases(dossier, modele))
        {
            try
            {
                var s = await BaseDonnees.ScriptsAppliquesAsync(modele.Chaine(base_, RoleSchema, config["LOGIBTP_BASE_MOT_DE_PASSE_SCHEMA"]));
                var attendus = manifeste.Scripts.Where(x => !x.Rejouable).Select(x => x.Chemin).Except(s.Select(x => x.Chemin)).Count();
                sortie.WriteLine($"{code ?? "(principale)"} → {base_} : {s.Count} script(s) appliqué(s)" + (attendus > 0 ? $", {attendus} en attente (mise à jour)" : ", à jour"));
            }
            catch (Npgsql.NpgsqlException e)
            {
                sortie.WriteLine($"{code ?? "(principale)"} → {base_} : injoignable ({Masquage.Texte(e.Message)})");
            }
        }
        return 0;
    }

    // ---------------------------------------------------------------- certificats (§ 5)

    private static DossierCertificats Certificats() =>
        new(Environment.GetEnvironmentVariable("LOGIBTP_CERTIFICATS") ?? Path.Combine(Directory.GetCurrentDirectory(), "certificats"));

    private static int CreerCertificat(string[] args, string dossier, TextWriter sortie)
    {
        var config = Configuration(dossier);
        var domaine = Exiger(config, "LOGIBTP_DOMAINE");
        var cleDonnees = Exiger(config, ExtensionsConfiguration.CleChiffrement);
        var jours = int.TryParse(Option(args, "--jours"), out var j) ? j : AutoriteCertificats.JoursServeurMax;
        var d = Certificats();
        Directory.CreateDirectory(d.Dossier);
        var maintenant = DateTimeOffset.Now;
        var (racine, cleRacine) = Racine(d, domaine, cleDonnees, args.Contains("--nouvelle-racine"), Option(args, "--organisation"), maintenant, sortie);
        var serveur = AutoriteCertificats.Emettre(racine, cleRacine, AutoriteCertificats.NomsInstallation(domaine), maintenant, jours);
        d.Ecrire(OrigineCertificat.LogiBtp, domaine, serveur.CertificatPem, serveur.ClePem, racine, maintenant);
        sortie.WriteLine($"Certificat de {domaine} et *.{domaine} valable jusqu'au {serveur.Certificat.NotAfter:dd/MM/yyyy}");
        sortie.WriteLine($"Empreinte SHA-256 de l'autorité (à comparer sur les postes) : {AutoriteCertificats.Empreinte(racine)}");
        return 0;
    }

    /// <summary>Autorité de l'installation : relue (clé déchiffrée par la clé des données) ou créée.</summary>
    private static (X509Certificate2 Racine, string Cle) Racine(DossierCertificats d, string domaine, string cleDonnees, bool nouvelle,
        string? organisation, DateTimeOffset maintenant, TextWriter sortie)
    {
        if (!nouvelle && d.LireRacine() is { } existante && File.Exists(d.CleRacine))
        {
            if (!AutoriteCertificats.NomsPermis(existante).Contains(domaine, StringComparer.OrdinalIgnoreCase))
                throw new InvalidOperationException($"L'autorité existante ne couvre pas {domaine} : --nouvelle-racine (à redéployer sur les postes)");
            return (existante, AutoriteCertificats.DechiffrerCle(File.ReadAllText(d.CleRacine), cleDonnees));
        }
        var r = AutoriteCertificats.CreerRacine(domaine, [domaine], maintenant, organisation);
        DossierCertificats.EcrireSecret(d.CleRacine, AutoriteCertificats.ChiffrerCle(r.ClePem, cleDonnees));
        File.WriteAllText(d.Racine, r.CertificatPem + "\n");
        sortie.WriteLine($"Autorité LogiBTP créée (valable jusqu'au {r.Certificat.NotAfter:dd/MM/yyyy}, limitée à {domaine} et ses sous-domaines) : à installer sur les postes");
        return (r.Certificat, r.ClePem);
    }

    private static int RenouvelerCertificat(string[] args, string dossier, TextWriter sortie)
    {
        var d = Certificats();
        var infos = d.Infos() ?? throw new InvalidOperationException("Aucun certificat installé : « installation certificat creer »");
        var avant = int.TryParse(Option(args, "--avant"), out var a) ? a : 60;
        var reste = (infos.Fin - DateTimeOffset.Now).TotalDays;
        if (reste > avant)
        {
            sortie.WriteLine($"Certificat valable encore {Math.Floor(reste)} jour(s) : rien à faire (renouvellement à {avant} jours)");
            return 0;
        }
        if (infos.Origine == OrigineCertificat.LetsEncrypt)
            throw new InvalidOperationException("Certificat Let's Encrypt : renouvelé par Certificat-LetsEncrypt.ps1 -Renouveler (tâche planifiée)");
        if (infos.Origine != OrigineCertificat.LogiBtp)
            throw new InvalidOperationException($"Certificat {infos.Origine} à renouveler auprès de son émetteur ({infos.Emetteur}), puis « installation certificat importer »");
        return CreerCertificat([], dossier, sortie);
    }

    private static int ImporterCertificat(string[] args, string dossier, TextWriter sortie)
    {
        var config = Configuration(dossier);
        var domaine = Exiger(config, "LOGIBTP_DOMAINE");
        var fichier = Option(args, "--certificat") ?? throw new ArgumentException("--certificat obligatoire (.pfx, .p12 ou .pem)");
        var origine = (Option(args, "--origine") ?? OrigineCertificat.Importe).ToUpperInvariant();
        if (origine is not (OrigineCertificat.Importe or OrigineCertificat.LetsEncrypt)) throw new ArgumentException("--origine : IMPORTE ou LETSENCRYPT");
        var (chaine, cle, racine) = DossierCertificats.LireFourni(fichier, Option(args, "--cle"), Environment.GetEnvironmentVariable("LOGIBTP_CERTIFICAT_MOT_DE_PASSE"));
        using var cert = X509Certificate2.CreateFromPem(chaine, cle);
        foreach (var (nom, essai) in new[] { (domaine, domaine), ("*." + domaine, "societe." + domaine) })
            if (!AutoriteCertificats.Couvre(cert, essai)) throw new InvalidOperationException($"Le certificat ne couvre pas {nom} : il faut le nom {domaine} et le joker *.{domaine}");
        if (cert.NotAfter < DateTime.Now) throw new InvalidOperationException($"Certificat expiré le {cert.NotAfter:dd/MM/yyyy}");
        Certificats().Ecrire(origine, domaine, chaine, cle, racine, DateTimeOffset.Now);
        sortie.WriteLine($"Certificat importé ({origine}, émis par {cert.Issuer}) valable jusqu'au {cert.NotAfter:dd/MM/yyyy}"
            + (racine is null ? "" : " ; autorité jointe proposée sur la page /certificat"));
        return 0;
    }

    /// <summary>
    /// Certificat de la base sur le même hôte que l'API (lot 11 des demandes du 25/10/2026, A35) : émis par l'autorité
    /// LogiBTP (créée au besoin) pour le nom de la base dans le domaine (LOGIBTP_BASE_HOTE s'il en fait partie, sinon
    /// base.&lt;domaine&gt;), renouvelé à 60 jours de son échéance ; l'API vérifie la chaîne par la racine (VerifyCA : l'hôte
    /// Docker « logibtp-base » n'est pas un nom du domaine) sauf réglage déjà posé (VerifyFull d'une base distante).
    /// </summary>
    private static void CertificatBaseLocal(IConfiguration config, string env, string domaine, TextWriter sortie)
    {
        var dossierBase = DossierBase();
        var crt = Path.Combine(dossierBase, "base.crt");
        if (config["LOGIBTP_BASE_SSL_SERVEUR"] is "1" or "true" or "on" && File.Exists(crt) && File.Exists(Path.Combine(dossierBase, "base.key"))
            && X509Certificate2.CreateFromPem(File.ReadAllText(crt)).NotAfter > DateTime.Now.AddDays(60))
            return;
        var hote = config["LOGIBTP_BASE_HOTE"];
        var nom = hote is not null && hote.EndsWith("." + domaine, StringComparison.OrdinalIgnoreCase) ? hote.ToLowerInvariant() : "base." + domaine;
        var d = Certificats();
        var (racine, cleRacine) = Racine(d, domaine, Exiger(config, ExtensionsConfiguration.CleChiffrement), false, null, DateTimeOffset.Now, sortie);
        var emis = AutoriteCertificats.Emettre(racine, cleRacine, [nom], DateTimeOffset.Now);
        EcrireCertificatBase(dossierBase, emis.CertificatPem, emis.ClePem);
        var valeurs = new Dictionary<string, string> { ["LOGIBTP_BASE_SSL_SERVEUR"] = "1" };
        if (string.IsNullOrWhiteSpace(config["LOGIBTP_BASE_SSL"])) valeurs["LOGIBTP_BASE_SSL"] = "VerifyCA";
        if (string.IsNullOrWhiteSpace(config["LOGIBTP_BASE_RACINE"])) valeurs["LOGIBTP_BASE_RACINE"] = d.Racine.Replace('\\', '/');
        RemplacerEnv(env, valeurs);
        sortie.WriteLine($"Certificat de la base {nom} valable jusqu'au {emis.Certificat.NotAfter:dd/MM/yyyy} : TLS de la base actif (redémarrer le conteneur logibtp-base)");
    }

    private static void EcrireCertificatBase(string dossierBase, string crt, string cle)
    {
        Directory.CreateDirectory(dossierBase);
        File.WriteAllText(Path.Combine(dossierBase, "base.crt"), crt.Trim() + "\n");
        DossierCertificats.EcrireSecret(Path.Combine(dossierBase, "base.key"), cle);
    }

    /// <summary>
    /// Base sur une autre machine (§ 3.3) : certificat du serveur PostgreSQL (nom DNS dans le domaine de l'installation)
    /// émis par l'autorité LogiBTP ou fourni, TLS du serveur activé, connexions de l'API en VerifyFull par la racine,
    /// accès limité aux adresses du serveur de l'API ; pg_hba.conf et postgresql.conf régénérés.
    /// </summary>
    private static int CertificatBase(string[] args, string dossier, TextWriter sortie)
    {
        var config = Configuration(dossier);
        var domaine = Exiger(config, "LOGIBTP_DOMAINE");
        var nom = (Option(args, "--nom") ?? throw new ArgumentException("--nom obligatoire (nom DNS du serveur de la base, ex. base." + domaine + ")")).Trim().ToLowerInvariant();
        if (!nom.EndsWith("." + domaine, StringComparison.Ordinal)) throw new ArgumentException($"Le nom de la base doit être un sous-domaine de {domaine} (contrainte de noms de l'autorité)");
        var adresses = Option(args, "--adresses-api") ?? config["LOGIBTP_BASE_ADRESSES_API"];
        if (string.IsNullOrWhiteSpace(adresses)) throw new ArgumentException("--adresses-api obligatoire : adresse (ou CIDR) du serveur de l'API vue par la base");
        var dossierBase = DossierBase();
        Directory.CreateDirectory(dossierBase);
        string crt, cle;
        if (Option(args, "--certificat") is { } fourni)
        {
            var (chaine, clePem, _) = DossierCertificats.LireFourni(fourni, Option(args, "--cle"), Environment.GetEnvironmentVariable("LOGIBTP_CERTIFICAT_MOT_DE_PASSE"));
            (crt, cle) = (chaine, clePem);
        }
        else
        {
            var d = Certificats();
            var (racine, cleRacine) = Racine(d, domaine, Exiger(config, ExtensionsConfiguration.CleChiffrement), false, null, DateTimeOffset.Now, sortie);
            var emis = AutoriteCertificats.Emettre(racine, cleRacine, [nom], DateTimeOffset.Now);
            (crt, cle) = (emis.CertificatPem, emis.ClePem);
            sortie.WriteLine($"Certificat de la base {nom} valable jusqu'au {emis.Certificat.NotAfter:dd/MM/yyyy}");
        }
        EcrireCertificatBase(dossierBase, crt, cle);
        var env = Path.Combine(dossier, ".env");
        RemplacerEnv(env, new Dictionary<string, string>
        {
            ["LOGIBTP_BASE_HOTE"] = nom,
            ["LOGIBTP_BASE_SSL"] = "VerifyFull",
            ["LOGIBTP_BASE_RACINE"] = Path.Combine(Certificats().Dossier, "racine.crt").Replace('\\', '/'),
            ["LOGIBTP_BASE_SSL_SERVEUR"] = "1",
            ["LOGIBTP_BASE_ADRESSES_API"] = adresses,
        });
        var reglages = Reglages(Configuration(dossier));
        File.WriteAllText(Path.Combine(dossierBase, "pg_hba.conf"), ConfigurationPostgres.PgHba(reglages));
        File.WriteAllText(Path.Combine(dossierBase, "postgresql.conf"), ConfigurationPostgres.PostgresqlConf(reglages));
        sortie.WriteLine($"Base distante {nom} : TLS activé, accès depuis {adresses} ; copier le volume logibtp-base-config sur le serveur de la base");
        return 0;
    }

    /// <summary>Rôles et droits rejoués sur toutes les bases (après une restauration ou une mise à jour) : roles.sql.</summary>
    private static async Task<int> DroitsBasesAsync(string dossier, TextWriter sortie)
    {
        var config = Configuration(dossier);
        var modele = Modele(config);
        var bd = new BaseDonnees(sortie);
        await bd.DefinirRolesAsync(modele.Chaine("postgres", "postgres", Exiger(config, "LOGIBTP_BASE_MOT_DE_PASSE_ADMIN")), new Dictionary<string, string?>
        {
            [RoleSchema] = Exiger(config, "LOGIBTP_BASE_MOT_DE_PASSE_SCHEMA"),
            ["logibtp_app"] = Exiger(config, "LOGIBTP_BASE_MOT_DE_PASSE_APP"),
            ["logibtp_lecture"] = Exiger(config, "LOGIBTP_BASE_MOT_DE_PASSE_LECTURE"),
        });
        foreach (var (_, base_) in Bases(dossier, modele))
            await bd.ExecuterFichierAsync(modele.Chaine(base_, "postgres", config["LOGIBTP_BASE_MOT_DE_PASSE_ADMIN"]), Path.Combine(RacineSql(), "db/installation/roles.sql"));
        return 0;
    }

    private static int ChiffrerSauvegarde(bool chiffrer, string jeu, string dossier, TextWriter sortie)
    {
        var config = Configuration(dossier);
        var cle = Exiger(config, ExtensionsConfiguration.CleChiffrement);
        if (!Directory.Exists(jeu)) throw new ArgumentException($"Dossier introuvable : {jeu}");
        // Déchiffrement : clé courante, puis clés précédentes (sauvegardes antérieures à une rotation).
        var n = chiffrer ? ChiffrementSauvegarde.ChiffrerDossier(jeu, cle)
            : ChiffrementSauvegarde.DechiffrerDossier(jeu, [cle, .. Chiffrement.Liste(config[ExtensionsConfiguration.CleChiffrement + "_PRECEDENTES"])]);
        sortie.WriteLine($"{n} fichier(s) {(chiffrer ? "chiffré(s)" : "déchiffré(s)")}");
        return 0;
    }

    private static int EtatCertificat(TextWriter sortie)
    {
        var infos = Certificats().Infos();
        if (infos is null)
        {
            sortie.WriteLine("Aucun certificat : l'API écoute en HTTP seulement");
            return 0;
        }
        var reste = (int)Math.Floor((infos.Fin - DateTimeOffset.Now).TotalDays);
        sortie.WriteLine($"{infos.Origine} : {string.Join(", ", infos.Noms)} ; émis par {infos.Emetteur} ; valable jusqu'au {infos.Fin:dd/MM/yyyy} ({reste} jour(s))");
        if (infos.EmpreinteRacine is not null) sortie.WriteLine($"Empreinte SHA-256 de l'autorité : {infos.EmpreinteRacine}");
        return 0;
    }

    // ---------------------------------------------------------------- mise à jour et rotation (lot 4)

    /// <summary>
    /// Mise à jour de toutes les bases (§ 7.2) : scripts du manifeste absents du journal installation_script, dans l'ordre,
    /// sous logibtp_schema, scripts rejouables, droits des rôles, conversions de données. Une base sans journal (créée
    /// hors de l'installeur) est refusée : « installation base adopter ».
    /// </summary>
    private static async Task<int> MettreAJourAsync(string dossier, TextWriter sortie)
    {
        var config = Configuration(dossier);
        var modele = Modele(config);
        var racine = RacineSql();
        var manifeste = ManifesteScripts.Lire(racine);
        var bd = new BaseDonnees(sortie);
        var modifies = 0;
        foreach (var (code, base_) in Bases(dossier, modele))
        {
            var schema = modele.Chaine(base_, RoleSchema, Exiger(config, "LOGIBTP_BASE_MOT_DE_PASSE_SCHEMA"));
            if ((await BaseDonnees.ScriptsAppliquesAsync(schema)).Count == 0)
                throw new InvalidOperationException($"La base {base_} n'a pas de journal des scripts : « installation base adopter --base {base_} --confirmer » si elle est à jour du manifeste précédent");
            modifies += (await bd.AppliquerAsync(schema, racine, manifeste.Scripts)).Modifies.Count;
        }
        await DroitsBasesAsync(dossier, sortie);
        await ConvertirAsync(dossier, sortie);
        if (modifies > 0) sortie.WriteLine($"Attention : {modifies} script(s) modifié(s) après leur application, non rejoués (une correction doit être un nouveau script)");
        sortie.WriteLine("Bases à jour");
        return 0;
    }

    /// <summary>
    /// Base créée hors de l'installeur (base de développement, installation antérieure) : les scripts du manifeste sont
    /// inscrits au journal sans être exécutés. À n'employer que pour une base à jour de ces scripts.
    /// </summary>
    private static async Task<int> AdopterAsync(string[] args, string dossier, TextWriter sortie)
    {
        if (!args.Contains("--confirmer")) throw new ArgumentException("--confirmer obligatoire : la base doit déjà contenir tous les scripts du manifeste");
        var config = Configuration(dossier);
        var modele = Modele(config);
        var cible = Option(args, "--base");
        var bases = Bases(dossier, modele).Select(b => b.Base).Where(b => args.Contains("--toutes") || b == cible).ToList();
        if (bases.Count == 0) throw new ArgumentException("--base NOM ou --toutes");
        var racine = RacineSql();
        foreach (var b in bases)
            await new BaseDonnees(sortie).AppliquerAsync(modele.Chaine(b, RoleSchema, Exiger(config, "LOGIBTP_BASE_MOT_DE_PASSE_SCHEMA")), racine, ManifesteScripts.Lire(racine).Scripts, adopter: true);
        return 0;
    }

    /// <summary>Empreintes calculées par la clé des données (module Mail : adresse des comptes ; module OAuth : compte connecté).</summary>
    private static readonly EmpreinteDeclaree[] Empreintes =
    [
        new("mail_compte", "mco_adresse_empreinte", "mco_identite", t => System.Text.Json.Nodes.JsonNode.Parse(t)?["adresse"]?.GetValue<string>()),
        new("oauth_connexion", "oco_compte_empreinte", "oco_compte", t => t),
    ];

    /// <summary>
    /// Nouvelle clé des données : l'ancienne passe dans LOGIBTP_CLE_CHIFFREMENT_PRECEDENTES (elle déchiffre encore ce qui ne
    /// l'est pas encore), la clé de l'autorité est rechiffrée, puis toutes les bases. API arrêtée pendant l'opération
    /// (Changer-CleDonnees-LogiBTP.ps1). Les sauvegardes chiffrées antérieures se lisent par les clés précédentes.
    /// </summary>
    private static async Task<int> ChangerCleAsync(string dossier, TextWriter sortie)
    {
        var config = Configuration(dossier);
        var ancienne = Exiger(config, ExtensionsConfiguration.CleChiffrement);
        var precedentes = Chiffrement.Liste(config[ExtensionsConfiguration.CleChiffrement + "_PRECEDENTES"]).ToList();
        var nouvelle = Secrets.CleDonnees();
        var d = Certificats();
        if (File.Exists(d.CleRacine))
        {
            DossierCertificats.EcrireSecret(d.CleRacine, AutoriteCertificats.ChiffrerCle(AutoriteCertificats.DechiffrerCle(File.ReadAllText(d.CleRacine), ancienne), nouvelle));
            sortie.WriteLine("Clé de l'autorité rechiffrée");
        }
        RemplacerEnv(Path.Combine(dossier, ".env"), new Dictionary<string, string>
        {
            [ExtensionsConfiguration.CleChiffrement] = nouvelle,
            [ExtensionsConfiguration.CleChiffrement + "_PRECEDENTES"] = string.Join(",", new[] { ancienne }.Concat(precedentes).Distinct()),
        });
        sortie.WriteLine("Nouvelle clé des données enregistrée dans le .env (l'ancienne reste lisible en clé précédente)");
        return await RechiffrerAsync(dossier, sortie);
    }

    /// <summary>Rechiffre toutes les bases par la clé courante (reprise d'une rotation interrompue).</summary>
    private static async Task<int> RechiffrerAsync(string dossier, TextWriter sortie)
    {
        var config = Configuration(dossier);
        var modele = Modele(config);
        var cle = Exiger(config, ExtensionsConfiguration.CleChiffrement);
        var chiffrement = new Chiffrement(cle, Chiffrement.Liste(config[ExtensionsConfiguration.CleChiffrement + "_PRECEDENTES"]));
        foreach (var (_, base_) in Bases(dossier, modele))
        {
            var bilan = await RotationCle.RechiffrerBaseAsync(modele.Chaine(base_, RoleSchema, Exiger(config, "LOGIBTP_BASE_MOT_DE_PASSE_SCHEMA")), chiffrement, chiffrement, Empreintes);
            sortie.WriteLine($"{base_} : {bilan.Valeurs} valeur(s) rechiffrée(s), {bilan.Empreintes} empreinte(s) recalculée(s)" + (bilan.Tables.Count > 0 ? $" ({string.Join(", ", bilan.Tables)})" : ""));
        }
        sortie.WriteLine("Sauvegarder le nouveau .env hors du serveur ; les sessions ouvertes sont fermées (jetons signés par l'ancienne clé)");
        return 0;
    }

    // ---------------------------------------------------------------- outils

    /// <summary>Configuration de l'installation : societes.json puis .env déchiffré, variables du système prioritaires.</summary>
    internal static ConfigurationManager Configuration(string dossier)
    {
        var c = new ConfigurationManager();
        c.AddJsonFile(Path.Combine(dossier, FichierSocietes), optional: true);
        c.AjouterFichierEnv(dossier, cleEnv: CleConstruction.Valeur);
        return c;
    }

    private static ModeleConnexion Modele(IConfiguration c) =>
        ModeleConnexion.Lire(k => c[k]) ?? throw new InvalidOperationException("LOGIBTP_BASE_HOTE absent du .env : lancer d'abord « installation preparer »");

    private static string Exiger(IConfiguration c, string cle) =>
        c[cle] is { Length: > 0 } v ? v : throw new InvalidOperationException($"{cle} absent du .env : lancer d'abord « installation preparer »");

    internal static ReglagesPostgres Reglages(IConfiguration c) => new()
    {
        Reseau = c["LOGIBTP_BASE_RESEAU"] is { Length: > 0 } r ? r : "172.30.70.0/24",
        MemoireMo = int.TryParse(c["LOGIBTP_BASE_MEMOIRE_MO"], out var m) ? m : 2048,
        AdressesApi = (c["LOGIBTP_BASE_ADRESSES_API"] ?? "").Split([',', ';', ' '], StringSplitOptions.RemoveEmptyEntries),
        Ssl = c["LOGIBTP_BASE_SSL_SERVEUR"] is "1" or "true" or "on",
    };

    /// <summary>Dossier de la configuration du conteneur de la base (volume partagé) : LOGIBTP_CONFIG_BASE.</summary>
    internal static string DossierBase() => Environment.GetEnvironmentVariable("LOGIBTP_CONFIG_BASE") ?? Path.Combine(Directory.GetCurrentDirectory(), "base-config");

    /// <summary>Racine des scripts SQL : LOGIBTP_SQL (/app/sql dans l'image), sinon la racine du dépôt (dossier de LogiBTP.slnx).</summary>
    internal static string RacineSql()
    {
        if (Environment.GetEnvironmentVariable("LOGIBTP_SQL") is { Length: > 0 } d) return d;
        foreach (var depart in new[] { Directory.GetCurrentDirectory(), AppContext.BaseDirectory })
        {
            for (var r = new DirectoryInfo(depart); r is not null; r = r.Parent)
                if (File.Exists(Path.Combine(r.FullName, "LogiBTP.slnx"))) return r.FullName;
        }
        throw new InvalidOperationException("Scripts SQL introuvables : définir LOGIBTP_SQL");
    }

    private static string VerifierDomaine(string d)
    {
        d = d.Trim().TrimEnd('.').ToLowerInvariant();
        if (d.EndsWith(".local", StringComparison.Ordinal)) throw new ArgumentException("Domaine en .local refusé (réservé au mDNS) : utiliser un sous-domaine du domaine de l'entreprise, ou .internal");
        if (Uri.CheckHostName(d) != UriHostNameType.Dns || !d.Contains('.')) throw new ArgumentException($"Domaine invalide : {d}");
        return d;
    }

    internal static string? Option(string[] args, string nom)
    {
        var i = Array.IndexOf(args, nom);
        return i >= 0 && i + 1 < args.Length ? args[i + 1] : null;
    }

    /// <summary>Ajoute au .env les variables absentes (jamais de remplacement), puis chiffre les valeurs sensibles.</summary>
    internal static int CompleterEnv(string chemin, IEnumerable<(string Cle, string Valeur, string? Commentaire)> variables)
    {
        var lignes = File.ReadAllLines(chemin).ToList();
        var presentes = ExtensionsConfiguration.LireEnv(lignes);
        var n = 0;
        foreach (var (cle, valeur, commentaire) in variables)
        {
            if (presentes.ContainsKey(cle)) continue;
            if (commentaire is not null) lignes.Add("# " + commentaire);
            lignes.Add($"{cle}={valeur}");
            n++;
        }
        File.WriteAllLines(chemin, ExtensionsConfiguration.ChiffrerLignes(lignes, CleConstruction.Valeur));
        return n;
    }

    /// <summary>Remplace la valeur de variables non sensibles du .env (ajoutées si absentes).</summary>
    internal static void RemplacerEnv(string chemin, IReadOnlyDictionary<string, string> valeurs)
    {
        if (valeurs.Count == 0) return;
        var restantes = new Dictionary<string, string>(valeurs);
        var lignes = File.ReadAllLines(chemin).Select(l =>
        {
            var i = l.IndexOf('=');
            if (l.TrimStart().StartsWith('#') || i <= 0) return l;
            var cle = l[..i].Trim();
            return restantes.Remove(cle, out var v) ? $"{cle}={v}" : l;
        }).ToList();
        lignes.AddRange(restantes.Select(p => $"{p.Key}={p.Value}"));
        File.WriteAllLines(chemin, ExtensionsConfiguration.ChiffrerLignes(lignes, CleConstruction.Valeur));
    }

    private static int Erreur(TextWriter sortie, string message)
    {
        sortie.WriteLine(message);
        return 1;
    }
}
