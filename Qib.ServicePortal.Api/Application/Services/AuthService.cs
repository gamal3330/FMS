using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Qib.ServicePortal.Api.Application.DTOs;
using Qib.ServicePortal.Api.Application.Interfaces;
using Qib.ServicePortal.Api.Common.Exceptions;
using Qib.ServicePortal.Api.Domain.Entities;
using Qib.ServicePortal.Api.Infrastructure.Data;
using Qib.ServicePortal.Api.Infrastructure.Security;

namespace Qib.ServicePortal.Api.Application.Services;

public class AuthService(
    ServicePortalDbContext db,
    IPasswordHasher passwordHasher,
    IJwtTokenService jwtTokenService,
    IOptions<JwtOptions> jwtOptions,
    IPermissionService permissionService,
    ICurrentUserService currentUser,
    IAuditService auditService,
    ISettingsStore settingsStore) : IAuthService
{
    public async Task<AuthResponse> LoginAsync(LoginRequest request, CancellationToken cancellationToken = default)
    {
        var rawIdentifier = request.Identifier.Trim();
        var identifier = rawIdentifier.ToLowerInvariant();
        var user = await db.Users
            .Include(x => x.Role)
            .Include(x => x.Department)
            .Include(x => x.SpecializedSection)
            .FirstOrDefaultAsync(x =>
                x.Username.ToLower() == identifier ||
                x.Email.ToLower() == identifier ||
                (x.EmployeeNumber != null && x.EmployeeNumber.ToLower() == identifier),
                cancellationToken);

        if (user is null || !passwordHasher.Verify(request.Password, user.PasswordHash))
        {
            RecordLoginAttempt(user?.Id, rawIdentifier, false, user is null ? "user_not_found" : "invalid_password");
            await auditService.LogAsync("auth_login_failed", "auth", metadata: new { identifier }, result: "failed", cancellationToken: cancellationToken);
            throw new ApiException("بيانات الدخول غير صحيحة", StatusCodes.Status401Unauthorized);
        }

        if (!user.IsActive || user.IsLocked)
        {
            RecordLoginAttempt(user.Id, rawIdentifier, false, user.IsLocked ? "locked" : "inactive");
            await auditService.LogAsync("auth_login_blocked", "auth", user.Id.ToString(), user.Id, metadata: new { user.IsActive, user.IsLocked }, result: "failed", cancellationToken: cancellationToken);
            throw new ApiException("الحساب غير مفعل أو مقفل", StatusCodes.Status403Forbidden);
        }

        RecordLoginAttempt(user.Id, rawIdentifier, true);
        user.LastLoginAt = DateTimeOffset.UtcNow;
        var response = await CreateAuthResponseAsync(user, cancellationToken);
        await db.SaveChangesAsync(cancellationToken);
        await auditService.LogAsync("auth_login_success", "auth", user.Id.ToString(), user.Id, cancellationToken: cancellationToken);
        return response;
    }

    public async Task<AuthResponse> RefreshAsync(RefreshTokenRequest request, CancellationToken cancellationToken = default)
    {
        var tokenHash = jwtTokenService.HashRefreshToken(request.RefreshToken);
        var existingToken = await db.RefreshTokens
            .Include(x => x.User)
            .ThenInclude(x => x!.Role)
            .Include(x => x.User)
            .ThenInclude(x => x!.Department)
            .Include(x => x.User)
            .ThenInclude(x => x!.SpecializedSection)
            .FirstOrDefaultAsync(x => x.TokenHash == tokenHash, cancellationToken);

        if (existingToken is null || existingToken.IsExpired || existingToken.IsRevoked || existingToken.User is null)
        {
            throw new ApiException("رمز التحديث غير صالح", StatusCodes.Status401Unauthorized);
        }

        existingToken.RevokedAt = DateTimeOffset.UtcNow;
        existingToken.RevokedByIp = currentUser.IpAddress;
        var response = await CreateAuthResponseAsync(existingToken.User, cancellationToken, tokenHash);
        existingToken.ReplacedByTokenHash = jwtTokenService.HashRefreshToken(response.RefreshToken);
        await db.SaveChangesAsync(cancellationToken);
        await auditService.LogAsync("auth_token_refreshed", "auth", existingToken.UserId.ToString(), existingToken.UserId, cancellationToken: cancellationToken);
        return response;
    }

    public async Task LogoutAsync(LogoutRequest request, CancellationToken cancellationToken = default)
    {
        if (!string.IsNullOrWhiteSpace(request.RefreshToken))
        {
            var tokenHash = jwtTokenService.HashRefreshToken(request.RefreshToken);
            var token = await db.RefreshTokens.FirstOrDefaultAsync(x => x.TokenHash == tokenHash, cancellationToken);
            if (token is not null && !token.IsRevoked)
            {
                token.RevokedAt = DateTimeOffset.UtcNow;
                token.RevokedByIp = currentUser.IpAddress;
            }

            await RevokeSessionAsync(tokenHash, "logout", cancellationToken);
        }
        else if (currentUser.UserId.HasValue)
        {
            var activeTokens = await db.RefreshTokens
                .Where(x => x.UserId == currentUser.UserId.Value && x.RevokedAt == null && x.ExpiresAt > DateTimeOffset.UtcNow)
                .ToListAsync(cancellationToken);
            foreach (var token in activeTokens)
            {
                token.RevokedAt = DateTimeOffset.UtcNow;
                token.RevokedByIp = currentUser.IpAddress;
            }

            var activeSessions = await db.UserSessions
                .Where(x => x.UserId == currentUser.UserId.Value && x.IsActive)
                .ToListAsync(cancellationToken);
            foreach (var session in activeSessions)
            {
                RevokeSession(session, "logout");
            }
        }

        await db.SaveChangesAsync(cancellationToken);
        await auditService.LogAsync("auth_logout", "auth", actorUserId: currentUser.UserId, cancellationToken: cancellationToken);
    }

    public async Task<CurrentUserDto> GetMeAsync(CancellationToken cancellationToken = default)
    {
        var userId = currentUser.UserId ?? throw new ApiException("غير مصرح", StatusCodes.Status401Unauthorized);
        var user = await db.Users
            .Include(x => x.Role)
            .Include(x => x.Department)
            .Include(x => x.SpecializedSection)
            .FirstOrDefaultAsync(x => x.Id == userId, cancellationToken)
            ?? throw new ApiException("المستخدم غير موجود", StatusCodes.Status404NotFound);
        return await MapCurrentUserAsync(user, cancellationToken);
    }

    public async Task ChangePasswordAsync(ChangePasswordRequest request, CancellationToken cancellationToken = default)
    {
        var userId = currentUser.UserId ?? throw new ApiException("غير مصرح", StatusCodes.Status401Unauthorized);
        var user = await db.Users.FirstOrDefaultAsync(x => x.Id == userId, cancellationToken)
                   ?? throw new ApiException("المستخدم غير موجود", StatusCodes.Status404NotFound);

        if (!passwordHasher.Verify(request.CurrentPassword, user.PasswordHash))
        {
            throw new ApiException("كلمة المرور الحالية غير صحيحة", StatusCodes.Status400BadRequest);
        }

        await ValidatePasswordPolicyAsync(request.NewPassword, cancellationToken);

        user.PasswordHash = passwordHasher.Hash(request.NewPassword);
        user.ForcePasswordChange = false;
        user.PasswordChangedAt = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync(cancellationToken);
        await auditService.LogAsync("auth_password_changed", "user", user.Id.ToString(), user.Id, cancellationToken: cancellationToken);
    }

    private async Task ValidatePasswordPolicyAsync(string password, CancellationToken cancellationToken)
    {
        var minLength = await settingsStore.GetValueAsync("security.password_min_length", 8, cancellationToken);
        var requireUppercase = await settingsStore.GetValueAsync("security.require_uppercase", true, cancellationToken);
        var requireNumbers = await settingsStore.GetValueAsync("security.require_numbers", true, cancellationToken);
        var requireSpecialChars = await settingsStore.GetValueAsync("security.require_special_chars", true, cancellationToken);

        minLength = Math.Clamp(minLength, 1, 256);
        if (password.Length < minLength)
        {
            throw new ApiException($"الحد الأدنى لكلمة المرور هو {minLength} حرف", StatusCodes.Status400BadRequest);
        }

        if (requireUppercase && !password.Any(char.IsUpper))
        {
            throw new ApiException("كلمة المرور يجب أن تحتوي على حرف كبير", StatusCodes.Status400BadRequest);
        }

        if (requireNumbers && !password.Any(char.IsDigit))
        {
            throw new ApiException("كلمة المرور يجب أن تحتوي على رقم", StatusCodes.Status400BadRequest);
        }

        if (requireSpecialChars && !password.Any(ch => !char.IsLetterOrDigit(ch)))
        {
            throw new ApiException("كلمة المرور يجب أن تحتوي على رمز خاص", StatusCodes.Status400BadRequest);
        }
    }

    private async Task<AuthResponse> CreateAuthResponseAsync(User user, CancellationToken cancellationToken, string? rotateSessionFromRefreshTokenHash = null)
    {
        var permissions = await permissionService.GetEffectivePermissionCodesAsync(user.Id, cancellationToken);
        var refreshToken = jwtTokenService.CreateRefreshToken();
        var refreshTokenHash = jwtTokenService.HashRefreshToken(refreshToken);
        var refreshTokenExpiresAt = jwtTokenService.RefreshTokenExpiresAt();
        var accessToken = jwtTokenService.CreateAccessToken(user, permissions, refreshTokenHash);
        db.RefreshTokens.Add(new RefreshToken
        {
            UserId = user.Id,
            TokenHash = refreshTokenHash,
            ExpiresAt = refreshTokenExpiresAt,
            CreatedByIp = currentUser.IpAddress,
            UserAgent = currentUser.UserAgent
        });

        if (!string.IsNullOrWhiteSpace(rotateSessionFromRefreshTokenHash))
        {
            var session = await db.UserSessions
                .Where(x =>
                    x.UserId == user.Id &&
                    x.IsActive &&
                    (x.RefreshTokenHash == rotateSessionFromRefreshTokenHash || x.SessionTokenHash == rotateSessionFromRefreshTokenHash))
                .OrderByDescending(x => x.StartedAt)
                .FirstOrDefaultAsync(cancellationToken);

            if (session is not null)
            {
                session.SessionTokenHash = refreshTokenHash;
                session.RefreshTokenHash = refreshTokenHash;
                session.LastSeenAt = DateTimeOffset.UtcNow;
                session.ExpiresAt = refreshTokenExpiresAt;
                session.IpAddress = currentUser.IpAddress ?? session.IpAddress;
                session.UserAgent = currentUser.UserAgent ?? session.UserAgent;
            }
            else
            {
                AddUserSession(user.Id, refreshTokenHash, refreshTokenExpiresAt);
            }
        }
        else
        {
            AddUserSession(user.Id, refreshTokenHash, refreshTokenExpiresAt);
        }

        return new AuthResponse(
            accessToken,
            refreshToken,
            DateTimeOffset.UtcNow.AddMinutes(jwtOptions.Value.AccessTokenMinutes),
            user.ForcePasswordChange,
            await MapCurrentUserAsync(user, cancellationToken));
    }

    private async Task<CurrentUserDto> MapCurrentUserAsync(User user, CancellationToken cancellationToken)
    {
        var permissions = await permissionService.GetEffectivePermissionCodesAsync(user.Id, cancellationToken);
        return new CurrentUserDto(
            user.Id,
            user.Username,
            user.Email,
            user.NameAr,
            user.NameEn,
            user.EmployeeNumber,
            user.JobTitle,
            user.IsActive,
            user.ForcePasswordChange,
            user.Role is null ? null : new RoleDto(user.Role.Id, user.Role.Code, user.Role.NameAr, user.Role.NameEn, user.Role.Description, user.Role.IsSystem, user.Role.IsActive, 0, user.Role.CreatedAt, user.Role.UpdatedAt),
            user.Department is null ? null : new DepartmentDto(user.Department.Id, user.Department.Code, user.Department.NameAr, user.Department.NameEn, user.Department.Description, user.Department.ParentDepartmentId, user.Department.ManagerUserId, user.Department.ManagerUser?.NameAr, user.Department.IsActive, user.Department.CreatedAt, user.Department.UpdatedAt),
            user.SpecializedSectionId,
            user.SpecializedSection?.Code,
            user.SpecializedSection?.NameAr,
            permissions);
    }

    private void RecordLoginAttempt(long? userId, string loginIdentifier, bool isSuccess, string? failureReason = null)
    {
        db.UserLoginAttempts.Add(new UserLoginAttempt
        {
            UserId = userId,
            LoginIdentifier = loginIdentifier,
            IsSuccess = isSuccess,
            FailureReason = failureReason,
            IpAddress = currentUser.IpAddress,
            UserAgent = currentUser.UserAgent,
            AttemptedAt = DateTimeOffset.UtcNow
        });
    }

    private void AddUserSession(long userId, string refreshTokenHash, DateTimeOffset refreshTokenExpiresAt)
    {
        var now = DateTimeOffset.UtcNow;
        db.UserSessions.Add(new UserSession
        {
            UserId = userId,
            SessionTokenHash = refreshTokenHash,
            RefreshTokenHash = refreshTokenHash,
            IpAddress = currentUser.IpAddress,
            UserAgent = currentUser.UserAgent,
            StartedAt = now,
            LastSeenAt = now,
            ExpiresAt = refreshTokenExpiresAt,
            IsActive = true
        });
    }

    private async Task RevokeSessionAsync(string refreshTokenHash, string reason, CancellationToken cancellationToken)
    {
        var session = await db.UserSessions
            .Where(x => x.IsActive && (x.RefreshTokenHash == refreshTokenHash || x.SessionTokenHash == refreshTokenHash))
            .OrderByDescending(x => x.StartedAt)
            .FirstOrDefaultAsync(cancellationToken);

        if (session is not null)
        {
            RevokeSession(session, reason);
        }
    }

    private static void RevokeSession(UserSession session, string reason)
    {
        session.IsActive = false;
        session.RevokedAt = DateTimeOffset.UtcNow;
        session.RevocationReason = reason;
        session.LastSeenAt = DateTimeOffset.UtcNow;
    }
}
