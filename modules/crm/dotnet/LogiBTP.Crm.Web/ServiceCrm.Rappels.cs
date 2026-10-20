using System.Text.Json;
using LogiBTP.Crm;
using LogiBTP.Socle.Web;
using Microsoft.EntityFrameworkCore;

namespace LogiBTP.Crm.Web;

/// <summary>Paramètres du module : seuils des couleurs des rappels (jours avant l'échéance).</summary>
public sealed record ParametresCrm(SeuilsRappel Seuils);

/// <summary>Rappel saisi : type DATE ou AVANT, date, délai en jours, individu (nul : pour moi).</summary>
public sealed record RappelSaisi(string Type, DateTimeOffset? Quand, int? DelaiJours, long? IndId);

/// <summary>Rappel lu : saisie, destinataire, auteur, traité, état calculé (couleur, visible, référence), note résumée.</summary>
public sealed record RappelDto(long Id, long NoteId, string Type, DateTimeOffset? Quand, int? DelaiJours, long? IndId, string? Individu, string CreePar,
    DateTimeOffset? TraiteLe, bool Actif, bool Visible, string? Couleur, DateTimeOffset? Reference, NoteListe? Note);

/// <summary>Rappels des notes (lot 2) : paramètres, liste « mes rappels », rappels d'une note, ajout, modification, traitement.</summary>
public partial class ServiceCrm
{
    private const string CleSeuils = "seuils_rappel";

    public async Task<ParametresCrm> Parametres(CancellationToken ct)
    {
        var p = await db.Parametres.AsNoTracking().FirstOrDefaultAsync(x => x.CpaCle == CleSeuils, ct);
        return new ParametresCrm(p?.CpaValeur.Deserialize<SeuilsRappel>(new JsonSerializerOptions(JsonSerializerDefaults.Web)) ?? new SeuilsRappel());
    }

    /// <summary>Seuils globaux (administrateur) : rouge ≥ 0, orange ≥ rouge.</summary>
    public async Task<ParametresCrm> EnregistrerParametres(ParametresCrm p, Utilisateur u, CancellationToken ct)
    {
        if (!u.EstAdmin) throw ExceptionMetier.AccesRefuse("PARAMETRER");
        if (p.Seuils.Rouge < 0 || p.Seuils.Orange < p.Seuils.Rouge) throw ExceptionMetier.Invalide("SEUILS_RAPPEL", "Seuils en jours : rouge positif ou nul, orange au moins égal au rouge");
        var valeur = JsonSerializer.SerializeToDocument(new { orange = p.Seuils.Orange, rouge = p.Seuils.Rouge });
        var e = await db.Parametres.FirstOrDefaultAsync(x => x.CpaCle == CleSeuils, ct);
        if (e is null) db.Parametres.Add(e = new CrmParametre { CpaCle = CleSeuils });
        e.CpaValeur = valeur;
        e.CpaMajLe = DateTimeOffset.UtcNow;
        e.CpaMajPar = u.Code;
        await db.SaveChangesAsync(ct);
        return await Parametres(ct);
    }

    /// <summary>
    /// Mes rappels actifs (pour mon individu, ou créés par moi sans individu) ; visibles seulement sauf tous : rouge,
    /// orange, vert, puis la référence la plus proche.
    /// </summary>
    public async Task<List<RappelDto>> MesRappels(bool tous, Utilisateur u, CancellationToken ct)
    {
        var c = await CourantAsync(u, ct);
        var ind = c.Ind ?? -1;
        var clos = ReglesNote.EtatsClos;
        var lignes = await (from r in db.Rappels.AsNoTracking()
                            join n in db.Notes.AsNoTracking() on r.RapNotId equals n.NotId
                            where r.RapTraiteLe == null && n.NotArchiveeLe == null && !clos.Contains(n.NotEtat)
                                  && (r.RapIndId == ind || (r.RapIndId == null && r.RapCreePar == u.Code))
                            select new { r, n }).Take(500).ToListAsync(ct);
        var notes = await EnListe(lignes.Select(x => x.n).DistinctBy(n => n.NotId).ToList(), c, false, ct);
        return await EnRappels(lignes.Select(x => (x.r, x.n)).ToList(), notes.ToDictionary(n => n.Id), ct, tous ? null : true);
    }

    /// <summary>Rappels d'une note (tous, avec leur état).</summary>
    public async Task<List<RappelDto>> RappelsNote(long note, CancellationToken ct)
    {
        var n = await db.Notes.AsNoTracking().FirstAsync(x => x.NotId == note, ct);
        var rappels = await db.Rappels.AsNoTracking().Where(r => r.RapNotId == note).OrderBy(r => r.RapCreeLe).ToListAsync(ct);
        return await EnRappels(rappels.Select(r => (r, n)).ToList(), [], ct, null);
    }

