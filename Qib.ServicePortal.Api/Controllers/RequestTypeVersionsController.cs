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
[Route("api/dotnet/v1")]
[Authorize(Policy = "Permission:request_types.view")]
public class RequestTypeVersionsController(ServicePortalDbContext db, IAuditService auditService) : ControllerBase
{
    [HttpPost("request-type-versions/{versionId:long}/activate")]
    [Authorize(Policy = "Permission:request_types.manage")]
    public async Task<ActionResult<RequestTypeVersionDto>> ActivateVersion(long versionId, CancellationToken cancellationToken)
    {
        var version = await db.RequestTypeVersions
            .Include(x => x.RequestType)
            .Include(x => x.Fields)
            .Include(x => x.WorkflowSteps)
            .Include(x => x.Settings)
            .FirstOrDefaultAsync(x => x.Id == versionId, cancellationToken)
            ?? throw new ApiException("نسخة نوع الطلب غير موجودة", StatusCodes.Status404NotFound);

        var validation = await ValidateVersionAsync(version, cancellationToken);
        if (!validation.CanActivate)
        {
            throw new ApiException(string.Join("، ", validation.Errors));
        }

        var activeVersions = await db.RequestTypeVersions
            .Where(x => x.RequestTypeId == version.RequestTypeId && x.Status == "active")
            .ToListAsync(cancellationToken);
        foreach (var activeVersion in activeVersions)
        {
            activeVersion.Status = "archived";
        }

        version.Status = "active";
        version.ActivatedAt = DateTimeOffset.UtcNow;
        if (version.RequestType is not null)
        {
            version.RequestType.CurrentVersionId = version.Id;
            version.RequestType.IsActive = true;
        }

        await db.SaveChangesAsync(cancellationToken);
        await auditService.LogAsync("request_type_version_activated", "request_type_version", version.Id.ToString(), newValue: new { version.RequestTypeId, version.VersionNumber }, cancellationToken: cancellationToken);
        return Ok(RequestTypesController.MapVersion(version));
    }

    [HttpPost("request-type-versions/{versionId:long}/validate")]
    public async Task<ActionResult<RequestTypeValidationResultDto>> ValidateVersion(long versionId, CancellationToken cancellationToken)
    {
        var version = await db.RequestTypeVersions
            .Include(x => x.RequestType)
            .Include(x => x.Fields)
            .Include(x => x.WorkflowSteps)
            .Include(x => x.Settings)
            .FirstOrDefaultAsync(x => x.Id == versionId, cancellationToken)
            ?? throw new ApiException("نسخة نوع الطلب غير موجودة", StatusCodes.Status404NotFound);
        return Ok(await ValidateVersionAsync(version, cancellationToken));
    }

    [HttpGet("request-type-versions/{versionId:long}/fields")]
    public async Task<ActionResult<IReadOnlyCollection<RequestTypeFieldDto>>> GetFields(long versionId, CancellationToken cancellationToken)
    {
        await EnsureVersionExistsAsync(versionId, cancellationToken);
        var fields = await db.RequestTypeFields
            .AsNoTracking()
            .Where(x => x.VersionId == versionId)
            .OrderBy(x => x.SortOrder)
            .ThenBy(x => x.Id)
            .ToListAsync(cancellationToken);
        return Ok(fields.Select(RequestTypesController.MapField).ToList());
    }

    [HttpPost("request-type-versions/{versionId:long}/fields")]
    [Authorize(Policy = "Permission:request_fields.manage")]
    public async Task<ActionResult<RequestTypeFieldDto>> AddField(long versionId, UpsertRequestTypeFieldRequest request, CancellationToken cancellationToken)
    {
        await EnsureDraftVersionAsync(versionId, cancellationToken);
        if (await db.RequestTypeFields.AnyAsync(x => x.VersionId == versionId && x.FieldName == request.FieldName, cancellationToken))
        {
            throw new ApiException("اسم الحقل مستخدم مسبقاً في هذه النسخة");
        }

        var field = new RequestTypeField { VersionId = versionId };
        ApplyField(field, request);
        db.RequestTypeFields.Add(field);
        await db.SaveChangesAsync(cancellationToken);
        await auditService.LogAsync("request_field_added", "request_type_field", field.Id.ToString(), newValue: new { field.VersionId, field.FieldName }, cancellationToken: cancellationToken);
        return Ok(RequestTypesController.MapField(field));
    }

