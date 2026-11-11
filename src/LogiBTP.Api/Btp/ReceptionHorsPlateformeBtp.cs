using LogiBTP.FactureElectronique;
using LogiBTP.FactureElectronique.Web;
using LogiBTP.Mail.Web;
using LogiBTP.Socle.Web;

namespace LogiBTP.Api.Btp;

/// <summary>Demande « Créer la facture » depuis une pièce jointe d'un courriel reçu : référence de la pièce (ged:&lt;id&gt;).</summary>
public sealed record DemandeFactureCourriel(string Reference);

/// <summary>
/// Réception hors plateforme (plans/facturation-electronique.md, lot 14) : Factur-X (PDF) ou XML CII / UBL reçu en dehors
/// de toute plateforme, traité comme un flux reçu (sens In, connecteur MANUEL, <see cref="ReceptionFactureBtp"/>) sans
/// statut envoyé. Glisser-déposer sur la liste des factures à traiter ou sur une facture d'achat : route du module
/// <c>POST /api/facture-electronique/import</c> avec <c>hors_plateforme</c> ; pièce jointe d'un courriel reçu : route du
/// cœur ci-dessous (courriel lisible par l'utilisateur, pièce du courriel, droit Modifier du nœud facture_electronique).
/// </summary>
public static class ReceptionHorsPlateformeBtp
{
    /// <summary>Facture d'une pièce jointe d'un courriel reçu : même traitement qu'une facture glissée ; flux du module rendu.</summary>
    public static async Task<FluxDto> DepuisCourrielAsync(long courriel, string reference, Utilisateur u, IServiceProvider services, CancellationToken ct)
    {
        var detail = await services.GetRequiredService<ServiceEnvoiMail>().MessageAsync(u, courriel, ct);
        if (detail.Message.Sens != "R") throw ExceptionMetier.Invalide(ErreurFe.DemandeInvalide, "Seul un courriel reçu propose de créer la facture");
        var piece = detail.Pieces.FirstOrDefault(p => p.Reference == reference) ?? throw ExceptionMetier.Introuvable("Pièce jointe");
        if (!ReglesReception.EstFichierFacture(piece.Nom, piece.Type))
            throw ExceptionMetier.Invalide(ErreurFe.DemandeInvalide, $"{piece.Nom} : Factur-X (PDF) ou XML CII / UBL attendu");
        var contenu = await services.GetRequiredService<SpecialisationMail>().LirePieceAsync(piece.Reference, ct) ?? throw ExceptionMetier.Introuvable("Pièce jointe");
        return await services.GetRequiredService<ServiceFactureElectronique>()
            .ImporterHorsPlateformeAsync(contenu.Octets, piece.Nom, new { courriel, piece = piece.Reference }, u, ct);
    }

    /// <summary>Route du cœur, sous le groupe du module (activation exigée) : POST /facture-electronique/courriels/{id}/facture.</summary>
    public static RouteGroupBuilder MapReceptionHorsPlateforme(this RouteGroupBuilder api)
    {
        api.MapPost("/facture-electronique/courriels/{id:long}/facture", (long id, DemandeFactureCourriel d, HttpContext http, CancellationToken ct) =>
            DepuisCourrielAsync(id, d.Reference, Utilisateur.Depuis(http), http.RequestServices, ct));
        return api;
    }
}
