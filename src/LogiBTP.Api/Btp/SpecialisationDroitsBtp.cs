using LogiBTP.Droits.Web;
using LogiBTP.Socle.Web;
using Microsoft.EntityFrameworkCore;

namespace LogiBTP.Api.Btp;

/// <summary>
/// Module Droits spécialisé pour le BTP : catalogue (modules, types de documents par famille, types de fiches, fonctions
/// d'administration) et rattachement de chaque route /api à un nœud. Conventions des modules : documents/{famille}/{code}
/// (module Document), fiches/{type} (module Fiche), crm (module CRM), pointage (module Pointage).
/// </summary>
public sealed class SpecialisationDroitsBtp : SpecialisationDroits
{
    private static readonly string[] Cycle = ["CONSULTER", "MODIFIER", "VALIDER", "CREER", "SUPPRIMER", "DEVERROUILLER", "FORCER"];
    private static readonly string[] Simple = ["CONSULTER", "MODIFIER", "CREER", "SUPPRIMER"];
    private static readonly string[] Fiche = ["CONSULTER", "MODIFIER", "CREER", "SUPPRIMER", "DEVERROUILLER", "RGPD"];
    private static readonly string[] Lecture = ["CONSULTER", "MODIFIER"];

    private static readonly Dictionary<string, string> Familles = new()
    {
        ["V"] = "Ventes", ["A"] = "Achats", ["T"] = "Sous-traitance", ["S"] = "Stock", ["E"] = "Exécution",
    };

    private sealed record TypeLu(string Code, string Libelle, string Famille);
    private sealed record FicheLue(string Code, string Libelle);

    public override async Task<IReadOnlyList<NoeudCatalogue>> CatalogueAsync(IServiceProvider services, CancellationToken ct)
    {
        var db = services.GetRequiredService<LogiBtpContext>();
        var types = await db.Database.SqlQueryRaw<TypeLu>("SELECT tyd_code AS \"Code\", tyd_libelle AS \"Libelle\", tyd_famille AS \"Famille\" FROM type_document ORDER BY tyd_famille, tyd_code").ToListAsync(ct);
        var fiches = await db.Database.SqlQueryRaw<FicheLue>("SELECT tyf_code AS \"Code\", tyf_libelle AS \"Libelle\" FROM type_fiche WHERE tyf_actif ORDER BY tyf_libelle").ToListAsync(ct);
        var n = new List<NoeudCatalogue>
        {
            new("documents", "Documents", Cycle, Icone: "📄", Aide: "Pièces de vente, d'achat, de stock, d'exécution et de sous-traitance"),
        };
        foreach (var f in types.Select(t => t.Famille).Distinct())
        {
            n.Add(new($"documents/{f}", Familles.GetValueOrDefault(f, f), Cycle));
            n.AddRange(types.Where(t => t.Famille == f).Select(t => new NoeudCatalogue($"documents/{f}/{t.Code}", t.Libelle, Cycle)));
        }
        n.Add(new("fiches", "Fiches", Fiche, Icone: "🗂", Aide: "Salariés, matériels, tiers, structure des affaires, éléments de bibliothèque"));
        n.AddRange(fiches.Select(f => new NoeudCatalogue($"fiches/{f.Code}", f.Libelle, Fiche)));
        n.AddRange(
        [
            new("listes", "Listes", Lecture, Icone: "📋", Aide: "Listes de données (vues, recherche, saisie en liste)"),
            new("structure", "Structure des affaires", Simple, Icone: "🏗", Aide: "Rattachements, marchés, acomptes, intervenants"),
            new("annuaire", "Annuaire", Simple, Icone: "📇"),
            new("bibliotheque", "Bibliothèque", Simple, Icone: "📚"),
            new("ged", "GED", Simple, Icone: "🗄"),
            new("editions", "Éditions", Simple, Icone: "🖨"),
            new("ressources", "Ressources", Simple, Icone: "🧰", Aide: "Habilitations, équipes, missions d'intérim, services"),
            new("calendriers", "Calendriers", Simple, Icone: "📅"),
            new("crm", "CRM", ["CONSULTER", "MODIFIER", "CREER", "SUPPRIMER", "SUPERVISER", "RGPD"], Icone: "💬",
                Aide: "Superviser : voir les notes de tous ; RGPD : lever le masquage des notes privées"),
            new("reglement", "Règlements", Simple, Icone: "💶"),
            new("execution", "Exécution", Simple, Icone: "🧭"),
            new("sous_traitance", "Sous-traitance", Simple, Icone: "🤝"),
            new("stock", "Stock", Simple, Icone: "📦"),
            new("pointage", "Pointage MO", ["CONSULTER", "MODIFIER", "VALIDER", "CREER", "SUPPRIMER"], Portee: true, Icone: "⏱",
                Aide: "Portée : soi (ses heures), son service (responsable), tout"),
            new("pointage/bornes", "Bornes d'atelier", Simple, Aide: "Appareils, PIN, paramétrage des bornes"),
            new("planning", "Planning", Simple, Icone: "📆"),
            new("mail", "Messagerie", Simple, Icone: "📧"),
            new("connexions", "Connexions externes (OAuth)", Simple, Icone: "🔐"),
            new("administration", "Administration", Lecture, Icone: "⚙"),
            new("administration/profils", "Profils et droits", Lecture),
            new("administration/comptes", "Comptes utilisateurs", Lecture),
        ]);
        return n;
    }

