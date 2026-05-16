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
[Route("api/dotnet/v1/departments")]
[Authorize(Policy = "Permission:departments.view")]
public class DepartmentsController(ServicePortalDbContext db, IAuditService auditService) : ControllerBase
{
    [HttpGet]
    public async Task<ActionResult<IReadOnlyCollection<object>>> GetDepartments([FromQuery] string? search, CancellationToken cancellationToken)
    {
        var query = db.Departments
            .Include(x => x.ManagerUser)
            .AsNoTracking();

        if (!string.IsNullOrWhiteSpace(search))
        {
            var value = search.Trim().ToLowerInvariant();
            query = query.Where(x =>
                x.Code.ToLower().Contains(value) ||
                x.NameAr.ToLower().Contains(value) ||
                (x.NameEn != null && x.NameEn.ToLower().Contains(value)) ||
                (x.Description != null && x.Description.ToLower().Contains(value)) ||
                (x.ManagerUser != null && x.ManagerUser.NameAr.ToLower().Contains(value)));
        }

        var departments = await query
            .OrderByDescending(x => x.IsActive)
            .ThenBy(x => x.NameAr)
            .ToListAsync(cancellationToken);
        return Ok(departments.Select(MapDepartment).ToList());
    }

    [HttpPost]
    [Authorize(Policy = "Permission:departments.manage")]
    public async Task<ActionResult<object>> CreateDepartment([FromBody] JsonElement request, CancellationToken cancellationToken)
    {
        var code = RequiredString(request, "code").Trim();
        var nameAr = RequiredString(request, "name_ar", "nameAr").Trim();
        var nameEn = StringProp(request, "name_en", "nameEn")?.Trim();
        var description = StringProp(request, "description")?.Trim();
        var parentDepartmentId = LongProp(request, "parent_department_id", "parentDepartmentId");
        var managerUserId = LongProp(request, "manager_id", "manager_user_id", "managerUserId");

        await ValidateDepartmentRequestAsync(null, code, nameAr, parentDepartmentId, managerUserId, cancellationToken);
        var department = new Department
        {
            Code = code,
            NameAr = nameAr,
            NameEn = string.IsNullOrWhiteSpace(nameEn) ? null : nameEn,
            Description = string.IsNullOrWhiteSpace(description) ? null : description,
            ParentDepartmentId = parentDepartmentId,
            ManagerUserId = managerUserId,
            IsActive = BoolProp(request, true, "is_active", "isActive")
        };

        db.Departments.Add(department);
        await db.SaveChangesAsync(cancellationToken);
        await auditService.LogAsync("department_created", "department", department.Id.ToString(), newValue: department, cancellationToken: cancellationToken);
        var created = await db.Departments.Include(x => x.ManagerUser).AsNoTracking().FirstAsync(x => x.Id == department.Id, cancellationToken);
        return Ok(MapDepartment(created));
    }

    [HttpPut("{id:long}")]
    [Authorize(Policy = "Permission:departments.manage")]
    public async Task<ActionResult<object>> UpdateDepartment(long id, [FromBody] JsonElement request, CancellationToken cancellationToken)
    {
        var department = await db.Departments.FirstOrDefaultAsync(x => x.Id == id, cancellationToken)
                         ?? throw new ApiException("الإدارة غير موجودة", StatusCodes.Status404NotFound);

        var code = RequiredString(request, "code").Trim();
        var nameAr = RequiredString(request, "name_ar", "nameAr").Trim();
        var nameEn = StringProp(request, "name_en", "nameEn")?.Trim();
        var description = StringProp(request, "description")?.Trim();
        var parentDepartmentId = LongProp(request, "parent_department_id", "parentDepartmentId");
        var managerUserId = LongProp(request, "manager_id", "manager_user_id", "managerUserId");

        await ValidateDepartmentRequestAsync(id, code, nameAr, parentDepartmentId, managerUserId, cancellationToken);
        if (parentDepartmentId == id)
        {
            throw new ApiException("لا يمكن أن تكون الإدارة تابعة لنفسها");
        }

        var oldValue = new { department.Code, department.NameAr, department.ManagerUserId, department.IsActive };
        department.Code = code;
        department.NameAr = nameAr;
        department.NameEn = string.IsNullOrWhiteSpace(nameEn) ? null : nameEn;
        department.Description = string.IsNullOrWhiteSpace(description) ? null : description;
        department.ParentDepartmentId = parentDepartmentId;
        department.ManagerUserId = managerUserId;
        department.IsActive = BoolProp(request, department.IsActive, "is_active", "isActive");

        await db.SaveChangesAsync(cancellationToken);
        await auditService.LogAsync("department_updated", "department", department.Id.ToString(), oldValue: oldValue, newValue: new { department.Code, department.NameAr, department.ManagerUserId, department.IsActive }, cancellationToken: cancellationToken);
        var updated = await db.Departments.Include(x => x.ManagerUser).AsNoTracking().FirstAsync(x => x.Id == department.Id, cancellationToken);
        return Ok(MapDepartment(updated));
    }

