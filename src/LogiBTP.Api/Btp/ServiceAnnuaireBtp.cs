using LogiBTP.Annuaire.Web;
using LogiBTP.Socle.Web;

namespace LogiBTP.Api.Btp;

/// <summary>
/// Annuaire du cœur : les tiers et individus « à ne plus utiliser » (colonne <c>*_usage</c> = N, db/228) sont écartés des
/// seuls choix de recherche (nouvelle saisie). Les fiches en sommeil (S) restent proposées ; la fiche, la liste et la
/// lecture par identifiant (valeur déjà posée sur une pièce) ne sont pas touchées.
/// </summary>
public class ServiceAnnuaireBtp(AnnuaireDbContext db, SpecialisationAnnuaire specialisation, IChronosFiches? chronos = null)
    : ServiceAnnuaire(db, specialisation, chronos)
{
    protected override string? FiltreChoixPersonnes() => "per_id NOT IN (SELECT per_id FROM personne WHERE per_usage = 'N')";

    protected override string? FiltreChoixIndividus() => "ind_id NOT IN (SELECT ind_id FROM individu WHERE ind_usage = 'N')";
}
