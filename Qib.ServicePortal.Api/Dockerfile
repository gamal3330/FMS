FROM mcr.microsoft.com/dotnet/sdk:8.0 AS build
WORKDIR /src

COPY Qib.ServicePortal.Api.csproj ./
RUN dotnet restore

COPY . ./
RUN dotnet publish Qib.ServicePortal.Api.csproj -c Release -o /app/publish --no-restore

FROM mcr.microsoft.com/dotnet/aspnet:8.0 AS runtime
WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends libfontconfig1 fonts-noto-core \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --create-home --shell /bin/bash appuser \
    && mkdir -p /data/uploads /data/backups \
    && chown -R appuser:appuser /data /app

COPY --from=build /app/publish ./

USER appuser
ENV ASPNETCORE_URLS=http://+:8080
EXPOSE 8080

ENTRYPOINT ["dotnet", "Qib.ServicePortal.Api.dll"]
