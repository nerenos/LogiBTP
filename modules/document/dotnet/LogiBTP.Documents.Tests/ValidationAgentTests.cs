using LogiBTP.Documents.Web;
using LogiBTP.Socle;
using LogiBTP.Socle.Web;
using Xunit;

namespace LogiBTP.Documents.Tests;

/// <summary>Validation automatique (ValiderDans) par un agent IA : refusée sans VALIDER effectif (lot 3 du plan MCP).</summary>
public class ValidationAgentTests
{
    private sealed class DroitsFixes(params string[] actions) : IDroits
    {
        public Task<string?> PorteeAsync(Utilisateur u, string noeud, string action, CancellationToken ct) =>
            Task.FromResult(actions.Contains(action) ? PorteesDroits.Tout : null);
        public Task<IReadOnlyList<ProfilDroits>> ProfilsAsync(CancellationToken ct) => Task.FromResult<IReadOnlyList<ProfilDroits>>([]);
    }

    private static Task Exiger(IDroits? droits, Utilisateur u) =>
        DocumentService<Document, DocumentLigne, DocumentComplet<Document, DocumentLigne>>.ExigerValidationAgent(droits, u, "documents/V/V_COMMANDE", CancellationToken.None);

    private static readonly Utilisateur Humain = new("jean", "SAISIE");
    private static readonly Utilisateur Agent = Humain with { Agent = new AgentRequete("D1", "client") };

    [Fact]
    public async Task Agent_sans_valider_refuse()
    {
        var e = await Assert.ThrowsAsync<ExceptionMetier>(() => Exiger(new DroitsFixes(ActionsDroits.Consulter, ActionsDroits.Creer, ActionsDroits.Modifier), Agent));
        Assert.Equal(ErreursAgent.AgentInterdit, e.Code);
        Assert.Equal(403, e.Statut);
        // Sans module Droits : jamais pour un agent.
        await Assert.ThrowsAsync<ExceptionMetier>(() => Exiger(null, Agent));
    }

    [Fact]
    public async Task Agent_avec_valider_et_humain_acceptes()
    {
        await Exiger(new DroitsFixes(ActionsDroits.Valider), Agent);
        await Exiger(new DroitsFixes(), Humain);
        await Exiger(null, Humain);
    }
}
