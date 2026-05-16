using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Qib.ServicePortal.Api.Application.Interfaces;
using Qib.ServicePortal.Api.Common.Exceptions;
using Qib.ServicePortal.Api.Domain.Entities;
using Qib.ServicePortal.Api.Infrastructure.Data;

namespace Qib.ServicePortal.Api.Controllers;

[ApiController]
[Route("api/dotnet/v1/roles")]
[Authorize(Policy = "Permission:roles.view")]
public class RolesController(ServicePortalDbContext db, IAuditService auditService) : ControllerBase
{
    [HttpGet]
    public async Task<ActionResult<IReadOnlyCollection<object>>> GetRoles(CancellationToken cancellationToken)
    {
        var roles = await db.Roles
            .Include(x => x.Users)
            .AsNoTracking()
            .OrderByDescending(x => x.IsSystem)
            .ThenBy(x => x.NameAr)
            .ToListAsync(cancellationToken);
        return Ok(roles.Select(MapRole).ToList());
    }

    [HttpPost]
    [Authorize(Policy = "Permission:roles.manage")]
    public async Task<ActionResult<object>> CreateRole([FromBody] JsonElement request, CancellationToken cancellationToken)
    {
        var code = RequiredString(request, "code").Trim();
        if (await db.Roles.AnyAsync(x => x.Code == code, cancellationToken))
        {
            throw new ApiException("رمز الدور مستخدم مسبقاً");
        }

        var role = new Role
        {
            Code = code,
            NameAr = RequiredString(request, "name_ar", "role_name_ar", "nameAr").Trim(),
            NameEn = StringProp(request, "name_en", "role_name_en", "nameEn")?.Trim(),
            Description = StringProp(request, "description")?.Trim(),
            IsActive = BoolProp(request, true, "is_active", "isActive"),
            IsSystem = false
        };
        db.Roles.Add(role);
        await db.SaveChangesAsync(cancellationToken);
        await auditService.LogAsync("role_created", "role", role.Id.ToString(), newValue: new { role.Code, role.NameAr }, cancellationToken: cancellationToken);
        return Ok(MapRole(role));
    }

    [HttpPut("{id:long}")]
    [Authorize(Policy = "Permission:roles.manage")]
    public async Task<ActionResult<object>> UpdateRole(long id, [FromBody] JsonElement request, CancellationToken cancellationToken)
    {
        var role = await db.Roles.Include(x => x.Users).FirstOrDefaultAsync(x => x.Id == id, cancellationToken)
                   ?? throw new ApiException("الدور غير موجود", StatusCodes.Status404NotFound);
        var requestedCode = RequiredString(request, "code").Trim();

        if (!role.IsSystem && await db.Roles.AnyAsync(x => x.Id != id && x.Code == requestedCode, cancellationToken))
        {
            throw new ApiException("رمز الدور مستخدم مسبقاً");
        }

        var oldValue = new { role.Code, role.NameAr, role.IsActive };
        if (!role.IsSystem)
        {
            role.Code = requestedCode;
        }

        role.NameAr = RequiredString(request, "name_ar", "role_name_ar", "nameAr").Trim();
        role.NameEn = StringProp(request, "name_en", "role_name_en", "nameEn")?.Trim();
        role.Description = StringProp(request, "description")?.Trim();
        role.IsActive = BoolProp(request, role.IsActive, "is_active", "isActive");

        await db.SaveChangesAsync(cancellationToken);
        await auditService.LogAsync("role_updated", "role", role.Id.ToString(), oldValue: oldValue, newValue: new { role.Code, role.NameAr, role.IsActive }, cancellationToken: cancellationToken);
        return Ok(MapRole(role));
    }

    [HttpPost("{id:long}/clone")]
    [Authorize(Policy = "Permission:roles.manage")]
    public async Task<ActionResult<object>> CloneRole(long id, CancellationToken cancellationToken)
    {
        var role = await db.Roles.Include(x => x.RolePermissions).FirstOrDefaultAsync(x => x.Id == id, cancellationToken)
                   ?? throw new ApiException("الدور غير موجود", StatusCodes.Status404NotFound);
        var baseCode = $"{role.Code}_copy";
        var code = baseCode;
        var counter = 1;
        while (await db.Roles.AnyAsync(x => x.Code == code, cancellationToken))
        {
            counter += 1;
            code = $"{baseCode}_{counter}";
        }

        var clone = new Role
        {
            Code = code,
            NameAr = $"نسخة من {role.NameAr}",
            NameEn = $"Copy of {role.NameEn ?? role.Code}",
            Description = role.Description,
            IsActive = true,
            IsSystem = false
        };
        db.Roles.Add(clone);
        await db.SaveChangesAsync(cancellationToken);
        foreach (var permission in role.RolePermissions.Where(x => x.IsAllowed))
        {
            db.RolePermissions.Add(new RolePermission { RoleId = clone.Id, PermissionId = permission.PermissionId, IsAllowed = true });
        }

        await db.SaveChangesAsync(cancellationToken);
        await auditService.LogAsync("role_cloned", "role", clone.Id.ToString(), metadata: new { source_role_id = id }, cancellationToken: cancellationToken);
        return Ok(MapRole(clone));
    }