    [HttpPatch("{id:long}/status")]
    [Authorize(Policy = "Permission:departments.manage")]
    public async Task<ActionResult<object>> UpdateDepartmentStatus(long id, [FromBody] JsonElement request, CancellationToken cancellationToken)
    {
        var department = await db.Departments.FirstOrDefaultAsync(x => x.Id == id, cancellationToken)
                         ?? throw new ApiException("الإدارة غير موجودة", StatusCodes.Status404NotFound);
        var oldValue = new { department.IsActive };
        department.IsActive = BoolProp(request, department.IsActive, "is_active", "isActive", "active");
        await db.SaveChangesAsync(cancellationToken);
        await auditService.LogAsync("department_status_updated", "department", department.Id.ToString(), oldValue: oldValue, newValue: new { department.IsActive }, cancellationToken: cancellationToken);
        var updated = await db.Departments.Include(x => x.ManagerUser).AsNoTracking().FirstAsync(x => x.Id == id, cancellationToken);
        return Ok(MapDepartment(updated));
    }

    [HttpDelete("{id:long}")]
    [Authorize(Policy = "Permission:departments.manage")]
    public async Task<IActionResult> DeleteDepartment(long id, CancellationToken cancellationToken)
    {
        var department = await db.Departments.FirstOrDefaultAsync(x => x.Id == id, cancellationToken)
                         ?? throw new ApiException("الإدارة غير موجودة", StatusCodes.Status404NotFound);

        var blockers = new List<string>();
        if (await db.Users.AnyAsync(x => x.DepartmentId == id, cancellationToken))
        {
            blockers.Add("يوجد مستخدمون مرتبطون بهذه الإدارة");
        }
        if (await db.Departments.AnyAsync(x => x.ParentDepartmentId == id, cancellationToken))
        {
            blockers.Add("توجد إدارات فرعية مرتبطة بهذه الإدارة");
        }
        if (await db.SpecializedSections.AnyAsync(x => x.DepartmentId == id, cancellationToken))
        {
            blockers.Add("توجد أقسام مختصة مرتبطة بهذه الإدارة");
        }
        if (await db.Requests.AnyAsync(x => x.DepartmentId == id, cancellationToken))
        {
            blockers.Add("توجد طلبات مرتبطة بهذه الإدارة");
        }
        if (await db.Documents.AnyAsync(x => x.OwnerDepartmentId == id, cancellationToken))
        {
            blockers.Add("توجد وثائق مرتبطة بهذه الإدارة");
        }

        if (blockers.Count > 0)
        {
            throw new ApiException(string.Join("، ", blockers), StatusCodes.Status409Conflict);
        }

        var oldValue = new { department.Code, department.NameAr };
        db.Departments.Remove(department);
        await db.SaveChangesAsync(cancellationToken);
        await auditService.LogAsync("department_deleted", "department", id.ToString(), oldValue: oldValue, cancellationToken: cancellationToken);
        return NoContent();
    }

    private async Task ValidateDepartmentRequestAsync(long? id, string code, string nameAr, long? parentDepartmentId, long? managerUserId, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(code) || code.Length > 100)
        {
            throw new ApiException("رمز الإدارة مطلوب ويجب ألا يتجاوز 100 حرف");
        }
        if (!code.All(ch => char.IsLetterOrDigit(ch) || ch == '.' || ch == '_' || ch == '-'))
        {
            throw new ApiException("رمز الإدارة يجب أن يحتوي على أحرف أو أرقام أو . _ - فقط");
        }
        if (string.IsNullOrWhiteSpace(nameAr) || nameAr.Length > 255)
        {
            throw new ApiException("اسم الإدارة بالعربية مطلوب ويجب ألا يتجاوز 255 حرفاً");
        }
        if (await db.Departments.AnyAsync(x => x.Id != id && x.Code == code, cancellationToken))
        {
            throw new ApiException("رمز الإدارة مستخدم مسبقاً");
        }

        if (parentDepartmentId.HasValue && !await db.Departments.AnyAsync(x => x.Id == parentDepartmentId.Value, cancellationToken))
        {
            throw new ApiException("الإدارة الرئيسية غير موجودة");
        }

        if (managerUserId.HasValue && !await db.Users.AnyAsync(x => x.Id == managerUserId.Value && x.IsActive, cancellationToken))
        {
            throw new ApiException("مدير الإدارة المحدد غير صالح");
        }
    }

    private static object MapDepartment(Department department)
    {
        return new
        {
            department.Id,
            department.Code,
            name_ar = department.NameAr,
            name_en = department.NameEn,
            nameAr = department.NameAr,
            nameEn = department.NameEn,
            description = department.Description,
            parent_department_id = department.ParentDepartmentId,
            parentDepartmentId = department.ParentDepartmentId,
            manager_user_id = department.ManagerUserId,
            manager_id = department.ManagerUserId,
            managerUserId = department.ManagerUserId,
            manager_name_ar = department.ManagerUser?.NameAr,
            managerUserNameAr = department.ManagerUser?.NameAr,
            is_active = department.IsActive,
            isActive = department.IsActive,
            created_at = department.CreatedAt,
            updated_at = department.UpdatedAt
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
