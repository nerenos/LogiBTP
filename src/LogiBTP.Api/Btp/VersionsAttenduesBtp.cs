using LogiBTP.Domaine;
using LogiBTP.Installation;
using LogiBTP.Installation.Web;

namespace LogiBTP.Api.Btp;

/// <summary>
/// Versions du schéma attendues par cette version de l'API (plan versionnement-schema, lot 6) : plus haute version de chaque
/// module du plan <c>db/installation/scripts.txt</c>, embarqué dans l'assemblage à la compilation (ressource
/// <c>LogiBTP.Api.scripts.txt</c>) plutôt que lu dans le dossier SQL de l'image (<c>LOGIBTP_SQL</c>, absent de l'image de
/// démonstration Vercel) : il ne peut donc pas différer du binaire, ni manquer. Une base en retard est refusée en 503
/// <see cref="ErreursInstallation.BaseAMettreAJour"/> (module Installation, <see cref="ControleVersionBase"/>).
/// </summary>
public static class VersionsAttenduesBtp
{
    public const string Ressource = "LogiBTP.Api.scripts.txt";

    public static VersionsAttendues Lire()
    {
        using var flux = typeof(VersionsAttenduesBtp).Assembly.GetManifestResourceStream(Ressource)
            ?? throw new InvalidOperationException("Plan des scripts SQL absent de l'assemblage (db/installation/scripts.txt)");
        using var lecteur = new StreamReader(flux);
        return VersionsAttendues.Depuis(lecteur.ReadToEnd().Split('\n'), MigrationsCoeur.Liste);
    }

    public static IServiceCollection AddVersionsAttendues(this IServiceCollection services) =>
        services.AddControleVersionBase(Lire(), ErreursInstallation.BaseAMettreAJour);
}
