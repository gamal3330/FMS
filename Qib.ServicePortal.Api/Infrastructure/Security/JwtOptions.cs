namespace Qib.ServicePortal.Api.Infrastructure.Security;

public class JwtOptions
{
    public string Issuer { get; set; } = "Qib.ServicePortal.DotNet";
    public string Audience { get; set; } = "Qib.ServicePortal";
    public string Secret { get; set; } = string.Empty;
    public int AccessTokenMinutes { get; set; } = 30;
    public int RefreshTokenDays { get; set; } = 14;
}
