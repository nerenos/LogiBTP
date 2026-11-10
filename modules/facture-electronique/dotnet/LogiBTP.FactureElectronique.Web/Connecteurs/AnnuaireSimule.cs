using System.Collections.Concurrent;

namespace LogiBTP.FactureElectronique.Web.Connecteurs;

/// <summary>
/// Annuaire de la plateforme simulée (Directory Service) : unités légales, établissements, codes de routage et lignes
/// d'annuaire ajoutés par la démonstration ou les tests. Recherche sur les champs de l'API (siren, businessName,
/// siret, name, routingIdentifier, addressingIdentifier…) avec les opérateurs strict, contains et startWith.
/// </summary>
public sealed class AnnuaireSimule
{
    private readonly ConcurrentDictionary<string, UniteLegale> unites = new();
    private readonly ConcurrentDictionary<string, Etablissement> etablissements = new();
    private readonly ConcurrentDictionary<(string, string), CodeRoutage> codes = new();
    private readonly ConcurrentDictionary<string, LigneAnnuaire> lignes = new();

    public void Ajouter(UniteLegale u) => unites[u.Siren] = u;
    public void Ajouter(Etablissement e) => etablissements[e.Siret] = e;
    public void Ajouter(CodeRoutage c) => codes[(c.Siret ?? "", c.IdentifiantRoutage)] = c;
    public void Ajouter(LigneAnnuaire l) => lignes[l.IdentifiantAdressage] = l;

    public UniteLegale UniteLegale(string siren) => unites.GetValueOrDefault(siren) ?? throw Introuvable("Unité légale", siren);

    public Etablissement Etablissement(string siret)
    {
        var e = etablissements.GetValueOrDefault(siret) ?? throw Introuvable("Établissement", siret);
        return e with { UniteLegale = e.UniteLegale ?? (e.Siren is null ? null : unites.GetValueOrDefault(e.Siren)) };
    }

    public CodeRoutage CodeRoutage(string siret, string identifiant) =>
        codes.GetValueOrDefault((siret, identifiant)) ?? throw Introuvable("Code de routage", identifiant);

    public LigneAnnuaire Ligne(string identifiant) => Inclure(lignes.GetValueOrDefault(identifiant) ?? throw Introuvable("Ligne d'annuaire", identifiant));

    public ResultatsAnnuaire<UniteLegale> RechercherUnitesLegales(RechercheAnnuaire r) => Page(unites.Values.OrderBy(u => u.Siren), r, u => new()
    {
        ["siren"] = u.Siren, ["businessName"] = u.RaisonSociale, ["entityType"] = u.TypeEntite, ["administrativeStatus"] = u.EtatAdministratif,
    });

    public ResultatsAnnuaire<Etablissement> RechercherEtablissements(RechercheAnnuaire r) => Page(etablissements.Values.OrderBy(e => e.Siret), r, e => new()
    {
        ["siret"] = e.Siret, ["siren"] = e.Siren, ["name"] = e.Nom, ["facilityType"] = e.TypeEtablissement, ["administrativeStatus"] = e.EtatAdministratif,
        ["postalCode"] = e.Adresse?.CodePostal, ["locality"] = e.Adresse?.Localite,
        ["addressLines"] = string.Join(" ", new[] { e.Adresse?.Ligne1, e.Adresse?.Ligne2, e.Adresse?.Ligne3 }.Where(x => x is not null)),
    });

    public ResultatsAnnuaire<CodeRoutage> RechercherCodesRoutage(RechercheAnnuaire r) => Page(codes.Values.OrderBy(c => c.IdentifiantRoutage), r, c => new()
    {
        ["routingIdentifier"] = c.IdentifiantRoutage, ["siret"] = c.Siret, ["routingCodeName"] = c.Nom, ["administrativeStatus"] = c.EtatAdministratif,
        ["postalCode"] = c.Adresse?.CodePostal, ["locality"] = c.Adresse?.Localite,
    });

    public ResultatsAnnuaire<LigneAnnuaire> RechercherLignes(RechercheAnnuaire r)
    {
        var page = Page(lignes.Values.OrderBy(l => l.IdentifiantAdressage), r, l => new()
        {
            ["addressingIdentifier"] = l.IdentifiantAdressage, ["siren"] = l.Siren, ["siret"] = l.Siret, ["routingIdentifier"] = l.IdentifiantRoutage,
            ["addressingSuffix"] = l.Suffixe,
        });
        return page with { Resultats = [.. page.Resultats.Select(Inclure)] };
    }

    private LigneAnnuaire Inclure(LigneAnnuaire l) => l with
    {
        UniteLegale = l.UniteLegale ?? (l.Siren is null ? null : unites.GetValueOrDefault(l.Siren)),
        Etablissement = l.Etablissement ?? (l.Siret is null ? null : etablissements.GetValueOrDefault(l.Siret)),
        CodeRoutage = l.CodeRoutage ?? (l.Siret is null || l.IdentifiantRoutage is null ? null : codes.GetValueOrDefault((l.Siret, l.IdentifiantRoutage))),
    };

    private static ResultatsAnnuaire<T> Page<T>(IEnumerable<T> tous, RechercheAnnuaire r, Func<T, Dictionary<string, string?>> champs)
    {
        var retenus = tous.Where(x =>
        {
            var c = champs(x);
            return r.Filtres.All(f => c.TryGetValue(f.Champ, out var v)
                ? v is not null && f.Operateur switch
                {
                    OperateurAnnuaire.Contient => v.Contains(f.Valeur, StringComparison.OrdinalIgnoreCase),
                    OperateurAnnuaire.CommencePar => v.StartsWith(f.Valeur, StringComparison.OrdinalIgnoreCase),
                    _ => v == f.Valeur,
                }
                : throw new ExceptionConnecteur(ErreurFe.RequeteRefusee, $"Filtre inconnu : {f.Champ}", 400));
        }).ToList();
        return new ResultatsAnnuaire<T>(retenus.Count, [.. retenus.Skip(r.Ignorer ?? 0).Take(r.Limite ?? int.MaxValue)]);
    }

    private static ExceptionConnecteur Introuvable(string quoi, string id) => new(ErreurFe.RessourceIntrouvable, $"{quoi} {id} introuvable", 404);
}
