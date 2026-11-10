using System.Diagnostics;
using System.Globalization;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using LogiBTP.Socle;
using LogiBTP.Socle.Web;
using Microsoft.Extensions.Logging;

namespace LogiBTP.FactureElectronique.Web.Connecteurs;

/// <summary>
/// Connecteur générique AFNOR XP Z12-013 (Flow Service et Directory Service 1.3.0, artefacts/api) : dépôt en
/// <c>multipart/form-data</c> (<c>flowInfo</c> JSON + <c>file</c>, <c>sha256</c>), recherche paginée par curseur,
/// téléchargement par <c>docType</c>, annuaire, healthcheck ; en-têtes <c>Request-Id</c> (un UUID par appel, rendu
/// dans les erreurs et le journal) et <c>Organization-Id</c> ; jeton Bearer obtenu par <see cref="IFournisseurJeton"/>
/// (OAuth 2.0 client credentials, module OAuth branché par l'application) ; statuts 400 à 503 → <see cref="ErreurFe"/>.
/// Le journal ne contient ni jeton ni en-tête : méthode, chemin, statut, Request-Id et durée. Une PA dont l'API s'écarte
/// de la norme dérive de cette classe (adresses, en-têtes, lecture des erreurs, étapes) et s'enregistre dans la fabrique.
/// </summary>
public class ConnecteurAfnor(ParametresConnecteur parametres, HttpClient http, IFournisseurJeton? jetons = null, ILogger? journal = null)
    : ConnecteurPlateforme
{
    /// <summary>Taille maximale lue d'un corps d'erreur.</summary>
    private const int TailleErreur = 64 * 1024;

    protected ParametresConnecteur Parametres { get; } = parametres;
    protected HttpClient Http { get; } = http;

    public override string Code => ConnecteurFe.Afnor;

    // ---------------------------------------------------------------- Flow Service

    protected override async Task<FluxDepose> DeposerFluxAsync(FluxPrepare p, CancellationToken ct)
    {
        var f = p.Flux;
        var info = new JsonObject();
        if (f.IdentifiantSuivi is not null) info["trackingId"] = f.IdentifiantSuivi;
        info["name"] = f.Nom;
        if (f.RegleTraitement is not null) info["processingRule"] = f.RegleTraitement;
        info["flowSyntax"] = f.Syntaxe;
        if (f.Profil is not null) info["flowProfile"] = f.Profil;
        info["sha256"] = p.Empreinte;

        var corps = new MultipartFormDataContent();
        var partieInfo = new StringContent(info.ToJsonString(), Encoding.UTF8);
        partieInfo.Headers.ContentType = new MediaTypeHeaderValue("application/json");
        corps.Add(partieInfo, "flowInfo");
        var fichier = new ByteArrayContent(f.Contenu);
        fichier.Headers.ContentType = new MediaTypeHeaderValue(f.Syntaxe == Syntaxe.FacturX ? "application/pdf" : "application/xml");
        corps.Add(fichier, "file", f.Nom);

        var json = await EnvoyerJsonAsync(HttpMethod.Post, AdresseFlux("v1/flows"), corps, ct);
        var o = Objet(json.Noeud, json.RequestId);
        var depose = new FluxDepose(
            Texte(o, "flowId", json.RequestId)!, Date(o, "submittedAt", json.RequestId)!.Value, Texte(o, "trackingId"),
            Texte(o, "name") ?? f.Nom, Texte(o, "flowSyntax") ?? f.Syntaxe)
        {
            Profil = Texte(o, "flowProfile"), RegleTraitement = Texte(o, "processingRule"), Empreinte = Texte(o, "sha256") ?? p.Empreinte,
        };
        if (depose.Empreinte != p.Empreinte) throw Illisible("empreinte sha256 différente de celle du fichier déposé", json.RequestId);
        return depose;
    }

    protected override async Task<PageFlux> RechercherFluxAsync(CriteresFlux c, string? curseur, int limite, CancellationToken ct)
    {
        var ou = new JsonObject();
        if (c.ModifieApres is { } apres) ou["updatedAfter"] = DateIso(apres);
        if (c.ModifieAvant is { } avant) ou["updatedBefore"] = DateIso(avant);
        if (c.Regles.Count > 0) ou["processingRule"] = Tableau(c.Regles);
        if (c.Types.Count > 0) ou["flowType"] = Tableau(c.Types);
        if (c.Sens.Count > 0) ou["flowDirection"] = Tableau(c.Sens);
        if (c.IdentifiantSuivi is not null) ou["trackingId"] = c.IdentifiantSuivi;
        if (c.EtatAccuse is not null) ou["ackStatus"] = c.EtatAccuse;
        var demande = new JsonObject { ["limit"] = limite };
        if (curseur is not null) demande["cursor"] = curseur;
        demande["where"] = ou;

        var json = await EnvoyerJsonAsync(HttpMethod.Post, AdresseFlux("v1/flows/search"), Json(demande), ct);
        var o = Objet(json.Noeud, json.RequestId);
        var resultats = o["results"] is JsonArray a ? a.Select(n => LireFlux(Objet(n, json.RequestId), json.RequestId)).ToList() : [];
        return new PageFlux(resultats, Texte(o, "nextCursor") is { Length: > 0 } suivant ? suivant : null);
    }

    protected override async Task<Flux> LireFluxAsync(string idFlux, CancellationToken ct)
    {
        var json = await EnvoyerJsonAsync(HttpMethod.Get, AdresseDocument(idFlux, TypeDocumentFlux.Metadonnees), null, ct);
        return LireFlux(Objet(json.Noeud, json.RequestId), json.RequestId);
    }

    protected override async Task<FichierFlux> TelechargerFluxAsync(string idFlux, string typeDocument, CancellationToken ct)
    {
        var (reponse, requestId) = await EnvoyerAsync(HttpMethod.Get, AdresseDocument(idFlux, typeDocument), null, ct);
        using (reponse)
        {
            var contenu = await reponse.Content.ReadAsByteArrayAsync(ct);
            var disposition = reponse.Content.Headers.ContentDisposition;
            var nom = (disposition?.FileNameStar ?? disposition?.FileName)?.Trim('"');
            return new FichierFlux(contenu, nom, reponse.Content.Headers.ContentType?.MediaType);
        }
    }

    protected override async Task<Abonnement> AbonnerFluxAsync(DemandeAbonnement d, CancellationToken ct)
    {
        var demande = new JsonObject { ["callbackUrl"] = d.AdresseRappel.ToString() };
        if (d.Types.Count > 0) demande["flowTypes"] = Tableau(d.Types);
        if (d.Sens is not null) demande["flowDirection"] = d.Sens;
        if (d.EtatAccuse is not null) demande["ackStatus"] = d.EtatAccuse;
        var json = await EnvoyerJsonAsync(HttpMethod.Post, AdresseFlux("v1/webhooks"), Json(demande), ct);
        var o = Objet(json.Noeud, json.RequestId);
        return new Abonnement(Texte(o, "webhookId", json.RequestId)!, Texte(o, "signingKey"), Date(o, "createdAt"));
    }

    protected override async Task VerifierSanteAsync(CancellationToken ct)
    {
        var (reponse, _) = await EnvoyerAsync(HttpMethod.Get, AdresseFlux("v1/healthcheck"), null, ct);
        reponse.Dispose();
    }

    // ---------------------------------------------------------------- Directory Service

    protected override async Task<UniteLegale> LireUniteLegaleAsync(string siren, CancellationToken ct) =>
        LireUniteLegale(await ObjetAnnuaireAsync($"v1/siren/code-insee:{siren}", ct))!;

    protected override async Task<Etablissement> LireEtablissementAsync(string siret, CancellationToken ct) =>
        LireEtablissement(await ObjetAnnuaireAsync($"v1/siret/code-insee:{siret}?include=siren", ct))!;

    protected override async Task<CodeRoutage> LireCodeRoutageAsync(string siret, string identifiant, CancellationToken ct) =>
        LireCodeRoutage(await ObjetAnnuaireAsync($"v1/routing-code/siret:{siret}/code:{Uri.EscapeDataString(identifiant)}", ct))!;

    protected override async Task<LigneAnnuaire> LireLigneAnnuaireAsync(string identifiant, CancellationToken ct) =>
        LireLigne(await ObjetAnnuaireAsync($"v1/directory-line/code:{Uri.EscapeDataString(identifiant)}?include=siren,siret,routingCode", ct));

    protected override Task<ResultatsAnnuaire<UniteLegale>> ChercherUnitesLegalesAsync(RechercheAnnuaire r, CancellationToken ct) =>
        ChercherAsync("v1/siren/search", r, null, o => LireUniteLegale(o)!, ct);

    protected override Task<ResultatsAnnuaire<Etablissement>> ChercherEtablissementsAsync(RechercheAnnuaire r, CancellationToken ct) =>
        ChercherAsync("v1/siret/search", r, ["siren"], o => LireEtablissement(o)!, ct);

    protected override Task<ResultatsAnnuaire<CodeRoutage>> ChercherCodesRoutageAsync(RechercheAnnuaire r, CancellationToken ct) =>
        ChercherAsync("v1/routing-code/search", r, null, o => LireCodeRoutage(o)!, ct);

    protected override Task<ResultatsAnnuaire<LigneAnnuaire>> ChercherLignesAnnuaireAsync(RechercheAnnuaire r, CancellationToken ct) =>
        ChercherAsync("v1/directory-line/search", r, ["siren", "siret", "routingCode"], LireLigne, ct);

    private async Task<JsonObject> ObjetAnnuaireAsync(string chemin, CancellationToken ct)
    {
        var json = await EnvoyerJsonAsync(HttpMethod.Get, AdresseAnnuaire(chemin), null, ct);
        return Objet(json.Noeud, json.RequestId);
    }

    private async Task<ResultatsAnnuaire<T>> ChercherAsync<T>(
        string chemin, RechercheAnnuaire r, string[]? inclure, Func<JsonObject, T> lire, CancellationToken ct)
    {
        var filtres = new JsonObject();
        foreach (var f in r.Filtres) filtres[f.Champ] = new JsonObject { ["op"] = f.Operateur, ["value"] = f.Valeur };
        var demande = new JsonObject { ["filters"] = filtres };
        if (inclure is not null) demande["include"] = Tableau(inclure);
        if (r.Limite is { } l) demande["limit"] = l;
        if (r.Ignorer is { } i) demande["ignore"] = i;
        var json = await EnvoyerJsonAsync(HttpMethod.Post, AdresseAnnuaire(chemin), Json(demande), ct);
        var o = Objet(json.Noeud, json.RequestId);
        var resultats = o["results"] is JsonArray a ? a.Select(n => lire(Objet(n, json.RequestId))).ToList() : [];
        return new ResultatsAnnuaire<T>(o["totalNumberOfResults"]?.GetValue<int>() ?? resultats.Count, resultats);
    }

    // ---------------------------------------------------------------- adresses et requêtes (surchargeables)

    /// <summary>Adresse d'une opération du Flow Service (chemin relatif « v1/… »).</summary>
    protected virtual Uri AdresseFlux(string chemin) => Combiner(Parametres.AdresseFlux, chemin, "Flow Service");

    /// <summary>Adresse d'une opération du Directory Service (chemin relatif « v1/… »).</summary>
    protected virtual Uri AdresseAnnuaire(string chemin) => Combiner(Parametres.AdresseAnnuaire, chemin, "Directory Service");

    private Uri AdresseDocument(string idFlux, string typeDocument) =>
        AdresseFlux($"v1/flows/{Uri.EscapeDataString(idFlux)}?docType={typeDocument}");

    /// <summary>En-têtes d'une requête : jeton Bearer, Request-Id, Organization-Id. Une PA peut en ajouter.</summary>
    protected virtual async Task PreparerAsync(HttpRequestMessage requete, string requestId, CancellationToken ct)
    {
        if (jetons is null || Parametres.ConnexionOAuth is not { } connexion)
            throw new ExceptionConnecteur(ErreurFe.ParametreConnecteur, "Connexion OAuth du connecteur non renseignée");
        var jeton = await jetons.JetonAsync(connexion, ct);
        requete.Headers.Authorization = new AuthenticationHeaderValue("Bearer", jeton.Jeton);
        requete.Headers.Add("Request-Id", requestId);
        if (!string.IsNullOrWhiteSpace(Parametres.Organisation)) requete.Headers.Add("Organization-Id", Parametres.Organisation);
    }

    /// <summary>Erreur d'une réponse non réussie : code du statut, errorCode et errorMessage (Error, application/json ou problem+json).</summary>
    protected virtual async Task<ExceptionConnecteur> ErreurAsync(HttpResponseMessage reponse, string requestId, CancellationToken ct)
    {
        var statut = (int)reponse.StatusCode;
        string? codePlateforme = null, message = null;
        try
        {
            var octets = await reponse.Content.ReadAsByteArrayAsync(ct);
            if (octets.Length is > 0 and <= TailleErreur && JsonNode.Parse(octets) is JsonObject o)
            {
                codePlateforme = Texte(o, "errorCode");
                message = Texte(o, "errorMessage") ?? Texte(o, "details");
            }
        }
        catch (JsonException)
        {
            // Corps non JSON : seul le statut compte.
        }
        var texte = $"Plateforme : {statut} {codePlateforme}{(message is null ? "" : " — " + Masquage.Texte(message))}".TrimEnd();
        return new ExceptionConnecteur(ExceptionConnecteur.CodeDuStatut(statut), texte, statut, codePlateforme, requestId);
    }

    /// <summary>Envoie une requête (délai des paramètres) et rend la réponse réussie ; lève l'erreur traduite sinon.</summary>
    protected async Task<(HttpResponseMessage Reponse, string RequestId)> EnvoyerAsync(HttpMethod methode, Uri adresse, HttpContent? corps, CancellationToken ct)
    {
        var requestId = Guid.NewGuid().ToString();
        using var requete = new HttpRequestMessage(methode, adresse) { Content = corps };
        await PreparerAsync(requete, requestId, ct);
        using var delai = CancellationTokenSource.CreateLinkedTokenSource(ct);
        delai.CancelAfter(Parametres.Delai);
        var chrono = Stopwatch.StartNew();
        HttpResponseMessage reponse;
        try
        {
            reponse = await Http.SendAsync(requete, HttpCompletionOption.ResponseHeadersRead, delai.Token);
        }
        catch (OperationCanceledException) when (!ct.IsCancellationRequested)
        {
            Journaliser(methode, adresse, null, requestId, chrono.Elapsed);
            throw new ExceptionConnecteur(ErreurFe.DelaiDepasse, "Plateforme : délai d'attente dépassé", requestId: requestId);
        }
        catch (HttpRequestException e)
        {
            Journaliser(methode, adresse, null, requestId, chrono.Elapsed);
            throw new ExceptionConnecteur(ErreurFe.PlateformeIndisponible, $"Plateforme injoignable : {Masquage.Texte(e.Message)}", requestId: requestId);
        }
        Journaliser(methode, adresse, (int)reponse.StatusCode, requestId, chrono.Elapsed);
        if (reponse.IsSuccessStatusCode) return (reponse, requestId);
        using (reponse) throw await ErreurAsync(reponse, requestId, ct);
    }

    private async Task<(JsonNode? Noeud, string RequestId)> EnvoyerJsonAsync(HttpMethod methode, Uri adresse, HttpContent? corps, CancellationToken ct)
    {
        var (reponse, requestId) = await EnvoyerAsync(methode, adresse, corps, ct);
        using (reponse)
        {
            try
            {
                return (JsonNode.Parse(await reponse.Content.ReadAsStreamAsync(ct)), requestId);
            }
            catch (JsonException)
            {
                throw Illisible("JSON attendu", requestId);
            }
        }
    }

    private void Journaliser(HttpMethod methode, Uri adresse, int? statut, string requestId, TimeSpan duree) =>
        journal?.LogInformation("Connecteur {Connecteur} : {Methode} {Chemin} → {Statut} (Request-Id {RequestId}, {Duree} ms)",
            Code, methode.Method, adresse.AbsolutePath, statut?.ToString(CultureInfo.InvariantCulture) ?? "sans réponse", requestId,
            (long)duree.TotalMilliseconds);

    private static Uri Combiner(Uri? base_, string chemin, string service)
    {
        if (base_ is null || !base_.IsAbsoluteUri)
            throw new ExceptionConnecteur(ErreurFe.ParametreConnecteur, $"Adresse du {service} non renseignée");
        var texte = base_.ToString();
        return new Uri(texte.EndsWith('/') ? texte + chemin : texte + "/" + chemin);
    }

    // ---------------------------------------------------------------- lecture JSON

    private static Flux LireFlux(JsonObject o, string requestId)
    {
        var accuse = o["acknowledgement"] as JsonObject ?? throw Illisible("flux sans accusé", requestId);
        var details = accuse["details"] is JsonArray a
            ? a.Select(n => Objet(n, requestId)).Select(d => new DetailAccuse(
                Texte(d, "level") ?? NiveauAccuse.Erreur, Texte(d, "item") ?? "", Texte(d, "reasonCode") ?? "", Texte(d, "reasonMessage") ?? "")).ToList()
            : [];
        return new Flux(
            Texte(o, "flowId", requestId)!, Texte(o, "trackingId"), Texte(o, "name") ?? "", Texte(o, "flowSyntax", requestId)!,
            Texte(o, "flowProfile") ?? ProfilFacture.NonDefini, Texte(o, "processingRule") ?? RegleTraitement.NonDefini,
            Texte(o, "processingRuleSource") ?? OrigineRegle.Calculee, Texte(o, "flowType", requestId)!, Texte(o, "flowDirection", requestId)!,
            Date(o, "submittedAt", requestId)!.Value, Date(o, "updatedAt", requestId)!.Value,
            new AccuseFlux(Texte(accuse, "status", requestId)!, details))
        { Empreinte = Texte(o, "sha256") };
    }

    private static UniteLegale? LireUniteLegale(JsonObject? o) => o is null ? null
        : new UniteLegale(Texte(o, "siren") ?? "", Texte(o, "businessName"), Texte(o, "entityType"), Texte(o, "administrativeStatus"));

    private static Etablissement? LireEtablissement(JsonObject? o)
    {
        if (o is null) return null;
        var b2g = o["b2gAdditionalData"] as JsonObject;
        return new Etablissement(
            Texte(o, "siret") ?? "", Texte(o, "siren"), Texte(o, "name"), Texte(o, "facilityType"), Texte(o, "administrativeStatus"),
            LireAdresse(o["address"] as JsonObject),
            b2g is null ? null : new DonneesB2g(Booleen(b2g, "pm"), Booleen(b2g, "pmOnly"), Booleen(b2g, "managesPaymentStatus"),
                Booleen(b2g, "managesLegalCommitmentCode"), Booleen(b2g, "managesLegalCommitmentOrServiceCode"), Booleen(b2g, "serviceCodeStatus")),
            LireUniteLegale(o["legalUnit"] as JsonObject));
    }

    private static CodeRoutage? LireCodeRoutage(JsonObject? o) => o is null ? null
        : new CodeRoutage(Texte(o, "routingIdentifier") ?? "", Texte(o, "siret"), Texte(o, "routingIdentifierType"), Texte(o, "routingCodeName"),
            Booleen(o, "managesLegalCommitmentCode") ?? Booleen(o, "managesLegalCommitment"), Texte(o, "administrativeStatus"),
            LireAdresse(o["address"] as JsonObject));

    private static LigneAnnuaire LireLigne(JsonObject o) => new(
        Texte(o, "addressingIdentifier") ?? "", Texte(o, "platformType"), Texte(o, "directoryLineStatus"), Texte(o, "siren"),
        Texte(o, "siret"), Texte(o, "routingIdentifier"), Texte(o, "addressingSuffix"))
    {
        UniteLegale = LireUniteLegale(o["legalUnit"] as JsonObject),
        Etablissement = LireEtablissement(o["facility"] as JsonObject),
        CodeRoutage = LireCodeRoutage(o["routingCode"] as JsonObject),
    };

    private static AdresseAnnuaire? LireAdresse(JsonObject? o) => o is null ? null
        : new AdresseAnnuaire(Texte(o, "addressLine1"), Texte(o, "addressLine2"), Texte(o, "addressLine3"), Texte(o, "postalCode"),
            Texte(o, "countrySubdivision"), Texte(o, "locality"), Texte(o, "countryCode"), Texte(o, "countryName"));

    private static JsonObject Objet(JsonNode? n, string requestId) => n as JsonObject ?? throw Illisible("objet JSON attendu", requestId);

    /// <summary>Texte d'une propriété ; obligatoire si un Request-Id est donné (REPONSE_ILLISIBLE sinon).</summary>
    private static string? Texte(JsonObject o, string nom, string? requestId = null)
    {
        var n = o[nom];
        string? v = n is JsonValue j && j.TryGetValue<string>(out var s) ? s : null;
        if (v is null && requestId is not null) throw Illisible($"propriété {nom} absente", requestId);
        return v;
    }

    private static bool? Booleen(JsonObject o, string nom) => o[nom] is JsonValue j && j.TryGetValue<bool>(out var b) ? b : null;

    private static DateTimeOffset? Date(JsonObject o, string nom, string? requestId = null)
    {
        var t = Texte(o, nom, requestId);
        if (t is null) return null;
        return DateTimeOffset.TryParse(t, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal, out var d)
            ? d : throw Illisible($"date {nom} illisible", requestId);
    }

    private static string DateIso(DateTimeOffset d) => d.UtcDateTime.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", CultureInfo.InvariantCulture);

    private static JsonArray Tableau(IEnumerable<string> valeurs) => new(valeurs.Select(v => (JsonNode)JsonValue.Create(v)!).ToArray());

    private static StringContent Json(JsonObject o) => new(o.ToJsonString(), Encoding.UTF8, "application/json");
}