    [HttpPut("request-fields/{fieldId:long}")]
    [Authorize(Policy = "Permission:request_fields.manage")]
    public async Task<ActionResult<RequestTypeFieldDto>> UpdateField(long fieldId, UpsertRequestTypeFieldRequest request, CancellationToken cancellationToken)
    {
        var field = await db.RequestTypeFields.FirstOrDefaultAsync(x => x.Id == fieldId, cancellationToken)
                    ?? throw new ApiException("الحقل غير موجود", StatusCodes.Status404NotFound);
        await EnsureDraftVersionAsync(field.VersionId, cancellationToken);
        if (await db.RequestTypeFields.AnyAsync(x => x.Id != fieldId && x.VersionId == field.VersionId && x.FieldName == request.FieldName, cancellationToken))
        {
            throw new ApiException("اسم الحقل مستخدم مسبقاً في هذه النسخة");
        }

        var oldValue = new { field.FieldName, field.LabelAr, field.FieldType, field.IsRequired };
        ApplyField(field, request);
        await db.SaveChangesAsync(cancellationToken);
        await auditService.LogAsync("request_field_updated", "request_type_field", field.Id.ToString(), oldValue: oldValue, newValue: new { field.FieldName, field.LabelAr, field.FieldType, field.IsRequired }, cancellationToken: cancellationToken);
        return Ok(RequestTypesController.MapField(field));
    }

    [HttpDelete("request-fields/{fieldId:long}")]
    [Authorize(Policy = "Permission:request_fields.manage")]
    public async Task<IActionResult> DeleteField(long fieldId, CancellationToken cancellationToken)
    {
        var field = await db.RequestTypeFields.FirstOrDefaultAsync(x => x.Id == fieldId, cancellationToken)
                    ?? throw new ApiException("الحقل غير موجود", StatusCodes.Status404NotFound);
        await EnsureDraftVersionAsync(field.VersionId, cancellationToken);
        db.RequestTypeFields.Remove(field);
        await db.SaveChangesAsync(cancellationToken);
        await auditService.LogAsync("request_field_deleted", "request_type_field", fieldId.ToString(), cancellationToken: cancellationToken);
        return NoContent();
    }

    [HttpGet("request-type-versions/{versionId:long}/workflow")]
    public async Task<ActionResult<IReadOnlyCollection<WorkflowStepDto>>> GetWorkflow(long versionId, CancellationToken cancellationToken)
    {
        await EnsureVersionExistsAsync(versionId, cancellationToken);
        var steps = await WorkflowQuery()
            .AsNoTracking()
            .Where(x => x.VersionId == versionId)
            .OrderBy(x => x.SortOrder)
            .ThenBy(x => x.Id)
            .ToListAsync(cancellationToken);
        return Ok(steps.Select(RequestTypesController.MapStep).ToList());
    }

    [HttpPost("request-type-versions/{versionId:long}/workflow/steps")]
    [Authorize(Policy = "Permission:request_workflows.manage")]
    public async Task<ActionResult<WorkflowStepDto>> AddWorkflowStep(long versionId, UpsertWorkflowStepRequest request, CancellationToken cancellationToken)
    {
        await EnsureDraftVersionAsync(versionId, cancellationToken);
        var approverUserId = await ValidateWorkflowReferencesAsync(request, cancellationToken);
        var step = new WorkflowTemplateStep { VersionId = versionId };
        ApplyWorkflowStep(step, request, approverUserId);
        db.WorkflowTemplateSteps.Add(step);
        await db.SaveChangesAsync(cancellationToken);
        await auditService.LogAsync("workflow_step_added", "workflow_template_step", step.Id.ToString(), newValue: new { step.VersionId, step.StepType, step.StepNameAr }, cancellationToken: cancellationToken);
        var created = await WorkflowQuery().AsNoTracking().FirstAsync(x => x.Id == step.Id, cancellationToken);
        return Ok(RequestTypesController.MapStep(created));
    }

