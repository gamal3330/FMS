using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using System.Text.Json;
using Qib.ServicePortal.Api.Application.Interfaces;
using Qib.ServicePortal.Api.Common.Exceptions;
using Qib.ServicePortal.Api.Domain.Entities;
using Qib.ServicePortal.Api.Infrastructure.Data;

namespace Qib.ServicePortal.Api.Controllers;

[ApiController]
[Route("api/dotnet/v1/specialized-sections")]
[Authorize]
public class SpecializedSectionsController(ServicePortalDbContext db, IAuditService auditService) : ControllerBase
{
    [HttpGet]
    [HttpGet("/api/dotnet/v1/settings/specialized-sections")]
    public async Task<ActionResult<IReadOnlyCollection<object>>> GetSpecializedSections(
        [FromQuery] string? search,
        [FromQuery] bool? activeOnly,
        [FromQuery(Name = "active_only")] bool? activeOnlySnake,
        CancellationToken cancellationToken)
    {
        var query = db.SpecializedSections
            .Include(x => x.Department)
            .Include(x => x.ManagerUser)
            .Include(x => x.DefaultAssigneeUser)
            .AsNoTracking();
        if (activeOnly == true || activeOnlySnake == true)
        {
            query = query.Where(x => x.IsActive);
        }
        if (!string.IsNullOrWhiteSpace(search))
        {
            var value = search.Trim().ToLowerInvariant();
            query = query.Where(x =>
                x.Code.ToLower().Contains(value) ||
                x.NameAr.ToLower().Contains(value) ||
                (x.NameEn != null && x.NameEn.ToLower().Contains(value)) ||
                (x.Description != null && x.Description.ToLower().Contains(value)) ||
                (x.Department != null && x.Department.NameAr.ToLower().Contains(value)));
        }

        var sections = await query
            .OrderByDescending(x => x.IsActive)
            .ThenBy(x => x.NameAr)
            .ToListAsync(cancellationToken);

        return Ok(sections.Select(MapSection).ToList());
    }

    [HttpPost]
    [HttpPost("/api/dotnet/v1/settings/specialized-sections")]
    [Authorize(Policy = "Permission:request_types.manage")]
    public async Task<ActionResult<object>> CreateSpecializedSection([FromBody] JsonElement request, CancellationToken cancellationToken)
    {
        var code = RequiredString(request, "code").Trim();
        var nameAr = RequiredString(request, "name_ar", "nameAr").Trim();
        var nameEn = StringProp(request, "name_en", "nameEn")?.Trim();
        var description = StringProp(request, "description")?.Trim();
        var departmentId = LongProp(request, "department_id", "departmentId");
        var managerUserId = LongProp(request, "manager_id", "manager_user_id", "managerUserId");
        var defaultAssigneeUserId = LongProp(request, "default_assignee_user_id", "defaultAssigneeUserId");
        await ValidateSectionRequestAsync(null, code, nameAr, departmentId, managerUserId, defaultAssigneeUserId, cancellationToken);

        var section = new SpecializedSection
        {
            Code = code,
            NameAr = nameAr,
            NameEn = string.IsNullOrWhiteSpace(nameEn) ? null : nameEn,
            Description = string.IsNullOrWhiteSpace(description) ? null : description,
            DepartmentId = departmentId,
            ManagerUserId = managerUserId,
            DefaultAssigneeUserId = defaultAssigneeUserId,
            AllowManualAssignment = BoolProp(request, true, "allow_manual_assignment", "allowManualAssignment"),
            AutoAssignStrategy = StringProp(request, "auto_assign_strategy", "autoAssignStrategy")?.Trim() ?? "none",
            IsActive = BoolProp(request, true, "is_active", "isActive")
        };

        db.SpecializedSections.Add(section);
        await db.SaveChangesAsync(cancellationToken);
        await auditService.LogAsync("specialized_section_created", "specialized_section", section.Id.ToString(), newValue: new { section.Code, section.NameAr, section.DepartmentId }, cancellationToken: cancellationToken);

        var created = await LoadSection(section.Id).AsNoTracking().FirstAsync(cancellationToken);
        return Ok(MapSection(created));
    }

