using System.Net;
using System.Net.Sockets;

namespace LogiBTP.Authentification;

/// <summary>
/// Adresses IP de la connexion (D19 à D21) : préfixe compté pour l'exclusion (IPv4 entière, IPv6 par /64 : une machine
/// dispose de tout un /64), adresses de confiance (réseau local, serveur TSE) en notation CIDR.
/// </summary>
public static class Adresses
{
    /// <summary>Préfixe compté d'une adresse (null : illisible) ; une IPv4 encapsulée en IPv6 compte comme IPv4.</summary>
    public static string? Prefixe(string? adresse)
    {
        if (!IPAddress.TryParse(adresse, out var ip)) return null;
        if (ip.IsIPv4MappedToIPv6) ip = ip.MapToIPv4();
        if (ip.AddressFamily == AddressFamily.InterNetwork) return ip.ToString();
        var octets = ip.GetAddressBytes();
        Array.Clear(octets, 8, 8);
        return new IPAddress(octets) + "/64";
    }

    /// <summary>Adresse comprise dans l'une des plages CIDR (« 192.168.0.0/16 », « 10.1.2.3 », « fd00::/8 ») ; plage illisible ignorée.</summary>
    public static bool DansPlages(string? adresse, IEnumerable<string>? plages)
    {
        if (plages is null || !IPAddress.TryParse(adresse, out var ip)) return false;
        if (ip.IsIPv4MappedToIPv6) ip = ip.MapToIPv4();
        foreach (var p in plages)
        {
            var texte = p.Trim();
            if (!texte.Contains('/')) texte += IPAddress.TryParse(texte, out var seule) && seule.AddressFamily == AddressFamily.InterNetworkV6 ? "/128" : "/32";
            if (IPNetwork.TryParse(texte, out var reseau) && reseau.Contains(ip)) return true;
        }
        return false;
    }

    /// <summary>Plages CIDR saisies valides (identifiants d'API, adresses de confiance) : codes d'erreur des plages illisibles.</summary>
    public static List<string> PlagesInvalides(IEnumerable<string>? plages) =>
        (plages ?? []).Select(p => p.Trim()).Where(p => p.Length > 0
            && !IPNetwork.TryParse(p.Contains('/') ? p : p + (p.Contains(':') ? "/128" : "/32"), out _)).ToList();
}
