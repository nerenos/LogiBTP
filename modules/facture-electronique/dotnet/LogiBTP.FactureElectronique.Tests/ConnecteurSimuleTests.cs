using System.Text;
using LogiBTP.FactureElectronique.Formats;
using LogiBTP.FactureElectronique.Web.Connecteurs;
using Xunit;

namespace LogiBTP.FactureElectronique.Tests;

/// <summary>
/// Plateforme simulée (dépôt → accusé → statuts 200 à 205 en CDAR, règles de démonstration de l'accusé Error, factures
/// reçues, relève par curseur) et connecteur manuel (dépôt tenu localement, confirmation, import).
/// </summary>
public class ConnecteurSimuleTests
{
    private static readonly DateTimeOffset Depart = new(2026, 11, 9, 8, 0, 0, TimeSpan.Zero);
    private readonly HorlogeTest horloge = new(Depart);

    private ConnecteurSimule Connecteur(OptionsPlateformeSimulee? o = null) => new(new PlateformeSimulee(new MagasinFluxMemoire(), horloge, o));

    private static FluxADeposer Facture(string? suivi = "SUIVI-1") =>
        new(ConnecteurAfnorTests.Exemple(ConnecteurAfnorTests.Cii), "F202500003.xml", Syntaxe.Cii) { IdentifiantSuivi = suivi };

    [Fact]
    public async Task Depot_puis_accuse_puis_statuts_200_a_205_en_cdar()
    {
        var c = Connecteur();
        var d = await c.DeposerAsync(Facture());
        Assert.Equal(EtatAccuse.EnAttente, (await c.FluxAsync(d.IdFlux)).Accuse.Etat);

        horloge.Avancer(TimeSpan.FromMinutes(1));
        var f = await c.FluxAsync(d.IdFlux);
        Assert.Equal((EtatAccuse.Ok, TypeFlux.FactureClient, ProfilFacture.En16931, OrigineRegle.Calculee, RegleTraitement.B2B),
            (f.Accuse.Etat, f.Type, f.Profil, f.OrigineRegle, f.RegleTraitement));
        Assert.Equal(Depart.AddMinutes(1), f.ModifieLe);

        var entrants = new CriteresFlux { Sens = [SensFlux.Entrant], Types = [TypeFlux.CdvFactureClient] };
        Assert.Empty((await c.RechercherAsync(entrants)).Flux);

        horloge.Avancer(TimeSpan.FromMinutes(5));  // 200 et 201 dus (3 et 5 minutes après le dépôt)
        var (premiers, curseur) = await c.RechercherToutAsync(entrants, limite: 1);
        Assert.Equal(2, premiers.Count);

        horloge.Avancer(TimeSpan.FromHours(1));
        var (suivants, _) = await c.RechercherToutAsync(entrants, curseur, 1);
        var tous = premiers.Concat(suivants.Where(s => premiers.All(p => p.IdFlux != s.IdFlux))).ToList();
        Assert.Equal(6, tous.Count);

        var historique = new List<string>();
        foreach (var s in tous)
        {
            Assert.Equal((Syntaxe.Cdar, EtatAccuse.Ok), (s.Syntaxe, s.Accuse.Etat));
            var cdar = await c.TelechargerAsync(s.IdFlux);
            var lu = Assert.Single(Cdar.StatutsLus(Cdar.Lire(cdar.Contenu), SensFacture.Emise, historique));
            Assert.Equal("F202500003", lu.Numero);
            Assert.Empty(lu.Erreurs);
            historique.Add(lu.Statut);
        }
        Assert.Equal([StatutCdv.Deposee, StatutCdv.Emise, StatutCdv.Recue, StatutCdv.MiseADisposition, StatutCdv.PriseEnCharge, StatutCdv.Approuvee], historique);
        Assert.Equal(EmetteurStatut.Acheteur, Cdar.StatutsLus(Cdar.Lire((await c.TelechargerAsync(tous[^1].IdFlux)).Contenu), SensFacture.Emise)[0].Emetteur);

        // Relève idempotente : le même curseur rend les mêmes flux, un curseur final rien de neuf.
        Assert.Equal(suivants.Select(s => s.IdFlux), (await c.RechercherToutAsync(entrants, curseur, 1)).Flux.Select(s => s.IdFlux));
    }

