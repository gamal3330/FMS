using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Qib.ServicePortal.Api.Application.DTOs;
using Qib.ServicePortal.Api.Application.Interfaces;
using Qib.ServicePortal.Api.Common.Exceptions;
using Qib.ServicePortal.Api.Domain.Entities;
using Qib.ServicePortal.Api.Infrastructure.Data;

namespace Qib.ServicePortal.Api.Controllers;

[ApiController]
[Route("api/dotnet/v1/permissions")]
[Authorize(Policy = "Permission:permissions.view")]
public class PermissionsController(
    ServicePortalDbContext db,
    IPermissionService permissionService,
    IAuditService auditService,
    ICurrentUserService currentUser) : ControllerBase
{
    private static readonly string[] ManageLikeLevels = ["create", "edit", "delete", "export", "manage"];

    [HttpGet]
    public async Task<ActionResult<IReadOnlyCollection<PermissionDto>>> GetPermissions(CancellationToken cancellationToken)
    {
        var permissions = await db.Permissions
            .AsNoTracking()
            .OrderBy(x => x.Module)
            .ThenBy(x => x.Code)
            .Select(x => new PermissionDto(x.Id, x.Code, x.NameAr, x.NameEn, x.Module, x.IsActive))
            .ToListAsync(cancellationToken);
        return Ok(permissions);
    }

    [HttpGet("screens")]
    public async Task<ActionResult<object>> GetScreenPermissions(CancellationToken cancellationToken)
    {
        var screens = UsersController.ScreenCatalog.Select(x => new { key = x.Key, label = x.Label }).ToList();
        var roles = await db.Roles.Include(x => x.RolePermissions).ThenInclude(x => x.Permission).Include(x => x.Users).AsNoTracking().OrderBy(x => x.NameAr).ToListAsync(cancellationToken);
        var users = await db.Users.Include(x => x.Role).AsNoTracking().OrderBy(x => x.NameAr).Take(1000).ToListAsync(cancellationToken);
        var settings = await db.SystemSettings.AsNoTracking().Where(x => x.Group == "screen_permissions").ToDictionaryAsync(x => x.Key, x => x.Value, cancellationToken);

        var roleRows = roles.Select(role =>
        {
            var permissionCodes = role.RolePermissions.Where(x => x.IsAllowed && x.Permission != null && x.Permission.IsActive).Select(x => x.Permission!.Code).ToHashSet(StringComparer.OrdinalIgnoreCase);
            return new
            {
                role.Id,
                role.Code,
                name_ar = role.NameAr,
                name_en = role.NameEn,
                is_system_role = role.IsSystem,
                users_count = role.Users.Count,
                permissions = UsersController.ScreenCatalog.ToDictionary(
                    screen => screen.Key,
                    screen => settings.GetValueOrDefault(ScreenSettingKey("role", role.Id, screen.Key)) ?? InferLevel(permissionCodes, screen))
            };
        }).ToList();

        var userRows = new List<object>();
        foreach (var user in users)
        {
            var effective = (await permissionService.GetEffectivePermissionCodesAsync(user.Id, cancellationToken)).ToHashSet(StringComparer.OrdinalIgnoreCase);
            userRows.Add(new
            {
                user.Id,
                name_ar = user.NameAr,
                username = user.Username,
                email = user.Email,
                employee_id = user.EmployeeNumber,
                role = user.Role?.Code,
                permissions = UsersController.ScreenCatalog.ToDictionary(
                    screen => screen.Key,
                    screen => settings.GetValueOrDefault(ScreenSettingKey("user", user.Id, screen.Key)) ?? InferLevel(effective, screen))
            });
        }

        return Ok(new { screens, roles = roleRows, users = userRows });
    }

    [HttpPut("screens/role/{roleId:long}")]
    [Authorize(Policy = "Permission:permissions.manage")]
    public async Task<IActionResult> UpdateRoleScreenPermissions(long roleId, [FromBody] JsonElement request, CancellationToken cancellationToken)
    {
        var role = await db.Roles.FirstOrDefaultAsync(x => x.Id == roleId, cancellationToken)
                   ?? throw new ApiException("الدور غير موجود", StatusCodes.Status404NotFound);
        var levels = ParseLevels(request);
        var oldValue = await GetStoredScreenLevelsAsync("role", roleId, cancellationToken);

        foreach (var screen in UsersController.ScreenCatalog)
        {
            if (!levels.TryGetValue(screen.Key, out var level))
            {
                continue;
            }

            await ApplyRoleScreenLevelAsync(role.Id, screen, NormalizeLevel(level), cancellationToken);
            await SetScreenLevelAsync("role", role.Id, screen.Key, NormalizeLevel(level), cancellationToken);
        }

        await db.SaveChangesAsync(cancellationToken);
        await auditService.LogAsync("screen_permission_changed", "role", roleId.ToString(), oldValue: oldValue, newValue: levels, cancellationToken: cancellationToken);
        return Ok(new { success = true });
    }

    [HttpPut("screens/user/{userId:long}")]
    [Authorize(Policy = "Permission:permissions.manage")]
    public async Task<IActionResult> UpdateUserScreenPermissions(long userId, [FromBody] JsonElement request, CancellationToken cancellationToken)
    {
        var user = await db.Users.FirstOrDefaultAsync(x => x.Id == userId, cancellationToken)
                   ?? throw new ApiException("المستخدم غير موجود", StatusCodes.Status404NotFound);
        var levels = ParseLevels(request);
        var oldValue = await GetStoredScreenLevelsAsync("user", user.Id, cancellationToken);

        foreach (var screen in UsersController.ScreenCatalog)
        {
            if (!levels.TryGetValue(screen.Key, out var level))
            {
                continue;
            }

            await ApplyUserScreenLevelAsync(user.Id, screen, NormalizeLevel(level), cancellationToken);
            await SetScreenLevelAsync("user", user.Id, screen.Key, NormalizeLevel(level), cancellationToken);
        }

        await db.SaveChangesAsync(cancellationToken);
        await auditService.LogAsync("screen_permission_changed", "user", userId.ToString(), oldValue: oldValue, newValue: levels, cancellationToken: cancellationToken);
        return Ok(new { success = true });
    }

    private async Task ApplyRoleScreenLevelAsync(long roleId, UsersController.ScreenDefinition screen, string level, CancellationToken cancellationToken)
    {
        var relevantCodes = screen.ViewPermissions.Concat(screen.ManagePermissions).Distinct(StringComparer.OrdinalIgnoreCase).ToList();
        var permissions = await db.Permissions.Where(x => relevantCodes.Contains(x.Code)).ToListAsync(cancellationToken);
        var allowedCodes = AllowedCodesForLevel(screen, level).ToHashSet(StringComparer.OrdinalIgnoreCase);
        foreach (var permission in permissions)
        {
            await UpsertRolePermissionAsync(roleId, permission.Id, allowedCodes.Contains(permission.Code), cancellationToken);
        }
    }

    private async Task ApplyUserScreenLevelAsync(long userId, UsersController.ScreenDefinition screen, string level, CancellationToken cancellationToken)
    {
        var relevantCodes = screen.ViewPermissions.Concat(screen.ManagePermissions).Distinct(StringComparer.OrdinalIgnoreCase).ToList();
        var permissions = await db.Permissions.Where(x => relevantCodes.Contains(x.Code)).ToListAsync(cancellationToken);
        var allowedCodes = AllowedCodesForLevel(screen, level).ToHashSet(StringComparer.OrdinalIgnoreCase);
        foreach (var permission in permissions)
        {
            await UpsertUserPermissionOverrideAsync(userId, permission.Id, allowedCodes.Contains(permission.Code), cancellationToken);
        }
    }

    private async Task UpsertRolePermissionAsync(long roleId, long permissionId, bool isAllowed, CancellationToken cancellationToken)
    {
        var tracked = db.RolePermissions.Local.FirstOrDefault(x => x.RoleId == roleId && x.PermissionId == permissionId);
        if (tracked is not null)
        {
            tracked.IsAllowed = isAllowed;
            return;
        }

        var existing = await db.RolePermissions.FirstOrDefaultAsync(x => x.RoleId == roleId && x.PermissionId == permissionId, cancellationToken);
        if (existing is not null)
        {
            existing.IsAllowed = isAllowed;
            return;
        }

        db.RolePermissions.Add(new RolePermission { RoleId = roleId, PermissionId = permissionId, IsAllowed = isAllowed });
    }

    private async Task UpsertUserPermissionOverrideAsync(long userId, long permissionId, bool isAllowed, CancellationToken cancellationToken)
    {
        var tracked = db.UserPermissionOverrides.Local.FirstOrDefault(x => x.UserId == userId && x.PermissionId == permissionId);
        if (tracked is not null)
        {
            tracked.IsAllowed = isAllowed;
            tracked.Reason = "screen_permission";
            return;
        }

        var existing = await db.UserPermissionOverrides.FirstOrDefaultAsync(x => x.UserId == userId && x.PermissionId == permissionId, cancellationToken);
        if (existing is not null)
        {
            existing.IsAllowed = isAllowed;
            existing.Reason = "screen_permission";
            return;
        }

        db.UserPermissionOverrides.Add(new UserPermissionOverride { UserId = userId, PermissionId = permissionId, IsAllowed = isAllowed, Reason = "screen_permission" });
    }

    private async Task<Dictionary<string, string>> GetStoredScreenLevelsAsync(string subjectType, long subjectId, CancellationToken cancellationToken)
    {
        var prefix = $"screen_permission.{subjectType}.{subjectId}.";
        return await db.SystemSettings.AsNoTracking()
            .Where(x => x.Group == "screen_permissions" && x.Key.StartsWith(prefix))
            .ToDictionaryAsync(x => x.Key[prefix.Length..], x => x.Value ?? "no_access", cancellationToken);
    }

    private async Task SetScreenLevelAsync(string subjectType, long subjectId, string screenKey, string level, CancellationToken cancellationToken)
    {
        var key = ScreenSettingKey(subjectType, subjectId, screenKey);
        var setting = await db.SystemSettings.FirstOrDefaultAsync(x => x.Key == key, cancellationToken);
        if (setting is null)
        {
            setting = new SystemSetting
            {
                Key = key,
                Group = "screen_permissions",
                DataType = "string",
                DescriptionAr = "مستوى صلاحية شاشة"
            };
            db.SystemSettings.Add(setting);
        }

        setting.Value = level;
        setting.UpdatedByUserId = currentUser.UserId;
    }

    private static Dictionary<string, string> ParseLevels(JsonElement request)
    {
        if (!request.TryGetProperty("permissions", out var permissions) || permissions.ValueKind != JsonValueKind.Object)
        {
            throw new ApiException("صيغة صلاحيات الشاشات غير صحيحة");
        }

        return permissions.EnumerateObject().ToDictionary(x => x.Name, x => x.Value.ValueKind == JsonValueKind.String ? x.Value.GetString() ?? "no_access" : "no_access");
    }

    private static string InferLevel(IReadOnlySet<string> permissionCodes, UsersController.ScreenDefinition screen)
    {
        if (screen.ManagePermissions.Any(x => permissionCodes.Contains(x)))
        {
            return "manage";
        }

        if (screen.ViewPermissions.Any(x => permissionCodes.Contains(x)))
        {
            return "view";
        }

        return "no_access";
    }

    private static string[] AllowedCodesForLevel(UsersController.ScreenDefinition screen, string level)
    {
        if (level == "no_access")
        {
            return [];
        }

        return ManageLikeLevels.Contains(level)
            ? screen.ViewPermissions.Concat(screen.ManagePermissions).Distinct(StringComparer.OrdinalIgnoreCase).ToArray()
            : screen.ViewPermissions;
    }

    private static string NormalizeLevel(string? level)
    {
        return level is "view" or "create" or "edit" or "delete" or "export" or "manage" ? level : "no_access";
    }

    private static string ScreenSettingKey(string subjectType, long subjectId, string screenKey)
    {
        return $"screen_permission.{subjectType}.{subjectId}.{screenKey}";
    }
}
