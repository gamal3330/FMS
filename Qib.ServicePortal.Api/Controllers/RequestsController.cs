using System.Security.Cryptography;
using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Qib.ServicePortal.Api.Application.DTOs;
using Qib.ServicePortal.Api.Application.Interfaces;
using Qib.ServicePortal.Api.Common.Exceptions;
using Qib.ServicePortal.Api.Domain.Entities;
using Qib.ServicePortal.Api.Infrastructure.Data;
using Qib.ServicePortal.Api.Infrastructure.Pdf;
using RequestEntity = Qib.ServicePortal.Api.Domain.Entities.Request;

namespace Qib.ServicePortal.Api.Controllers;

[ApiController]
[Route("api/dotnet/v1/requests")]
[Authorize(Policy = "Permission:requests.view")]
public class RequestsController(
    ServicePortalDbContext db,
    ICurrentUserService currentUser,
    IPermissionService permissionService,
    IAuditService auditService,
    ISettingsStore settingsStore,
    INotificationRealtimeService realtimeNotifications,
    IConfiguration configuration) : ControllerBase
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);
    private static readonly HashSet<string> FinalStatuses = ["completed", "closed", "rejected", "cancelled"];
    private static readonly HashSet<string> BlockedExtensions = ["exe", "bat", "cmd", "ps1", "sh", "js", "vbs", "msi"];
    private static readonly HashSet<string> ImageExtensionAliases = ["image", "images", "photo", "photos", "picture", "pictures", "صورة", "صور"];
    private static readonly string[] ImageExtensions = ["png", "jpg", "jpeg", "webp", "heic", "heif"];
    private static readonly HashSet<string> SystemFormMetadataFields =
    [
        "administrative_section",
        "administrative_section_label",
        "assigned_section",
        "assigned_section_label",
        "assigned_department_id",
        "assigned_department_name",
        "request_type_code",
        "request_type_label",
        "business_justification"
    ];

    [HttpGet]
    public async Task<ActionResult<IReadOnlyCollection<RequestDto>>> GetRequests(
        [FromQuery] string? search,
        [FromQuery] string? status,
        [FromQuery] long? requestTypeId,
        [FromQuery(Name = "request_type_id")] long? requestTypeIdSnake,
        [FromQuery] bool? myRequests,
        [FromQuery(Name = "my_requests")] bool? myRequestsSnake,
        CancellationToken cancellationToken)
    {
        var actorId = RequireCurrentUserId();
        var actor = await LoadActorAsync(cancellationToken);
        var canManage = await permissionService.HasPermissionAsync(actorId, "requests.manage", cancellationToken);
        var query = BaseRequestQuery().AsNoTracking();

        if (!canManage || myRequests == true || myRequestsSnake == true)
        {
            query = ApplyRequestScope(query, actor);
        }

        if (!string.IsNullOrWhiteSpace(status))
        {
            query = query.Where(x => x.Status == status);
        }

        var effectiveRequestTypeId = requestTypeId ?? requestTypeIdSnake;
        if (effectiveRequestTypeId.HasValue)
        {
            query = query.Where(x => x.RequestTypeId == effectiveRequestTypeId.Value);
        }

        if (!string.IsNullOrWhiteSpace(search))
        {
            var value = search.Trim().ToLowerInvariant();
            query = query.Where(x =>
                x.RequestNumber.ToLower().Contains(value) ||
                x.Title.ToLower().Contains(value) ||
                x.Requester!.NameAr.ToLower().Contains(value));
        }

        var requests = await query
            .OrderByDescending(x => x.CreatedAt)
            .Take(500)
            .ToListAsync(cancellationToken);
        return Ok(requests.Select(MapRequest).ToList());
    }

    [HttpPost]
    public async Task<ActionResult<RequestDetailsDto>> CreateRequest(CreateRequestRequest request, CancellationToken cancellationToken)
    {
        var actorId = RequireCurrentUserId();
        var requester = await db.Users
            .Include(x => x.Department)
            .FirstOrDefaultAsync(x => x.Id == actorId && x.IsActive && !x.IsLocked, cancellationToken)
            ?? throw new ApiException("المستخدم غير صالح", StatusCodes.Status403Forbidden);

        var requestType = await db.RequestTypes
            .Include(x => x.SpecializedSection)
            .ThenInclude(x => x!.DefaultAssigneeUser)
            .Include(x => x.SpecializedSection)
            .ThenInclude(x => x!.ManagerUser)
            .Include(x => x.SpecializedSection)
            .ThenInclude(x => x!.Department)
            .ThenInclude(x => x!.ManagerUser)
            .Include(x => x.CurrentVersion)
            .ThenInclude(x => x!.Settings)
            .FirstOrDefaultAsync(x => x.Id == request.RequestTypeId, cancellationToken)
            ?? throw new ApiException("نوع الطلب غير موجود", StatusCodes.Status404NotFound);

        if (!requestType.IsActive || requestType.CurrentVersion is null || requestType.CurrentVersion.Status != "active" || requestType.CurrentVersion.Settings is null)
        {
            throw new ApiException("نوع الطلب غير متاح حالياً");
        }

        var fields = await db.RequestTypeFields
            .Where(x => x.VersionId == requestType.CurrentVersion.Id && x.IsActive && x.VisibleToRequester)
            .OrderBy(x => x.SortOrder)
            .ToListAsync(cancellationToken);
        var workflowSteps = await db.WorkflowTemplateSteps
            .Where(x => x.VersionId == requestType.CurrentVersion.Id && x.IsActive)
            .OrderBy(x => x.SortOrder)
            .ToListAsync(cancellationToken);

        if (workflowSteps.Count == 0)
        {
            throw new ApiException("نوع الطلب لا يحتوي على مسار موافقات فعال");
        }

        ValidateFormData(fields, request.FormData);
        var now = DateTimeOffset.UtcNow;
        var settings = requestType.CurrentVersion.Settings;
        var priority = NormalizePriorityCode(string.IsNullOrWhiteSpace(request.Priority) ? settings.DefaultPriority : request.Priority!);
        var prioritySetting = await db.PrioritySettings.AsNoTracking().FirstOrDefaultAsync(x => x.Code == priority && x.IsActive, cancellationToken);
        if (prioritySetting is null)
        {
            throw new ApiException("الأولوية المحددة غير صالحة");
        }

        var responseDueAt = now.AddHours(settings.SlaResponseHours ?? prioritySetting.ResponseHours);
        var resolutionDueAt = now.AddHours(settings.SlaResolutionHours ?? prioritySetting.ResolutionHours);

        var entity = new RequestEntity
        {
            RequestNumber = await GenerateRequestNumberAsync(cancellationToken),
            Title = request.Title.Trim(),
            RequestTypeId = requestType.Id,
            RequestTypeVersionId = requestType.CurrentVersion.Id,
            RequesterId = requester.Id,
            DepartmentId = requester.DepartmentId,
            SpecializedSectionId = requestType.SpecializedSectionId,
            AssignedToId = requestType.SpecializedSection?.DefaultAssigneeUserId,
            Status = "pending_approval",
            Priority = priority,
            SlaResponseDueAt = responseDueAt,
            SlaResolutionDueAt = resolutionDueAt,
            SubmittedAt = now,
            FormDataJson = SerializeSchemaFormData(fields, request.FormData)
        };

        db.Requests.Add(entity);
        await db.SaveChangesAsync(cancellationToken);

        var workflowSnapshots = CreateWorkflowSnapshots(entity.Id, workflowSteps, now).ToList();
        db.RequestFieldSnapshots.AddRange(CreateFieldSnapshots(entity.Id, fields, request.FormData));
        db.RequestWorkflowSnapshots.AddRange(workflowSnapshots);
        db.RequestStatusHistory.Add(new RequestStatusHistory
        {
            RequestId = entity.Id,
            OldStatus = null,
            NewStatus = entity.Status,
            ChangedByUserId = requester.Id,
            ChangedAt = now,
            Comment = "تم تقديم الطلب"
        });
        db.RequestSlaTracking.Add(new RequestSlaTracking
        {
            RequestId = entity.Id,
            ResponseDueAt = responseDueAt,
            ResolutionDueAt = resolutionDueAt
        });

        await db.SaveChangesAsync(cancellationToken);
        var effectiveSendNotification = await ShouldSendRequestCreatedNotificationAsync(request.SendNotification, cancellationToken);
        if (effectiveSendNotification)
        {
            await CreateRequestCreatedLinkedMessageAsync(entity, requester, requestType, workflowSnapshots, now, cancellationToken);
        }

        await auditService.LogAsync(
            "request_created",
            "request",
            entity.Id.ToString(),
            newValue: new { entity.RequestNumber, entity.RequestTypeId, entity.RequestTypeVersionId, sendNotification = effectiveSendNotification },
            cancellationToken: cancellationToken);

        var created = await LoadRequestDetailsAsync(entity.Id, cancellationToken);
        return CreatedAtAction(nameof(GetRequest), new { id = entity.Id }, MapDetails(created));
    }

    [HttpPost("dynamic")]
    public Task<ActionResult<RequestDetailsDto>> CreateDynamicRequest([FromBody] JsonElement request, CancellationToken cancellationToken)
    {
        return CreateRequest(ParseCreateRequest(request), cancellationToken);
    }

    [HttpGet("{id:long}")]
    public async Task<ActionResult<RequestDetailsDto>> GetRequest(long id, CancellationToken cancellationToken)
    {
        await EnsureCanViewRequestAsync(id, cancellationToken);
        var request = await LoadRequestDetailsAsync(id, cancellationToken);
        return Ok(MapDetails(request));
    }

    [HttpPut("{id:long}")]
    public async Task<ActionResult<RequestDetailsDto>> UpdateRequest(long id, UpdateRequestRequest request, CancellationToken cancellationToken)
    {
        var actorId = RequireCurrentUserId();
        var entity = await db.Requests
            .Include(x => x.RequestTypeVersion)
            .ThenInclude(x => x!.Settings)
            .FirstOrDefaultAsync(x => x.Id == id, cancellationToken)
            ?? throw new ApiException("الطلب غير موجود", StatusCodes.Status404NotFound);

        var canManage = await permissionService.HasPermissionAsync(actorId, "requests.manage", cancellationToken);
        if (!canManage && entity.RequesterId != actorId)
        {
            throw new ApiException("لا تملك صلاحية تعديل هذا الطلب", StatusCodes.Status403Forbidden);
        }

        var allowEditBeforeApproval = entity.RequestTypeVersion?.Settings?.AllowEditBeforeApproval == true;
        if (entity.Status != "returned_for_edit" && !(entity.Status == "pending_approval" && allowEditBeforeApproval))
        {
            throw new ApiException("لا يمكن تعديل الطلب في حالته الحالية");
        }

        var fields = await db.RequestTypeFields
            .Where(x => x.VersionId == entity.RequestTypeVersionId && x.IsActive && x.VisibleToRequester)
            .OrderBy(x => x.SortOrder)
            .ToListAsync(cancellationToken);
        ValidateFormData(fields, request.FormData);

        var oldValue = new { entity.Title, entity.Priority, entity.FormDataJson };
        entity.Title = request.Title.Trim();
        if (!string.IsNullOrWhiteSpace(request.Priority))
        {
            var normalizedPriority = NormalizePriorityCode(request.Priority);
            if (!await db.PrioritySettings.AnyAsync(x => x.Code == normalizedPriority && x.IsActive, cancellationToken))
            {
                throw new ApiException("الأولوية المحددة غير صالحة");
            }

            entity.Priority = normalizedPriority;
        }

        entity.FormDataJson = SerializeSchemaFormData(fields, request.FormData);
        db.RequestFieldSnapshots.RemoveRange(db.RequestFieldSnapshots.Where(x => x.RequestId == id));
        db.RequestFieldSnapshots.AddRange(CreateFieldSnapshots(id, fields, request.FormData));
        await db.SaveChangesAsync(cancellationToken);
        await auditService.LogAsync("request_updated", "request", id.ToString(), oldValue: oldValue, newValue: new { entity.Title, entity.Priority, entity.FormDataJson }, cancellationToken: cancellationToken);

        var updated = await LoadRequestDetailsAsync(id, cancellationToken);
        return Ok(MapDetails(updated));
    }

    [HttpPatch("{id:long}")]
    public Task<ActionResult<RequestDetailsDto>> PatchRequest(long id, [FromBody] JsonElement request, CancellationToken cancellationToken)
    {
        return UpdateRequest(id, ParseUpdateRequest(request), cancellationToken);
    }

    [HttpPost("{id:long}/cancel")]
    public async Task<IActionResult> CancelRequest(long id, RequestActionRequest request, CancellationToken cancellationToken)
    {
        var actorId = RequireCurrentUserId();
        var entity = await db.Requests.FirstOrDefaultAsync(x => x.Id == id, cancellationToken)
                     ?? throw new ApiException("الطلب غير موجود", StatusCodes.Status404NotFound);
        var canManage = await permissionService.HasPermissionAsync(actorId, "requests.manage", cancellationToken);
        if (!canManage && entity.RequesterId != actorId)
        {
            throw new ApiException("لا تملك صلاحية إلغاء هذا الطلب", StatusCodes.Status403Forbidden);
        }

        if (FinalStatuses.Contains(entity.Status))
        {
            throw new ApiException("لا يمكن إلغاء طلب منتهٍ");
        }

        await ChangeRequestStatusAsync(entity, "cancelled", actorId, request.Comment ?? "تم إلغاء الطلب", cancellationToken);
        await db.RequestWorkflowSnapshots
            .Where(x => x.RequestId == id && (x.Status == "pending" || x.Status == "waiting"))
            .ExecuteUpdateAsync(x => x.SetProperty(s => s.Status, "cancelled"), cancellationToken);
        await auditService.LogAsync("request_cancelled", "request", id.ToString(), metadata: new { request.Comment }, cancellationToken: cancellationToken);
        return NoContent();
    }

    [HttpPost("{id:long}/resubmit")]
    public async Task<ActionResult<RequestDetailsDto>> ResubmitRequest(long id, RequestActionRequest request, CancellationToken cancellationToken)
    {
        var actorId = RequireCurrentUserId();
        var entity = await db.Requests.FirstOrDefaultAsync(x => x.Id == id, cancellationToken)
                     ?? throw new ApiException("الطلب غير موجود", StatusCodes.Status404NotFound);
        if (entity.RequesterId != actorId && !await permissionService.HasPermissionAsync(actorId, "requests.manage", cancellationToken))
        {
            throw new ApiException("لا تملك صلاحية إعادة إرسال هذا الطلب", StatusCodes.Status403Forbidden);
        }

        if (entity.Status != "returned_for_edit")
        {
            throw new ApiException("يمكن إعادة إرسال الطلبات المعادة للتعديل فقط");
        }

        var steps = await db.RequestWorkflowSnapshots.Where(x => x.RequestId == id).OrderBy(x => x.SortOrder).ToListAsync(cancellationToken);
        var now = DateTimeOffset.UtcNow;
        for (var i = 0; i < steps.Count; i++)
        {
            steps[i].Status = i == 0 ? "pending" : "waiting";
            steps[i].PendingAt = i == 0 ? now : null;
            steps[i].ActionByUserId = null;
            steps[i].ActionAt = null;
            steps[i].Comments = null;
        }

        entity.SubmittedAt = now;
        await ChangeRequestStatusAsync(entity, "pending_approval", actorId, request.Comment ?? "تمت إعادة إرسال الطلب", cancellationToken, saveNow: false);
        await db.SaveChangesAsync(cancellationToken);
        await auditService.LogAsync("request_resubmitted", "request", id.ToString(), metadata: new { request.Comment }, cancellationToken: cancellationToken);

        var updated = await LoadRequestDetailsAsync(id, cancellationToken);
        return Ok(MapDetails(updated));
    }

    [HttpPost("{id:long}/reopen")]
    public async Task<ActionResult<RequestDetailsDto>> ReopenRequest(long id, RequestActionRequest request, CancellationToken cancellationToken)
    {
        var actorId = RequireCurrentUserId();
        if (!await permissionService.HasPermissionAsync(actorId, "requests.manage", cancellationToken))
        {
            throw new ApiException("لا تملك صلاحية إعادة فتح الطلب", StatusCodes.Status403Forbidden);
        }

        var entity = await db.Requests
            .Include(x => x.RequestTypeVersion)
            .ThenInclude(x => x!.Settings)
            .FirstOrDefaultAsync(x => x.Id == id, cancellationToken)
            ?? throw new ApiException("الطلب غير موجود", StatusCodes.Status404NotFound);
        if (entity.RequestTypeVersion?.Settings?.AllowReopen != true)
        {
            throw new ApiException("إعادة فتح هذا النوع من الطلبات غير مفعلة");
        }

        if (entity.Status is not ("closed" or "completed" or "rejected"))
        {
            throw new ApiException("يمكن إعادة فتح الطلبات المغلقة أو المكتملة أو المرفوضة فقط");
        }

        await ChangeRequestStatusAsync(entity, "reopened", actorId, request.Comment ?? "تمت إعادة فتح الطلب", cancellationToken);
        await auditService.LogAsync("request_reopened", "request", id.ToString(), metadata: new { request.Comment }, cancellationToken: cancellationToken);

        var updated = await LoadRequestDetailsAsync(id, cancellationToken);
        return Ok(MapDetails(updated));
    }

    [HttpPost("{id:long}/attachments")]
    [Consumes("multipart/form-data")]
    public async Task<ActionResult<RequestAttachmentDto>> UploadAttachment(long id, IFormFile file, CancellationToken cancellationToken)
    {
        var attachments = await UploadAttachmentsAsync(id, [file], cancellationToken);
        return Ok(attachments.First());
    }

    [HttpPost("{id:long}/attachments/batch")]
    [Consumes("multipart/form-data")]
    public async Task<ActionResult<IReadOnlyCollection<RequestAttachmentDto>>> UploadAttachments(long id, List<IFormFile> files, CancellationToken cancellationToken)
    {
        var attachments = await UploadAttachmentsAsync(id, files, cancellationToken);
        return Ok(attachments);
    }

    private async Task<IReadOnlyCollection<RequestAttachmentDto>> UploadAttachmentsAsync(long id, IReadOnlyCollection<IFormFile> files, CancellationToken cancellationToken)
    {
        var actorId = RequireCurrentUserId();
        if (files.Count == 0 || files.Any(file => file is null))
        {
            throw new ApiException("يرجى اختيار ملف واحد على الأقل");
        }

        var entity = await db.Requests
            .Include(x => x.RequestTypeVersion)
            .ThenInclude(x => x!.Settings)
            .Include(x => x.Attachments.Where(a => !a.IsDeleted))
            .FirstOrDefaultAsync(x => x.Id == id, cancellationToken)
            ?? throw new ApiException("الطلب غير موجود", StatusCodes.Status404NotFound);
        await EnsureCanViewRequestAsync(id, cancellationToken);

        var settings = entity.RequestTypeVersion?.Settings;
        if (settings is null)
        {
            throw new ApiException("إعدادات نوع الطلب غير موجودة");
        }

        if (!settings.AllowAttachmentAfterSubmission && entity.Status != "draft")
        {
            throw new ApiException("إضافة المرفقات بعد الإرسال غير مسموحة لهذا النوع");
        }

        var activeAttachmentCount = entity.Attachments.Count(x => !x.IsDeleted);
        var maxAttachments = settings.AllowMultipleAttachments ? Math.Max(settings.MaxAttachments, 1) : 1;
        var requestedTotal = activeAttachmentCount + files.Count;

        if (!settings.AllowMultipleAttachments && requestedTotal > 1)
        {
            throw new ApiException("لا يسمح هذا النوع بأكثر من مرفق");
        }

        if (requestedTotal > maxAttachments)
        {
            var remaining = Math.Max(maxAttachments - activeAttachmentCount, 0);
            throw new ApiException(remaining == 0
                ? $"تم الوصول للحد الأقصى للمرفقات وهو {maxAttachments}"
                : $"عدد المرفقات يتجاوز الحد المسموح. المتبقي لهذا الطلب: {remaining}");
        }

        foreach (var file in files)
        {
            await ValidateGlobalUploadSettingsAsync(file, settings, cancellationToken);
            ValidateUpload(file, settings);
        }

        var uploadPath = Path.Combine(configuration["Storage:UploadsPath"] ?? "/data/uploads", "requests", id.ToString());
        Directory.CreateDirectory(uploadPath);

        var createdAttachments = new List<RequestAttachment>();
        foreach (var file in files)
        {
            var extension = Path.GetExtension(file.FileName).ToLowerInvariant();
            var storedFileName = $"{Guid.NewGuid():N}{extension}";
            var storagePath = Path.Combine(uploadPath, storedFileName);

            await using (var stream = System.IO.File.Create(storagePath))
            {
                await file.CopyToAsync(stream, cancellationToken);
            }

            var checksum = await ComputeChecksumAsync(storagePath, cancellationToken);
            createdAttachments.Add(new RequestAttachment
            {
                RequestId = id,
                FileName = Path.GetFileName(file.FileName),
                StoredFileName = storedFileName,
                StoragePath = storagePath,
                ContentType = file.ContentType,
                FileSize = file.Length,
                Checksum = checksum,
                UploadedByUserId = actorId,
                UploadedAt = DateTimeOffset.UtcNow
            });
        }

        db.RequestAttachments.AddRange(createdAttachments);
        await db.SaveChangesAsync(cancellationToken);
        foreach (var attachment in createdAttachments)
        {
            await auditService.LogAsync("request_attachment_uploaded", "request_attachment", attachment.Id.ToString(), newValue: new { attachment.RequestId, attachment.FileName, attachment.FileSize }, cancellationToken: cancellationToken);
        }

        var createdIds = createdAttachments.Select(x => x.Id).ToList();
        var created = await db.RequestAttachments
            .Include(x => x.UploadedByUser)
            .AsNoTracking()
            .Where(x => createdIds.Contains(x.Id))
            .OrderBy(x => x.Id)
            .ToListAsync(cancellationToken);
        return created.Select(MapAttachment).ToList();
    }

    [HttpGet("{id:long}/attachments")]
    public async Task<ActionResult<IReadOnlyCollection<RequestAttachmentDto>>> GetAttachments(long id, CancellationToken cancellationToken)
    {
        await EnsureCanViewRequestAsync(id, cancellationToken);
        var attachments = await db.RequestAttachments
            .Include(x => x.UploadedByUser)
            .AsNoTracking()
            .Where(x => x.RequestId == id && !x.IsDeleted)
            .OrderByDescending(x => x.UploadedAt)
            .ToListAsync(cancellationToken);
        return Ok(attachments.Select(MapAttachment).ToList());
    }

    [HttpGet("{id:long}/attachments/{attachmentId:long}/download")]
    public async Task<IActionResult> DownloadAttachment(long id, long attachmentId, CancellationToken cancellationToken)
    {
        await EnsureCanViewRequestAsync(id, cancellationToken);
        var attachment = await db.RequestAttachments
            .AsNoTracking()
            .FirstOrDefaultAsync(x => x.Id == attachmentId && x.RequestId == id && !x.IsDeleted, cancellationToken)
            ?? throw new ApiException("المرفق غير موجود", StatusCodes.Status404NotFound);

        if (!System.IO.File.Exists(attachment.StoragePath))
        {
            throw new ApiException("ملف المرفق غير موجود على التخزين", StatusCodes.Status404NotFound);
        }

        await auditService.LogAsync("request_attachment_downloaded", "request", id.ToString(), metadata: new { attachmentId, attachment.FileName }, cancellationToken: cancellationToken);
        return PhysicalFile(attachment.StoragePath, attachment.ContentType, attachment.FileName);
    }

    [HttpGet("{id:long}/timeline")]
    public async Task<ActionResult<IReadOnlyCollection<RequestTimelineItemDto>>> GetTimeline(long id, CancellationToken cancellationToken)
    {
        await EnsureCanViewRequestAsync(id, cancellationToken);
        var history = await db.RequestStatusHistory.Include(x => x.ChangedByUser).AsNoTracking().Where(x => x.RequestId == id).ToListAsync(cancellationToken);
        var attachments = await db.RequestAttachments.Include(x => x.UploadedByUser).AsNoTracking().Where(x => x.RequestId == id && !x.IsDeleted).ToListAsync(cancellationToken);
        var workflow = await db.RequestWorkflowSnapshots.Include(x => x.ActionByUser).AsNoTracking().Where(x => x.RequestId == id && x.ActionAt != null).ToListAsync(cancellationToken);

        var timeline = history.Select(x => new RequestTimelineItemDto("status", x.NewStatus, x.Comment, x.ChangedAt, x.ChangedByUser?.NameAr))
            .Concat(attachments.Select(x => new RequestTimelineItemDto("attachment", x.FileName, "تم رفع مرفق", x.UploadedAt, x.UploadedByUser?.NameAr)))
            .Concat(workflow.Select(x => new RequestTimelineItemDto("workflow", x.StepNameAr, x.Comments, x.ActionAt!.Value, x.ActionByUser?.NameAr)))
            .OrderByDescending(x => x.CreatedAt)
            .ToList();
        return Ok(timeline);
    }

    [HttpGet("{id:long}/print.pdf")]
    public async Task<IActionResult> PrintRequestPdf(long id, CancellationToken cancellationToken)
    {
        await EnsureCanViewRequestAsync(id, cancellationToken);
        var request = await LoadRequestDetailsAsync(id, cancellationToken);
        var details = MapDetails(request);
        var actorId = RequireCurrentUserId();
        var printedBy = await db.Users.AsNoTracking().Where(x => x.Id == actorId).Select(x => x.NameAr).FirstOrDefaultAsync(cancellationToken) ?? "مستخدم النظام";
        var bytes = RequestPdfGenerator.Generate(details, printedBy, DateTimeOffset.UtcNow);
        await auditService.LogAsync("request_pdf_printed", "request", id.ToString(), metadata: new { request.RequestNumber }, cancellationToken: cancellationToken);
        return File(bytes, "application/pdf", $"{request.RequestNumber}.pdf");
    }

    [HttpGet("{id:long}/status-history")]
    public async Task<ActionResult<IReadOnlyCollection<RequestStatusHistoryDto>>> GetStatusHistory(long id, CancellationToken cancellationToken)
    {
        await EnsureCanViewRequestAsync(id, cancellationToken);
        var history = await db.RequestStatusHistory
            .Include(x => x.ChangedByUser)
            .AsNoTracking()
            .Where(x => x.RequestId == id)
            .OrderBy(x => x.ChangedAt)
            .ToListAsync(cancellationToken);
        return Ok(history.Select(MapStatusHistory).ToList());
    }

    [HttpGet("{id:long}/audit-logs")]
    public async Task<ActionResult<IReadOnlyCollection<AuditLogDto>>> GetAuditLogs(long id, CancellationToken cancellationToken)
    {
        await EnsureCanViewRequestAsync(id, cancellationToken);
        var actorId = RequireCurrentUserId();
        var canViewAudit = await permissionService.HasPermissionAsync(actorId, "audit.view", cancellationToken)
                           || await permissionService.HasPermissionAsync(actorId, "requests.manage", cancellationToken);
        if (!canViewAudit)
        {
            throw new ApiException("لا تملك صلاحية عرض سجل التدقيق لهذا الطلب", StatusCodes.Status403Forbidden);
        }

        var entityId = id.ToString();
        var logs = await db.AuditLogs
            .Include(x => x.User)
            .AsNoTracking()
            .Where(x => x.EntityId == entityId && (x.EntityType == "request" || x.EntityType == "request_attachment"))
            .OrderByDescending(x => x.CreatedAt)
            .Take(200)
            .ToListAsync(cancellationToken);

        return Ok(logs.Select(x => new AuditLogDto(
            x.Id,
            x.Action,
            x.EntityType,
            x.EntityId,
            x.Result,
            x.UserId,
            x.User?.Username,
            x.IpAddress,
            x.UserAgent,
            x.OldValueJson,
            x.NewValueJson,
            x.MetadataJson,
            x.CreatedAt)).ToList());
    }

    private IQueryable<RequestEntity> BaseRequestQuery()
    {
        return db.Requests
            .Include(x => x.RequestType)
            .Include(x => x.RequestTypeVersion)
            .Include(x => x.Requester)
            .Include(x => x.Department)
            .Include(x => x.SpecializedSection)
            .ThenInclude(x => x!.Department)
            .Include(x => x.AssignedTo)
            .Include(x => x.Attachments)
            .Include(x => x.WorkflowSnapshots);
    }

    private async Task<RequestEntity> LoadRequestDetailsAsync(long id, CancellationToken cancellationToken)
    {
        return await BaseRequestQuery()
            .Include(x => x.FieldSnapshots)
            .Include(x => x.WorkflowSnapshots).ThenInclude(x => x.ApproverRole)
            .Include(x => x.WorkflowSnapshots).ThenInclude(x => x.ApproverUser)
            .Include(x => x.WorkflowSnapshots).ThenInclude(x => x.TargetDepartment)
            .Include(x => x.WorkflowSnapshots).ThenInclude(x => x.ActionByUser)
            .Include(x => x.Attachments).ThenInclude(x => x.UploadedByUser)
            .Include(x => x.StatusHistory).ThenInclude(x => x.ChangedByUser)
            .Include(x => x.SlaTracking)
            .AsNoTracking()
            .FirstOrDefaultAsync(x => x.Id == id, cancellationToken)
            ?? throw new ApiException("الطلب غير موجود", StatusCodes.Status404NotFound);
    }

    private async Task EnsureCanViewRequestAsync(long requestId, CancellationToken cancellationToken)
    {
        var actor = await LoadActorAsync(cancellationToken);
        if (await permissionService.HasPermissionAsync(actor.Id, "requests.manage", cancellationToken))
        {
            return;
        }

        var allowed = await ApplyRequestScope(db.Requests.Where(x => x.Id == requestId), actor).AnyAsync(cancellationToken);
        if (!allowed)
        {
            throw new ApiException("لا تملك صلاحية عرض هذا الطلب", StatusCodes.Status403Forbidden);
        }
    }

    private async Task<User> LoadActorAsync(CancellationToken cancellationToken)
    {
        var actorId = currentUser.UserId ?? throw new ApiException("غير مصرح", StatusCodes.Status401Unauthorized);
        return await db.Users
            .Include(x => x.Role)
            .Include(x => x.Department)
            .Include(x => x.SpecializedSection)
            .AsNoTracking()
            .FirstOrDefaultAsync(x => x.Id == actorId && x.IsActive && !x.IsLocked, cancellationToken)
            ?? throw new ApiException("المستخدم غير صالح", StatusCodes.Status403Forbidden);
    }

    private static IQueryable<RequestEntity> ApplyRequestScope(IQueryable<RequestEntity> query, User actor)
    {
        return query.Where(x =>
            x.RequesterId == actor.Id ||
            x.AssignedToId == actor.Id ||
            x.WorkflowSnapshots.Any(s => s.ApproverUserId == actor.Id || s.ApproverRoleId == actor.RoleId || s.ActionByUserId == actor.Id) ||
            x.WorkflowSnapshots.Any(s => s.TargetDepartment != null && s.TargetDepartment.ManagerUserId == actor.Id) ||
            x.Requester!.DirectManagerId == actor.Id ||
            x.Department!.ManagerUserId == actor.Id ||
            x.SpecializedSection!.ManagerUserId == actor.Id ||
            x.SpecializedSection!.Department!.ManagerUserId == actor.Id ||
            x.SpecializedSection!.DefaultAssigneeUserId == actor.Id ||
            (actor.SpecializedSectionId.HasValue && x.SpecializedSectionId == actor.SpecializedSectionId));
    }

    private async Task ChangeRequestStatusAsync(RequestEntity entity, string newStatus, long actorId, string? comment, CancellationToken cancellationToken, bool saveNow = true)
    {
        var oldStatus = entity.Status;
        entity.Status = newStatus;
        if (newStatus is "closed" or "completed" or "cancelled" or "rejected")
        {
            entity.ClosedAt = DateTimeOffset.UtcNow;
        }

        db.RequestStatusHistory.Add(new RequestStatusHistory
        {
            RequestId = entity.Id,
            OldStatus = oldStatus,
            NewStatus = newStatus,
            ChangedByUserId = actorId,
            ChangedAt = DateTimeOffset.UtcNow,
            Comment = comment
        });

        if (saveNow)
        {
            await db.SaveChangesAsync(cancellationToken);
        }
    }

    private long RequireCurrentUserId()
    {
        return currentUser.UserId ?? throw new ApiException("غير مصرح", StatusCodes.Status401Unauthorized);
    }

    private static CreateRequestRequest ParseCreateRequest(JsonElement request)
    {
        var requestTypeId = LongProp(request, "request_type_id", "requestTypeId")
                            ?? throw new ApiException("نوع الطلب مطلوب");
        return new CreateRequestRequest(
            requestTypeId,
            RequiredString(request, "title"),
            StringProp(request, "priority"),
            ObjectProp(request, "form_data", "formData"),
            BoolProp(request, "send_notification", "sendNotification"));
    }

    private static UpdateRequestRequest ParseUpdateRequest(JsonElement request)
    {
        return new UpdateRequestRequest(
            RequiredString(request, "title"),
            StringProp(request, "priority"),
            ObjectProp(request, "form_data", "formData"));
    }

    private static string RequiredString(JsonElement source, params string[] names)
    {
        var value = StringProp(source, names);
        if (string.IsNullOrWhiteSpace(value))
        {
            throw new ApiException("عنوان الطلب مطلوب");
        }

        return value;
    }

    private static string? StringProp(JsonElement source, params string[] names)
    {
        if (source.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        foreach (var name in names)
        {
            if (source.TryGetProperty(name, out var value))
            {
                return value.ValueKind == JsonValueKind.String ? value.GetString() : value.ToString();
            }
        }

        return null;
    }

    private static long? LongProp(JsonElement source, params string[] names)
    {
        if (source.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        foreach (var name in names)
        {
            if (!source.TryGetProperty(name, out var value))
            {
                continue;
            }

            if (value.ValueKind == JsonValueKind.Number && value.TryGetInt64(out var number))
            {
                return number;
            }

            if (value.ValueKind == JsonValueKind.String && long.TryParse(value.GetString(), out number))
            {
                return number;
            }
        }

        return null;
    }

    private static bool? BoolProp(JsonElement source, params string[] names)
    {
        if (source.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        foreach (var name in names)
        {
            if (!source.TryGetProperty(name, out var value))
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

        return null;
    }

    private static Dictionary<string, JsonElement> ObjectProp(JsonElement source, params string[] names)
    {
        if (source.ValueKind != JsonValueKind.Object)
        {
            return [];
        }

        foreach (var name in names)
        {
            if (source.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.Object)
            {
                return value.EnumerateObject().ToDictionary(x => x.Name, x => x.Value.Clone());
            }
        }

        return [];
    }

    private static string NormalizePriorityCode(string? value)
    {
        return (value ?? "normal").Trim().ToLowerInvariant() switch
        {
            "medium" => "normal",
            "" => "normal",
            var code => code
        };
    }

    private async Task<string> GenerateRequestNumberAsync(CancellationToken cancellationToken)
    {
        var year = DateTimeOffset.UtcNow.Year;
        var prefix = $"QIB-{year}-";
        var count = await db.Requests.CountAsync(x => x.RequestNumber.StartsWith(prefix), cancellationToken) + 1;
        return $"{prefix}{count:000000}";
    }

    private async Task<bool> ShouldSendRequestCreatedNotificationAsync(bool? requestedValue, CancellationToken cancellationToken)
    {
        var showCheckbox = await settingsStore.GetValueAsync("messaging.request.show_request_notification_checkbox", true, cancellationToken);
        var defaultChecked = await settingsStore.GetValueAsync("messaging.request.default_send_request_notification", true, cancellationToken);
        var allowToggle = await settingsStore.GetValueAsync("messaging.request.allow_requester_toggle_notification", true, cancellationToken);

        if (!showCheckbox || !allowToggle)
        {
            return defaultChecked;
        }

        return requestedValue ?? defaultChecked;
    }

    private async Task CreateRequestCreatedLinkedMessageAsync(
        RequestEntity request,
        User requester,
        RequestType requestType,
        IReadOnlyCollection<RequestWorkflowSnapshot> workflowSnapshots,
        DateTimeOffset now,
        CancellationToken cancellationToken)
    {
        var messagingEnabled = await settingsStore.GetValueAsync("messaging.general.enable_messaging", true, cancellationToken);
        var requestLinkingEnabled = await settingsStore.GetValueAsync("messaging.request.allow_link_to_request", true, cancellationToken);
        if (!messagingEnabled || !requestLinkingEnabled)
        {
            return;
        }

        var recipients = await ResolveRequestNotificationRecipientsAsync(request, requester, requestType, workflowSnapshots, cancellationToken);
        if (recipients.Count == 0)
        {
            return;
        }

        var messageType = await db.MessageTypes
            .AsNoTracking()
            .FirstOrDefaultAsync(x => x.Code == "notification" && x.IsActive, cancellationToken)
            ?? await db.MessageTypes.AsNoTracking().FirstOrDefaultAsync(x => x.Code == "internal_message" && x.IsActive, cancellationToken)
            ?? await db.MessageTypes.AsNoTracking().OrderBy(x => x.SortOrder).FirstOrDefaultAsync(x => x.IsActive, cancellationToken);
        if (messageType is null)
        {
            return;
        }

        var subject = $"إشعار بطلب جديد: {request.RequestNumber}";
        if (await db.Messages.AnyAsync(x => x.RelatedRequestId == request.Id && x.Subject == subject, cancellationToken))
        {
            return;
        }

        var priorityLabel = request.Priority switch
        {
            "low" => "منخفضة",
            "high" => "مرتفعة",
            "urgent" => "عاجلة",
            "critical" => "حرجة",
            _ => "متوسطة"
        };
        var body = string.Join("\n", new[]
        {
            "تم إنشاء طلب جديد ويحتاج إلى المتابعة.",
            "",
            $"رقم الطلب: {request.RequestNumber}",
            $"عنوان الطلب: {request.Title}",
            $"نوع الطلب: {requestType.NameAr}",
            $"الأولوية: {priorityLabel}",
            $"القسم المختص: {requestType.SpecializedSection?.NameAr ?? "-"}",
            $"مقدم الطلب: {requester.NameAr}",
            "",
            "يمكن متابعة الطلب من شاشة الطلبات أو الموافقات حسب صلاحيتك."
        });

        var message = new Message
        {
            SenderId = requester.Id,
            MessageTypeId = messageType.Id,
            RelatedRequestId = request.Id,
            Subject = subject,
            Body = body,
            Priority = "normal",
            IsOfficial = false,
            IncludeInRequestPdf = false,
            SentAt = now,
            Recipients = recipients.Select(id => new MessageRecipient
            {
                RecipientId = id,
                IsRead = false
            }).ToList()
        };
        db.Messages.Add(message);

        var notifications = new List<Notification>();
        if (await ShouldPushRequestMessageNotificationAsync(cancellationToken))
        {
            notifications = recipients.Select(id => new Notification
            {
                UserId = id,
                Title = "طلب جديد بانتظار المتابعة",
                Body = $"{requester.NameAr}: {request.Title}",
                Channel = "requests",
                RelatedRoute = $"/requests/{request.Id}",
                IsRead = false
            }).ToList();
        }

        if (notifications.Count > 0)
        {
            db.Notifications.AddRange(notifications);
        }

        await db.SaveChangesAsync(cancellationToken);
        foreach (var notification in notifications)
        {
            await realtimeNotifications.SendToUserAsync(notification.UserId, new
            {
                type = "request_created",
                id = notification.Id,
                title = notification.Title,
                body = notification.Body,
                channel = notification.Channel,
                related_route = notification.RelatedRoute,
                request_id = request.Id,
                message_id = message.Id,
                created_at = notification.CreatedAt
            }, cancellationToken);
        }
    }

    private async Task<IReadOnlyCollection<long>> ResolveRequestNotificationRecipientsAsync(
        RequestEntity request,
        User requester,
        RequestType requestType,
        IReadOnlyCollection<RequestWorkflowSnapshot> workflowSnapshots,
        CancellationToken cancellationToken)
    {
        var step = workflowSnapshots.OrderBy(x => x.SortOrder).FirstOrDefault(x => x.Status == "pending");
        var recipientIds = new HashSet<long>();

        if (step?.ApproverUserId is long approverUserId)
        {
            recipientIds.Add(approverUserId);
        }

        if (step?.ApproverRoleId is long approverRoleId)
        {
            var roleUsers = await db.Users
                .AsNoTracking()
                .Where(x => x.RoleId == approverRoleId && x.IsActive && !x.IsLocked)
                .Select(x => x.Id)
                .ToListAsync(cancellationToken);
            recipientIds.UnionWith(roleUsers);
        }

        switch (step?.StepType)
        {
            case "direct_manager":
                AddIfPresent(recipientIds, requester.DirectManagerId);
                break;
            case "department_manager":
                AddIfPresent(recipientIds, requestType.SpecializedSection?.Department?.ManagerUserId);
                AddIfPresent(recipientIds, requestType.SpecializedSection?.ManagerUserId);
                break;
            case "specific_department_manager":
                if (step.TargetDepartmentId.HasValue)
                {
                    var managerId = await db.Departments
                        .AsNoTracking()
                        .Where(x => x.Id == step.TargetDepartmentId.Value)
                        .Select(x => x.ManagerUserId)
                        .FirstOrDefaultAsync(cancellationToken);
                    AddIfPresent(recipientIds, managerId);
                }
                break;
            case "specialized_section":
                AddIfPresent(recipientIds, requestType.SpecializedSection?.ManagerUserId);
                AddIfPresent(recipientIds, requestType.SpecializedSection?.DefaultAssigneeUserId);
                AddIfPresent(recipientIds, request.AssignedToId);
                break;
            case "department_specialist":
            case "implementation_engineer":
            case "execution":
            case "execute_request":
                AddIfPresent(recipientIds, requestType.SpecializedSection?.DefaultAssigneeUserId);
                AddIfPresent(recipientIds, request.AssignedToId);
                break;
            case "information_security":
            case "it_manager":
            case "executive_management":
                var roleUsers = await db.Users
                    .AsNoTracking()
                    .Where(x => x.Role != null && x.Role.Code == step.StepType && x.Role.IsActive && x.IsActive && !x.IsLocked)
                    .Select(x => x.Id)
                    .ToListAsync(cancellationToken);
                recipientIds.UnionWith(roleUsers);
                break;
        }

        if (recipientIds.Count == 0)
        {
            AddIfPresent(recipientIds, requester.DirectManagerId);
        }

        recipientIds.Remove(requester.Id);
        if (recipientIds.Count == 0)
        {
            return Array.Empty<long>();
        }

        var activeRecipients = await db.Users
            .AsNoTracking()
            .Where(x => recipientIds.Contains(x.Id) && x.IsActive && !x.IsLocked)
            .Select(x => x.Id)
            .ToListAsync(cancellationToken);
        var allowed = new List<long>();
        foreach (var recipientId in activeRecipients)
        {
            if (await permissionService.HasPermissionAsync(recipientId, "messages.view", cancellationToken))
            {
                allowed.Add(recipientId);
            }
        }

        return allowed;
    }

    private async Task<bool> ShouldPushRequestMessageNotificationAsync(CancellationToken cancellationToken)
    {
        var enabled = await settingsStore.GetValueAsync("messaging.notifications.enable_message_notifications", true, cancellationToken);
        var notifyNew = await settingsStore.GetValueAsync("messaging.notifications.notify_on_new_message", true, cancellationToken);
        return enabled && notifyNew;
    }

    private static void AddIfPresent(HashSet<long> ids, long? id)
    {
        if (id.HasValue)
        {
            ids.Add(id.Value);
        }
    }

    private static void ValidateFormData(IReadOnlyCollection<RequestTypeField> fields, Dictionary<string, JsonElement> formData)
    {
        var knownFields = fields.Select(x => x.FieldName).ToHashSet(StringComparer.OrdinalIgnoreCase);
        var extras = formData.Keys.Where(x => !knownFields.Contains(x) && !SystemFormMetadataFields.Contains(x)).ToList();
        if (extras.Count > 0)
        {
            throw new ApiException($"توجد حقول غير معرفة في النموذج: {string.Join(", ", extras)}");
        }

        foreach (var field in fields.Where(x => x.IsRequired))
        {
            if (!formData.TryGetValue(field.FieldName, out var value) || IsEmpty(value))
            {
                throw new ApiException($"الحقل {field.LabelAr} مطلوب");
            }
        }

        foreach (var field in fields)
        {
            if (!formData.TryGetValue(field.FieldName, out var value) || IsEmpty(value))
            {
                continue;
            }

            if (field.FieldType == "number" && value.ValueKind != JsonValueKind.Number)
            {
                throw new ApiException($"الحقل {field.LabelAr} يجب أن يكون رقماً");
            }

            if (field.FieldType is "date" or "datetime" && !DateTimeOffset.TryParse(value.ToString(), out _))
            {
                throw new ApiException($"الحقل {field.LabelAr} يجب أن يكون تاريخاً صحيحاً");
            }

            if (field.FieldType == "email" && !value.ToString().Contains('@'))
            {
                throw new ApiException($"الحقل {field.LabelAr} يجب أن يكون بريداً إلكترونياً صحيحاً");
            }
        }
    }

    private static bool IsEmpty(JsonElement value)
    {
        return value.ValueKind is JsonValueKind.Null or JsonValueKind.Undefined ||
               (value.ValueKind == JsonValueKind.String && string.IsNullOrWhiteSpace(value.GetString())) ||
               (value.ValueKind == JsonValueKind.Array && value.GetArrayLength() == 0);
    }

    private static string SerializeSchemaFormData(IReadOnlyCollection<RequestTypeField> fields, Dictionary<string, JsonElement> formData)
    {
        var normalized = fields
            .Where(x => formData.ContainsKey(x.FieldName))
            .ToDictionary(x => x.FieldName, x => formData[x.FieldName]);
        foreach (var key in SystemFormMetadataFields)
        {
            if (formData.TryGetValue(key, out var value))
            {
                normalized[key] = value;
            }
        }

        return JsonSerializer.Serialize(normalized, JsonOptions);
    }

    private static IEnumerable<RequestFieldSnapshot> CreateFieldSnapshots(long requestId, IReadOnlyCollection<RequestTypeField> fields, Dictionary<string, JsonElement> formData)
    {
        foreach (var field in fields)
        {
            formData.TryGetValue(field.FieldName, out var value);
            var snapshot = new RequestFieldSnapshot
            {
                RequestId = requestId,
                FieldName = field.FieldName,
                LabelAr = field.LabelAr,
                LabelEn = field.LabelEn,
                FieldType = field.FieldType,
                SortOrder = field.SortOrder,
                SectionName = field.SectionName
            };

            if (!IsEmpty(value))
            {
                if (field.FieldType == "number" && value.TryGetDecimal(out var number))
                {
                    snapshot.ValueNumber = number;
                }
                else if (field.FieldType is "date" or "datetime" && DateTimeOffset.TryParse(value.ToString(), out var date))
                {
                    snapshot.ValueDate = date;
                    snapshot.ValueText = value.ToString();
                }
                else if (value.ValueKind is JsonValueKind.Object or JsonValueKind.Array)
                {
                    snapshot.ValueJson = value.GetRawText();
                }
                else
                {
                    snapshot.ValueText = value.ToString();
                }
            }

            yield return snapshot;
        }
    }

    private static IEnumerable<RequestWorkflowSnapshot> CreateWorkflowSnapshots(long requestId, IReadOnlyCollection<WorkflowTemplateStep> steps, DateTimeOffset now)
    {
        var ordered = steps.OrderBy(x => x.SortOrder).ToList();
        for (var i = 0; i < ordered.Count; i++)
        {
            var step = ordered[i];
            yield return new RequestWorkflowSnapshot
            {
                RequestId = requestId,
                StepNameAr = step.StepNameAr,
                StepNameEn = step.StepNameEn,
                StepType = step.StepType,
                ApproverRoleId = step.ApproverRoleId,
                ApproverUserId = step.ApproverUserId,
                TargetDepartmentId = step.TargetDepartmentId,
                Status = i == 0 ? "pending" : "waiting",
                PendingAt = i == 0 ? now : null,
                SlaDueAt = step.SlaHours.HasValue ? now.AddHours(step.SlaHours.Value) : null,
                SortOrder = step.SortOrder,
                IsMandatory = step.IsMandatory,
                CanApprove = step.CanApprove,
                CanReject = step.CanReject,
                CanReturnForEdit = step.CanReturnForEdit,
                CanDelegate = step.CanDelegate
            };
        }
    }

    private static void ValidateUpload(IFormFile file, RequestTypeSettings settings)
    {
        if (file.Length <= 0)
        {
            throw new ApiException("الملف فارغ");
        }

        var maxBytes = settings.MaxFileSizeMb * 1024L * 1024L;
        if (file.Length > maxBytes)
        {
            throw new ApiException($"حجم الملف يتجاوز الحد المسموح وهو {settings.MaxFileSizeMb} MB");
        }

        var extension = Path.GetExtension(file.FileName).TrimStart('.').ToLowerInvariant();
        if (string.IsNullOrWhiteSpace(extension) || BlockedExtensions.Contains(extension))
        {
            throw new ApiException("نوع الملف غير مسموح");
        }

        var allowed = NormalizeAllowedExtensions(settings.AllowedExtensionsJson);
        if (allowed.Length > 0 && !allowed.Any(x => x.Equals(extension, StringComparison.OrdinalIgnoreCase)))
        {
            throw new ApiException($"امتداد الملف غير مسموح لهذا النوع من الطلبات. الامتدادات المسموحة: {string.Join(", ", allowed)}");
        }
    }

    private static string[] NormalizeAllowedExtensions(string? allowedExtensionsJson)
    {
        var values = Array.Empty<string>();
        if (!string.IsNullOrWhiteSpace(allowedExtensionsJson))
        {
            try
            {
                values = JsonSerializer.Deserialize<string[]>(allowedExtensionsJson) ?? [];
            }
            catch
            {
                values = allowedExtensionsJson.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
            }
        }

        return values
            .SelectMany(value =>
            {
                var extension = value.Trim().TrimStart('.').ToLowerInvariant();
                if (string.IsNullOrWhiteSpace(extension))
                {
                    return [];
                }

                return ImageExtensionAliases.Contains(extension) || ImageExtensions.Contains(extension) ? ImageExtensions : [extension];
            })
            .Where(extension => !BlockedExtensions.Contains(extension))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .OrderBy(extension => extension)
            .ToArray();
    }

    private async Task ValidateGlobalUploadSettingsAsync(IFormFile file, RequestTypeSettings requestTypeSettings, CancellationToken cancellationToken)
    {
        var uploadsEnabled = await settingsStore.GetValueAsync("attachments.allow_uploads", true, cancellationToken);
        if (!uploadsEnabled)
        {
            throw new ApiException("رفع الملفات معطل من الإعدادات العامة للمرفقات");
        }

        var globalMaxFileSizeMb = await settingsStore.GetValueAsync("attachments.max_file_size_mb", 10, cancellationToken);
        var globalHardLimit = await settingsStore.GetValueAsync("attachments.is_hard_limit", true, cancellationToken);
        if (globalHardLimit && requestTypeSettings.MaxFileSizeMb > globalMaxFileSizeMb)
        {
            throw new ApiException($"إعداد نوع الطلب يتجاوز الحد الأقصى العام للمرفقات وهو {globalMaxFileSizeMb} MB. يرجى تعديل قواعد المرفقات لنوع الطلب.");
        }

        if (globalHardLimit && file.Length > globalMaxFileSizeMb * 1024L * 1024L)
        {
            throw new ApiException($"حجم الملف يتجاوز الحد الأقصى العام للمرفقات وهو {globalMaxFileSizeMb} MB");
        }
    }

    private static async Task<string> ComputeChecksumAsync(string path, CancellationToken cancellationToken)
    {
        await using var stream = System.IO.File.OpenRead(path);
        var hash = await SHA256.HashDataAsync(stream, cancellationToken);
        return Convert.ToHexString(hash).ToLowerInvariant();
    }

    private static RequestDetailsDto MapDetails(RequestEntity entity)
    {
        return new RequestDetailsDto(
            MapRequest(entity),
            entity.FieldSnapshots.OrderBy(x => x.SortOrder).Select(MapFieldSnapshot).ToList(),
            entity.WorkflowSnapshots.OrderBy(x => x.SortOrder).Select(MapWorkflowSnapshot).ToList(),
            entity.Attachments.Where(x => !x.IsDeleted).OrderByDescending(x => x.UploadedAt).Select(MapAttachment).ToList(),
            entity.StatusHistory.OrderBy(x => x.ChangedAt).Select(MapStatusHistory).ToList(),
            entity.SlaTracking is null ? null : new RequestSlaTrackingDto(entity.SlaTracking.ResponseDueAt, entity.SlaTracking.ResolutionDueAt, entity.SlaTracking.FirstResponseAt, entity.SlaTracking.ResolvedAt, entity.SlaTracking.IsBreached, entity.SlaTracking.BreachReason));
    }

    private static RequestDto MapRequest(RequestEntity entity)
    {
        var totalSteps = entity.WorkflowSnapshots.Count;
        var doneSteps = entity.WorkflowSnapshots.Count(x => x.Status is "approved" or "executed" or "closed");
        var progress = totalSteps == 0 ? 0 : (int)Math.Round(doneSteps * 100m / totalSteps);
        return new RequestDto(
            entity.Id,
            entity.RequestNumber,
            entity.Title,
            entity.RequestTypeId,
            entity.RequestType?.NameAr,
            entity.RequestTypeVersionId,
            entity.RequestTypeVersion?.VersionNumber,
            entity.RequesterId,
            entity.Requester?.NameAr,
            entity.DepartmentId,
            entity.Department?.NameAr,
            entity.SpecializedSectionId,
            entity.SpecializedSection?.NameAr,
            entity.SpecializedSection?.Department?.NameAr,
            entity.AssignedToId,
            entity.AssignedTo?.NameAr,
            entity.Status,
            entity.Priority,
            entity.SlaResponseDueAt,
            entity.SlaResolutionDueAt,
            entity.SubmittedAt,
            entity.ClosedAt,
            entity.CreatedAt,
            entity.UpdatedAt,
            entity.Attachments.Count(x => !x.IsDeleted),
            progress);
    }

    private static RequestFieldSnapshotDto MapFieldSnapshot(RequestFieldSnapshot item)
    {
        return new RequestFieldSnapshotDto(item.Id, item.FieldName, item.LabelAr, item.LabelEn, item.FieldType, item.ValueText, item.ValueNumber, item.ValueDate, item.ValueJson, item.SortOrder, item.SectionName);
    }

    private static RequestWorkflowSnapshotDto MapWorkflowSnapshot(RequestWorkflowSnapshot item)
    {
        return new RequestWorkflowSnapshotDto(item.Id, item.StepNameAr, item.StepNameEn, item.StepType, item.ApproverRoleId, item.ApproverRole?.NameAr, item.ApproverUserId, item.ApproverUser?.NameAr, item.TargetDepartmentId, item.TargetDepartment?.NameAr, item.Status, item.ActionByUserId, item.ActionByUser?.NameAr, item.ActionAt, item.PendingAt, item.Comments, item.SlaDueAt, item.SortOrder, item.CanApprove, item.CanReject, item.CanReturnForEdit, item.CanDelegate);
    }

    private static RequestAttachmentDto MapAttachment(RequestAttachment item)
    {
        return new RequestAttachmentDto(item.Id, item.FileName, item.ContentType, item.FileSize, item.Checksum, item.UploadedByUserId, item.UploadedByUser?.NameAr, item.UploadedAt);
    }

    private static RequestStatusHistoryDto MapStatusHistory(RequestStatusHistory item)
    {
        return new RequestStatusHistoryDto(item.Id, item.OldStatus, item.NewStatus, item.ChangedByUserId, item.ChangedByUser?.NameAr, item.ChangedAt, item.Comment);
    }
}
