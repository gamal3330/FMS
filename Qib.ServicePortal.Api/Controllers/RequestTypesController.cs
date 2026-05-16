using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using System.Text.Json;
using Qib.ServicePortal.Api.Application.DTOs;
using Qib.ServicePortal.Api.Application.Interfaces;
using Qib.ServicePortal.Api.Common.Exceptions;
using Qib.ServicePortal.Api.Domain.Entities;
using Qib.ServicePortal.Api.Infrastructure.Data;

namespace Qib.ServicePortal.Api.Controllers;

[ApiController]
[Route("api/dotnet/v1/request-types")]
[Authorize]
public class RequestTypesController(ServicePortalDbContext db, ICurrentUserService currentUser, IAuditService auditService, ISettingsStore settingsStore) : ControllerBase
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);
    private static readonly HashSet<string> ImageExtensionAliases = ["image", "images", "photo", "photos", "picture", "pictures", "صورة", "صور"];
    private static readonly string[] ImageExtensions = ["png", "jpg", "jpeg", "webp", "heic", "heif"];

    [HttpGet("bootstrap")]
    [Authorize(Policy = "Permission:request_types.view")]
    public async Task<IActionResult> Bootstrap(
        [FromQuery] string? search,
        [FromQuery] string? status,
        CancellationToken cancellationToken)
    {
        var query = BootstrapRequestTypeQuery().AsNoTracking();
        if (!string.IsNullOrWhiteSpace(search))
        {
            var value = search.Trim().ToLowerInvariant();
            query = query.Where(x =>
                x.NameAr.ToLower().Contains(value) ||
                x.Code.ToLower().Contains(value) ||
                (x.NameEn != null && x.NameEn.ToLower().Contains(value)));
        }

        if (string.Equals(status, "active", StringComparison.OrdinalIgnoreCase))
        {
            query = query.Where(x => x.IsActive);
        }
        else if (string.Equals(status, "inactive", StringComparison.OrdinalIgnoreCase))
        {
            query = query.Where(x => !x.IsActive);
        }

        var requestTypes = await query
            .OrderBy(x => x.SortOrder)
            .ThenBy(x => x.NameAr)
            .ToListAsync(cancellationToken);

        var departments = await db.Departments
            .AsNoTracking()
            .OrderBy(x => x.NameAr)
            .Select(x => new
            {
                x.Id,
                x.Code,
                name_ar = x.NameAr,
                name_en = x.NameEn,
                parent_department_id = x.ParentDepartmentId,
                manager_user_id = x.ManagerUserId,
                is_active = x.IsActive
            })
            .ToListAsync(cancellationToken);

        var sections = await db.SpecializedSections
            .Include(x => x.Department)
            .AsNoTracking()
            .OrderBy(x => x.NameAr)
            .Select(x => new
            {
                x.Id,
                x.Code,
                name_ar = x.NameAr,
                name_en = x.NameEn,
                department_id = x.DepartmentId,
                department_name_ar = x.Department != null ? x.Department.NameAr : null,
                manager_user_id = x.ManagerUserId,
                default_assignee_user_id = x.DefaultAssigneeUserId,
                allow_manual_assignment = x.AllowManualAssignment,
                auto_assign_strategy = x.AutoAssignStrategy,
                is_active = x.IsActive
            })
            .ToListAsync(cancellationToken);

        var priorities = await db.PrioritySettings
            .AsNoTracking()
            .Where(x => x.IsActive)
            .OrderBy(x => x.SortOrder)
            .Select(x => new
            {
                x.Id,
                x.Code,
                name_ar = x.NameAr,
                name_en = x.NameEn,
                x.Color,
                response_hours = x.ResponseHours,
                resolution_hours = x.ResolutionHours
            })
            .ToListAsync(cancellationToken);

        return Ok(new
        {
            request_types = requestTypes.Select(ToLegacyRequestType).ToList(),
            departments,
            specialized_sections = sections,
            priorities
        });
    }

    [HttpGet("/api/dotnet/v1/settings/request-management/overview")]
    [Authorize(Policy = "Permission:request_types.view")]
    public async Task<IActionResult> Overview(CancellationToken cancellationToken)
    {
        var requestTypes = await db.RequestTypes
            .Include(x => x.SpecializedSection)
            .Include(x => x.CurrentVersion)
            .ThenInclude(x => x!.Settings)
            .Include(x => x.CurrentVersion)
            .ThenInclude(x => x!.WorkflowSteps)
            .AsNoTracking()
            .ToListAsync(cancellationToken);

        return Ok(new
        {
            total_request_types = requestTypes.Count,
            active_request_types = requestTypes.Count(x => x.IsActive),
            inactive_request_types = requestTypes.Count(x => !x.IsActive),
            missing_workflow = requestTypes.Count(x => x.CurrentVersion is null || x.CurrentVersion.WorkflowSteps.All(step => !step.IsActive)),
            missing_specialized_section = requestTypes.Count(x => x.SpecializedSectionId is null),
            requires_attachment = requestTypes.Count(x => x.CurrentVersion?.Settings?.RequiresAttachment == true),
            has_sla = requestTypes.Count(x => x.CurrentVersion?.Settings is { SlaResponseHours: not null } || x.CurrentVersion?.Settings is { SlaResolutionHours: not null }),
            last_updated_at = requestTypes.Count == 0 ? (DateTimeOffset?)null : requestTypes.Max(x => x.UpdatedAt)
        });
    }

    [HttpGet]
    [Authorize(Policy = "Permission:request_types.view")]
    public async Task<IActionResult> GetRequestTypes(
        [FromQuery] string? search,
        [FromQuery] bool? isActive,
        CancellationToken cancellationToken)
    {
        var query = BaseRequestTypeQuery().AsNoTracking();
        if (!string.IsNullOrWhiteSpace(search))
        {
            var value = search.Trim().ToLowerInvariant();
            query = query.Where(x => x.NameAr.ToLower().Contains(value) || x.Code.ToLower().Contains(value) || (x.NameEn != null && x.NameEn.ToLower().Contains(value)));
        }

        if (isActive.HasValue)
        {
            query = query.Where(x => x.IsActive == isActive.Value);
        }

        var items = await query.OrderBy(x => x.SortOrder).ThenBy(x => x.NameAr).ToListAsync(cancellationToken);
        return Ok(items.Select(ToLegacyRequestType).ToList());
    }

    [HttpGet("active")]
    [Authorize(Policy = "Permission:requests.view")]
    public async Task<IActionResult> GetActiveRequestTypes(CancellationToken cancellationToken)
    {
        var items = await BaseRequestTypeQuery()
            .AsNoTracking()
            .Where(x => x.IsActive && x.CurrentVersion != null && x.CurrentVersion.Status == "active" && x.CurrentVersion.Settings != null && x.CurrentVersion.Settings.ShowInEmployeePortal)
            .OrderBy(x => x.SortOrder)
            .ThenBy(x => x.NameAr)
            .ToListAsync(cancellationToken);
        return Ok(items.Select(ToLegacyRequestType).ToList());
    }

    [HttpGet("{id:long}")]
    [Authorize(Policy = "Permission:request_types.view")]
    public async Task<IActionResult> GetRequestType(long id, CancellationToken cancellationToken)
    {
        var item = await BootstrapRequestTypeQuery().AsNoTracking().FirstOrDefaultAsync(x => x.Id == id, cancellationToken)
                   ?? throw new ApiException("نوع الطلب غير موجود", StatusCodes.Status404NotFound);
        return Ok(ToLegacyRequestType(item));
    }

    [HttpPost]
    [Authorize(Policy = "Permission:request_types.manage")]
    public async Task<ActionResult<object>> CreateRequestType(CreateRequestTypeRequest request, CancellationToken cancellationToken)
    {
        var specializedSectionId = await ResolveSpecializedSectionIdAsync(request.SpecializedSectionId, request.AssignedSection, cancellationToken);
        var defaultPriority = NormalizePriorityCode(request.DefaultPriority);
        await EnsureRequestTypeReferencesAsync(specializedSectionId, defaultPriority, cancellationToken);
        if (await db.RequestTypes.AnyAsync(x => x.Code == request.Code, cancellationToken))
        {
            throw new ApiException("رمز نوع الطلب مستخدم مسبقاً");
        }

        var requestType = new RequestType
        {
            NameAr = request.NameAr.Trim(),
            NameEn = request.NameEn?.Trim(),
            Code = request.Code.Trim(),
            Category = request.Category?.Trim(),
            Description = request.Description?.Trim(),
            Icon = request.Icon?.Trim(),
            Color = request.Color?.Trim(),
            SpecializedSectionId = specializedSectionId,
            IsActive = false,
            SortOrder = request.SortOrder
        };

        db.RequestTypes.Add(requestType);
        await db.SaveChangesAsync(cancellationToken);

        var version = new RequestTypeVersion
        {
            RequestTypeId = requestType.Id,
            VersionNumber = 1,
            Status = "draft",
            ChangeSummary = "النسخة الأولى",
            CreatedByUserId = currentUser.UserId
        };
        db.RequestTypeVersions.Add(version);
        await db.SaveChangesAsync(cancellationToken);

        db.RequestTypeSettings.Add(new RequestTypeSettings
        {
            RequestTypeId = requestType.Id,
            VersionId = version.Id,
            DefaultPriority = defaultPriority,
            RequiresAttachment = request.RequiresAttachment,
            AllowMultipleAttachments = request.AllowMultipleAttachments,
            RequireAttachmentBeforeSubmit = request.RequiresAttachment
        });
        requestType.CurrentVersionId = version.Id;
        await db.SaveChangesAsync(cancellationToken);
        await auditService.LogAsync("request_type_created", "request_type", requestType.Id.ToString(), newValue: new { requestType.Code, requestType.NameAr }, cancellationToken: cancellationToken);

        var created = await BaseRequestTypeQuery().AsNoTracking().FirstAsync(x => x.Id == requestType.Id, cancellationToken);
        return CreatedAtAction(nameof(GetRequestType), new { id = requestType.Id }, ToLegacyRequestType(created));
    }

    [HttpPut("{id:long}")]
    [Authorize(Policy = "Permission:request_types.manage")]
    public async Task<ActionResult<object>> UpdateRequestType(long id, UpdateRequestTypeRequest request, CancellationToken cancellationToken)
    {
        var requestType = await db.RequestTypes
            .FirstOrDefaultAsync(x => x.Id == id, cancellationToken)
            ?? throw new ApiException("نوع الطلب غير موجود", StatusCodes.Status404NotFound);

        var specializedSectionId = await ResolveSpecializedSectionIdAsync(request.SpecializedSectionId, request.AssignedSection, cancellationToken);
        var defaultPriority = NormalizePriorityCode(request.DefaultPriority);
        var allowedExtensionsJson = NormalizeAllowedExtensionsJson(request.AllowedExtensionsJson);
        await EnsureRequestTypeReferencesAsync(specializedSectionId, defaultPriority, cancellationToken);
        await ValidateAttachmentRulesAsync(request.MaxAttachments, request.MaxFileSizeMb, allowedExtensionsJson, cancellationToken);

        var oldValue = new { requestType.NameAr, requestType.SpecializedSectionId, requestType.IsActive };
        requestType.NameAr = request.NameAr.Trim();
        requestType.NameEn = request.NameEn?.Trim();
        requestType.Category = request.Category?.Trim();
        requestType.Description = request.Description?.Trim();
        requestType.Icon = request.Icon?.Trim();
        requestType.Color = request.Color?.Trim();
        requestType.SpecializedSectionId = specializedSectionId;
        requestType.SortOrder = request.SortOrder;

        var editableVersion = await db.RequestTypeVersions
            .Include(x => x.Settings)
            .Where(x => x.RequestTypeId == id && x.Status == "draft")
            .OrderByDescending(x => x.VersionNumber)
            .FirstOrDefaultAsync(cancellationToken)
            ?? await db.RequestTypeVersions
                .Include(x => x.Settings)
                .Where(x => x.Id == requestType.CurrentVersionId)
                .FirstOrDefaultAsync(cancellationToken);

        var settings = editableVersion?.Settings;
        if (settings is not null)
        {
            settings.DefaultPriority = defaultPriority;
            settings.RequiresAttachment = request.RequiresAttachment;
            settings.AllowMultipleAttachments = request.AllowMultipleAttachments;
            settings.MaxAttachments = request.MaxAttachments;
            settings.MaxFileSizeMb = request.MaxFileSizeMb;
            settings.AllowedExtensionsJson = allowedExtensionsJson;
            settings.RequireAttachmentBeforeSubmit = request.RequiresAttachment;
            settings.SlaResponseHours = request.SlaResponseHours;
            settings.SlaResolutionHours = request.SlaResolutionHours;
            settings.ShowInEmployeePortal = request.ShowInEmployeePortal;
            settings.RequiresManager = request.RequiresManager;
            settings.AllowCancelByRequester = request.AllowCancelByRequester;
            settings.AllowReopen = request.AllowReopen;
            settings.AllowEditBeforeApproval = request.AllowEditBeforeApproval;
        }

        await db.SaveChangesAsync(cancellationToken);
        await auditService.LogAsync("request_type_updated", "request_type", requestType.Id.ToString(), oldValue: oldValue, newValue: new { requestType.NameAr, requestType.SpecializedSectionId, settings?.DefaultPriority }, cancellationToken: cancellationToken);

        var updated = await BaseRequestTypeQuery().AsNoTracking().FirstAsync(x => x.Id == requestType.Id, cancellationToken);
        return Ok(ToLegacyRequestType(updated));
    }

    [HttpPatch("{id:long}/status")]
    [Authorize(Policy = "Permission:request_types.manage")]
    public async Task<IActionResult> PatchStatus(long id, PatchRequestTypeStatusRequest request, CancellationToken cancellationToken)
    {
        var requestType = await db.RequestTypes
            .Include(x => x.CurrentVersion)
            .ThenInclude(x => x!.Settings)
            .Include(x => x.SpecializedSection)
            .FirstOrDefaultAsync(x => x.Id == id, cancellationToken)
            ?? throw new ApiException("نوع الطلب غير موجود", StatusCodes.Status404NotFound);

        if (request.IsActive && requestType.CurrentVersion?.Status != "active")
        {
            throw new ApiException("لا يمكن تفعيل نوع الطلب قبل نشر نسخة فعالة");
        }

        requestType.IsActive = request.IsActive;
        await db.SaveChangesAsync(cancellationToken);
        await auditService.LogAsync(request.IsActive ? "request_type_enabled" : "request_type_disabled", "request_type", id.ToString(), cancellationToken: cancellationToken);
        return Ok(ToLegacyRequestType(requestType));
    }

    [HttpDelete("{id:long}")]
    [Authorize(Policy = "Permission:request_types.manage")]
    public async Task<IActionResult> DeleteRequestType(long id, CancellationToken cancellationToken)
    {
        var requestType = await db.RequestTypes.FirstOrDefaultAsync(x => x.Id == id, cancellationToken)
            ?? throw new ApiException("نوع الطلب غير موجود", StatusCodes.Status404NotFound);

        if (await db.Requests.AnyAsync(x => x.RequestTypeId == id, cancellationToken))
        {
            throw new ApiException("لا يمكن حذف نوع طلب توجد عليه طلبات. يمكنك تعطيله بدلاً من الحذف.", StatusCodes.Status409Conflict);
        }

        var oldValue = new { requestType.Code, requestType.NameAr };
        requestType.CurrentVersionId = null;
        await db.SaveChangesAsync(cancellationToken);

        db.RequestTypes.Remove(requestType);
        await db.SaveChangesAsync(cancellationToken);
        await auditService.LogAsync("request_type_deleted", "request_type", id.ToString(), oldValue: oldValue, cancellationToken: cancellationToken);
        return NoContent();
    }

    [HttpGet("{id:long}/fields")]
    [Authorize(Policy = "Permission:request_types.view")]
    public async Task<IActionResult> GetLegacyFields(long id, CancellationToken cancellationToken)
    {
        var version = await GetDisplayVersionForRequestTypeAsync(id, cancellationToken);
        var fields = await db.RequestTypeFields
            .AsNoTracking()
            .Where(x => x.VersionId == version.Id)
            .OrderBy(x => x.SortOrder)
            .ThenBy(x => x.Id)
            .ToListAsync(cancellationToken);

        return Ok(fields.Select(ToLegacyField).ToList());
    }

    [HttpPost("{id:long}/fields")]
    [Authorize(Policy = "Permission:request_fields.manage")]
    public async Task<IActionResult> AddLegacyField(long id, [FromBody] JsonElement request, CancellationToken cancellationToken)
    {
        var version = await GetEditableVersionForRequestTypeAsync(id, cancellationToken);
        var fieldName = RequiredString(request, "field_name", "fieldName").Trim();
        if (await db.RequestTypeFields.AnyAsync(x => x.VersionId == version.Id && x.FieldName == fieldName, cancellationToken))
        {
            throw new ApiException("اسم الحقل مستخدم مسبقاً في هذه النسخة");
        }

        var field = new RequestTypeField { VersionId = version.Id };
        ApplyField(field, request);
        db.RequestTypeFields.Add(field);
        await db.SaveChangesAsync(cancellationToken);
        await auditService.LogAsync("request_field_added", "request_type_field", field.Id.ToString(), newValue: new { field.VersionId, field.FieldName }, cancellationToken: cancellationToken);
        return Ok(ToLegacyField(field));
    }

    [HttpPut("fields/{fieldId:long}")]
    [Authorize(Policy = "Permission:request_fields.manage")]
    public async Task<IActionResult> UpdateLegacyField(long fieldId, [FromBody] JsonElement request, CancellationToken cancellationToken)
    {
        var field = await GetEditableFieldAsync(fieldId, cancellationToken);
        var fieldName = RequiredString(request, "field_name", "fieldName").Trim();
        if (await db.RequestTypeFields.AnyAsync(x => x.Id != field.Id && x.VersionId == field.VersionId && x.FieldName == fieldName, cancellationToken))
        {
            throw new ApiException("اسم الحقل مستخدم مسبقاً في هذه النسخة");
        }

        var oldValue = new { field.FieldName, field.LabelAr, field.FieldType, field.IsRequired };
        ApplyField(field, request);
        await db.SaveChangesAsync(cancellationToken);
        await auditService.LogAsync("request_field_updated", "request_type_field", field.Id.ToString(), oldValue: oldValue, newValue: new { field.FieldName, field.LabelAr, field.FieldType, field.IsRequired }, cancellationToken: cancellationToken);
        return Ok(ToLegacyField(field));
    }

    [HttpDelete("fields/{fieldId:long}")]
    [Authorize(Policy = "Permission:request_fields.manage")]
    public async Task<IActionResult> DeleteLegacyField(long fieldId, CancellationToken cancellationToken)
    {
        var field = await GetEditableFieldAsync(fieldId, cancellationToken);
        db.RequestTypeFields.Remove(field);
        await db.SaveChangesAsync(cancellationToken);
        await auditService.LogAsync("request_field_deleted", "request_type_field", field.Id.ToString(), cancellationToken: cancellationToken);
        return NoContent();
    }

    [HttpPost("{id:long}/fields/reorder")]
    [Authorize(Policy = "Permission:request_fields.manage")]
    public async Task<IActionResult> ReorderLegacyFields(long id, [FromBody] JsonElement request, CancellationToken cancellationToken)
    {
        var ids = LongArrayProp(request, "ids");
        var version = await GetEditableVersionForRequestTypeAsync(id, cancellationToken);
        await ReorderFieldsAsync(version.Id, ids, cancellationToken);
        await auditService.LogAsync("request_fields_reordered", "request_type_version", version.Id.ToString(), metadata: new { ids }, cancellationToken: cancellationToken);
        return Ok(new { success = true });
    }

    [HttpGet("{id:long}/workflow")]
    [Authorize(Policy = "Permission:request_types.view")]
    public async Task<IActionResult> GetLegacyWorkflow(long id, CancellationToken cancellationToken)
    {
        var version = await GetDisplayVersionForRequestTypeAsync(id, cancellationToken);
        var steps = await WorkflowQuery()
            .AsNoTracking()
            .Where(x => x.VersionId == version.Id)
            .OrderBy(x => x.SortOrder)
            .ThenBy(x => x.Id)
            .ToListAsync(cancellationToken);

        return Ok(new
        {
            version_id = version.Id,
            version_number = version.VersionNumber,
            status = version.Status,
            steps = steps.Select(ToLegacyStep).ToList()
        });
    }

    [HttpPost("{id:long}/workflow/steps")]
    [Authorize(Policy = "Permission:request_workflows.manage")]
    public async Task<IActionResult> AddLegacyWorkflowStep(long id, [FromBody] JsonElement request, CancellationToken cancellationToken)
    {
        var version = await GetEditableVersionForRequestTypeAsync(id, cancellationToken);
        var approverUserId = await ValidateWorkflowReferencesAsync(request, cancellationToken);
        var step = new WorkflowTemplateStep { VersionId = version.Id };
        ApplyWorkflowStep(step, request, approverUserId);
        db.WorkflowTemplateSteps.Add(step);
        await db.SaveChangesAsync(cancellationToken);
        await auditService.LogAsync("workflow_step_added", "workflow_template_step", step.Id.ToString(), newValue: new { step.VersionId, step.StepType, step.StepNameAr }, cancellationToken: cancellationToken);
        var created = await WorkflowQuery().AsNoTracking().FirstAsync(x => x.Id == step.Id, cancellationToken);
        return Ok(ToLegacyStep(created));
    }

    [HttpPut("workflow-steps/{stepId:long}")]
    [Authorize(Policy = "Permission:request_workflows.manage")]
    public async Task<IActionResult> UpdateLegacyWorkflowStep(long stepId, [FromBody] JsonElement request, CancellationToken cancellationToken)
    {
        var step = await GetEditableWorkflowStepAsync(stepId, cancellationToken);
        var approverUserId = await ValidateWorkflowReferencesAsync(request, cancellationToken);
        var oldValue = new { step.StepNameAr, step.StepType, step.SortOrder, step.CanReject, step.CanReturnForEdit };
        ApplyWorkflowStep(step, request, approverUserId);
        await db.SaveChangesAsync(cancellationToken);
        await auditService.LogAsync("workflow_step_updated", "workflow_template_step", step.Id.ToString(), oldValue: oldValue, newValue: new { step.StepNameAr, step.StepType, step.SortOrder, step.CanReject, step.CanReturnForEdit }, cancellationToken: cancellationToken);
        var updated = await WorkflowQuery().AsNoTracking().FirstAsync(x => x.Id == step.Id, cancellationToken);
        return Ok(ToLegacyStep(updated));
    }

    [HttpDelete("workflow-steps/{stepId:long}")]
    [Authorize(Policy = "Permission:request_workflows.manage")]
    public async Task<IActionResult> DeleteLegacyWorkflowStep(long stepId, CancellationToken cancellationToken)
    {
        var step = await GetEditableWorkflowStepAsync(stepId, cancellationToken);
        db.WorkflowTemplateSteps.Remove(step);
        await db.SaveChangesAsync(cancellationToken);
        await auditService.LogAsync("workflow_step_deleted", "workflow_template_step", step.Id.ToString(), cancellationToken: cancellationToken);
        return NoContent();
    }

    [HttpPost("{id:long}/workflow/reorder")]
    [Authorize(Policy = "Permission:request_workflows.manage")]
    public async Task<IActionResult> ReorderLegacyWorkflow(long id, [FromBody] JsonElement request, CancellationToken cancellationToken)
    {
        var ids = LongArrayProp(request, "ids");
        var version = await GetEditableVersionForRequestTypeAsync(id, cancellationToken);
        await ReorderWorkflowAsync(version.Id, ids, cancellationToken);
        await auditService.LogAsync("workflow_reordered", "request_type_version", version.Id.ToString(), metadata: new { ids }, cancellationToken: cancellationToken);
        return Ok(new { success = true });
    }

    [HttpGet("workflow-roles")]
    [Authorize(Policy = "Permission:request_types.view")]
    public async Task<IActionResult> GetWorkflowRoles(CancellationToken cancellationToken)
    {
        var roles = await db.Roles
            .AsNoTracking()
            .Where(x => x.IsActive)
            .OrderBy(x => x.NameAr)
            .Select(x => new
            {
                x.Id,
                x.Code,
                name_ar = x.NameAr,
                name_en = x.NameEn,
                is_system = x.IsSystem,
                is_active = x.IsActive
            })
            .ToListAsync(cancellationToken);
        return Ok(roles);
    }

    [HttpGet("workflow-departments")]
    [Authorize(Policy = "Permission:request_types.view")]
    public async Task<IActionResult> GetWorkflowDepartments(CancellationToken cancellationToken)
    {
        var departments = await db.Departments
            .Include(x => x.ManagerUser)
            .AsNoTracking()
            .Where(x => x.IsActive)
            .OrderBy(x => x.NameAr)
            .Select(x => new
            {
                x.Id,
                x.Code,
                name_ar = x.NameAr,
                name_en = x.NameEn,
                manager_id = x.ManagerUserId,
                manager_name_ar = x.ManagerUser != null ? x.ManagerUser.NameAr : null,
                is_active = x.IsActive
            })
            .ToListAsync(cancellationToken);
        return Ok(departments);
    }

    [HttpGet("{id:long}/versions")]
    [Authorize(Policy = "Permission:request_types.view")]
    public async Task<IActionResult> GetVersions(long id, CancellationToken cancellationToken)
    {
        if (!await db.RequestTypes.AnyAsync(x => x.Id == id, cancellationToken))
        {
            throw new ApiException("نوع الطلب غير موجود", StatusCodes.Status404NotFound);
        }

        var versions = await db.RequestTypeVersions
            .Include(x => x.CreatedByUser)
            .Include(x => x.Fields)
            .Include(x => x.WorkflowSteps)
            .Include(x => x.Settings)
            .AsNoTracking()
            .Where(x => x.RequestTypeId == id)
            .OrderByDescending(x => x.VersionNumber)
            .ToListAsync(cancellationToken);
        var versionIds = versions.Select(x => x.Id).ToList();
        var requestCounts = await db.Requests
            .AsNoTracking()
            .Where(x => versionIds.Contains(x.RequestTypeVersionId))
            .GroupBy(x => x.RequestTypeVersionId)
            .Select(x => new { VersionId = x.Key, Count = x.Count() })
            .ToDictionaryAsync(x => x.VersionId, x => x.Count, cancellationToken);

        return Ok(new
        {
            versions = versions.Select(version => ToLegacyVersion(version, requestCounts.GetValueOrDefault(version.Id))).ToList()
        });
    }

    [HttpPost("{id:long}/versions/clone-current")]
    [Authorize(Policy = "Permission:request_types.manage")]
    public async Task<ActionResult<RequestTypeVersionDto>> CloneCurrentVersion(long id, CloneRequestTypeVersionRequest request, CancellationToken cancellationToken)
    {
        var requestType = await db.RequestTypes.Include(x => x.CurrentVersion).FirstOrDefaultAsync(x => x.Id == id, cancellationToken)
                          ?? throw new ApiException("نوع الطلب غير موجود", StatusCodes.Status404NotFound);
        var sourceVersion = requestType.CurrentVersionId.HasValue
            ? await db.RequestTypeVersions
                .Include(x => x.Fields)
                .Include(x => x.WorkflowSteps)
                .Include(x => x.Settings)
                .FirstOrDefaultAsync(x => x.Id == requestType.CurrentVersionId.Value, cancellationToken)
            : null;

        if (sourceVersion is null)
        {
            throw new ApiException("لا توجد نسخة حالية يمكن نسخها");
        }

        var nextNumber = await db.RequestTypeVersions.Where(x => x.RequestTypeId == id).MaxAsync(x => x.VersionNumber, cancellationToken) + 1;
        var draft = new RequestTypeVersion
        {
            RequestTypeId = id,
            VersionNumber = nextNumber,
            Status = "draft",
            ChangeSummary = request.ChangeSummary,
            CreatedByUserId = currentUser.UserId
        };
        db.RequestTypeVersions.Add(draft);
        await db.SaveChangesAsync(cancellationToken);

        db.RequestTypeFields.AddRange(sourceVersion.Fields.Select(x => new RequestTypeField
        {
            VersionId = draft.Id,
            FieldName = x.FieldName,
            LabelAr = x.LabelAr,
            LabelEn = x.LabelEn,
            FieldType = x.FieldType,
            IsRequired = x.IsRequired,
            PlaceholderAr = x.PlaceholderAr,
            HelpTextAr = x.HelpTextAr,
            DefaultValue = x.DefaultValue,
            OptionsJson = x.OptionsJson,
            ValidationRulesJson = x.ValidationRulesJson,
            SortOrder = x.SortOrder,
            SectionName = x.SectionName,
            Width = x.Width,
            IsActive = x.IsActive,
            VisibleToRequester = x.VisibleToRequester,
            VisibleToApprover = x.VisibleToApprover,
            VisibleToExecutor = x.VisibleToExecutor
        }));

        db.WorkflowTemplateSteps.AddRange(sourceVersion.WorkflowSteps.Select(x => new WorkflowTemplateStep
        {
            VersionId = draft.Id,
            StepNameAr = x.StepNameAr,
            StepNameEn = x.StepNameEn,
            StepType = x.StepType,
            ApproverRoleId = x.ApproverRoleId,
            ApproverUserId = x.ApproverUserId,
            TargetDepartmentId = x.TargetDepartmentId,
            IsMandatory = x.IsMandatory,
            CanApprove = x.CanApprove,
            CanReject = x.CanReject,
            CanReturnForEdit = x.CanReturnForEdit,
            CanDelegate = x.CanDelegate,
            SlaHours = x.SlaHours,
            EscalationUserId = x.EscalationUserId,
            EscalationRoleId = x.EscalationRoleId,
            ReturnToStepOrder = x.ReturnToStepOrder,
            SortOrder = x.SortOrder,
            IsActive = x.IsActive
        }));

        if (sourceVersion.Settings is not null)
        {
            db.RequestTypeSettings.Add(new RequestTypeSettings
            {
                RequestTypeId = id,
                VersionId = draft.Id,
                RequiresAttachment = sourceVersion.Settings.RequiresAttachment,
                AllowMultipleAttachments = sourceVersion.Settings.AllowMultipleAttachments,
                MaxAttachments = sourceVersion.Settings.MaxAttachments,
                MaxFileSizeMb = sourceVersion.Settings.MaxFileSizeMb,
                AllowedExtensionsJson = sourceVersion.Settings.AllowedExtensionsJson,
                RequireAttachmentBeforeSubmit = sourceVersion.Settings.RequireAttachmentBeforeSubmit,
                RequireAttachmentOnReturn = sourceVersion.Settings.RequireAttachmentOnReturn,
                AllowAttachmentAfterSubmission = sourceVersion.Settings.AllowAttachmentAfterSubmission,
                DefaultPriority = sourceVersion.Settings.DefaultPriority,
                SlaResponseHours = sourceVersion.Settings.SlaResponseHours,
                SlaResolutionHours = sourceVersion.Settings.SlaResolutionHours,
                BusinessHoursOnly = sourceVersion.Settings.BusinessHoursOnly,
                PauseSlaWhenWaitingForUser = sourceVersion.Settings.PauseSlaWhenWaitingForUser,
                AllowCancelByRequester = sourceVersion.Settings.AllowCancelByRequester,
                AllowReopen = sourceVersion.Settings.AllowReopen,
                AllowEditBeforeApproval = sourceVersion.Settings.AllowEditBeforeApproval,
                ShowInEmployeePortal = sourceVersion.Settings.ShowInEmployeePortal,
                RequiresManager = sourceVersion.Settings.RequiresManager,
                EnableRequestMessagesTab = sourceVersion.Settings.EnableRequestMessagesTab,
                IncludeOfficialMessagesInPdf = sourceVersion.Settings.IncludeOfficialMessagesInPdf,
                PdfTemplateId = sourceVersion.Settings.PdfTemplateId
            });
        }

        await db.SaveChangesAsync(cancellationToken);
        await auditService.LogAsync("request_type_version_created", "request_type_version", draft.Id.ToString(), newValue: new { RequestTypeId = id, draft.VersionNumber }, cancellationToken: cancellationToken);
        return Ok(ToLegacyVersion(draft, 0));
    }

    [HttpGet("{id:long}/form-schema")]
    [Authorize(Policy = "Permission:requests.view")]
    public async Task<IActionResult> GetFormSchema(long id, CancellationToken cancellationToken)
    {
        var requestType = await BaseRequestTypeQuery().AsNoTracking().FirstOrDefaultAsync(x => x.Id == id, cancellationToken)
                          ?? throw new ApiException("نوع الطلب غير موجود", StatusCodes.Status404NotFound);
        if (!requestType.IsActive || requestType.CurrentVersion is null || requestType.CurrentVersion.Status != "active" || requestType.CurrentVersion.Settings is null)
        {
            throw new ApiException("نوع الطلب غير متاح حالياً", StatusCodes.Status404NotFound);
        }

        var fields = await db.RequestTypeFields.AsNoTracking().Where(x => x.VersionId == requestType.CurrentVersion.Id && x.IsActive && x.VisibleToRequester).OrderBy(x => x.SortOrder).ToListAsync(cancellationToken);
        var workflow = await WorkflowQuery().AsNoTracking().Where(x => x.VersionId == requestType.CurrentVersion.Id && x.IsActive).OrderBy(x => x.SortOrder).ToListAsync(cancellationToken);
        return Ok(new
        {
            request_type = ToLegacyRequestType(requestType),
            version = ToLegacyVersion(requestType.CurrentVersion, 0),
            settings = ToLegacySettings(requestType.CurrentVersion.Settings),
            fields = fields.Select(ToLegacyField).ToList(),
            workflow_preview = workflow.Select(ToLegacyStep).ToList()
        });
    }

    [HttpGet("{id:long}/workflow/preview")]
    [Authorize(Policy = "Permission:request_types.view")]
    public async Task<IActionResult> WorkflowPreview(long id, CancellationToken cancellationToken)
    {
        var version = await GetDisplayVersionForRequestTypeAsync(id, cancellationToken);

        var steps = await WorkflowQuery()
            .AsNoTracking()
            .Where(x => x.VersionId == version.Id && x.IsActive)
            .OrderBy(x => x.SortOrder)
            .ToListAsync(cancellationToken);

        return Ok(new
        {
            version_number = version.VersionNumber,
            status = version.Status,
            steps = steps.Select(step => new
            {
                step.Id,
                step_name_ar = step.StepNameAr,
                step_name_en = step.StepNameEn,
                step_type = step.StepType,
                approver_role_id = step.ApproverRoleId,
                approver_role_name_ar = step.ApproverRole?.NameAr,
                approver_user_id = step.ApproverUserId,
                approver_user_name_ar = step.ApproverUser?.NameAr,
                approver_employee_number = step.ApproverUser?.EmployeeNumber,
                target_department_id = step.TargetDepartmentId,
                target_department_name_ar = step.TargetDepartment?.NameAr,
                is_mandatory = step.IsMandatory,
                can_approve = step.CanApprove,
                can_reject = step.CanReject,
                can_return_for_edit = step.CanReturnForEdit,
                sort_order = step.SortOrder,
                is_active = step.IsActive
            }).ToList()
        });
    }

    [HttpPost("{id:long}/versions/validate-draft")]
    [Authorize(Policy = "Permission:request_types.view")]
    public async Task<IActionResult> ValidateDraft(long id, CancellationToken cancellationToken)
    {
        var requestType = await BootstrapRequestTypeQuery()
            .AsNoTracking()
            .FirstOrDefaultAsync(x => x.Id == id, cancellationToken)
            ?? throw new ApiException("نوع الطلب غير موجود", StatusCodes.Status404NotFound);

        var draft = await db.RequestTypeVersions
            .Include(x => x.Fields)
            .Include(x => x.WorkflowSteps)
            .Include(x => x.Settings)
            .AsNoTracking()
            .Where(x => x.RequestTypeId == id && x.Status == "draft")
            .OrderByDescending(x => x.VersionNumber)
            .FirstOrDefaultAsync(cancellationToken);

        var version = draft ?? requestType.CurrentVersion;
        var checks = new List<object>();
        AddCheck(checks, "basic_info", "البيانات الأساسية", !string.IsNullOrWhiteSpace(requestType.NameAr) && !string.IsNullOrWhiteSpace(requestType.Code), "بيانات نوع الطلب مكتملة", "أكمل اسم ورمز نوع الطلب");
        AddCheck(checks, "specialized_section", "القسم المختص", requestType.SpecializedSectionId.HasValue, "تم تحديد القسم المختص", "حدد القسم المختص باستقبال الطلب");
        AddCheck(checks, "fields", "حقول النموذج", version?.Fields.Any(x => x.IsActive) == true, "توجد حقول فعالة", "أضف حقلاً واحداً على الأقل");
        AddCheck(checks, "workflow", "مسار الموافقات", version?.WorkflowSteps.Any(x => x.IsActive) == true, "يوجد مسار موافقات فعال", "أضف مرحلة موافقة واحدة على الأقل");
        AddCheck(checks, "settings", "الإعدادات", version?.Settings is not null, "إعدادات نوع الطلب موجودة", "أكمل إعدادات نوع الطلب");

        var errors = checks.Count(check => (string)check.GetType().GetProperty("status")!.GetValue(check)! == "failed");
        var warnings = checks.Count(check => (string)check.GetType().GetProperty("status")!.GetValue(check)! == "warning");

        return Ok(new
        {
            has_draft = draft is not null,
            version_number = version?.VersionNumber,
            can_publish = draft is not null && errors == 0,
            errors_count = errors,
            warnings_count = warnings,
            checks,
            preview = new
            {
                fields_count = version?.Fields.Count(x => x.IsActive) ?? 0,
                workflow_steps_count = version?.WorkflowSteps.Count(x => x.IsActive) ?? 0
            }
        });
    }

    [HttpPost("{id:long}/versions/publish-draft")]
    [Authorize(Policy = "Permission:request_types.manage")]
    public async Task<IActionResult> PublishDraft(long id, CancellationToken cancellationToken)
    {
        var requestType = await db.RequestTypes.FirstOrDefaultAsync(x => x.Id == id, cancellationToken)
            ?? throw new ApiException("نوع الطلب غير موجود", StatusCodes.Status404NotFound);
        var draft = await db.RequestTypeVersions
            .Include(x => x.Fields)
            .Include(x => x.WorkflowSteps)
            .Include(x => x.Settings)
            .Where(x => x.RequestTypeId == id && x.Status == "draft")
            .OrderByDescending(x => x.VersionNumber)
            .FirstOrDefaultAsync(cancellationToken)
            ?? throw new ApiException("لا توجد مسودة للنشر");

        if (!draft.WorkflowSteps.Any(x => x.IsActive))
        {
            throw new ApiException("لا يمكن نشر نوع طلب بدون مسار موافقات");
        }

        if (requestType.SpecializedSectionId is null)
        {
            throw new ApiException("لا يمكن نشر نوع طلب بدون قسم مختص");
        }

        var activeVersions = await db.RequestTypeVersions
            .Where(x => x.RequestTypeId == id && x.Status == "active")
            .ToListAsync(cancellationToken);
        foreach (var version in activeVersions)
        {
            version.Status = "archived";
        }

        draft.Status = "active";
        draft.ActivatedAt = DateTimeOffset.UtcNow;
        requestType.CurrentVersionId = draft.Id;
        requestType.IsActive = true;
        await db.SaveChangesAsync(cancellationToken);
        await auditService.LogAsync("request_type_version_activated", "request_type_version", draft.Id.ToString(), newValue: new { RequestTypeId = id, draft.VersionNumber }, cancellationToken: cancellationToken);

        return Ok(new { published = true, version = MapVersion(draft), request_type = ToLegacyRequestType(requestType) });
    }

    private async Task<RequestTypeVersion> GetDisplayVersionForRequestTypeAsync(long requestTypeId, CancellationToken cancellationToken)
    {
        if (!await db.RequestTypes.AnyAsync(x => x.Id == requestTypeId, cancellationToken))
        {
            throw new ApiException("نوع الطلب غير موجود", StatusCodes.Status404NotFound);
        }

        var draft = await VersionWithChildrenQuery()
            .AsNoTracking()
            .Where(x => x.RequestTypeId == requestTypeId && x.Status == "draft")
            .OrderByDescending(x => x.VersionNumber)
            .FirstOrDefaultAsync(cancellationToken);
        if (draft is not null)
        {
            return draft;
        }

        var currentVersionId = await db.RequestTypes
            .AsNoTracking()
            .Where(x => x.Id == requestTypeId)
            .Select(x => x.CurrentVersionId)
            .FirstOrDefaultAsync(cancellationToken);
        if (currentVersionId.HasValue)
        {
            return await VersionWithChildrenQuery()
                .AsNoTracking()
                .FirstAsync(x => x.Id == currentVersionId.Value, cancellationToken);
        }

        throw new ApiException("لا توجد نسخة لنوع الطلب", StatusCodes.Status404NotFound);
    }

    private async Task<RequestTypeVersion> GetEditableVersionForRequestTypeAsync(long requestTypeId, CancellationToken cancellationToken)
    {
        var requestType = await db.RequestTypes.FirstOrDefaultAsync(x => x.Id == requestTypeId, cancellationToken)
                          ?? throw new ApiException("نوع الطلب غير موجود", StatusCodes.Status404NotFound);

        var draft = await VersionWithChildrenQuery()
            .Where(x => x.RequestTypeId == requestTypeId && x.Status == "draft")
            .OrderByDescending(x => x.VersionNumber)
            .FirstOrDefaultAsync(cancellationToken);
        if (draft is not null)
        {
            return draft;
        }

        if (!requestType.CurrentVersionId.HasValue)
        {
            var version = new RequestTypeVersion
            {
                RequestTypeId = requestType.Id,
                VersionNumber = 1,
                Status = "draft",
                ChangeSummary = "مسودة تلقائية",
                CreatedByUserId = currentUser.UserId
            };
            db.RequestTypeVersions.Add(version);
            await db.SaveChangesAsync(cancellationToken);
            requestType.CurrentVersionId = version.Id;
            db.RequestTypeSettings.Add(new RequestTypeSettings { RequestTypeId = requestType.Id, VersionId = version.Id });
            await db.SaveChangesAsync(cancellationToken);
            return await VersionWithChildrenQuery().FirstAsync(x => x.Id == version.Id, cancellationToken);
        }

        var source = await VersionWithChildrenQuery()
            .FirstOrDefaultAsync(x => x.Id == requestType.CurrentVersionId.Value, cancellationToken)
            ?? throw new ApiException("لا توجد نسخة حالية يمكن تعديلها");

        if (source.Status == "draft")
        {
            return source;
        }

        return await CreateDraftFromVersionAsync(requestType, source, cancellationToken);
    }

    private async Task<RequestTypeVersion> CreateDraftFromVersionAsync(RequestType requestType, RequestTypeVersion sourceVersion, CancellationToken cancellationToken)
    {
        var maxVersion = await db.RequestTypeVersions
            .Where(x => x.RequestTypeId == requestType.Id)
            .Select(x => (int?)x.VersionNumber)
            .MaxAsync(cancellationToken) ?? 0;
        var draft = new RequestTypeVersion
        {
            RequestTypeId = requestType.Id,
            VersionNumber = maxVersion + 1,
            Status = "draft",
            ChangeSummary = "مسودة تعديل تلقائية",
            CreatedByUserId = currentUser.UserId
        };
        db.RequestTypeVersions.Add(draft);
        await db.SaveChangesAsync(cancellationToken);

        db.RequestTypeFields.AddRange(sourceVersion.Fields.Select(x => new RequestTypeField
        {
            VersionId = draft.Id,
            FieldName = x.FieldName,
            LabelAr = x.LabelAr,
            LabelEn = x.LabelEn,
            FieldType = x.FieldType,
            IsRequired = x.IsRequired,
            PlaceholderAr = x.PlaceholderAr,
            HelpTextAr = x.HelpTextAr,
            DefaultValue = x.DefaultValue,
            OptionsJson = x.OptionsJson,
            ValidationRulesJson = x.ValidationRulesJson,
            SortOrder = x.SortOrder,
            SectionName = x.SectionName,
            Width = x.Width,
            IsActive = x.IsActive,
            VisibleToRequester = x.VisibleToRequester,
            VisibleToApprover = x.VisibleToApprover,
            VisibleToExecutor = x.VisibleToExecutor
        }));

        db.WorkflowTemplateSteps.AddRange(sourceVersion.WorkflowSteps.Select(x => new WorkflowTemplateStep
        {
            VersionId = draft.Id,
            StepNameAr = x.StepNameAr,
            StepNameEn = x.StepNameEn,
            StepType = x.StepType,
            ApproverRoleId = x.ApproverRoleId,
            ApproverUserId = x.ApproverUserId,
            TargetDepartmentId = x.TargetDepartmentId,
            IsMandatory = x.IsMandatory,
            CanApprove = x.CanApprove,
            CanReject = x.CanReject,
            CanReturnForEdit = x.CanReturnForEdit,
            CanDelegate = x.CanDelegate,
            SlaHours = x.SlaHours,
            EscalationUserId = x.EscalationUserId,
            EscalationRoleId = x.EscalationRoleId,
            ReturnToStepOrder = x.ReturnToStepOrder,
            SortOrder = x.SortOrder,
            IsActive = x.IsActive
        }));

        if (sourceVersion.Settings is not null)
        {
            db.RequestTypeSettings.Add(new RequestTypeSettings
            {
                RequestTypeId = requestType.Id,
                VersionId = draft.Id,
                RequiresAttachment = sourceVersion.Settings.RequiresAttachment,
                AllowMultipleAttachments = sourceVersion.Settings.AllowMultipleAttachments,
                MaxAttachments = sourceVersion.Settings.MaxAttachments,
                MaxFileSizeMb = sourceVersion.Settings.MaxFileSizeMb,
                AllowedExtensionsJson = sourceVersion.Settings.AllowedExtensionsJson,
                RequireAttachmentBeforeSubmit = sourceVersion.Settings.RequireAttachmentBeforeSubmit,
                RequireAttachmentOnReturn = sourceVersion.Settings.RequireAttachmentOnReturn,
                AllowAttachmentAfterSubmission = sourceVersion.Settings.AllowAttachmentAfterSubmission,
                DefaultPriority = sourceVersion.Settings.DefaultPriority,
                SlaResponseHours = sourceVersion.Settings.SlaResponseHours,
                SlaResolutionHours = sourceVersion.Settings.SlaResolutionHours,
                BusinessHoursOnly = sourceVersion.Settings.BusinessHoursOnly,
                PauseSlaWhenWaitingForUser = sourceVersion.Settings.PauseSlaWhenWaitingForUser,
                AllowCancelByRequester = sourceVersion.Settings.AllowCancelByRequester,
                AllowReopen = sourceVersion.Settings.AllowReopen,
                AllowEditBeforeApproval = sourceVersion.Settings.AllowEditBeforeApproval,
                ShowInEmployeePortal = sourceVersion.Settings.ShowInEmployeePortal,
                RequiresManager = sourceVersion.Settings.RequiresManager,
                EnableRequestMessagesTab = sourceVersion.Settings.EnableRequestMessagesTab,
                IncludeOfficialMessagesInPdf = sourceVersion.Settings.IncludeOfficialMessagesInPdf,
                PdfTemplateId = sourceVersion.Settings.PdfTemplateId
            });
        }

        await db.SaveChangesAsync(cancellationToken);
        await auditService.LogAsync("request_type_version_created", "request_type_version", draft.Id.ToString(), newValue: new { requestType.Id, draft.VersionNumber, source_version_id = sourceVersion.Id }, cancellationToken: cancellationToken);
        return await VersionWithChildrenQuery().FirstAsync(x => x.Id == draft.Id, cancellationToken);
    }

    private IQueryable<RequestTypeVersion> VersionWithChildrenQuery()
    {
        return db.RequestTypeVersions
            .Include(x => x.Fields)
            .Include(x => x.WorkflowSteps)
            .Include(x => x.Settings)
            .Include(x => x.CreatedByUser);
    }

    private async Task<RequestTypeField> GetEditableFieldAsync(long fieldId, CancellationToken cancellationToken)
    {
        var field = await db.RequestTypeFields
            .Include(x => x.Version)
            .ThenInclude(x => x!.RequestType)
            .FirstOrDefaultAsync(x => x.Id == fieldId, cancellationToken)
            ?? throw new ApiException("الحقل غير موجود", StatusCodes.Status404NotFound);

        if (field.Version?.Status == "draft")
        {
            return field;
        }

        var requestType = field.Version?.RequestType ?? throw new ApiException("نوع الطلب غير موجود", StatusCodes.Status404NotFound);
        var draft = await GetEditableVersionForRequestTypeAsync(requestType.Id, cancellationToken);
        return await db.RequestTypeFields
            .FirstOrDefaultAsync(x => x.VersionId == draft.Id && x.FieldName == field.FieldName, cancellationToken)
            ?? throw new ApiException("تعذر العثور على الحقل في المسودة", StatusCodes.Status404NotFound);
    }

    private async Task<WorkflowTemplateStep> GetEditableWorkflowStepAsync(long stepId, CancellationToken cancellationToken)
    {
        var step = await db.WorkflowTemplateSteps
            .Include(x => x.Version)
            .ThenInclude(x => x!.RequestType)
            .FirstOrDefaultAsync(x => x.Id == stepId, cancellationToken)
            ?? throw new ApiException("مرحلة الموافقة غير موجودة", StatusCodes.Status404NotFound);

        if (step.Version?.Status == "draft")
        {
            return step;
        }

        var requestType = step.Version?.RequestType ?? throw new ApiException("نوع الطلب غير موجود", StatusCodes.Status404NotFound);
        var draft = await GetEditableVersionForRequestTypeAsync(requestType.Id, cancellationToken);
        return await db.WorkflowTemplateSteps
            .FirstOrDefaultAsync(x => x.VersionId == draft.Id && x.SortOrder == step.SortOrder && x.StepType == step.StepType, cancellationToken)
            ?? await db.WorkflowTemplateSteps
                .FirstOrDefaultAsync(x => x.VersionId == draft.Id && x.StepNameAr == step.StepNameAr, cancellationToken)
            ?? throw new ApiException("تعذر العثور على المرحلة في المسودة", StatusCodes.Status404NotFound);
    }

    private async Task ReorderFieldsAsync(long versionId, IReadOnlyCollection<long> ids, CancellationToken cancellationToken)
    {
        var fields = await db.RequestTypeFields.Where(x => x.VersionId == versionId).ToListAsync(cancellationToken);
        var sourceFields = await db.RequestTypeFields
            .AsNoTracking()
            .Where(x => ids.Contains(x.Id))
            .ToListAsync(cancellationToken);
        var order = 1;

        foreach (var id in ids)
        {
            var field = fields.FirstOrDefault(x => x.Id == id);
            if (field is null)
            {
                var source = sourceFields.FirstOrDefault(x => x.Id == id);
                if (source is not null)
                {
                    field = fields.FirstOrDefault(x => x.FieldName == source.FieldName);
                }
            }

            if (field is not null)
            {
                field.SortOrder = order++;
            }
        }

        if (order == 1)
        {
            throw new ApiException("ترتيب الحقول غير مطابق لحقول النسخة");
        }

        await db.SaveChangesAsync(cancellationToken);
    }

    private async Task ReorderWorkflowAsync(long versionId, IReadOnlyCollection<long> ids, CancellationToken cancellationToken)
    {
        var steps = await db.WorkflowTemplateSteps.Where(x => x.VersionId == versionId).ToListAsync(cancellationToken);
        var sourceSteps = await db.WorkflowTemplateSteps
            .AsNoTracking()
            .Where(x => ids.Contains(x.Id))
            .ToListAsync(cancellationToken);
        var order = 1;

        foreach (var id in ids)
        {
            var step = steps.FirstOrDefault(x => x.Id == id);
            if (step is null)
            {
                var source = sourceSteps.FirstOrDefault(x => x.Id == id);
                if (source is not null)
                {
                    step = steps.FirstOrDefault(x =>
                        x.StepType == source.StepType &&
                        (x.StepNameAr == source.StepNameAr || x.SortOrder == source.SortOrder));
                }
            }

            if (step is not null)
            {
                step.SortOrder = order++;
            }
        }

        if (order == 1)
        {
            throw new ApiException("ترتيب المراحل غير مطابق لمسار النسخة");
        }

        await db.SaveChangesAsync(cancellationToken);
    }

    private IQueryable<RequestType> BaseRequestTypeQuery()
    {
        return db.RequestTypes
            .Include(x => x.SpecializedSection)
            .ThenInclude(x => x!.Department)
            .Include(x => x.CurrentVersion)
            .ThenInclude(x => x!.Settings)
            .Include(x => x.CurrentVersion)
            .ThenInclude(x => x!.Fields)
            .Include(x => x.CurrentVersion)
            .ThenInclude(x => x!.WorkflowSteps);
    }

    private IQueryable<RequestType> BootstrapRequestTypeQuery()
    {
        return db.RequestTypes
            .Include(x => x.SpecializedSection)
            .ThenInclude(x => x!.Department)
            .Include(x => x.CurrentVersion)
            .ThenInclude(x => x!.Settings)
            .Include(x => x.CurrentVersion)
            .ThenInclude(x => x!.Fields)
            .Include(x => x.CurrentVersion)
            .ThenInclude(x => x!.WorkflowSteps);
    }

    private IQueryable<WorkflowTemplateStep> WorkflowQuery()
    {
        return db.WorkflowTemplateSteps
            .Include(x => x.ApproverRole)
            .Include(x => x.ApproverUser)
            .Include(x => x.TargetDepartment);
    }

    private async Task<long?> ResolveSpecializedSectionIdAsync(long? specializedSectionId, string? assignedSectionCode, CancellationToken cancellationToken)
    {
        if (specializedSectionId.HasValue)
        {
            return specializedSectionId.Value;
        }

        if (!string.IsNullOrWhiteSpace(assignedSectionCode))
        {
            var code = assignedSectionCode.Trim();
            var section = await db.SpecializedSections
                .AsNoTracking()
                .Where(x => x.IsActive && x.Code == code)
                .Select(x => (long?)x.Id)
                .FirstOrDefaultAsync(cancellationToken);
            if (section.HasValue)
            {
                return section.Value;
            }
        }

        return await db.SpecializedSections
            .AsNoTracking()
            .Where(x => x.IsActive)
            .OrderBy(x => x.NameAr)
            .Select(x => (long?)x.Id)
            .FirstOrDefaultAsync(cancellationToken);
    }

    private async Task EnsureRequestTypeReferencesAsync(long? specializedSectionId, string defaultPriority, CancellationToken cancellationToken)
    {
        if (specializedSectionId.HasValue && !await db.SpecializedSections.AnyAsync(x => x.Id == specializedSectionId.Value && x.IsActive, cancellationToken))
        {
            throw new ApiException("القسم المختص المحدد غير صالح");
        }

        if (!await db.PrioritySettings.AnyAsync(x => x.Code == defaultPriority && x.IsActive, cancellationToken))
        {
            throw new ApiException("الأولوية الافتراضية غير صالحة");
        }
    }

    private static string NormalizePriorityCode(string? code)
    {
        return string.Equals(code, "medium", StringComparison.OrdinalIgnoreCase)
            ? "normal"
            : string.IsNullOrWhiteSpace(code)
                ? "normal"
                : code.Trim().ToLowerInvariant();
    }

    private static string NormalizeAllowedExtensionsJson(JsonElement? value)
    {
        if (value is null)
        {
            return JsonSerializer.Serialize(new[] { "pdf", "png", "jpg", "jpeg" }, JsonOptions);
        }

        if (value.Value.ValueKind == JsonValueKind.Array)
        {
            var extensions = value.Value.EnumerateArray()
                .Select(x => x.GetString())
                .Where(x => !string.IsNullOrWhiteSpace(x))
                .SelectMany(ExpandAllowedExtension)
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .OrderBy(x => x)
                .ToList();
            return JsonSerializer.Serialize(extensions.Count == 0 ? ["pdf", "png", "jpg", "jpeg"] : extensions, JsonOptions);
        }

        if (value.Value.ValueKind == JsonValueKind.String)
        {
            var raw = value.Value.GetString();
            var extensions = ParseAllowedExtensions(raw)
                .SelectMany(ExpandAllowedExtension)
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .OrderBy(x => x)
                .ToList();
            return JsonSerializer.Serialize(extensions.Count == 0 ? ["pdf", "png", "jpg", "jpeg"] : extensions, JsonOptions);
        }

        return JsonSerializer.Serialize(new[] { "pdf", "png", "jpg", "jpeg" }, JsonOptions);
    }

    private async Task ValidateAttachmentRulesAsync(int maxAttachments, int maxFileSizeMb, string allowedExtensionsJson, CancellationToken cancellationToken)
    {
        if (maxAttachments < 1 || maxFileSizeMb < 1)
        {
            throw new ApiException("قواعد المرفقات غير صالحة");
        }

        var globalMaxFileSizeMb = await settingsStore.GetValueAsync("attachments.max_file_size_mb", 10, cancellationToken);
        var globalHardLimit = await settingsStore.GetValueAsync("attachments.is_hard_limit", true, cancellationToken);
        if (globalHardLimit && maxFileSizeMb > globalMaxFileSizeMb)
        {
            throw new ApiException($"لا يمكن أن يتجاوز حجم المرفق لهذا النوع الحد الأقصى العام للمرفقات وهو {globalMaxFileSizeMb} MB.");
        }

        var blocked = new[] { "exe", "bat", "cmd", "ps1", "sh", "js", "vbs", "msi" };
        if (blocked.Any(ext => allowedExtensionsJson.Contains(ext, StringComparison.OrdinalIgnoreCase)))
        {
            throw new ApiException("الامتدادات المسموحة تحتوي على نوع ملف محظور");
        }
    }

    public static RequestTypeDto MapRequestType(RequestType item)
    {
        return new RequestTypeDto(
            item.Id,
            item.NameAr,
            item.NameEn,
            item.Code,
            item.Category,
            item.Description,
            item.Icon,
            item.Color,
            item.SpecializedSectionId,
            item.SpecializedSection?.NameAr,
            item.IsActive,
            item.CurrentVersionId,
            item.CurrentVersion?.VersionNumber,
            item.SortOrder,
            item.CreatedAt,
            item.UpdatedAt,
            item.CurrentVersion?.Settings is null ? null : MapSettings(item.CurrentVersion.Settings));
    }

    public static RequestTypeVersionDto MapVersion(RequestTypeVersion item)
    {
        return new RequestTypeVersionDto(item.Id, item.RequestTypeId, item.VersionNumber, item.Status, item.ChangeSummary, item.CreatedByUserId, item.CreatedByUser?.NameAr, item.ActivatedAt, item.CreatedAt, item.UpdatedAt);
    }

    public static RequestTypeFieldDto MapField(RequestTypeField item)
    {
        return new RequestTypeFieldDto(item.Id, item.VersionId, item.FieldName, item.LabelAr, item.LabelEn, item.FieldType, item.IsRequired, item.PlaceholderAr, item.HelpTextAr, item.DefaultValue, item.OptionsJson, item.ValidationRulesJson, item.SortOrder, item.SectionName, item.Width, item.IsActive, item.VisibleToRequester, item.VisibleToApprover, item.VisibleToExecutor);
    }

    public static WorkflowStepDto MapStep(WorkflowTemplateStep item)
    {
        return new WorkflowStepDto(item.Id, item.VersionId, item.StepNameAr, item.StepNameEn, item.StepType, item.ApproverRoleId, item.ApproverRole?.NameAr, item.ApproverUserId, item.ApproverUser?.NameAr, item.ApproverUser?.EmployeeNumber, item.TargetDepartmentId, item.TargetDepartment?.NameAr, item.IsMandatory, item.CanApprove, item.CanReject, item.CanReturnForEdit, item.CanDelegate, item.SlaHours, item.EscalationUserId, item.EscalationRoleId, item.ReturnToStepOrder, item.SortOrder, item.IsActive);
    }

    public static RequestTypeSettingsDto MapSettings(RequestTypeSettings item)
    {
        return new RequestTypeSettingsDto(item.Id, item.RequestTypeId, item.VersionId, item.RequiresAttachment, item.AllowMultipleAttachments, item.MaxAttachments, item.MaxFileSizeMb, item.AllowedExtensionsJson, item.RequireAttachmentBeforeSubmit, item.RequireAttachmentOnReturn, item.AllowAttachmentAfterSubmission, item.DefaultPriority, item.SlaResponseHours, item.SlaResolutionHours, item.BusinessHoursOnly, item.PauseSlaWhenWaitingForUser, item.AllowCancelByRequester, item.AllowReopen, item.AllowEditBeforeApproval, item.ShowInEmployeePortal, item.RequiresManager, item.EnableRequestMessagesTab, item.IncludeOfficialMessagesInPdf, item.PdfTemplateId);
    }

    private async Task<long?> ValidateWorkflowReferencesAsync(JsonElement request, CancellationToken cancellationToken)
    {
        var stepType = StringProp(request, "direct_manager", "step_type", "stepType");
        var approverRoleId = LongProp(request, null, "approver_role_id", "approverRoleId");
        var approverUserId = LongProp(request, null, "approver_user_id", "approverUserId");
        var approverEmployeeNumber = StringProp(request, null, "approver_employee_number", "approverEmployeeNumber", "approver_user_employee_number", "approverUserEmployeeNumber")?.Trim();
        var targetDepartmentId = LongProp(request, null, "target_department_id", "targetDepartmentId");
        var escalationRoleId = LongProp(request, null, "escalation_role_id", "escalationRoleId");
        var escalationUserId = LongProp(request, null, "escalation_user_id", "escalationUserId");

        if (stepType == "specific_role" && !approverRoleId.HasValue)
        {
            throw new ApiException("مرحلة الدور المحدد تتطلب اختيار دور");
        }

        if (stepType == "specific_user")
        {
            if (!string.IsNullOrWhiteSpace(approverEmployeeNumber))
            {
                approverUserId = await db.Users
                    .Where(x => x.EmployeeNumber == approverEmployeeNumber && x.IsActive)
                    .Select(x => (long?)x.Id)
                    .FirstOrDefaultAsync(cancellationToken);

                if (!approverUserId.HasValue)
                {
                    throw new ApiException("لم يتم العثور على مستخدم نشط بهذا الرقم الوظيفي");
                }
            }
            else if (!approverUserId.HasValue)
            {
                throw new ApiException("مرحلة المستخدم المحدد تتطلب إدخال الرقم الوظيفي للموظف");
            }
        }

        if (stepType == "specific_department_manager" && !targetDepartmentId.HasValue)
        {
            throw new ApiException("مرحلة مدير إدارة محددة تتطلب اختيار الإدارة");
        }

        if (approverRoleId.HasValue && !await db.Roles.AnyAsync(x => x.Id == approverRoleId.Value && x.IsActive, cancellationToken))
        {
            throw new ApiException("الدور المحدد غير صالح");
        }

        if (approverUserId.HasValue && !await db.Users.AnyAsync(x => x.Id == approverUserId.Value && x.IsActive, cancellationToken))
        {
            throw new ApiException("المستخدم المحدد غير صالح");
        }

        if (targetDepartmentId.HasValue && !await db.Departments.AnyAsync(x => x.Id == targetDepartmentId.Value && x.IsActive, cancellationToken))
        {
            throw new ApiException("الإدارة المحددة غير صالحة");
        }

        if (escalationRoleId.HasValue && !await db.Roles.AnyAsync(x => x.Id == escalationRoleId.Value && x.IsActive, cancellationToken))
        {
            throw new ApiException("دور التصعيد المحدد غير صالح");
        }

        if (escalationUserId.HasValue && !await db.Users.AnyAsync(x => x.Id == escalationUserId.Value && x.IsActive, cancellationToken))
        {
            throw new ApiException("مستخدم التصعيد المحدد غير صالح");
        }

        return stepType == "specific_user" ? approverUserId : null;
    }

    private static void ApplyField(RequestTypeField field, JsonElement request)
    {
        field.FieldName = RequiredString(request, "field_name", "fieldName").Trim();
        field.LabelAr = RequiredString(request, "label_ar", "labelAr").Trim();
        field.LabelEn = StringProp(request, null, "label_en", "labelEn")?.Trim();
        field.FieldType = StringProp(request, "text", "field_type", "fieldType")!.Trim();
        field.IsRequired = BoolProp(request, false, "is_required", "isRequired");
        field.PlaceholderAr = StringProp(request, null, "placeholder_ar", "placeholderAr", "placeholder")?.Trim();
        field.HelpTextAr = StringProp(request, null, "help_text_ar", "helpTextAr", "help_text", "helpText")?.Trim();
        field.DefaultValue = StringProp(request, null, "default_value", "defaultValue");
        field.OptionsJson = NormalizeOptionsJson(request);
        field.ValidationRulesJson = NormalizeValidationRulesJson(request);
        field.SortOrder = IntProp(request, field.SortOrder > 0 ? field.SortOrder : 1, "sort_order", "sortOrder") ?? 1;
        field.SectionName = StringProp(request, null, "section_name", "sectionName")?.Trim();
        field.Width = StringProp(request, "full", "width") ?? "full";
        field.IsActive = BoolProp(request, true, "is_active", "isActive");
        field.VisibleToRequester = BoolProp(request, true, "visible_to_requester", "visibleToRequester");
        field.VisibleToApprover = BoolProp(request, true, "visible_to_approver", "visibleToApprover");
        field.VisibleToExecutor = BoolProp(request, true, "visible_to_executor", "visibleToExecutor");
    }

    private static void ApplyWorkflowStep(WorkflowTemplateStep step, JsonElement request, long? approverUserId)
    {
        step.StepType = StringProp(request, "direct_manager", "step_type", "stepType")!.Trim();
        step.StepNameAr = StringProp(request, null, "step_name_ar", "stepNameAr")?.Trim()
            ?? StepTypeArabicName(step.StepType);
        step.StepNameEn = StringProp(request, null, "step_name_en", "stepNameEn")?.Trim();
        step.ApproverRoleId = step.StepType == "specific_role" ? LongProp(request, null, "approver_role_id", "approverRoleId") : null;
        step.ApproverUserId = step.StepType == "specific_user" ? approverUserId : null;
        step.TargetDepartmentId = step.StepType == "specific_department_manager" ? LongProp(request, null, "target_department_id", "targetDepartmentId") : null;
        step.IsMandatory = BoolProp(request, true, "is_mandatory", "isMandatory");
        step.CanApprove = BoolProp(request, true, "can_approve", "canApprove");
        step.CanReject = BoolProp(request, true, "can_reject", "canReject");
        step.CanReturnForEdit = BoolProp(request, false, "can_return_for_edit", "canReturnForEdit");
        step.CanDelegate = BoolProp(request, false, "can_delegate", "canDelegate");
        step.SlaHours = IntProp(request, null, "sla_hours", "slaHours");
        step.EscalationUserId = LongProp(request, null, "escalation_user_id", "escalationUserId");
        step.EscalationRoleId = LongProp(request, null, "escalation_role_id", "escalationRoleId");
        step.ReturnToStepOrder = step.CanReturnForEdit ? IntProp(request, null, "return_to_step_order", "returnToStepOrder") : null;
        step.SortOrder = IntProp(request, step.SortOrder > 0 ? step.SortOrder : 1, "sort_order", "sortOrder") ?? 1;
        step.IsActive = BoolProp(request, true, "is_active", "isActive");
    }

    private static object ToLegacyField(RequestTypeField item)
    {
        var options = ParseJsonArray(item.OptionsJson);
        var validationRules = ParseJsonObject(item.ValidationRulesJson);
        return new
        {
            item.Id,
            version_id = item.VersionId,
            field_name = item.FieldName,
            label_ar = item.LabelAr,
            label_en = item.LabelEn,
            field_type = item.FieldType,
            is_required = item.IsRequired,
            placeholder = item.PlaceholderAr,
            placeholder_ar = item.PlaceholderAr,
            help_text = item.HelpTextAr,
            help_text_ar = item.HelpTextAr,
            default_value = item.DefaultValue,
            options,
            options_json = options,
            validation_rules = validationRules,
            validation_rules_json = validationRules,
            sort_order = item.SortOrder,
            section_name = item.SectionName,
            width = item.Width,
            is_active = item.IsActive,
            visible_to_requester = item.VisibleToRequester,
            visible_to_approver = item.VisibleToApprover,
            visible_to_executor = item.VisibleToExecutor
        };
    }

    private static object ToLegacyStep(WorkflowTemplateStep item)
    {
        return new
        {
            item.Id,
            version_id = item.VersionId,
            step_name_ar = item.StepNameAr,
            step_name_en = item.StepNameEn,
            step_type = item.StepType,
            approver_role_id = item.ApproverRoleId,
            approver_role_name_ar = item.ApproverRole?.NameAr,
            approver_user_id = item.ApproverUserId,
            approver_user_name_ar = item.ApproverUser?.NameAr,
            approver_employee_number = item.ApproverUser?.EmployeeNumber,
            target_department_id = item.TargetDepartmentId,
            target_department_name_ar = item.TargetDepartment?.NameAr,
            is_mandatory = item.IsMandatory,
            can_approve = item.CanApprove,
            can_reject = item.CanReject,
            can_return_for_edit = item.CanReturnForEdit,
            can_delegate = item.CanDelegate,
            sla_hours = item.SlaHours,
            escalation_user_id = item.EscalationUserId,
            escalation_role_id = item.EscalationRoleId,
            return_to_step_order = item.ReturnToStepOrder,
            sort_order = item.SortOrder,
            is_active = item.IsActive
        };
    }

    private static object ToLegacyVersion(RequestTypeVersion item, int requestsCount)
    {
        var activeFields = item.Fields.Count(x => x.IsActive);
        var activeSteps = item.WorkflowSteps.Count(x => x.IsActive);
        return new
        {
            item.Id,
            request_type_id = item.RequestTypeId,
            version_number = item.VersionNumber,
            status = item.Status,
            change_summary = item.ChangeSummary,
            created_by = item.CreatedByUserId,
            created_by_user_id = item.CreatedByUserId,
            created_by_name_ar = item.CreatedByUser?.NameAr,
            created_at = item.CreatedAt,
            updated_at = item.UpdatedAt,
            activated_at = item.ActivatedAt,
            fields_count = activeFields,
            workflow_steps_count = activeSteps,
            requests_count = requestsCount,
            is_ready = item.Settings is not null && activeSteps > 0
        };
    }

    private static object ToLegacySettings(RequestTypeSettings item)
    {
        return new
        {
            item.Id,
            request_type_id = item.RequestTypeId,
            version_id = item.VersionId,
            requires_attachment = item.RequiresAttachment,
            allow_multiple_attachments = item.AllowMultipleAttachments,
            max_attachments = item.MaxAttachments,
            max_file_size_mb = item.MaxFileSizeMb,
            allowed_extensions_json = ParseAllowedExtensions(item.AllowedExtensionsJson),
            require_attachment_before_submit = item.RequireAttachmentBeforeSubmit,
            require_attachment_on_return = item.RequireAttachmentOnReturn,
            allow_attachment_after_submission = item.AllowAttachmentAfterSubmission,
            default_priority = ToLegacyPriorityCode(item.DefaultPriority),
            sla_response_hours = item.SlaResponseHours,
            sla_resolution_hours = item.SlaResolutionHours,
            business_hours_only = item.BusinessHoursOnly,
            pause_sla_when_waiting_for_user = item.PauseSlaWhenWaitingForUser,
            allow_cancel_by_requester = item.AllowCancelByRequester,
            allow_reopen = item.AllowReopen,
            allow_edit_before_approval = item.AllowEditBeforeApproval,
            show_in_employee_portal = item.ShowInEmployeePortal,
            requires_manager = item.RequiresManager,
            enable_request_messages_tab = item.EnableRequestMessagesTab,
            include_official_messages_in_pdf = item.IncludeOfficialMessagesInPdf,
            pdf_template_id = item.PdfTemplateId
        };
    }

    private static object ToLegacyRequestType(RequestType item)
    {
        var settings = item.CurrentVersion?.Settings;
        var workflow = item.CurrentVersion?.WorkflowSteps.OrderBy(x => x.SortOrder).ToList() ?? [];
        return new
        {
            item.Id,
            name_ar = item.NameAr,
            name_en = item.NameEn,
            item.Code,
            item.Category,
            item.Description,
            item.Icon,
            item.Color,
            specialized_section_id = item.SpecializedSectionId,
            specialized_section_name_ar = item.SpecializedSection?.NameAr,
            specialized_section_name = item.SpecializedSection?.NameAr,
            specialized_section_code = item.SpecializedSection?.Code,
            specialized_section = item.SpecializedSection is null ? null : new
            {
                item.SpecializedSection.Id,
                item.SpecializedSection.Code,
                name_ar = item.SpecializedSection.NameAr,
                name_en = item.SpecializedSection.NameEn,
                department_id = item.SpecializedSection.DepartmentId,
                department_name_ar = item.SpecializedSection.Department?.NameAr
            },
            assigned_section = item.SpecializedSection?.Code,
            assigned_section_label = item.SpecializedSection?.NameAr,
            assigned_department_id = item.SpecializedSection?.DepartmentId,
            auto_assign_strategy = item.SpecializedSection?.AutoAssignStrategy ?? "none",
            is_active = item.IsActive,
            current_version_id = item.CurrentVersionId,
            current_version_number = item.CurrentVersion?.VersionNumber,
            item.SortOrder,
            created_at = item.CreatedAt,
            updated_at = item.UpdatedAt,
            requires_attachment = settings?.RequiresAttachment ?? false,
            allow_multiple_attachments = settings?.AllowMultipleAttachments ?? false,
            max_attachments = settings?.MaxAttachments ?? 1,
            max_file_size_mb = settings?.MaxFileSizeMb ?? 10,
            allowed_extensions_json = ParseAllowedExtensions(settings?.AllowedExtensionsJson),
            default_priority = ToLegacyPriorityCode(settings?.DefaultPriority),
            sla_response_hours = settings?.SlaResponseHours,
            sla_resolution_hours = settings?.SlaResolutionHours,
            show_in_employee_portal = settings?.ShowInEmployeePortal ?? true,
            requires_manager = settings?.RequiresManager ?? true,
            allow_cancel_by_requester = settings?.AllowCancelByRequester ?? true,
            allow_reopen = settings?.AllowReopen ?? false,
            allow_edit_before_approval = settings?.AllowEditBeforeApproval ?? true,
            fields_count = item.CurrentVersion?.Fields.Count(x => x.IsActive) ?? 0,
            workflow_summary = workflow.Count == 0 ? null : string.Join(" ← ", workflow.Where(x => x.IsActive).Select(x => x.StepNameAr))
        };
    }

    private static string RequiredString(JsonElement element, params string[] names)
    {
        var value = StringProp(element, null, names);
        if (string.IsNullOrWhiteSpace(value))
        {
            throw new ApiException("توجد حقول مطلوبة غير مكتملة");
        }

        return value;
    }

    private static string? StringProp(JsonElement element, string? defaultValue, params string[] names)
    {
        if (!TryGetProperty(element, out var value, names) || value.ValueKind is JsonValueKind.Null or JsonValueKind.Undefined)
        {
            return defaultValue;
        }

        return value.ValueKind switch
        {
            JsonValueKind.String => value.GetString() ?? defaultValue,
            JsonValueKind.Number => value.GetRawText(),
            JsonValueKind.True => "true",
            JsonValueKind.False => "false",
            _ => value.GetRawText()
        };
    }

    private static bool BoolProp(JsonElement element, bool defaultValue, params string[] names)
    {
        if (!TryGetProperty(element, out var value, names) || value.ValueKind is JsonValueKind.Null or JsonValueKind.Undefined)
        {
            return defaultValue;
        }

        if (value.ValueKind == JsonValueKind.True) return true;
        if (value.ValueKind == JsonValueKind.False) return false;
        if (value.ValueKind == JsonValueKind.String && bool.TryParse(value.GetString(), out var parsed)) return parsed;
        return defaultValue;
    }

    private static int? IntProp(JsonElement element, int? defaultValue, params string[] names)
    {
        if (!TryGetProperty(element, out var value, names) || value.ValueKind is JsonValueKind.Null or JsonValueKind.Undefined)
        {
            return defaultValue;
        }

        if (value.ValueKind == JsonValueKind.Number && value.TryGetInt32(out var number)) return number;
        if (value.ValueKind == JsonValueKind.String && int.TryParse(value.GetString(), out var parsed)) return parsed;
        return defaultValue;
    }

    private static long? LongProp(JsonElement element, long? defaultValue, params string[] names)
    {
        if (!TryGetProperty(element, out var value, names) || value.ValueKind is JsonValueKind.Null or JsonValueKind.Undefined)
        {
            return defaultValue;
        }

        if (value.ValueKind == JsonValueKind.Number && value.TryGetInt64(out var number)) return number;
        if (value.ValueKind == JsonValueKind.String && long.TryParse(value.GetString(), out var parsed)) return parsed;
        return defaultValue;
    }

    private static IReadOnlyCollection<long> LongArrayProp(JsonElement element, params string[] names)
    {
        if (!TryGetProperty(element, out var value, names))
        {
            return [];
        }

        if (value.ValueKind == JsonValueKind.Array)
        {
            return value.EnumerateArray()
                .Select(item => item.ValueKind == JsonValueKind.Number && item.TryGetInt64(out var number)
                    ? number
                    : item.ValueKind == JsonValueKind.String && long.TryParse(item.GetString(), out var parsed)
                        ? parsed
                        : (long?)null)
                .Where(item => item.HasValue)
                .Select(item => item!.Value)
                .ToList();
        }

        if (value.ValueKind == JsonValueKind.String)
        {
            return (value.GetString() ?? string.Empty)
                .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
                .Select(item => long.TryParse(item, out var parsed) ? parsed : (long?)null)
                .Where(item => item.HasValue)
                .Select(item => item!.Value)
                .ToList();
        }

        return [];
    }

    private static bool TryGetProperty(JsonElement element, out JsonElement value, params string[] names)
    {
        foreach (var name in names)
        {
            if (element.TryGetProperty(name, out value))
            {
                return true;
            }
        }

        value = default;
        return false;
    }

    private static string NormalizeOptionsJson(JsonElement request)
    {
        if (TryGetProperty(request, out var optionsJson, "options_json", "optionsJson"))
        {
            if (optionsJson.ValueKind == JsonValueKind.Array) return optionsJson.GetRawText();
            if (optionsJson.ValueKind == JsonValueKind.String)
            {
                var raw = optionsJson.GetString();
                if (!string.IsNullOrWhiteSpace(raw) && raw.TrimStart().StartsWith('[')) return raw;
                return JsonSerializer.Serialize(SplitCsv(raw), JsonOptions);
            }
        }

        if (!TryGetProperty(request, out var options, "options"))
        {
            return "[]";
        }

        if (options.ValueKind == JsonValueKind.Array)
        {
            var values = options.EnumerateArray()
                .Select(item => item.ValueKind == JsonValueKind.String ? item.GetString() : item.GetRawText())
                .Where(item => !string.IsNullOrWhiteSpace(item))
                .Select(item => item!.Trim())
                .ToList();
            return JsonSerializer.Serialize(values, JsonOptions);
        }

        return options.ValueKind == JsonValueKind.String
            ? JsonSerializer.Serialize(SplitCsv(options.GetString()), JsonOptions)
            : "[]";
    }

    private static string NormalizeValidationRulesJson(JsonElement request)
    {
        if (!TryGetProperty(request, out var value, "validation_rules_json", "validationRulesJson", "validation_rules", "validationRules"))
        {
            return "{}";
        }

        if (value.ValueKind == JsonValueKind.Object || value.ValueKind == JsonValueKind.Array)
        {
            return value.GetRawText();
        }

        if (value.ValueKind == JsonValueKind.String)
        {
            var raw = value.GetString();
            return string.IsNullOrWhiteSpace(raw) ? "{}" : raw;
        }

        return "{}";
    }

    private static IReadOnlyCollection<string> ParseJsonArray(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return [];
        }

        try
        {
            return JsonSerializer.Deserialize<IReadOnlyCollection<string>>(value, JsonOptions) ?? [];
        }
        catch
        {
            return SplitCsv(value);
        }
    }

    private static IReadOnlyDictionary<string, object?> ParseJsonObject(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return new Dictionary<string, object?>();
        }

        try
        {
            return JsonSerializer.Deserialize<Dictionary<string, object?>>(value, JsonOptions) ?? new Dictionary<string, object?>();
        }
        catch
        {
            return new Dictionary<string, object?>();
        }
    }

    private static IReadOnlyCollection<string> SplitCsv(string? value)
    {
        return string.IsNullOrWhiteSpace(value)
            ? []
            : value.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
                .Where(item => !string.IsNullOrWhiteSpace(item))
                .ToList();
    }

    private static string StepTypeArabicName(string stepType)
    {
        return stepType switch
        {
            "direct_manager" => "المدير المباشر",
            "department_manager" => "مدير الإدارة المختصة",
            "department_specialist" => "مختص الإدارة المختصة",
            "specific_department_manager" => "مدير إدارة محددة",
            "specific_role" => "دور محدد",
            "specific_user" => "مستخدم محدد",
            "implementation_engineer" => "مختص تنفيذ",
            "executive_management" => "الإدارة التنفيذية",
            "close_request" => "إغلاق الطلب",
            "information_security" => "أمن المعلومات",
            _ => "مرحلة موافقة"
        };
    }

    private static IReadOnlyCollection<string> ParseAllowedExtensions(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return ["pdf", "png", "jpg", "jpeg"];
        }

        try
        {
            return (JsonSerializer.Deserialize<IReadOnlyCollection<string>>(value, JsonOptions) ?? ["pdf", "png", "jpg", "jpeg"])
                .SelectMany(ExpandAllowedExtension)
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .OrderBy(x => x)
                .ToList();
        }
        catch
        {
            return value.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
                .SelectMany(ExpandAllowedExtension)
                .Where(x => !string.IsNullOrWhiteSpace(x))
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .OrderBy(x => x)
                .ToList();
        }
    }

    private static IEnumerable<string> ExpandAllowedExtension(string? value)
    {
        var extension = (value ?? "").Trim().TrimStart('.').ToLowerInvariant();
        if (string.IsNullOrWhiteSpace(extension))
        {
            return [];
        }

        return ImageExtensionAliases.Contains(extension) || ImageExtensions.Contains(extension) ? ImageExtensions : [extension];
    }

    private static string ToLegacyPriorityCode(string? value)
    {
        return string.Equals(value, "normal", StringComparison.OrdinalIgnoreCase)
            ? "medium"
            : string.IsNullOrWhiteSpace(value)
                ? "medium"
                : value;
    }

    private static void AddCheck(List<object> checks, string code, string label, bool passed, string successMessage, string failureMessage)
    {
        checks.Add(new
        {
            code,
            label,
            status = passed ? "passed" : "failed",
            message = passed ? successMessage : failureMessage
        });
    }
}
