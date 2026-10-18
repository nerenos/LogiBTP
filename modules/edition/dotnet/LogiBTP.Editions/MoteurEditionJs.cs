using System.Diagnostics;
using System.Reflection;
using Jint;
using Jint.Native;

namespace LogiBTP.Editions;

/// <summary>Face de police chargée dans le moteur (famille, graisse, italique, octets du fichier TTF).</summary>
public sealed record FaceEdition(string Famille, int Graisse, bool Italique, byte[] Octets);

/// <summary>PDF produit : octets, nombre de pages, alertes (JSON), durée.</summary>
public sealed record PdfEdition(byte[] Octets, int Pages, string AlertesJson, TimeSpan Duree, string ChronosJson = "{}");

/// <summary>
/// Moteur d'édition JS (même script que le navigateur) exécuté dans Jint. Une instance n'est pas réentrante : le
/// <see cref="PoolMoteursEdition"/> en prête une par production.
/// </summary>
public sealed class MoteurEditionJs
{
    private readonly Engine _engine;
    private readonly JsValue _api;

    public MoteurEditionJs(string script, IEnumerable<FaceEdition> faces, TimeSpan? delai = null)
    {
        _engine = new Engine(o => o.TimeoutInterval(delai ?? TimeSpan.FromMinutes(5)).Strict(false));
        // Compression zlib des flux du PDF par .NET (pako est lent dans Jint).
        _engine.SetValue("__deflate", new Func<JsValue, JsValue>(o =>
        {
            using var sortie = new MemoryStream();
            using (var z = new System.IO.Compression.ZLibStream(sortie, System.IO.Compression.CompressionLevel.Optimal, true))
                z.Write(o.AsUint8Array());
            return _engine.Intrinsics.Uint8Array.Construct(sortie.ToArray());
        }));
        _engine.Execute(script);
        _api = _engine.GetValue("LogiBTPEdition");
        var liste = new JsArray(_engine);
        uint i = 0;
        foreach (var f in faces)
        {
            var o = new JsObject(_engine);
            o.Set("famille", f.Famille);
            o.Set("graisse", f.Graisse);
            o.Set("italique", f.Italique);
            o.Set("octets", _engine.Intrinsics.Uint8Array.Construct(f.Octets));
            liste.Set(i++, o);
        }
        Appeler("initialiser", liste);
    }

    /// <summary>Script embarqué du moteur (paquet construit par esbuild).</summary>
    public static string ScriptEmbarque()
    {
        using var flux = Assembly.GetExecutingAssembly().GetManifestResourceStream("moteur-edition.js")
            ?? throw new InvalidOperationException("Paquet du moteur d'édition absent (npm run construire --workspace modules/edition/js)");
        using var lecteur = new StreamReader(flux);
        return lecteur.ReadToEnd();
    }

    /// <summary>Faces livrées avec le module (dossier polices de l'application).</summary>
    public static List<FaceEdition> FacesLivrees(string? dossier = null)
    {
        dossier ??= Path.Combine(AppContext.BaseDirectory, "polices");
        FaceEdition F(string famille, int g, bool i, string fichier) => new(famille, g, i, File.ReadAllBytes(Path.Combine(dossier, fichier)));
        return
        [
            F("Inter", 400, false, "inter/Inter-Regular.ttf"), F("Inter", 400, true, "inter/Inter-Italic.ttf"),
            F("Inter", 500, false, "inter/Inter-Medium.ttf"), F("Inter", 500, true, "inter/Inter-MediumItalic.ttf"),
            F("Inter", 600, false, "inter/Inter-SemiBold.ttf"), F("Inter", 600, true, "inter/Inter-SemiBoldItalic.ttf"),
            F("Inter", 700, false, "inter/Inter-Bold.ttf"), F("Inter", 700, true, "inter/Inter-BoldItalic.ttf"),
            F("Libre Barcode 39", 400, false, "libre-barcode-39/LibreBarcode39-Regular.ttf"),
        ];
    }

    private JsValue Appeler(string fonction, params JsValue[] args) =>
        _engine.Invoke(_api.Get(fonction), _api, args);

    /// <summary>Arbre de pages (JSON) : { pages, alertes, page }.</summary>
    public string Pages(string modeleJson, string donneesJson, string envJson) =>
        Appeler("pages", modeleJson, donneesJson, envJson).AsString();

    /// <summary>PDF de l'édition (env : charte, blocs, rapports, parametres, format, ressources, pdf { titre, auteur, date }).</summary>
    public PdfEdition Pdf(string modeleJson, string donneesJson, string envJson)
    {
        var sw = Stopwatch.StartNew();
        var r = Appeler("pdf", modeleJson, donneesJson, envJson).UnwrapIfPromise();
        var octets = r.AsUint8Array();
        var alertes = _api.Get("derniereAlertes").AsString();
        var pages = (int)_api.Get("dernieresPages").AsNumber();
        return new PdfEdition(octets, pages, alertes, sw.Elapsed, _api.Get("derniersChronos").AsString());
    }

    public string VerifierModele(string modeleJson) => Appeler("verifierModele", modeleJson).AsString();
    public string Dependances(string modeleJson) => Appeler("dependances", modeleJson).AsString();
    public string LireImage(byte[] octets) => Appeler("lireImage", _engine.Intrinsics.Uint8Array.Construct(octets)).AsString();
}

/// <summary>
/// Moteurs d'édition prêtés à la demande (Jint n'est pas réentrant) : au plus <c>taille</c> instances, créées à la
/// première demande (≈ 3 s : script et polices), réutilisées ensuite.
/// </summary>
public sealed class PoolMoteursEdition(int taille = 2) : IDisposable
{
    private readonly SemaphoreSlim _places = new(taille, taille);
    private readonly Stack<MoteurEditionJs> _libres = new();
    private readonly Lock _verrou = new();
    private readonly Lazy<string> _script = new(MoteurEditionJs.ScriptEmbarque);
    private readonly Lazy<List<FaceEdition>> _faces = new(() => MoteurEditionJs.FacesLivrees());

    public async Task<T> ExecuterAsync<T>(Func<MoteurEditionJs, T> action, CancellationToken ct = default)
    {
        await _places.WaitAsync(ct);
        MoteurEditionJs? moteur = null;
        try
        {
            lock (_verrou) _libres.TryPop(out moteur);
            moteur ??= await Task.Run(() => new MoteurEditionJs(_script.Value, _faces.Value), ct);
            var r = await Task.Run(() => action(moteur), ct);
            lock (_verrou) _libres.Push(moteur);
            return r;
        }
        catch
        {
            // Moteur dans un état inconnu après une erreur : abandonné (un nouveau sera créé).
            throw;
        }
        finally
        {
            _places.Release();
        }
    }

    public void Dispose() => _places.Dispose();
}
