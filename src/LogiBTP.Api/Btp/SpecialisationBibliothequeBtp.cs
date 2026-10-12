using LogiBTP.Bibliotheque.Web;

namespace LogiBTP.Api.Btp;

/// <summary>Bibliothèque du cœur : les ouvrages se recalculent par le moteur de devis BTP (coefficients d'une période modifiés).</summary>
public sealed class SpecialisationBibliothequeBtp : SpecialisationBibliotheque
{
    public override void RecalculerOuvrage(Element ouvrage) => ElementsBibliotheque.RecalculerOuvrage(ouvrage);
}
