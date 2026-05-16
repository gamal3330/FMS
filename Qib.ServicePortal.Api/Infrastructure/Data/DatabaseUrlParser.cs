using Npgsql;

namespace Qib.ServicePortal.Api.Infrastructure.Data;

public static class DatabaseUrlParser
{
    public static string ResolveConnectionString(IConfiguration configuration)
    {
        var databaseUrl = configuration["DATABASE_URL"];
        if (!string.IsNullOrWhiteSpace(databaseUrl))
        {
            return FromDatabaseUrl(databaseUrl);
        }

        return configuration.GetConnectionString("DefaultConnection")
               ?? throw new InvalidOperationException("Database connection string is not configured.");
    }

    private static string FromDatabaseUrl(string databaseUrl)
    {
        var uri = new Uri(databaseUrl);
        var userInfo = uri.UserInfo.Split(':', 2);
        var builder = new NpgsqlConnectionStringBuilder
        {
            Host = uri.Host,
            Port = uri.Port > 0 ? uri.Port : 5432,
            Database = uri.AbsolutePath.TrimStart('/'),
            Username = Uri.UnescapeDataString(userInfo.ElementAtOrDefault(0) ?? string.Empty),
            Password = Uri.UnescapeDataString(userInfo.ElementAtOrDefault(1) ?? string.Empty),
            SslMode = uri.Query.Contains("sslmode=require", StringComparison.OrdinalIgnoreCase)
                ? SslMode.Require
                : SslMode.Prefer
        };
        return builder.ConnectionString;
    }
}
