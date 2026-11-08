# syntax=docker/dockerfile:1.7
# Image de l'API LogiBTP (ANALYSE-MODULE-INSTALLATION.md § 3.1) : client web construit par Vite et servi par l'API,
# API ASP.NET Core, scripts SQL du manifeste (commandes « installation … »). Construction depuis la racine du dépôt :
#   docker build --secret id=cle_construction,src=cle-construction.secret -t logibtp/api:<version> .
# La clé de construction (chiffrement du .env, D25) est obligatoire et passée en secret : jamais dans une couche.

# ---------------------------------------------------------------- client web
FROM node:22-bookworm-slim AS client
WORKDIR /src
COPY . .
RUN npm ci --no-audit --no-fund && npm run build --workspace client

# ---------------------------------------------------------------- API
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS api
WORKDIR /src
COPY . .
RUN --mount=type=secret,id=cle_construction,required=true \
    LOGIBTP_CLE_CONSTRUCTION="$(tr -cd '[:alnum:]' < /run/secrets/cle_construction)" \
    dotnet publish src/LogiBTP.Api -c Release -o /publication -p:UseAppHost=false \
 && mkdir -p /sql \
 && cp --parents db/*.sql db/installation/* modules/*/db/*.sql /sql/

# ---------------------------------------------------------------- exécution
FROM mcr.microsoft.com/dotnet/aspnet:10.0
ENV ASPNETCORE_ENVIRONMENT=Production \
    ASPNETCORE_HTTP_PORTS=8080 \
    TZ=Europe/Paris \
    LOGIBTP_CONFIG=/app/config \
    LOGIBTP_CONFIG_BASE=/app/base-config \
    LOGIBTP_CERTIFICATS=/app/certificats \
    LOGIBTP_SQL=/app/sql \
    LOGIBTP_SAUVEGARDES=/app/sauvegardes
WORKDIR /app
COPY --from=api /publication ./
COPY --from=api /sql ./sql/
COPY --from=client /src/client/dist ./wwwroot/
# Dossiers des volumes, au compte non root de l'image (copiés dans un volume neuf à son premier montage).
RUN mkdir -p config base-config certificats stockage-ged journaux sauvegardes \
 && chown app:app config base-config certificats stockage-ged journaux sauvegardes
USER app
EXPOSE 8080 8443
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD ["bash", "-c", "exec 3<>/dev/tcp/127.0.0.1/8080 && printf 'GET /api/sante HTTP/1.0\\r\\nHost: localhost\\r\\n\\r\\n' >&3 && head -1 <&3 | grep -q ' 200 '"]
ENTRYPOINT ["dotnet", "LogiBTP.Api.dll"]
