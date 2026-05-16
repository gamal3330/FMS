using Microsoft.EntityFrameworkCore;
using Qib.ServicePortal.Api.Application.DTOs;
using Qib.ServicePortal.Api.Application.Interfaces;
using Qib.ServicePortal.Api.Common.Exceptions;
using Qib.ServicePortal.Api.Infrastructure.Data;

namespace Qib.ServicePortal.Api.Application.Services;

public class PermissionService(ServicePortalDbContext db) : IPermissionService
{
    public async Task<IReadOnlyCollection<string>> GetEffectivePermissionCodesAsync(long userId, CancellationToken cancellationToken = default)
    {
        var user = await db.Users
            .Include(x => x.Role)
            .FirstOrDefaultAsync(x => x.Id == userId, cancellationToken);

        if (user is null || !user.IsActive || user.IsLocked || user.Role is null || !user.Role.IsActive)
        {
            return Array.Empty<string>();
        }

        if (user.Role.Code == "super_admin")
        {
            return await db.Permissions
                .Where(x => x.IsActive)
                .Select(x => x.Code)
                .OrderBy(x => x)
                .ToListAsync(cancellationToken);
        }

        var rolePermissions = await db.RolePermissions
            .Include(x => x.Permission)
            .Where(x => x.RoleId == user.RoleId && x.IsAllowed && x.Permission != null && x.Permission.IsActive)
            .Select(x => x.Permission!.Code)
            .ToListAsync(cancellationToken);

        var effective = rolePermissions.ToHashSet(StringComparer.OrdinalIgnoreCase);
        var overrides = await db.UserPermissionOverrides
            .Include(x => x.Permission)
            .Where(x => x.UserId == userId && x.Permission != null && x.Permission.IsActive)
            .ToListAsync(cancellationToken);

        foreach (var item in overrides)
        {
            if (item.Permission is null)
            {
                continue;
            }

            if (item.IsAllowed)
            {
                effective.Add(item.Permission.Code);
            }
            else
            {
                effective.Remove(item.Permission.Code);
            }
        }

        return effective.OrderBy(x => x).ToList();
    }

    public async Task<EffectivePermissionsDto> GetEffectivePermissionsAsync(long userId, CancellationToken cancellationToken = default)
    {
        var user = await db.Users
            .Include(x => x.Role)
            .FirstOrDefaultAsync(x => x.Id == userId, cancellationToken)
            ?? throw new ApiException("المستخدم غير موجود", StatusCodes.Status404NotFound);

        var permissions = await GetEffectivePermissionCodesAsync(userId, cancellationToken);
        var overrides = await db.UserPermissionOverrides
            .Include(x => x.Permission)
            .Where(x => x.UserId == userId && x.Permission != null)
            .ToListAsync(cancellationToken);

        return new EffectivePermissionsDto(
            user.Id,
            user.Username,
            user.Role?.Code ?? string.Empty,
            permissions,
            overrides.Where(x => x.IsAllowed).Select(x => x.Permission!.Code).OrderBy(x => x).ToList(),
            overrides.Where(x => !x.IsAllowed).Select(x => x.Permission!.Code).OrderBy(x => x).ToList());
    }

    public async Task<bool> HasPermissionAsync(long userId, string permissionCode, CancellationToken cancellationToken = default)
    {
        var permissions = await GetEffectivePermissionCodesAsync(userId, cancellationToken);
        return permissions.Contains(permissionCode, StringComparer.OrdinalIgnoreCase);
    }
}