    [HttpPut("workflow-steps/{stepId:long}")]
    [Authorize(Policy = "Permission:request_workflows.manage")]
    public async Task<ActionResult<WorkflowStepDto>> UpdateWorkflowStep(long stepId, UpsertWorkflowStepRequest request, CancellationToken cancellationToken)
    {
        var step = await db.WorkflowTemplateSteps.FirstOrDefaultAsync(x => x.Id == stepId, cancellationToken)
                   ?? throw new ApiException("مرحلة الموافقة غير موجودة", StatusCodes.Status404NotFound);
        await EnsureDraftVersionAsync(step.VersionId, cancellationToken);
        var approverUserId = await ValidateWorkflowReferencesAsync(request, cancellationToken);
        var oldValue = new { step.StepNameAr, step.StepType, step.SortOrder, step.CanReject, step.CanReturnForEdit };
        ApplyWorkflowStep(step, request, approverUserId);
        await db.SaveChangesAsync(cancellationToken);
        await auditService.LogAsync("workflow_step_updated", "workflow_template_step", step.Id.ToString(), oldValue: oldValue, newValue: new { step.StepNameAr, step.StepType, step.SortOrder, step.CanReject, step.CanReturnForEdit }, cancellationToken: cancellationToken);
        var updated = await WorkflowQuery().AsNoTracking().FirstAsync(x => x.Id == step.Id, cancellationToken);
        return Ok(RequestTypesController.MapStep(updated));
    }

    [HttpDelete("workflow-steps/{stepId:long}")]
    [Authorize(Policy = "Permission:request_workflows.manage")]
    public async Task<IActionResult> DeleteWorkflowStep(long stepId, CancellationToken cancellationToken)
    {
        var step = await db.WorkflowTemplateSteps.FirstOrDefaultAsync(x => x.Id == stepId, cancellationToken)
                   ?? throw new ApiException("مرحلة الموافقة غير موجودة", StatusCodes.Status404NotFound);
        await EnsureDraftVersionAsync(step.VersionId, cancellationToken);
        db.WorkflowTemplateSteps.Remove(step);
        await db.SaveChangesAsync(cancellationToken);
        await auditService.LogAsync("workflow_step_deleted", "workflow_template_step", stepId.ToString(), cancellationToken: cancellationToken);
        return NoContent();
    }

    private IQueryable<WorkflowTemplateStep> WorkflowQuery()
    {
        return db.WorkflowTemplateSteps
            .Include(x => x.ApproverRole)
            .Include(x => x.ApproverUser)
            .Include(x => x.TargetDepartment);
    }

    private async Task EnsureVersionExistsAsync(long versionId, CancellationToken cancellationToken)
    {
        if (!await db.RequestTypeVersions.AnyAsync(x => x.Id == versionId, cancellationToken))
        {
            throw new ApiException("نسخة نوع الطلب غير موجودة", StatusCodes.Status404NotFound);
        }
    }

    private async Task EnsureDraftVersionAsync(long versionId, CancellationToken cancellationToken)
    {
        var status = await db.RequestTypeVersions.Where(x => x.Id == versionId).Select(x => x.Status).FirstOrDefaultAsync(cancellationToken);
        if (status is null)
        {
            throw new ApiException("نسخة نوع الطلب غير موجودة", StatusCodes.Status404NotFound);
        }

        if (status != "draft")
        {
            throw new ApiException("يمكن تعديل النسخ المسودة فقط");
        }
    }

