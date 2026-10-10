namespace LogiBTP.Calcul;

/// <summary>Erreur de calcul signalée sur une ligne ou sur le document.</summary>
public sealed class ErreurCalcul(string code, string message) : Exception(message)
{
    public string Code { get; } = code;
}

public sealed record MessageCalcul(long? LigId, string Code, string Message);