    [Fact]
    public async Task Regles_de_demonstration_de_l_accuse_error()
    {
        var c = Connecteur(new OptionsPlateformeSimulee { DelaiAccuse = TimeSpan.Zero });
        async Task<DetailAccuse> Erreur(FluxADeposer f, string? empreinte = null)
        {
            var id = empreinte is null ? (await c.DeposerAsync(f)).IdFlux : c.Plateforme.Deposer(f, empreinte).IdFlux;
            var flux = await c.FluxAsync(id);
            Assert.Equal(EtatAccuse.Erreur, flux.Accuse.Etat);
            return Assert.Single(flux.Accuse.Details);
        }
        await c.DeposerAsync(Facture());
        Assert.Equal(MotifAccuse.FluxExistant, (await Erreur(Facture())).Motif);
        Assert.Equal(MotifAccuse.Empreinte, (await Erreur(Facture(null), new string('0', 64))).Motif);
        Assert.Equal(MotifAccuse.TypeFlux, (await Erreur(Facture(null) with { Syntaxe = Syntaxe.Ubl })).Motif);
        Assert.Equal(MotifAccuse.SchemaInvalide, (await Erreur(new FluxADeposer(Encoding.UTF8.GetBytes("<pas"), "x.xml", Syntaxe.Cii))).Motif);
        var texte = Encoding.UTF8.GetString(ConnecteurAfnorTests.Exemple(ConnecteurAfnorTests.Cii)).Replace("F202500003", "F2025REJET1");
        Assert.Equal(MotifAccuse.AutreErreurTechnique, (await Erreur(new FluxADeposer(Encoding.UTF8.GetBytes(texte), "r.xml", Syntaxe.Cii))).Motif);

        // Aucun statut programmé après un accusé Error.
        horloge.Avancer(TimeSpan.FromDays(1));
        var entrants = (await c.RechercherToutAsync(new CriteresFlux { Sens = [SensFlux.Entrant] })).Flux;
        Assert.Equal(6, entrants.Count);  // ceux de la seule facture acceptée
        Assert.Equal(5, (await c.RechercherToutAsync(new CriteresFlux { EtatAccuse = EtatAccuse.Erreur })).Flux.Count);
    }

    [Fact]
    public async Task Factures_et_statuts_recus_de_demonstration_annuaire_et_docType()
    {
        var c = Connecteur();
        var recue = c.Plateforme.RecevoirFacture(ConnecteurAfnorTests.Exemple(ConnecteurAfnorTests.FacturX), "recue.pdf");
        var page = await c.RechercherAsync(new CriteresFlux { Types = [TypeFlux.FactureFournisseur] });
        var f = Assert.Single(page.Flux);
        Assert.Equal((recue.IdFlux, Syntaxe.FacturX, SensFlux.Entrant, EtatAccuse.Ok), (f.IdFlux, f.Syntaxe, f.Sens, f.Accuse.Etat));
        Assert.Equal("application/xml", (await c.TelechargerAsync(f.IdFlux, TypeDocumentFlux.Converti)).TypeMime);
        Assert.Equal("text/plain", (await c.TelechargerAsync(f.IdFlux, TypeDocumentFlux.Lisible)).TypeMime);

        var cdar = Directory.GetFiles(LectureCiiTests.Dossier("cdar", "logibtp"), "*.xml").Order().First();
        var statut = c.Plateforme.RecevoirStatut(File.ReadAllBytes(cdar), Path.GetFileName(cdar));
        Assert.Equal((Syntaxe.Cdar, TypeFlux.CdvFactureClient), (statut.Syntaxe, statut.Type));
        Assert.Equal(ErreurFe.RessourceIntrouvable,
            (await Assert.ThrowsAsync<ExceptionConnecteur>(() => c.TelechargerAsync(statut.IdFlux, TypeDocumentFlux.Lisible))).Code);
        Assert.Equal(ErreurFe.RessourceIntrouvable, (await Assert.ThrowsAsync<ExceptionConnecteur>(() => c.FluxAsync("inconnu"))).Code);

        c.Plateforme.Annuaire.Ajouter(new LigneAnnuaire("100000009_STATUTS", TypePlateformeAnnuaire.Pa, EtatLigneAnnuaire.Active, "100000009", null, null, "STATUTS"));
        c.Plateforme.Annuaire.Ajouter(new UniteLegale("100000009", "BTP CONSTRUCTIONS", "PrivateVatRegistered", "A"));
        var l = await c.LigneAnnuaireAsync("100000009_STATUTS");
        Assert.Equal("BTP CONSTRUCTIONS", l.UniteLegale?.RaisonSociale);
        var r = await c.RechercherLignesAnnuaireAsync(new RechercheAnnuaire([new FiltreAnnuaire("addressingSuffix", "STAT", OperateurAnnuaire.CommencePar)]));
        Assert.Equal(1, r.Total);
        Assert.Equal(ErreurFe.RequeteRefusee, (await Assert.ThrowsAsync<ExceptionConnecteur>(() =>
            c.RechercherLignesAnnuaireAsync(new RechercheAnnuaire([new FiltreAnnuaire("inconnu", "x")])))).Code);
        Assert.True((await c.SanteAsync()).Disponible);
    }