    private async Task<long?> ValidateWorkflowReferencesAsync(UpsertWorkflowStepRequest request, CancellationToken cancellationToken)
    {
        var approverUserId = request.ApproverUserId;

        if (request.ApproverRoleId.HasValue && !await db.Roles.AnyAsync(x => x.Id == request.ApproverRoleId.Value && x.IsActive, cancellationToken))
        {
            throw new ApiException("الدور المحدد غير صالح");
        }

        if (request.StepType == "specific_user")
        {
            if (!string.IsNullOrWhiteSpace(request.ApproverEmployeeNumber))
            {
                approverUserId = await db.Users
                    .Where(x => x.EmployeeNumber == request.ApproverEmployeeNumber.Trim() && x.IsActive)
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

        if (approverUserId.HasValue && !await db.Users.AnyAsync(x => x.Id == approverUserId.Value && x.IsActive, cancellationToken))
        {
            throw new ApiException("المستخدم المحدد غير صالح");
        }

        if (request.TargetDepartmentId.HasValue && !await db.Departments.AnyAsync(x => x.Id == request.TargetDepartmentId.Value && x.IsActive, cancellationToken))
        {
            throw new ApiException("الإدارة المحددة غير صالحة");
        }

        if (request.EscalationRoleId.HasValue && !await db.Roles.AnyAsync(x => x.Id == request.EscalationRoleId.Value && x.IsActive, cancellationToken))
        {
            throw new ApiException("دور التصعيد المحدد غير صالح");
        }

        if (request.EscalationUserId.HasValue && !await db.Users.AnyAsync(x => x.Id == request.EscalationUserId.Value && x.IsActive, cancellationToken))
        {
            throw new ApiException("مستخدم التصعيد المحدد غير صالح");
        }

        return request.StepType == "specific_user" ? approverUserId : null;
    }

    private async Task<RequestTypeValidationResultDto> ValidateVersionAsync(RequestTypeVersion version, CancellationToken cancellationToken)
    {
        var errors = new List<string>();
        var warnings = new List<string>();

        if (version.RequestType is null)
        {
            errors.Add("نوع الطلب غير موجود");
        }

        if (string.IsNullOrWhiteSpace(version.RequestType?.NameAr) || string.IsNullOrWhiteSpace(version.RequestType?.Code))
        {
            errors.Add("بيانات نوع الطلب الأساسية غير مكتملة");
        }

        if (version.Settings is null)
        {
            errors.Add("إعدادات نوع الطلب غير موجودة");
        }

        if (version.WorkflowSteps.Count(x => x.IsActive) == 0)
        {
            errors.Add("يجب إضافة مرحلة موافقة واحدة على الأقل");
        }

        foreach (var step in version.WorkflowSteps.Where(x => x.IsActive))
        {
            if (step.StepType == "specific_role" && !step.ApproverRoleId.HasValue)
            {
                errors.Add($"مرحلة {step.StepNameAr} تتطلب دوراً محدداً");
            }

            if (step.StepType == "specific_user" && !step.ApproverUserId.HasValue)
            {
                errors.Add($"مرحلة {step.StepNameAr} تتطلب مستخدماً محدداً");
            }

            if (step.StepType == "specific_department_manager" && !step.TargetDepartmentId.HasValue)
            {
                errors.Add($"مرحلة {step.StepNameAr} تتطلب إدارة محددة");
            }
        }

        if (version.Fields.Count(x => x.IsActive) == 0)
        {
            warnings.Add("لا توجد حقول فعالة في النموذج");
        }

        if (version.RequestType?.SpecializedSectionId.HasValue == true)
        {
            var sectionExists = await db.SpecializedSections.AnyAsync(x => x.Id == version.RequestType.SpecializedSectionId.Value && x.IsActive, cancellationToken);
            if (!sectionExists)
            {
                errors.Add("القسم المختص غير صالح");
            }
        }

        return new RequestTypeValidationResultDto(errors.Count == 0, errors, warnings);
    }

    private static void ApplyField(RequestTypeField field, UpsertRequestTypeFieldRequest request)
    {
        field.FieldName = request.FieldName.Trim();
        field.LabelAr = request.LabelAr.Trim();
        field.LabelEn = request.LabelEn?.Trim();
        field.FieldType = request.FieldType;
        field.IsRequired = request.IsRequired;
        field.PlaceholderAr = request.PlaceholderAr?.Trim();
        field.HelpTextAr = request.HelpTextAr?.Trim();
        field.DefaultValue = request.DefaultValue;
        field.OptionsJson = request.OptionsJson;
        field.ValidationRulesJson = request.ValidationRulesJson;
        field.SortOrder = request.SortOrder;
        field.SectionName = request.SectionName?.Trim();
        field.Width = request.Width;
        field.IsActive = request.IsActive;
        field.VisibleToRequester = request.VisibleToRequester;
        field.VisibleToApprover = request.VisibleToApprover;
        field.VisibleToExecutor = request.VisibleToExecutor;
    }

    private static void ApplyWorkflowStep(WorkflowTemplateStep step, UpsertWorkflowStepRequest request, long? approverUserId)
    {
        step.StepNameAr = request.StepNameAr.Trim();
        step.StepNameEn = request.StepNameEn?.Trim();
        step.StepType = request.StepType;
        step.ApproverRoleId = request.ApproverRoleId;
        step.ApproverUserId = request.StepType == "specific_user" ? approverUserId : null;
        step.TargetDepartmentId = request.TargetDepartmentId;
        step.IsMandatory = request.IsMandatory;
        step.CanApprove = request.CanApprove;
        step.CanReject = request.CanReject;
        step.CanReturnForEdit = request.CanReturnForEdit;
        step.CanDelegate = request.CanDelegate;
        step.SlaHours = request.SlaHours;
        step.EscalationUserId = request.EscalationUserId;
        step.EscalationRoleId = request.EscalationRoleId;
        step.ReturnToStepOrder = request.ReturnToStepOrder;
        step.SortOrder = request.SortOrder;
        step.IsActive = request.IsActive;
    }
}
