using LogiBTP.Socle.Testing;
using Xunit;

namespace LogiBTP.Mail.Tests;

/// <summary>Codes du module : Codes.cs ↔ modules/mail/js/src/codes.js.</summary>
public class CodesTests
{
    private static readonly string Fichier = CasPartages.Chemin("modules", "mail", "js", "src", "codes.js");

    [Theory]
    [InlineData("ERREUR_MAIL", typeof(ErreursMail))]
    public void Parite_avec_le_js(string nom, Type type) => Assert.Empty(Constantes.Ecarts(Fichier, nom, type));
}
