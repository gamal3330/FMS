using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.Tokens;
using Qib.ServicePortal.Api.Domain.Entities;

namespace Qib.ServicePortal.Api.Infrastructure.Security;

public interface IJwtTokenService
{
    string CreateAccessToken(User user, IReadOnlyCollection<string> permissions, string? sessionTokenHash = null);
    string CreateRefreshToken();
    string HashRefreshToken(string refreshToken);
    DateTimeOffset RefreshTokenExpiresAt();
}

public class JwtTokenService(IOptions<JwtOptions> options) : IJwtTokenService
{
    private readonly JwtOptions _options = options.Value;

    public string CreateAccessToken(User user, IReadOnlyCollection<string> permissions, string? sessionTokenHash = null)
    {
        var claims = new List<Claim>
        {
            new(ClaimTypes.NameIdentifier, user.Id.ToString()),
            new(ClaimTypes.Name, user.Username),
            new(ClaimTypes.Email, user.Email),
            new("name_ar", user.NameAr),
            new("role", user.Role?.Code ?? string.Empty)
        };

        if (!string.IsNullOrWhiteSpace(sessionTokenHash))
        {
            claims.Add(new Claim("sid", sessionTokenHash));
        }

        claims.AddRange(permissions.Select(permission => new Claim("permission", permission)));

        var key = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(_options.Secret));
        var credentials = new SigningCredentials(key, SecurityAlgorithms.HmacSha256);
        var token = new JwtSecurityToken(
            issuer: _options.Issuer,
            audience: _options.Audience,
            claims: claims,
            expires: DateTime.UtcNow.AddMinutes(_options.AccessTokenMinutes),
            signingCredentials: credentials);

        return new JwtSecurityTokenHandler().WriteToken(token);
    }

    public string CreateRefreshToken()
    {
        return Convert.ToBase64String(RandomNumberGenerator.GetBytes(64));
    }

    public string HashRefreshToken(string refreshToken)
    {
        var bytes = SHA256.HashData(Encoding.UTF8.GetBytes(refreshToken));
        return Convert.ToHexString(bytes);
    }

    public DateTimeOffset RefreshTokenExpiresAt()
    {
        return DateTimeOffset.UtcNow.AddDays(_options.RefreshTokenDays);
    }
}
