using Qib.ServicePortal.Api.Application.DTOs;

namespace Qib.ServicePortal.Api.Application.Interfaces;

public interface ICurrentUserService
{
    long? UserId { get; }
    string? IpAddress { get; }
    string? UserAgent { get; }
}

public interface IAuditService
{
    Task LogAsync(
        string action,
        string entityType,
        string? entityId = null,
        long? actorUserId = null,
        object? oldValue = null,
        object? newValue = null,
        object? metadata = null,
        string result = "success",
        CancellationToken cancellationToken = default);
}

public interface IPermissionService
{
    Task<IReadOnlyCollection<string>> GetEffectivePermissionCodesAsync(long userId, CancellationToken cancellationToken = default);
    Task<EffectivePermissionsDto> GetEffectivePermissionsAsync(long userId, CancellationToken cancellationToken = default);
    Task<bool> HasPermissionAsync(long userId, string permissionCode, CancellationToken cancellationToken = default);
}

public interface IAuthService
{
    Task<AuthResponse> LoginAsync(LoginRequest request, CancellationToken cancellationToken = default);
    Task<AuthResponse> RefreshAsync(RefreshTokenRequest request, CancellationToken cancellationToken = default);
    Task LogoutAsync(LogoutRequest request, CancellationToken cancellationToken = default);
    Task<CurrentUserDto> GetMeAsync(CancellationToken cancellationToken = default);
    Task ChangePasswordAsync(ChangePasswordRequest request, CancellationToken cancellationToken = default);
}

public interface ISettingsStore
{
    Task<T> GetValueAsync<T>(string key, T defaultValue, CancellationToken cancellationToken = default);
    Task<Dictionary<string, object?>> GetValuesAsync(
        string group,
        string keyPrefix,
        IReadOnlyDictionary<string, object?> defaults,
        CancellationToken cancellationToken = default);
    Task SetValuesAsync(
        string group,
        string keyPrefix,
        IReadOnlyDictionary<string, object?> values,
        IReadOnlyDictionary<string, object?> defaults,
        CancellationToken cancellationToken = default);
}
