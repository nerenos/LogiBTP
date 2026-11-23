using LogiBTP.Bibliotheque.Web;
using LogiBTP.Socle.Web;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace LogiBTP.Bibliotheque.Tests;

/// <summary>
/// Service de mise à jour de la bibliothèque depuis un PA de document (unitaire et groupée), sur une base où les scripts du
/// module sont chargés : variable LOGIBTP_TEST_PG, sinon rien. Éléments propres à l'instance, supprimés à la fin.
/// </summary>
public sealed class MiseAJourPaTests : IAsyncLifetime
{
    private static readonly string? Connexion = Environment.GetEnvironmentVariable("LOGIBTP_TEST_PG");
    private static readonly Utilisateur Moi = new("maj.pa.test", "ADMIN");
    private readonly string _suffixe = Guid.NewGuid().ToString("N")[..8].ToUpperInvariant();
    private readonly List<long> _elements = [];

    private BibliothequeDbContext Db() => new(new DbContextOptionsBuilder<BibliothequeDbContext>().UseNpgsql(Connexion).UseSnakeCaseNamingConvention().Options);

    private static ServiceBibliotheque Service(BibliothequeDbContext db) => new(db, new SpecialisationBibliotheque());

    public Task InitializeAsync() => Task.CompletedTask;

    public async Task DisposeAsync()
    {
        if (Connexion is null) return;
        await using var db = Db();
        await db.Database.ExecuteSqlRawAsync("DELETE FROM verrou_fiche WHERE vef_type = 'element' AND vef_utilisateur = 'autre.test'");
        foreach (var id in _elements) await db.Database.ExecuteSqlRawAsync("DELETE FROM element WHERE ele_id = {0}", id);
    }

    private async Task<long> Article(BibliothequeDbContext db, string code, string scenario, decimal? paFixe, params TarifFournisseur[] tarifs)
    {
        var bib = await db.Bibliotheques.AsNoTracking().Select(b => b.BibId).FirstAsync();
        var e = new Element { EleBibId = bib, EleCode = $"PA{code}{_suffixe}", EleType = "ARTICLE", EleLibelleHtml = "Test", EleLibelle = "Test", EleUntStock = "u", EleScenarioPa = scenario, ElePaFixe = paFixe, EleCoefFg = 1, EleCoefBenef = 1 };
        db.Elements.Add(e);
        await db.SaveChangesAsync();
        _elements.Add(e.EleId);
        foreach (var t in tarifs) { t.TfoEleId = e.EleId; t.TfoFournisseur = "F"; t.TfoUntCode = "u"; db.Tarifs.Add(t); }
        await db.SaveChangesAsync();
        return e.EleId;
    }

    private static async Task<long?> Tiers(BibliothequeDbContext db, int rang) =>
        (await db.Database.SqlQueryRaw<long>("""SELECT per_id AS "Value" FROM personne ORDER BY per_id OFFSET {0} LIMIT 1""", rang).ToListAsync()).Cast<long?>().FirstOrDefault();

    [Fact]
    public async Task Tarif_du_fournisseur_modifie_seul_puis_prix_recalcules()
    {
        if (Connexion is null) return;
        await using var db = Db();
        var tiers = await Tiers(db, 0); if (tiers is null) return;
        var autre = await Tiers(db, 1);
        var id = await Article(db, "A", "FIXE", 10m, new TarifFournisseur { TfoPrix = 8m, TfoTiersId = tiers }, new TarifFournisseur { TfoPrix = 7m, TfoTiersId = autre });
        var s = Service(db);

        var reference = (await s.PaReferences(new DemandePaReference([id], tiers), default)).Single();
        Assert.Equal((8m, SourcePaReference.TarifFournisseur), (reference.Pa, reference.Source));

        var r = await s.MettreAJourPa(new DemandeMajPa(id, 9m, tiers, "F", reference.Empreinte), Moi, default);
        Assert.True(r.Ecrit);
        Assert.Equal(ActionMajPa.Tarif, r.Action);
        await using var lecture = Db();
        var tarifs = await lecture.Tarifs.AsNoTracking().Where(t => t.TfoEleId == id).ToListAsync();
        Assert.Equal(9m, tarifs.Single(t => t.TfoTiersId == tiers).TfoPrix);
        if (autre is not null && autre != tiers) Assert.Equal(7m, tarifs.Single(t => t.TfoTiersId == autre).TfoPrix);
        Assert.Equal(10m, (await lecture.Elements.AsNoTracking().FirstAsync(e => e.EleId == id)).ElePaFixe);
    }