    [HttpPut("{id:long}")]
    [HttpPut("/api/dotnet/v1/settings/specialized-sections/{id:long}")]
    [Authorize(Policy = "Permission:request_types.manage")]
    public async Task<ActionResult<object>> UpdateSpecializedSection(long id, [FromBody] JsonElement request, CancellationToken cancellationToken)
    {
        var section = await db.SpecializedSections.FirstOrDefaultAsync(x => x.Id == id, cancellationToken)
                      ?? throw new ApiException("القسم المختص غير موجود", StatusCodes.Status404NotFound);

        var code = RequiredString(request, "code").Trim();
        var nameAr = RequiredString(request, "name_ar", "nameAr").Trim();
        var nameEn = StringProp(request, "name_en", "nameEn")?.Trim();
        var description = StringProp(request, "description")?.Trim();
        var departmentId = LongProp(request, "department_id", "departmentId");
        var managerUserId = LongProp(request, "manager_id", "manager_user_id", "managerUserId");
        var defaultAssigneeUserId = LongProp(request, "default_assignee_user_id", "defaultAssigneeUserId");
        await ValidateSectionRequestAsync(id, code, nameAr, departmentId, managerUserId, defaultAssigneeUserId, cancellationToken);

        var oldValue = new { section.Code, section.NameAr, section.DepartmentId, section.IsActive };
        section.Code = code;
        section.NameAr = nameAr;
        section.NameEn = string.IsNullOrWhiteSpace(nameEn) ? null : nameEn;
        section.Description = string.IsNullOrWhiteSpace(description) ? null : description;
        section.DepartmentId = departmentId;
        section.ManagerUserId = managerUserId;
        section.DefaultAssigneeUserId = defaultAssigneeUserId;
        section.AllowManualAssignment = BoolProp(request, section.AllowManualAssignment, "allow_manual_assignment", "allowManualAssignment");
        section.AutoAssignStrategy = StringProp(request, "auto_assign_strategy", "autoAssignStrategy")?.Trim() ?? section.AutoAssignStrategy;
        section.IsActive = BoolProp(request, section.IsActive, "is_active", "isActive");

        await db.SaveChangesAsync(cancellationToken);
        await auditService.LogAsync("specialized_section_updated", "specialized_section", section.Id.ToString(), oldValue: oldValue, newValue: new { section.Code, section.NameAr, section.DepartmentId, section.IsActive }, cancellationToken: cancellationToken);

        var updated = await LoadSection(section.Id).AsNoTracking().FirstAsync(cancellationToken);
        return Ok(MapSection(updated));
    }

    [HttpPatch("{id:long}/status")]
    [HttpPatch("/api/dotnet/v1/settings/specialized-sections/{id:long}/status")]
    [Authorize(Policy = "Permission:request_types.manage")]
    public async Task<ActionResult<object>> UpdateSpecializedSectionStatus(long id, [FromBody] JsonElement request, CancellationToken cancellationToken)
    {
        var section = await db.SpecializedSections.FirstOrDefaultAsync(x => x.Id == id, cancellationToken)
                      ?? throw new ApiException("القسم المختص غير موجود", StatusCodes.Status404NotFound);
        var oldValue = new { section.IsActive };
        section.IsActive = BoolProp(request, section.IsActive, "is_active", "isActive", "active");
        await db.SaveChangesAsync(cancellationToken);
        await auditService.LogAsync("specialized_section_status_updated", "specialized_section", section.Id.ToString(), oldValue: oldValue, newValue: new { section.IsActive }, cancellationToken: cancellationToken);

        var updated = await LoadSection(section.Id).AsNoTracking().FirstAsync(cancellationToken);
        return Ok(MapSection(updated));
    }

    [HttpDelete("{id:long}")]
    [HttpDelete("/api/dotnet/v1/settings/specialized-sections/{id:long}")]
    [Authorize(Policy = "Permission:request_types.manage")]
    public async Task<IActionResult> DeleteSpecializedSection(long id, CancellationToken cancellationToken)
    {
        var section = await db.SpecializedSections.FirstOrDefaultAsync(x => x.Id == id, cancellationToken)
                      ?? throw new ApiException("القسم المختص غير موجود", StatusCodes.Status404NotFound);

        var blockers = new List<string>();
        if (await db.RequestTypes.AnyAsync(x => x.SpecializedSectionId == id, cancellationToken))
        {
            blockers.Add("يوجد نوع طلب مرتبط بهذا القسم");
        }
        if (await db.Requests.AnyAsync(x => x.SpecializedSectionId == id, cancellationToken))
        {
            blockers.Add("توجد طلبات مرتبطة بهذا القسم");
        }

        if (blockers.Count > 0)
        {
            throw new ApiException(string.Join("، ", blockers), StatusCodes.Status409Conflict);
        }

        var oldValue = new { section.Code, section.NameAr, section.DepartmentId };
        db.SpecializedSections.Remove(section);
        await db.SaveChangesAsync(cancellationToken);
        await auditService.LogAsync("specialized_section_deleted", "specialized_section", id.ToString(), oldValue: oldValue, cancellationToken: cancellationToken);
        return NoContent();
    }

    private IQueryable<SpecializedSection> LoadSection(long id)
    {
        return db.SpecializedSections
            .Include(x => x.Department)
            .Include(x => x.ManagerUser)
            .Include(x => x.DefaultAssigneeUser)
            .Where(x => x.Id == id);
    }