    [HttpDelete("{id:long}")]
    [Authorize(Policy = "Permission:roles.manage")]
    public async Task<IActionResult> DeleteRole(long id, CancellationToken cancellationToken)
    {
        var role = await db.Roles.Include(x => x.Users).FirstOrDefaultAsync(x => x.Id == id, cancellationToken)
                   ?? throw new ApiException("الدور غير موجود", StatusCodes.Status404NotFound);
        if (role.IsSystem)
        {
            throw new ApiException("لا يمكن حذف دور نظامي", StatusCodes.Status409Conflict);
        }

        if (role.Users.Count > 0)
        {
            throw new ApiException("لا يمكن حذف دور مرتبط بمستخدمين. عطّل الدور أو انقل المستخدمين أولاً.", StatusCodes.Status409Conflict);
        }

        db.Roles.Remove(role);
        await db.SaveChangesAsync(cancellationToken);
        await auditService.LogAsync("role_deleted", "role", id.ToString(), oldValue: new { role.Code, role.NameAr }, cancellationToken: cancellationToken);
        return Ok(new { success = true });
    }

    [HttpPut("{id:long}/permissions")]
    [Authorize(Policy = "Permission:permissions.manage")]
    public async Task<IActionResult> UpdateRolePermissions(long id, [FromBody] JsonElement request, CancellationToken cancellationToken)
    {
        var codes = request.TryGetProperty("permissionCodes", out var camel)
            ? camel.EnumerateArray().Select(x => x.GetString()).Where(x => !string.IsNullOrWhiteSpace(x)).Select(x => x!).ToList()
            : request.TryGetProperty("permission_codes", out var snake)
                ? snake.EnumerateArray().Select(x => x.GetString()).Where(x => !string.IsNullOrWhiteSpace(x)).Select(x => x!).ToList()
                : [];
        var role = await db.Roles.FirstOrDefaultAsync(x => x.Id == id, cancellationToken)
                   ?? throw new ApiException("الدور غير موجود", StatusCodes.Status404NotFound);
        var permissions = await db.Permissions.Where(x => codes.Contains(x.Code) && x.IsActive).ToListAsync(cancellationToken);
        if (permissions.Count != codes.Distinct(StringComparer.OrdinalIgnoreCase).Count())
        {
            throw new ApiException("توجد صلاحيات غير صحيحة في الطلب");
        }

        var oldCodes = await db.RolePermissions
            .Include(x => x.Permission)
            .Where(x => x.RoleId == id && x.Permission != null)
            .Select(x => x.Permission!.Code)
            .ToListAsync(cancellationToken);

        db.RolePermissions.RemoveRange(db.RolePermissions.Where(x => x.RoleId == id));
        db.RolePermissions.AddRange(permissions.Select(permission => new RolePermission
        {
            RoleId = role.Id,
            PermissionId = permission.Id,
            IsAllowed = true
        }));

        await db.SaveChangesAsync(cancellationToken);
        await auditService.LogAsync("role_permissions_updated", "role", role.Id.ToString(), oldValue: oldCodes, newValue: codes, cancellationToken: cancellationToken);
        return Ok(new { success = true });
    }

    private static object MapRole(Role role)
    {
        return new
        {
            role.Id,
            role.Code,
            name_ar = role.NameAr,
            role_name_ar = role.NameAr,
            name_en = role.NameEn,
            role_name_en = role.NameEn,
            role.Description,
            is_system = role.IsSystem,
            is_system_role = role.IsSystem,
            is_active = role.IsActive,
            users_count = role.Users?.Count ?? 0,
            created_at = role.CreatedAt,
            updated_at = role.UpdatedAt
        };
    }

    private static string RequiredString(JsonElement json, params string[] names)
    {
        var value = StringProp(json, names);
        if (string.IsNullOrWhiteSpace(value))
        {
            throw new ApiException("توجد حقول مطلوبة غير مكتملة");
        }

        return value;
    }

    private static string? StringProp(JsonElement json, params string[] names)
    {
        foreach (var name in names)
        {
            if (TryGetProperty(json, name, out var value))
            {
                return value.ValueKind == JsonValueKind.String ? value.GetString() : value.ToString();
            }
        }

        return null;
    }

    private static bool BoolProp(JsonElement json, bool defaultValue, params string[] names)
    {
        foreach (var name in names)
        {
            if (!TryGetProperty(json, name, out var value))
            {
                continue;
            }

            if (value.ValueKind == JsonValueKind.True)
            {
                return true;
            }

            if (value.ValueKind == JsonValueKind.False)
            {
                return false;
            }
        }

        return defaultValue;
    }

    private static bool TryGetProperty(JsonElement json, string name, out JsonElement value)
    {
        if (json.ValueKind == JsonValueKind.Object && json.TryGetProperty(name, out value))
        {
            return true;
        }

        if (json.ValueKind == JsonValueKind.Object)
        {
            foreach (var property in json.EnumerateObject())
            {
                if (string.Equals(property.Name, name, StringComparison.OrdinalIgnoreCase))
                {
                    value = property.Value;
                    return true;
                }
            }
        }

        value = default;
        return false;
    }
}