    [Fact]
    public async Task Connecteur_manuel_depot_a_disposition_confirmation_et_import()
    {
        var c = new ConnecteurManuel(new MagasinFluxMemoire(), horloge);
        Assert.False(c.TransmetAutomatiquement);
        var flux = Facture();
        var d = await c.DeposerAsync(flux);
        Assert.Equal(EtatAccuse.EnAttente, (await c.FluxAsync(d.IdFlux)).Accuse.Etat);
        var fichier = await c.TelechargerAsync(d.IdFlux);
        Assert.Equal((flux.Contenu, "application/xml"), (fichier.Contenu, fichier.TypeMime));
        Assert.Equal(ErreurFe.RessourceIntrouvable,
            (await Assert.ThrowsAsync<ExceptionConnecteur>(() => c.TelechargerAsync(d.IdFlux, TypeDocumentFlux.Lisible))).Code);

        horloge.Avancer(TimeSpan.FromMinutes(10));
        var confirme = c.Confirmer(d.IdFlux, new AccuseFlux(EtatAccuse.Ok, []));
        Assert.Equal((EtatAccuse.Ok, Depart.AddMinutes(10)), (confirme.Accuse.Etat, confirme.ModifieLe));
        Assert.Equal(ErreurFe.DemandeInvalide, Assert.Throws<ExceptionConnecteur>(() => c.Confirmer(d.IdFlux, new AccuseFlux(EtatAccuse.Ok, []))).Code);

        var importee = c.Importer(ConnecteurAfnorTests.Exemple(ConnecteurAfnorTests.FacturX), "recue.pdf");
        Assert.Equal((TypeFlux.FactureFournisseur, Syntaxe.FacturX, SensFlux.Entrant), (importee.Type, importee.Syntaxe, importee.Sens));
        var cdar = Directory.GetFiles(LectureCiiTests.Dossier("cdar", "logibtp"), "*.xml").Order().First();
        Assert.Equal(TypeFlux.CdvFactureClient, c.Importer(File.ReadAllBytes(cdar), "statut.xml").Type);
        Assert.Equal(ErreurFe.DemandeInvalide, Assert.Throws<ExceptionConnecteur>(() => c.Importer(Encoding.UTF8.GetBytes("<x/>"), "x.xml")).Code);

        var (entrants, _) = await c.RechercherToutAsync(new CriteresFlux { Sens = [SensFlux.Entrant] });
        Assert.Equal(2, entrants.Count);
        Assert.Equal(ErreurFe.FonctionNonPriseEnCharge, (await Assert.ThrowsAsync<ExceptionConnecteur>(() => c.UniteLegaleAsync("100000009"))).Code);
    }
}
