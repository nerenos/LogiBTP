using LogiBTP.Socle.Web;
using Microsoft.EntityFrameworkCore;

namespace LogiBTP.Crm.Web;

/// <summary>Pièce d'un élément du fil (document ou photo de la GED).</summary>
public sealed record PieceFil(long Id, string Titre, bool Image, string? Url, string? Contenu);

/// <summary>
/// Élément du fil : genre NOTE, DOCUMENT, PHOTOS (photos déposées ensemble) ou EVENEMENT ; date, auteur, titre, texte
/// (message de la note), élément décrit, page, note (réponses), pièces.
/// </summary>
public sealed record ElementFil(string Genre, DateTimeOffset Quand, string? Par, string Titre, string? Texte, ElementDecrit? Element, string? Url, long? NoteId,
    int NbReponses, List<PieceFil> Pieces);

/// <summary>Lot du fil : éléments du plus récent au plus ancien ; suivant = date à passer en « avant » pour le lot suivant (nul : fin).</summary>
public sealed record LotFil(List<ElementFil> Elements, DateTimeOffset? Suivant);

/// <summary>
/// Fil d'actualité (lot 5) : notes cochées « Dans le fil » (jamais privées ni RGPD), documents et photos de la GED
/// fournis par l'application, événements des modules ; périmètre agrégé vers le haut (spécialisation) ; chargement par
/// lots ; photos déposées ensemble (même élément, même auteur, moins de 10 minutes) regroupées.
/// </summary>
public partial class ServiceCrm
{
    public static readonly string[] GenresFil = ["NOTE", "DOCUMENT", "PHOTO", "EVENEMENT"];

    /// <summary>Événement publié dans le fil de l'élément (sans effet si l'élément manque).</summary>
    public async Task PublierAsync(string type, string? typeElement, string? idElement, string libelle, string? url, string? par, CancellationToken ct)
    {
        if (string.IsNullOrEmpty(typeElement) || string.IsNullOrEmpty(idElement)) return;
        db.Evenements.Add(new CrmEvenement
        {
            EveType = type, EveTypeElement = typeElement, EveIdElement = idElement, EveLibelle = libelle.Length > 300 ? libelle[..300] : libelle, EveUrl = url,
            EveQuand = DateTimeOffset.UtcNow, EvePar = par,
        });
        await db.SaveChangesAsync(ct);
    }

    public async Task<LotFil> Fil(string? typeElement, string? idElement, DateTimeOffset? avant, int taille, string? genres, Utilisateur u, CancellationToken ct)
    {
        taille = Math.Clamp(taille, 5, 100);
        var voulus = string.IsNullOrWhiteSpace(genres) ? [.. GenresFil] : genres.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries).ToHashSet();
        var global = string.IsNullOrEmpty(typeElement) || string.IsNullOrEmpty(idElement);
        List<ElementCrm> perimetre = global ? [] : await specialisation.PerimetreAsync(db, new ElementCrm(typeElement!, idElement!), ct);
        // Éléments du CRM rattachés au périmètre (plans, bordereaux, demandes transformées en projet) : leurs notes et événements aussi.
        if (!global)
        {
            var couples = perimetre.Select(e => e.Type + "|" + e.Id).ToList();
            var plans = await db.Plans.AsNoTracking().Where(p => p.PlaTypeElement != null && couples.Contains(p.PlaTypeElement + "|" + p.PlaIdElement)).Select(p => p.PlaId).ToListAsync(ct);
            var diffusions = await db.Diffusions.AsNoTracking().Where(d => d.DifTypeElement != null && couples.Contains(d.DifTypeElement + "|" + d.DifIdElement)).Select(d => d.DifId).ToListAsync(ct);
            var demandes = await db.Demandes.AsNoTracking().Where(d => d.DemCibleType != null && couples.Contains(d.DemCibleType + "|" + d.DemCibleId)).Select(d => d.DemId).ToListAsync(ct);
            perimetre.AddRange(plans.Select(x => new ElementCrm("crm_plan", x.ToString())));
            perimetre.AddRange(diffusions.Select(x => new ElementCrm("crm_diffusion", x.ToString())));
            perimetre.AddRange(demandes.Select(x => new ElementCrm("crm_demande", x.ToString())));
        }
        var cles = perimetre.Select(e => e.Type + "|" + e.Id).Distinct().ToList();
        var limite = avant ?? DateTimeOffset.MaxValue;
        var elements = new List<ElementFil>();