    [Fact]
    public async Task Pa_d_un_autre_fournisseur_cree_un_tarif_au_fournisseur_du_document()
    {
        if (Connexion is null) return;
        await using var db = Db();
        var tiers = await Tiers(db, 0); if (tiers is null) return;
        var autre = await Tiers(db, 1); if (autre is null || autre == tiers) return;
        var id = await Article(db, "B", "FOURNISSEUR_PRINCIPAL", null, new TarifFournisseur { TfoPrix = 8m, TfoTiersId = autre, TfoPrincipal = true });

        var r = await Service(db).MettreAJourPa(new DemandeMajPa(id, 9.5m, tiers, "Fournisseur du document"), Moi, default);
        Assert.Equal(ActionMajPa.NouveauTarif, r.Action);
        await using var lecture = Db();
        var tarifs = await lecture.Tarifs.AsNoTracking().Where(t => t.TfoEleId == id).ToListAsync();
        Assert.Equal(2, tarifs.Count);
        var cree = tarifs.Single(t => t.TfoTiersId == tiers);
        Assert.Equal((9.5m, false, DateOnly.FromDateTime(DateTime.Today)), (cree.TfoPrix, cree.TfoPrincipal, cree.TfoDebut!.Value));
        Assert.Equal(8m, tarifs.Single(t => t.TfoTiersId == autre).TfoPrix);
        Assert.Equal(8m, (await lecture.Elements.AsNoTracking().FirstAsync(e => e.EleId == id)).ElePa);
    }

    [Fact]
    public async Task Sans_fournisseur_pa_fixe_ecrit_et_scenario_calcule_refuse_avec_motif_en_liste()
    {
        if (Connexion is null) return;
        await using var db = Db();
        var fixe = await Article(db, "C", "FIXE", 10m);
        var pmp = await Article(db, "D", "PMP", null);
        var r = await Service(db).MettreAJourPa(new DemandeMajPaListe([new DemandeMajPa(fixe, 12m), new DemandeMajPa(pmp, 12m), new DemandeMajPa(-1, 1m)]), Moi, default);
        Assert.Equal([(true, ActionMajPa.PaFixe, null), (false, ActionMajPa.Aucune, MotifMajPa.ScenarioCalcule), (false, ActionMajPa.Aucune, MotifMajPa.ElementIntrouvable)],
            r.Select(x => (x.Ecrit, x.Action, x.Motif)).ToArray<(bool, string, string?)>());
        await using var lecture = Db();
        var e = await lecture.Elements.AsNoTracking().FirstAsync(x => x.EleId == fixe);
        Assert.Equal((12m, 12m, MiseAJourPaTestsOutils.Auteur), (e.ElePaFixe, e.ElePa, e.EleMajPar));
    }

    [Fact]
    public async Task Fiche_en_modification_par_un_autre_ou_empreinte_changee_refusees_sans_bloquer_les_autres()
    {
        if (Connexion is null) return;
        await using var db = Db();
        var verrouille = await Article(db, "E", "FIXE", 10m);
        var change = await Article(db, "F", "FIXE", 10m);
        var libre = await Article(db, "G", "FIXE", 10m);
        var s = Service(db);
        var avant = (await s.PaReferences(new DemandePaReference([verrouille, change, libre]), default)).ToDictionary(x => x.EleId, x => x.Empreinte);
        await db.Database.ExecuteSqlRawAsync("""
            INSERT INTO verrou_fiche (vef_type, vef_id, vef_utilisateur, vef_jeton, vef_depuis, vef_renouvele) VALUES ('element', {0}, 'autre.test', gen_random_uuid(), now(), now())
            ON CONFLICT (vef_type, vef_id) DO UPDATE SET vef_utilisateur = 'autre.test', vef_renouvele = now()
            """, verrouille.ToString());
        await db.Database.ExecuteSqlRawAsync("UPDATE element SET ele_mots_cles = 'modifie' WHERE ele_id = {0}", change);

        var r = await s.MettreAJourPa(new DemandeMajPaListe([new DemandeMajPa(verrouille, 12m, Empreinte: avant[verrouille]), new DemandeMajPa(change, 12m, Empreinte: avant[change]), new DemandeMajPa(libre, 12m, Empreinte: avant[libre])]), Moi, default);
        Assert.Equal(new string?[] { MotifMajPa.FicheEnModification, MotifMajPa.EmpreinteChangee, null }, r.Select(x => x.Motif).ToArray());
        await using var lecture = Db();
        Assert.Equal([10m, 10m, 12m], (await lecture.Elements.AsNoTracking().Where(e => _elements.Contains(e.EleId)).OrderBy(e => e.EleId).Select(e => e.ElePaFixe).ToListAsync()).TakeLast(3).Select(x => x!.Value).ToArray());
    }

    [Fact]
    public async Task Simulation_n_ecrit_rien()
    {
        if (Connexion is null) return;
        await using var db = Db();
        var id = await Article(db, "H", "FIXE", 10m);
        var r = await Service(db).MettreAJourPa(new DemandeMajPaListe([new DemandeMajPa(id, 12m)], Simulation: true), Moi, default);
        Assert.Equal((false, ActionMajPa.PaFixe, 12m), (r[0].Ecrit, r[0].Action, r[0].PaFixe));
        await using var lecture = Db();
        Assert.Equal(10m, (await lecture.Elements.AsNoTracking().FirstAsync(e => e.EleId == id)).ElePaFixe);
    }
}

internal static class MiseAJourPaTestsOutils
{
    public const string Auteur = "maj.pa.test";
}