    public override IReadOnlyList<RouteDroits> Routes { get; } =
    [
        new("/api/sante", ModeRoute.Publique),
        new("/api/societe", ModeRoute.Publique),
        new("/api/oauth/retour", ModeRoute.Publique),
        new("/api/pointage/borne", ModeRoute.Publique),
        new("/api/auth", ModeRoute.Session),
        new("/api/auth/comptes", ModeRoute.Module, "administration/comptes"),
        new("/api/auth/personne", ModeRoute.Module, "administration/comptes"),
        new("/api/auth/personnes", ModeRoute.Module, "administration/comptes"),
        new("/api/droits", ModeRoute.Session),
        new("/api/droits/catalogue", ModeRoute.Module, "administration/profils"),
        new("/api/droits/profils", ModeRoute.Module, "administration/profils"),
        new("/api/droits/journal", ModeRoute.Module, "administration/profils"),
        new("/api/modules", ModeRoute.Session),
        new("/api/diffusion", ModeRoute.Session),
        new("/api/notifications", ModeRoute.Session),
        // Module Document : définitions et référentiels lus par la page document.
        new("/api/documents", ModeRoute.Module, "documents"),
        new("/api/calcul", ModeRoute.Module, "documents"),
        new("/api/cas-test", ModeRoute.Module, "documents"),
        new("/api/historique", ModeRoute.Module, "documents"),
        new("/api/lignes", ModeRoute.Module, "documents"),
        new("/api/types-document", ModeRoute.Module, "documents"),
        new("/api/vues-document", ModeRoute.Module, "documents"),
        new("/api/etiquettes-ligne", ModeRoute.Module, "documents"),
        new("/api/couleurs-type-prix", ModeRoute.Module, "documents"),
        new("/api/modeles-document", ModeRoute.Module, "documents"),
        new("/api/conditions-paiement", ModeRoute.Module, "documents"),
        new("/api/unites", ModeRoute.Module, "documents"),
        new("/api/parametres-documents", ModeRoute.Module, "documents"),
        new("/api/regles-documents", ModeRoute.Module, "documents"),
        new("/api/comptes-comptables", ModeRoute.Module, "documents"),
        new("/api/fiches/{type}", ModeRoute.Module, "fiches/{type}"),
        new("/api/listes", ModeRoute.Module, "listes"),
        new("/api/structure", ModeRoute.Module, "structure"),
        new("/api/annuaire", ModeRoute.Module, "annuaire"),
        new("/api/entreprises-fr", ModeRoute.Module, "annuaire"),
        new("/api/bibliotheque", ModeRoute.Module, "bibliotheque"),
        new("/api/ged", ModeRoute.Module, "ged"),
        new("/api/editions", ModeRoute.Module, "editions"),
        new("/api/editions-btp", ModeRoute.Module, "editions"),
        new("/api/ressources", ModeRoute.Module, "ressources"),
        new("/api/services", ModeRoute.Module, "ressources"),
        new("/api/calendriers", ModeRoute.Module, "calendriers"),
        new("/api/crm", ModeRoute.Module, "crm"),
        new("/api/reglements", ModeRoute.Module, "reglement"),
        new("/api/execution", ModeRoute.Module, "execution"),
        new("/api/liaisons", ModeRoute.Module, "planning"),
        new("/api/sous-traitance", ModeRoute.Module, "sous_traitance"),
        new("/api/stock", ModeRoute.Module, "stock"),
        new("/api/stock/bornes", ModeRoute.Module, "pointage/bornes"),
        new("/api/pointage", ModeRoute.Module, "pointage"),
        new("/api/pointage/appareils", ModeRoute.Module, "pointage/bornes"),
        new("/api/pointage/pins", ModeRoute.Module, "pointage/bornes"),
        new("/api/planning", ModeRoute.Module, "planning"),
        new("/api/mail", ModeRoute.Module, "mail"),
        new("/api/oauth", ModeRoute.Module, "connexions"),
    ];

    private sealed record ProfilCompte(string Profil, int Nombre);

    public override async Task<IReadOnlyDictionary<string, int>> ComptesParProfilAsync(IServiceProvider services, CancellationToken ct) =>
        (await services.GetRequiredService<LogiBtpContext>().Database
            .SqlQueryRaw<ProfilCompte>("SELECT cpt_profil AS \"Profil\", COUNT(*)::int AS \"Nombre\" FROM compte GROUP BY cpt_profil").ToListAsync(ct))
        .ToDictionary(p => p.Profil, p => p.Nombre);
}