        if (voulus.Contains("NOTE"))
        {
            var q = db.Notes.AsNoTracking().Where(n => n.NotDansFil && !n.NotPrive && !n.NotRgpd && n.NotArchiveeLe == null && n.NotParentId == null && n.NotCreeLe < limite);
            if (!global) q = q.Where(n => db.Liens.Any(l => l.NliNotId == n.NotId && cles.Contains(l.NliTypeElement + "|" + l.NliIdElement)));
            var notes = await q.OrderByDescending(n => n.NotCreeLe).Take(taille).ToListAsync(ct);
            var ids = notes.Select(n => n.NotId).ToList();
            var principaux = await db.Liens.AsNoTracking().Where(l => ids.Contains(l.NliNotId)).ToListAsync(ct);
            var parNote = principaux.GroupBy(l => l.NliNotId).ToDictionary(g => g.Key, g => g.OrderByDescending(l => l.NliPrincipal).First());
            var decrits = (await DecrireAsync(parNote.Values.Select(l => new ElementCrm(l.NliTypeElement, l.NliIdElement)).ToList(), ct)).ToDictionary(e => (e.Type, e.Id));
            var reponses = await db.Notes.AsNoTracking().Where(n => n.NotParentId != null && ids.Contains(n.NotParentId.Value))
                .GroupBy(n => n.NotParentId!.Value).Select(g => new { g.Key, Nb = g.Count() }).ToDictionaryAsync(x => x.Key, x => x.Nb, ct);
            var pieces = (await specialisation.DocumentsAsync(db, ids.Select(i => new ElementCrm("crm_note", i.ToString())).ToList(), null, 200, ct))
                .GroupBy(d => d.Element.Id).ToDictionary(g => g.Key, g => g.OrderBy(d => d.Quand).Select(d => new PieceFil(d.Id, d.Titre, d.Image, d.Url, d.Contenu)).ToList());
            elements.AddRange(notes.Select(n => new ElementFil("NOTE", n.NotCreeLe, n.NotCreePar, n.NotObjet, n.NotMessageHtml,
                parNote.TryGetValue(n.NotId, out var l) ? decrits.GetValueOrDefault((l.NliTypeElement, l.NliIdElement)) : null, $"/crm/note/{n.NotId}", n.NotId,
                reponses.GetValueOrDefault(n.NotId), pieces.GetValueOrDefault(n.NotId.ToString()) ?? [])));
        }

        if (!global && (voulus.Contains("DOCUMENT") || voulus.Contains("PHOTO")))
        {
            var docs = await specialisation.DocumentsAsync(db, perimetre.Where(e => !e.Type.StartsWith("crm_")).ToList(), avant, taille, ct);
            docs = docs.Where(d => d.Image ? voulus.Contains("PHOTO") : voulus.Contains("DOCUMENT")).ToList();
            var decrits = (await DecrireAsync(docs.Select(d => d.Element).Distinct().ToList(), ct)).ToDictionary(e => (e.Type, e.Id));
            // Photos déposées ensemble : même élément, même auteur, moins de 10 minutes d'écart.
            var groupes = new List<List<DocumentFil>>();
            foreach (var d in docs.OrderByDescending(d => d.Quand))
            {
                var dernier = groupes.LastOrDefault();
                if (d.Image && dernier is not null && dernier[^1].Image && dernier[^1].Element == d.Element && dernier[^1].Par == d.Par
                    && (dernier[^1].Quand - d.Quand).TotalMinutes < 10) dernier.Add(d);
                else groupes.Add([d]);
            }
            elements.AddRange(groupes.Select(g => new ElementFil(g[0].Image ? "PHOTOS" : "DOCUMENT", g[0].Quand, g[0].Par,
                g[0].Image ? (g.Count > 1 ? $"{g.Count} photos" : g[0].Titre) : g[0].Titre, null, decrits.GetValueOrDefault((g[0].Element.Type, g[0].Element.Id)),
                g[0].Url, null, 0, g.Select(d => new PieceFil(d.Id, d.Titre, d.Image, d.Url, d.Contenu)).ToList())));
        }

        if (voulus.Contains("EVENEMENT"))
        {
            var q = db.Evenements.AsNoTracking().Where(e => e.EveQuand < limite);
            if (!global) q = q.Where(e => cles.Contains(e.EveTypeElement + "|" + e.EveIdElement));
            var evenements = await q.OrderByDescending(e => e.EveQuand).Take(taille).ToListAsync(ct);
            var decrits = (await DecrireAsync(evenements.Select(e => new ElementCrm(e.EveTypeElement, e.EveIdElement)).Distinct().ToList(), ct)).ToDictionary(e => (e.Type, e.Id));
            elements.AddRange(evenements.Select(e => new ElementFil("EVENEMENT", e.EveQuand, e.EvePar, e.EveLibelle, null,
                decrits.GetValueOrDefault((e.EveTypeElement, e.EveIdElement)), e.EveUrl, null, 0, [])));
        }

        var lot = elements.OrderByDescending(e => e.Quand).Take(taille).ToList();
        return new LotFil(lot, lot.Count == taille ? lot[^1].Quand : null);
    }
}