    private async Task<List<RappelDto>> EnRappels(List<(CrmRappel R, CrmNote N)> lignes, Dictionary<long, NoteListe> notes, CancellationToken ct, bool? visibles)
    {
        var seuils = (await Parametres(ct)).Seuils;
        var maintenant = DateTimeOffset.UtcNow;
        var noms = await specialisation.IndividusAsync(db, lignes.Where(x => x.R.RapIndId != null).Select(x => x.R.RapIndId!.Value).ToList(), ct);
        var rang = new Dictionary<string, int> { ["ROUGE"] = 0, ["ORANGE"] = 1, ["VERT"] = 2 };
        return lignes.Select(x =>
        {
            var e = ReglesRappel.Etat(new RappelAEvaluer(x.R.RapType, x.R.RapQuand, x.R.RapDelaiJours, x.R.RapTraiteLe), x.N.NotEtat, x.N.NotEcheance, seuils, maintenant);
            return new RappelDto(x.R.RapId, x.R.RapNotId, x.R.RapType, x.R.RapQuand, x.R.RapDelaiJours, x.R.RapIndId,
                x.R.RapIndId is long i ? noms.GetValueOrDefault(i) : null, x.R.RapCreePar, x.R.RapTraiteLe, e.Actif, e.Visible, e.Couleur, e.Reference,
                notes.GetValueOrDefault(x.N.NotId));
        }).Where(r => visibles is null || r.Visible == visibles)
          .OrderBy(r => rang.GetValueOrDefault(r.Couleur ?? "", 3)).ThenBy(r => r.Reference).ToList();
    }

    /// <summary>Note lisible par l'utilisateur (pas masquée), pour y poser ou lire des rappels.</summary>
    private async Task<(CrmNote Note, Courant C)> NoteLisibleAsync(long note, Utilisateur u, CancellationToken ct)
    {
        var c = await CourantAsync(u, ct);
        var n = await db.Notes.AsNoTracking().FirstOrDefaultAsync(x => x.NotId == note, ct) ?? throw ExceptionMetier.Introuvable($"Note {note}");
        var destinataire = c.Ind is long i && await db.Destinataires.AnyAsync(d => d.NdeNotId == note && d.NdeIndId == i, ct);
        if (Masque(n, c, destinataire) is not null) throw ExceptionMetier.AccesRefuse("LIRE");
        return (n, c);
    }

    private static void ControlerRappel(RappelSaisi s, CrmNote n)
    {
        var erreurs = ReglesRappel.Controler(new RappelAEvaluer(s.Type, s.Quand, s.DelaiJours), n.NotEtat, n.NotEcheance);
        if (erreurs.Count > 0) throw ExceptionMetier.Invalide("RAPPEL", string.Join(" ; ", erreurs.Select(e => ReglesRappel.Messages.GetValueOrDefault(e, e))), erreurs);
    }

    /// <summary>Ajout d'un rappel sur une note lisible ; pour un autre individu, il faut pouvoir modifier la note.</summary>
    public async Task<List<RappelDto>> AjouterRappel(long note, RappelSaisi s, Utilisateur u, CancellationToken ct)
    {
        var (n, c) = await NoteLisibleAsync(note, u, ct);
        ControlerRappel(s, n);
        var pour = s.IndId ?? c.Ind;
        if (pour != c.Ind)
        {
            var destinataire = c.Ind is long i && await db.Destinataires.AnyAsync(d => d.NdeNotId == note && d.NdeIndId == i, ct);
            if (!Droits(n, c, destinataire, null, false, false).Modifier) throw ExceptionMetier.AccesRefuse("MODIFIER");
        }
        db.Rappels.Add(new CrmRappel
        {
            RapNotId = note, RapType = s.Type, RapQuand = s.Type == "DATE" ? s.Quand : null, RapDelaiJours = s.Type == "AVANT" ? s.DelaiJours : null,
            RapIndId = pour, RapCreePar = u.Code, RapCreeLe = DateTimeOffset.UtcNow,
        });
        await db.SaveChangesAsync(ct);
        return await RappelsNote(note, ct);
    }

    private async Task<CrmRappel> RappelModifiableAsync(long id, Utilisateur u, CancellationToken ct)
    {
        var r = await db.Rappels.FirstOrDefaultAsync(x => x.RapId == id, ct) ?? throw ExceptionMetier.Introuvable($"Rappel {id}");
        var c = await CourantAsync(u, ct);
        if (!(u.EstAdmin || r.RapCreePar == u.Code || (c.Ind is long i && r.RapIndId == i))) throw ExceptionMetier.AccesRefuse("MODIFIER");
        return r;
    }

    public async Task<List<RappelDto>> ModifierRappel(long id, RappelSaisi s, Utilisateur u, CancellationToken ct)
    {
        var r = await RappelModifiableAsync(id, u, ct);
        var n = await db.Notes.AsNoTracking().FirstAsync(x => x.NotId == r.RapNotId, ct);
        ControlerRappel(s, n);
        r.RapType = s.Type;
        r.RapQuand = s.Type == "DATE" ? s.Quand : null;
        r.RapDelaiJours = s.Type == "AVANT" ? s.DelaiJours : null;
        if (s.IndId is not null) r.RapIndId = s.IndId;
        r.RapTraiteLe = null;
        await db.SaveChangesAsync(ct);
        return await RappelsNote(r.RapNotId, ct);
    }

    /// <summary>Rappel traité (« Fait ») : il ne paraît plus ; la note reste ouverte.</summary>
    public async Task<List<RappelDto>> TraiterRappel(long id, Utilisateur u, CancellationToken ct)
    {
        var r = await RappelModifiableAsync(id, u, ct);
        r.RapTraiteLe = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync(ct);
        return await RappelsNote(r.RapNotId, ct);
    }

    public async Task<List<RappelDto>> SupprimerRappel(long id, Utilisateur u, CancellationToken ct)
    {
        var r = await RappelModifiableAsync(id, u, ct);
        db.Rappels.Remove(r);
        await db.SaveChangesAsync(ct);
        return await RappelsNote(r.RapNotId, ct);
    }
}