    private async Task ValidateSectionRequestAsync(long? id, string code, string nameAr, long? departmentId, long? managerUserId, long? defaultAssigneeUserId, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(code) || code.Length > 100)
        {
            throw new ApiException("رمز القسم المختص مطلوب ويجب ألا يتجاوز 100 حرف");
        }
        if (!code.All(ch => char.IsLetterOrDigit(ch) || ch == '.' || ch == '_' || ch == '-'))
        {
            throw new ApiException("رمز القسم المختص يجب أن يحتوي على أحرف أو أرقام أو . _ - فقط");
        }
        if (string.IsNullOrWhiteSpace(nameAr) || nameAr.Length > 255)
        {
            throw new ApiException("اسم القسم المختص بالعربية مطلوب ويجب ألا يتجاوز 255 حرفاً");
        }
        if (await db.SpecializedSections.AnyAsync(x => x.Id != id && x.Code == code, cancellationToken))
        {
            throw new ApiException("رمز القسم المختص مستخدم مسبقاً");
        }
        if (departmentId.HasValue && !await db.Departments.AnyAsync(x => x.Id == departmentId.Value && x.IsActive, cancellationToken))
        {
            throw new ApiException("الإدارة المرتبطة غير موجودة أو غير نشطة");
        }
        if (managerUserId.HasValue && !await db.Users.AnyAsync(x => x.Id == managerUserId.Value && x.IsActive, cancellationToken))
        {
            throw new ApiException("مدير القسم المحدد غير صالح");
        }
        if (defaultAssigneeUserId.HasValue && !await db.Users.AnyAsync(x => x.Id == defaultAssigneeUserId.Value && x.IsActive, cancellationToken))
        {
            throw new ApiException("المختص الافتراضي المحدد غير صالح");
        }
    }

    private static object MapSection(SpecializedSection x)
    {
        return new
        {
            x.Id,
            x.Code,
            name_ar = x.NameAr,
            name_en = x.NameEn,
            nameAr = x.NameAr,
            nameEn = x.NameEn,
            description = x.Description,
            department_id = x.DepartmentId,
            departmentId = x.DepartmentId,
            department_name_ar = x.Department?.NameAr,
            departmentNameAr = x.Department?.NameAr,
            manager_user_id = x.ManagerUserId,
            manager_id = x.ManagerUserId,
            managerUserId = x.ManagerUserId,
            manager_name_ar = x.ManagerUser?.NameAr,
            managerUserNameAr = x.ManagerUser?.NameAr,
            default_assignee_user_id = x.DefaultAssigneeUserId,
            defaultAssigneeUserId = x.DefaultAssigneeUserId,
            default_assignee_name_ar = x.DefaultAssigneeUser?.NameAr,
            defaultAssigneeNameAr = x.DefaultAssigneeUser?.NameAr,
            allow_manual_assignment = x.AllowManualAssignment,
            allowManualAssignment = x.AllowManualAssignment,
            auto_assign_strategy = x.AutoAssignStrategy,
            autoAssignStrategy = x.AutoAssignStrategy,
            is_active = x.IsActive,
            isActive = x.IsActive,
            created_at = x.CreatedAt,
            updated_at = x.UpdatedAt
        };
    }

    private static string? StringProp(JsonElement element, params string[] names)
    {
        foreach (var name in names)
        {
            if (element.TryGetProperty(name, out var value) && value.ValueKind != JsonValueKind.Null && value.ValueKind != JsonValueKind.Undefined)
            {
                return value.ValueKind == JsonValueKind.String ? value.GetString() : value.ToString();
            }
        }
        return null;
    }

    private static string RequiredString(JsonElement element, params string[] names)
    {
        var value = StringProp(element, names);
        if (string.IsNullOrWhiteSpace(value))
        {
            throw new ApiException("الحقول المطلوبة غير مكتملة");
        }
        return value;
    }

    private static long? LongProp(JsonElement element, params string[] names)
    {
        foreach (var name in names)
        {
            if (!element.TryGetProperty(name, out var value) || value.ValueKind == JsonValueKind.Null || value.ValueKind == JsonValueKind.Undefined)
            {
                continue;
            }
            if (value.ValueKind == JsonValueKind.Number && value.TryGetInt64(out var number))
            {
                return number;
            }
            if (value.ValueKind == JsonValueKind.String && long.TryParse(value.GetString(), out var parsed))
            {
                return parsed;
            }
        }
        return null;
    }

    private static bool BoolProp(JsonElement element, bool fallback, params string[] names)
    {
        foreach (var name in names)
        {
            if (!element.TryGetProperty(name, out var value) || value.ValueKind == JsonValueKind.Null || value.ValueKind == JsonValueKind.Undefined)
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
            if (value.ValueKind == JsonValueKind.String && bool.TryParse(value.GetString(), out var parsed))
            {
                return parsed;
            }
        }
        return fallback;
    }
}
