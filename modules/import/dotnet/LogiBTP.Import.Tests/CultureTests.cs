using System.Globalization;
using System.Runtime.CompilerServices;

namespace LogiBTP.Import.Tests;

/// <summary>Globalisation active (pilote SQL Server de la reprise) : cultures fixées à l'invariante, comme dans Program.cs.</summary>
internal static class CultureTests
{
    [ModuleInitializer]
    internal static void Fixer()
    {
        CultureInfo.DefaultThreadCurrentCulture = CultureInfo.InvariantCulture;
        CultureInfo.DefaultThreadCurrentUICulture = CultureInfo.InvariantCulture;
        CultureInfo.CurrentCulture = CultureInfo.InvariantCulture;
        CultureInfo.CurrentUICulture = CultureInfo.InvariantCulture;
    }
}
