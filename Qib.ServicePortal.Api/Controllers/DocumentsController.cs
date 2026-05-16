using System.Security.Cryptography;
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
[Authorize(Policy = "Permission:documents.view")]
public class DocumentsController(
    ServicePortalDbContext db,
    ICurrentUserService currentUser,
    IPermissionService permissionService,
    IAuditService auditService,
    ISettingsStore settingsStore,
    IConfiguration configuration) : ControllerBase
{
    private sealed record AcknowledgementReportPayload(
        object document,
        object? version,
        int total,
        int acknowledged_count,
        int pending_count,
        IReadOnlyCollection<object> acknowledged,
        IReadOnlyCollection<object> pending);

    private static readonly HashSet<string> AllowedClassifications = ["public", "internal", "confidential", "top_secret"];
    private static readonly HashSet<string> AllowedStatuses = ["draft", "active", "archived", "expired"];

    [HttpGet("documents/categories")]
    public async Task<ActionResult<IReadOnlyCollection<DocumentCategoryDto>>> GetCategories(CancellationToken cancellationToken)
    {
        var categories = await db.DocumentCategories
            .AsNoTracking()
            .Include(x => x.Documents)
            .OrderBy(x => x.SortOrder)
            .ThenBy(x => x.NameAr)
            .ToListAsync(cancellationToken);

        return Ok(categories.Select(MapCategory).ToList());
    }

    [HttpGet("documents/settings/bootstrap")]
    [Authorize(Policy = "Permission:documents.manage")]
    public async Task<ActionResult<object>> GetSettingsBootstrap(CancellationToken cancellationToken)
    {
        var actorId = RequireCurrentUserId();
        var categories = await db.DocumentCategories
            .AsNoTracking()
            .Include(x => x.Documents)
            .OrderBy(x => x.SortOrder)
            .ThenBy(x => x.NameAr)
            .ToListAsync(cancellationToken);
        var documents = await LoadDocumentQuery()
            .AsNoTracking()
            .OrderByDescending(x => x.UpdatedAt)
            .Take(500)
            .ToListAsync(cancellationToken);
        var departments = await db.Departments
            .AsNoTracking()
            .Where(x => x.IsActive)
            .OrderBy(x => x.NameAr)
            .ToListAsync(cancellationToken);
        var roles = await db.Roles
            .AsNoTracking()
            .Where(x => x.IsActive)
            .OrderBy(x => x.NameAr)
            .ToListAsync(cancellationToken);
        var permissions = await db.DocumentPermissions
            .AsNoTracking()
            .Include(x => x.Category)
            .Include(x => x.Document)
            .Include(x => x.Role)
            .Include(x => x.Department)
            .OrderByDescending(x => x.UpdatedAt)
            .ToListAsync(cancellationToken);

        var documentRows = new List<object>();
        foreach (var document in documents)
        {
            documentRows.Add(await MapDocumentLegacyAsync(document, actorId, cancellationToken));
        }

        return Ok(new
        {
            categories = categories.Select(MapCategoryLegacy).ToList(),
            documents = documentRows,
            departments = departments.Select(x => new { id = x.Id, name_ar = x.NameAr, name_en = x.NameEn, code = x.Code }).ToList(),
            roles = roles.Select(x => new { id = x.Id, name_ar = x.NameAr, name_en = x.NameEn, code = x.Code, name = x.Code, label_ar = x.NameAr }).ToList(),
            permissions = permissions.Select(MapPermissionLegacy).ToList()
        });
    }

    [HttpPost("documents/categories")]
    [Authorize(Policy = "Permission:documents.manage")]
    public async Task<ActionResult<DocumentCategoryDto>> CreateCategory(UpsertDocumentCategoryRequest request, CancellationToken cancellationToken)
    {
        if (await db.DocumentCategories.AnyAsync(x => x.Code == request.Code, cancellationToken))
        {
            throw new ApiException("رمز التصنيف مستخدم مسبقاً");
        }

        var category = new DocumentCategory();
        ApplyCategory(category, request);
        db.DocumentCategories.Add(category);
        await db.SaveChangesAsync(cancellationToken);
        await auditService.LogAsync("document_category_created", "document_category", category.Id.ToString(), newValue: request, cancellationToken: cancellationToken);
        return CreatedAtAction(nameof(GetCategories), MapCategory(category));
    }

    [HttpPut("documents/categories/{id:long}")]
    [Authorize(Policy = "Permission:documents.manage")]
    public async Task<ActionResult<DocumentCategoryDto>> UpdateCategory(long id, UpsertDocumentCategoryRequest request, CancellationToken cancellationToken)
    {
        var category = await db.DocumentCategories.FirstOrDefaultAsync(x => x.Id == id, cancellationToken)
            ?? throw new ApiException("تصنيف الوثائق غير موجود", StatusCodes.Status404NotFound);
        if (await db.DocumentCategories.AnyAsync(x => x.Id != id && x.Code == request.Code, cancellationToken))
        {
            throw new ApiException("رمز التصنيف مستخدم مسبقاً");
        }

        var oldValue = MapCategory(category);
        ApplyCategory(category, request);
        await db.SaveChangesAsync(cancellationToken);
        await auditService.LogAsync("document_category_updated", "document_category", category.Id.ToString(), oldValue: oldValue, newValue: request, cancellationToken: cancellationToken);
        return Ok(MapCategory(category));
    }

    [HttpPatch("documents/categories/{id:long}/status")]
    [Authorize(Policy = "Permission:documents.manage")]
    public async Task<ActionResult<object>> SetCategoryStatus(long id, [FromBody] DocumentCategoryStatusRequest? request, [FromQuery] bool? isActive, CancellationToken cancellationToken)
    {
        var nextIsActive = request?.IsActive ?? isActive ?? throw new ApiException("حالة التصنيف مطلوبة");
        var category = await db.DocumentCategories.FirstOrDefaultAsync(x => x.Id == id, cancellationToken)
            ?? throw new ApiException("تصنيف الوثائق غير موجود", StatusCodes.Status404NotFound);
        category.IsActive = nextIsActive;
        await db.SaveChangesAsync(cancellationToken);
        await auditService.LogAsync(nextIsActive ? "document_category_enabled" : "document_category_disabled", "document_category", category.Id.ToString(), cancellationToken: cancellationToken);
        return Ok(MapCategoryLegacy(category));
    }

    [HttpGet("documents")]
    public async Task<ActionResult<IReadOnlyCollection<DocumentListItemDto>>> GetDocuments(
        [FromQuery] string? search,
        [FromQuery(Name = "category")] string? categoryCode,
        [FromQuery(Name = "category_id")] long? categoryId,
        [FromQuery] string? classification,
        [FromQuery] string? status,
        [FromQuery(Name = "owner_department_id")] long? ownerDepartmentId,
        CancellationToken cancellationToken)
    {
        var actorId = RequireCurrentUserId();
        var documents = await FilterDocuments(search, categoryCode, categoryId, classification, status, ownerDepartmentId)
            .OrderByDescending(x => x.UpdatedAt)
            .Take(500)
            .ToListAsync(cancellationToken);

        var visible = new List<DocumentListItemDto>();
        foreach (var document in documents)
        {
            if (await CanAccessDocumentAsync(document, actorId, "view", cancellationToken))
            {
                visible.Add(await MapListItemAsync(document, actorId, cancellationToken));
            }
        }

        return Ok(visible);
    }

    [HttpGet("documents/search")]
    public Task<ActionResult<IReadOnlyCollection<DocumentListItemDto>>> SearchDocuments(
        [FromQuery(Name = "q")] string? search,
        CancellationToken cancellationToken) =>
        GetDocuments(search, null, null, null, null, null, cancellationToken);

    [HttpGet("documents/categories/{categoryCode}/documents")]
    public Task<ActionResult<IReadOnlyCollection<DocumentListItemDto>>> GetCategoryDocuments(string categoryCode, CancellationToken cancellationToken) =>
        GetDocuments(null, categoryCode, null, null, null, null, cancellationToken);

    [HttpGet("documents/{id:long}")]
    public async Task<ActionResult<DocumentDetailsDto>> GetDocument(long id, CancellationToken cancellationToken)
    {
        var actorId = RequireCurrentUserId();
        var document = await LoadDocumentQuery()
            .AsNoTracking()
            .FirstOrDefaultAsync(x => x.Id == id, cancellationToken)
            ?? throw new ApiException("الوثيقة غير موجودة", StatusCodes.Status404NotFound);
        await EnsureDocumentAccessAsync(document, actorId, "view", cancellationToken);
        await LogDocumentAccessAsync(document, document.CurrentVersionId, actorId, "view", cancellationToken);
        await auditService.LogAsync("document_viewed", "document", id.ToString(), cancellationToken: cancellationToken);
        return Ok(await MapDetailsAsync(document, actorId, cancellationToken));
    }

    [HttpPost("documents")]
    [Authorize(Policy = "Permission:documents.manage")]
    [RequestSizeLimit(104_857_600)]
    public async Task<ActionResult<DocumentDetailsDto>> UploadDocument([FromForm] UploadDocumentMetadataRequest request, IFormFile file, CancellationToken cancellationToken)
    {
        var actorId = RequireCurrentUserId();
        ValidateClassification(request.Classification);
        await EnsureCategoryExistsAsync(request.CategoryId, cancellationToken);
        await EnsureDepartmentExistsAsync(request.OwnerDepartmentId, cancellationToken);
        await ValidatePdfFileAsync(file, cancellationToken);

        var document = new Document
        {
            TitleAr = request.TitleAr.Trim(),
            TitleEn = string.IsNullOrWhiteSpace(request.TitleEn) ? null : request.TitleEn.Trim(),
            CategoryId = request.CategoryId,
            DocumentNumber = string.IsNullOrWhiteSpace(request.DocumentNumber) ? null : request.DocumentNumber.Trim(),
            Description = request.Description,
            OwnerDepartmentId = request.OwnerDepartmentId,
            Classification = request.Classification,
            Status = "active",
            RequiresAcknowledgement = request.RequiresAcknowledgement,
            Keywords = request.Keywords,
            IsActive = true,
            CreatedByUserId = actorId
        };

        db.Documents.Add(document);
        await db.SaveChangesAsync(cancellationToken);

        var version = await SaveDocumentVersionAsync(document.Id, actorId, file, request.VersionNumber ?? "v1", request.IssueDate, request.EffectiveDate, request.ReviewDate, request.ChangeSummary, true, cancellationToken);
        document.CurrentVersionId = version.Id;
        await db.SaveChangesAsync(cancellationToken);

        await auditService.LogAsync("document_uploaded", "document", document.Id.ToString(), newValue: new { document.TitleAr, document.Classification, version.Id }, cancellationToken: cancellationToken);
        var created = await LoadDocumentQuery().AsNoTracking().FirstAsync(x => x.Id == document.Id, cancellationToken);
        return CreatedAtAction(nameof(GetDocument), new { id = document.Id }, await MapDetailsAsync(created, actorId, cancellationToken));
    }

    [HttpPut("documents/{id:long}")]
    [Authorize(Policy = "Permission:documents.manage")]
    public async Task<ActionResult<DocumentDetailsDto>> UpdateDocument(long id, UpdateDocumentRequest request, CancellationToken cancellationToken)
    {
        var actorId = RequireCurrentUserId();
        ValidateClassification(request.Classification);
        ValidateStatus(request.Status);
        await EnsureCategoryExistsAsync(request.CategoryId, cancellationToken);
        await EnsureDepartmentExistsAsync(request.OwnerDepartmentId, cancellationToken);

        var document = await LoadDocumentQuery().FirstOrDefaultAsync(x => x.Id == id, cancellationToken)
            ?? throw new ApiException("الوثيقة غير موجودة", StatusCodes.Status404NotFound);
        await EnsureDocumentAccessAsync(document, actorId, "manage", cancellationToken);
        var oldValue = await MapDetailsAsync(document, actorId, cancellationToken);

        document.TitleAr = request.TitleAr.Trim();
        document.TitleEn = string.IsNullOrWhiteSpace(request.TitleEn) ? null : request.TitleEn.Trim();
        document.DocumentNumber = string.IsNullOrWhiteSpace(request.DocumentNumber) ? null : request.DocumentNumber.Trim();
        document.Description = request.Description;
        document.CategoryId = request.CategoryId;
        document.OwnerDepartmentId = request.OwnerDepartmentId;
        document.Classification = request.Classification;
        document.Status = request.Status;
        document.RequiresAcknowledgement = request.RequiresAcknowledgement;
        document.Keywords = request.Keywords;
        document.IsActive = request.IsActive;

        await db.SaveChangesAsync(cancellationToken);
        await auditService.LogAsync("document_updated", "document", document.Id.ToString(), oldValue: oldValue, newValue: request, cancellationToken: cancellationToken);
        var updated = await LoadDocumentQuery().AsNoTracking().FirstAsync(x => x.Id == id, cancellationToken);
        return Ok(await MapDetailsAsync(updated, actorId, cancellationToken));
    }

    [HttpPatch("documents/{id:long}/status")]
    [Authorize(Policy = "Permission:documents.manage")]
    public async Task<ActionResult<object>> SetDocumentStatus(long id, [FromBody] DocumentStatusRequest? request, [FromQuery] string? status, [FromQuery] bool? isActive, CancellationToken cancellationToken)
    {
        var actorId = RequireCurrentUserId();
        var nextStatus = request?.Status ?? status ?? "active";
        ValidateStatus(nextStatus);
        var document = await LoadDocumentQuery().FirstOrDefaultAsync(x => x.Id == id, cancellationToken)
            ?? throw new ApiException("الوثيقة غير موجودة", StatusCodes.Status404NotFound);
        await EnsureDocumentAccessAsync(document, actorId, "manage", cancellationToken);
        document.Status = nextStatus;
        var nextIsActive = request?.IsActive ?? isActive;
        if (nextIsActive.HasValue)
        {
            document.IsActive = nextIsActive.Value;
        }

        await db.SaveChangesAsync(cancellationToken);
        await auditService.LogAsync("document_status_updated", "document", id.ToString(), newValue: new { status = nextStatus, isActive = nextIsActive }, cancellationToken: cancellationToken);
        return Ok(await MapDocumentLegacyAsync(document, actorId, cancellationToken));
    }

    [HttpGet("documents/{documentId:long}/versions")]
    [Authorize(Policy = "Permission:documents.versions.view")]
    public async Task<ActionResult<IReadOnlyCollection<DocumentVersionDto>>> GetVersions(long documentId, CancellationToken cancellationToken)
    {
        var actorId = RequireCurrentUserId();
        var document = await LoadDocumentQuery().AsNoTracking().FirstOrDefaultAsync(x => x.Id == documentId, cancellationToken)
            ?? throw new ApiException("الوثيقة غير موجودة", StatusCodes.Status404NotFound);
        await EnsureDocumentAccessAsync(document, actorId, "view", cancellationToken);
        return Ok(document.Versions.OrderByDescending(x => x.UploadedAt).Select(MapVersion).ToList());
    }

    [HttpPost("documents/{documentId:long}/versions")]
    [Authorize(Policy = "Permission:documents.manage")]
    [RequestSizeLimit(104_857_600)]
    public async Task<ActionResult<DocumentVersionDto>> UploadVersion(long documentId, [FromForm] UploadDocumentVersionMetadataRequest request, IFormFile file, CancellationToken cancellationToken)
    {
        var actorId = RequireCurrentUserId();
        var document = await LoadDocumentQuery().FirstOrDefaultAsync(x => x.Id == documentId, cancellationToken)
            ?? throw new ApiException("الوثيقة غير موجودة", StatusCodes.Status404NotFound);
        await EnsureDocumentAccessAsync(document, actorId, "manage", cancellationToken);
        await ValidatePdfFileAsync(file, cancellationToken);

        var versionNumber = string.IsNullOrWhiteSpace(request.VersionNumber)
            ? $"v{document.Versions.Count + 1}"
            : request.VersionNumber.Trim();
        if (document.Versions.Any(x => x.VersionNumber == versionNumber))
        {
            throw new ApiException("رقم الإصدار موجود مسبقاً لهذه الوثيقة");
        }

        var version = await SaveDocumentVersionAsync(document.Id, actorId, file, versionNumber, request.IssueDate, request.EffectiveDate, request.ReviewDate, request.ChangeSummary, request.SetAsCurrent, cancellationToken);
        if (request.SetAsCurrent)
        {
            foreach (var item in document.Versions)
            {
                item.IsCurrent = false;
            }

            version.IsCurrent = true;
            document.CurrentVersionId = version.Id;
        }

        await db.SaveChangesAsync(cancellationToken);
        await auditService.LogAsync("document_version_uploaded", "document", document.Id.ToString(), newValue: new { version.Id, version.VersionNumber, request.SetAsCurrent }, cancellationToken: cancellationToken);
        return Ok(MapVersion(version));
    }

    [HttpPost("documents/{documentId:long}/versions/{versionId:long}/set-current")]
    [Authorize(Policy = "Permission:documents.manage")]
    public async Task<ActionResult<DocumentDetailsDto>> SetCurrentVersion(long documentId, long versionId, CancellationToken cancellationToken)
    {
        var actorId = RequireCurrentUserId();
        var document = await LoadDocumentQuery().FirstOrDefaultAsync(x => x.Id == documentId, cancellationToken)
            ?? throw new ApiException("الوثيقة غير موجودة", StatusCodes.Status404NotFound);
        await EnsureDocumentAccessAsync(document, actorId, "manage", cancellationToken);
        var version = document.Versions.FirstOrDefault(x => x.Id == versionId)
            ?? throw new ApiException("إصدار الوثيقة غير موجود", StatusCodes.Status404NotFound);

        foreach (var item in document.Versions)
        {
            item.IsCurrent = false;
        }

        version.IsCurrent = true;
        document.CurrentVersionId = version.Id;
        await db.SaveChangesAsync(cancellationToken);
        await auditService.LogAsync("document_version_set_current", "document", document.Id.ToString(), newValue: new { version.Id, version.VersionNumber }, cancellationToken: cancellationToken);
        return Ok(await MapDetailsAsync(document, actorId, cancellationToken));
    }

    [HttpGet("documents/{documentId:long}/preview")]
    public Task<IActionResult> Preview(long documentId, CancellationToken cancellationToken) =>
        ServePdf(documentId, "view", "document_viewed", inline: true, cancellationToken);

    [HttpGet("documents/{documentId:long}/download")]
    public Task<IActionResult> Download(long documentId, CancellationToken cancellationToken) =>
        ServePdf(documentId, "download", "document_downloaded", inline: false, cancellationToken);

    [HttpGet("documents/{documentId:long}/print")]
    public Task<IActionResult> Print(long documentId, CancellationToken cancellationToken) =>
        ServePdf(documentId, "print", "document_printed", inline: true, cancellationToken);

    [HttpPost("documents/{documentId:long}/acknowledge")]
    [Authorize(Policy = "Permission:documents.acknowledge")]
    public async Task<ActionResult<DocumentAcknowledgementDto>> Acknowledge(long documentId, CancellationToken cancellationToken)
    {
        var actorId = RequireCurrentUserId();
        var document = await LoadDocumentQuery().FirstOrDefaultAsync(x => x.Id == documentId, cancellationToken)
            ?? throw new ApiException("الوثيقة غير موجودة", StatusCodes.Status404NotFound);
        await EnsureDocumentAccessAsync(document, actorId, "view", cancellationToken);
        if (document.CurrentVersionId is null)
        {
            throw new ApiException("لا يوجد إصدار حالي للوثيقة");
        }

        var acknowledgement = await db.DocumentAcknowledgements
            .Include(x => x.User)
            .FirstOrDefaultAsync(x => x.DocumentId == documentId && x.VersionId == document.CurrentVersionId && x.UserId == actorId, cancellationToken);
        if (acknowledgement is null)
        {
            acknowledgement = new DocumentAcknowledgement
            {
                DocumentId = documentId,
                VersionId = document.CurrentVersionId.Value,
                UserId = actorId,
                AcknowledgedAt = DateTimeOffset.UtcNow
            };
            db.DocumentAcknowledgements.Add(acknowledgement);
            await db.SaveChangesAsync(cancellationToken);
            await auditService.LogAsync("document_acknowledged", "document", documentId.ToString(), metadata: new { versionId = document.CurrentVersionId }, cancellationToken: cancellationToken);
        }

        var saved = await db.DocumentAcknowledgements.Include(x => x.User).FirstAsync(x => x.Id == acknowledgement.Id, cancellationToken);
        return Ok(MapAcknowledgement(saved));
    }

    [HttpGet("documents/{documentId:long}/acknowledgements")]
    [Authorize(Policy = "Permission:documents.logs.view")]
    public async Task<ActionResult<IReadOnlyCollection<DocumentAcknowledgementDto>>> GetAcknowledgements(long documentId, CancellationToken cancellationToken)
    {
        var actorId = RequireCurrentUserId();
        var document = await LoadDocumentQuery().AsNoTracking().FirstOrDefaultAsync(x => x.Id == documentId, cancellationToken)
            ?? throw new ApiException("الوثيقة غير موجودة", StatusCodes.Status404NotFound);
        await EnsureDocumentAccessAsync(document, actorId, "manage", cancellationToken);
        var items = await db.DocumentAcknowledgements
            .AsNoTracking()
            .Include(x => x.User)
            .Where(x => x.DocumentId == documentId)
            .OrderByDescending(x => x.AcknowledgedAt)
            .ToListAsync(cancellationToken);
        return Ok(items.Select(MapAcknowledgement).ToList());
    }

    [HttpGet("documents/{documentId:long}/acknowledgements/report")]
    [Authorize(Policy = "Permission:documents.manage")]
    public async Task<ActionResult<object>> GetAcknowledgementReport(long documentId, [FromQuery(Name = "department_id")] long? departmentId, CancellationToken cancellationToken)
    {
        var actorId = RequireCurrentUserId();
        var document = await LoadDocumentQuery().AsNoTracking().FirstOrDefaultAsync(x => x.Id == documentId, cancellationToken)
            ?? throw new ApiException("الوثيقة غير موجودة", StatusCodes.Status404NotFound);
        await EnsureDocumentAccessAsync(document, actorId, "manage", cancellationToken);
        return Ok(await BuildAcknowledgementReportAsync(document, departmentId, cancellationToken));
    }

    [HttpPost("documents/{documentId:long}/acknowledgements/remind")]
    [Authorize(Policy = "Permission:documents.manage")]
    public async Task<ActionResult<object>> RemindPendingAcknowledgements(long documentId, DocumentAcknowledgementReminderRequest request, CancellationToken cancellationToken)
    {
        var actorId = RequireCurrentUserId();
        var document = await LoadDocumentQuery().AsNoTracking().FirstOrDefaultAsync(x => x.Id == documentId, cancellationToken)
            ?? throw new ApiException("الوثيقة غير موجودة", StatusCodes.Status404NotFound);
        await EnsureDocumentAccessAsync(document, actorId, "manage", cancellationToken);
        if (!document.RequiresAcknowledgement)
        {
            throw new ApiException("هذه الوثيقة لا تتطلب إقرار اطلاع");
        }

        var report = await BuildAcknowledgementReportAsync(document, request.DepartmentId, cancellationToken);
        var pending = report.pending;
        var sentCount = pending.Count;
        if (request.UserIds is { Count: > 0 })
        {
            var ids = request.UserIds.ToHashSet();
            sentCount = pending.Count(x =>
            {
                var user = x.GetType().GetProperty("user")!.GetValue(x);
                var id = user?.GetType().GetProperty("id")?.GetValue(user);
                return id is long value && ids.Contains(value);
            });
        }

        await auditService.LogAsync("document_acknowledgement_reminder_sent", "document", documentId.ToString(), metadata: new { sentCount, request.DepartmentId }, cancellationToken: cancellationToken);
        return Ok(new { sent_count = sentCount });
    }

    [HttpGet("documents/{documentId:long}/access-logs")]
    [Authorize(Policy = "Permission:documents.logs.view")]
    public async Task<ActionResult<IReadOnlyCollection<DocumentAccessLogDto>>> GetAccessLogs(long documentId, CancellationToken cancellationToken)
    {
        var actorId = RequireCurrentUserId();
        var document = await LoadDocumentQuery().AsNoTracking().FirstOrDefaultAsync(x => x.Id == documentId, cancellationToken)
            ?? throw new ApiException("الوثيقة غير موجودة", StatusCodes.Status404NotFound);
        await EnsureDocumentAccessAsync(document, actorId, "manage", cancellationToken);
        var logs = await db.DocumentAccessLogs
            .AsNoTracking()
            .Include(x => x.User)
            .Where(x => x.DocumentId == documentId)
            .OrderByDescending(x => x.CreatedAt)
            .Take(300)
            .ToListAsync(cancellationToken);
        return Ok(logs.Select(MapAccessLog).ToList());
    }

    [HttpGet("documents/permissions")]
    [Authorize(Policy = "Permission:documents.manage")]
    public async Task<ActionResult<IReadOnlyCollection<DocumentPermissionDto>>> GetPermissions(CancellationToken cancellationToken)
    {
        var items = await db.DocumentPermissions
            .AsNoTracking()
            .Include(x => x.Category)
            .Include(x => x.Document)
            .Include(x => x.Role)
            .Include(x => x.Department)
            .OrderByDescending(x => x.UpdatedAt)
            .ToListAsync(cancellationToken);
        return Ok(items.Select(MapPermission).ToList());
    }

    [HttpPost("documents/permissions")]
    [Authorize(Policy = "Permission:documents.manage")]
    public async Task<ActionResult<DocumentPermissionDto>> UpsertPermission(UpsertDocumentPermissionRequest request, CancellationToken cancellationToken)
    {
        await ValidatePermissionRequestAsync(request, cancellationToken);

        var permission = await db.DocumentPermissions.FirstOrDefaultAsync(x =>
            x.CategoryId == request.CategoryId &&
            x.DocumentId == request.DocumentId &&
            x.RoleId == request.RoleId &&
            x.DepartmentId == request.DepartmentId,
            cancellationToken);

        if (permission is null)
        {
            permission = new DocumentPermission();
            db.DocumentPermissions.Add(permission);
        }

        ApplyPermission(permission, request);

        await db.SaveChangesAsync(cancellationToken);
        await auditService.LogAsync("document_permission_changed", "document_permission", permission.Id.ToString(), newValue: request, cancellationToken: cancellationToken);
        var saved = await db.DocumentPermissions
            .AsNoTracking()
            .Include(x => x.Category)
            .Include(x => x.Document)
            .Include(x => x.Role)
            .Include(x => x.Department)
            .FirstAsync(x => x.Id == permission.Id, cancellationToken);
        return Ok(MapPermission(saved));
    }

    [HttpPut("documents/permissions/{id:long}")]
    [Authorize(Policy = "Permission:documents.manage")]
    public async Task<ActionResult<DocumentPermissionDto>> UpdatePermission(long id, UpsertDocumentPermissionRequest request, CancellationToken cancellationToken)
    {
        await ValidatePermissionRequestAsync(request, cancellationToken);
        var permission = await db.DocumentPermissions.FirstOrDefaultAsync(x => x.Id == id, cancellationToken)
            ?? throw new ApiException("صلاحية الوثائق غير موجودة", StatusCodes.Status404NotFound);
        var duplicate = await db.DocumentPermissions.AnyAsync(x =>
            x.Id != id &&
            x.CategoryId == request.CategoryId &&
            x.DocumentId == request.DocumentId &&
            x.RoleId == request.RoleId &&
            x.DepartmentId == request.DepartmentId,
            cancellationToken);
        if (duplicate)
        {
            throw new ApiException("توجد صلاحية بنفس النطاق مسبقاً");
        }

        var oldValue = MapPermission(permission);
        ApplyPermission(permission, request);
        await db.SaveChangesAsync(cancellationToken);
        await auditService.LogAsync("document_permission_changed", "document_permission", permission.Id.ToString(), oldValue: oldValue, newValue: request, cancellationToken: cancellationToken);
        var saved = await db.DocumentPermissions
            .AsNoTracking()
            .Include(x => x.Category)
            .Include(x => x.Document)
            .Include(x => x.Role)
            .Include(x => x.Department)
            .FirstAsync(x => x.Id == permission.Id, cancellationToken);
        return Ok(MapPermission(saved));
    }

    [HttpDelete("documents/permissions/{id:long}")]
    [Authorize(Policy = "Permission:documents.manage")]
    public async Task<IActionResult> DeletePermission(long id, CancellationToken cancellationToken)
    {
        var permission = await db.DocumentPermissions.FirstOrDefaultAsync(x => x.Id == id, cancellationToken)
            ?? throw new ApiException("صلاحية الوثائق غير موجودة", StatusCodes.Status404NotFound);
        db.DocumentPermissions.Remove(permission);
        await db.SaveChangesAsync(cancellationToken);
        await auditService.LogAsync("document_permission_deleted", "document_permission", id.ToString(), cancellationToken: cancellationToken);
        return NoContent();
    }

    private IQueryable<Document> FilterDocuments(string? search, string? categoryCode, long? categoryId, string? classification, string? status, long? ownerDepartmentId)
    {
        var query = LoadDocumentQuery().AsNoTracking();
        if (!string.IsNullOrWhiteSpace(search))
        {
            var value = search.Trim().ToLowerInvariant();
            query = query.Where(x =>
                x.TitleAr.ToLower().Contains(value) ||
                (x.TitleEn != null && x.TitleEn.ToLower().Contains(value)) ||
                (x.DocumentNumber != null && x.DocumentNumber.ToLower().Contains(value)) ||
                (x.Keywords != null && x.Keywords.ToLower().Contains(value)) ||
                x.Category!.NameAr.ToLower().Contains(value));
        }

        if (!string.IsNullOrWhiteSpace(categoryCode))
        {
            query = query.Where(x => x.Category!.Code == categoryCode);
        }

        if (categoryId.HasValue)
        {
            query = query.Where(x => x.CategoryId == categoryId.Value);
        }

        if (!string.IsNullOrWhiteSpace(classification))
        {
            query = query.Where(x => x.Classification == classification);
        }

        if (!string.IsNullOrWhiteSpace(status))
        {
            query = query.Where(x => x.Status == status);
        }

        if (ownerDepartmentId.HasValue)
        {
            query = query.Where(x => x.OwnerDepartmentId == ownerDepartmentId.Value);
        }

        return query;
    }

    private IQueryable<Document> LoadDocumentQuery() =>
        db.Documents
            .Include(x => x.Category)
            .Include(x => x.OwnerDepartment)
            .Include(x => x.CreatedByUser)
            .Include(x => x.CurrentVersion).ThenInclude(x => x!.UploadedByUser)
            .Include(x => x.Versions).ThenInclude(x => x.UploadedByUser);

    private async Task<IActionResult> ServePdf(long documentId, string permissionAction, string auditAction, bool inline, CancellationToken cancellationToken)
    {
        var actorId = RequireCurrentUserId();
        var document = await LoadDocumentQuery().AsNoTracking().FirstOrDefaultAsync(x => x.Id == documentId, cancellationToken)
            ?? throw new ApiException("الوثيقة غير موجودة", StatusCodes.Status404NotFound);
        await EnsureDocumentAccessAsync(document, actorId, permissionAction, cancellationToken);
        var version = document.CurrentVersion ?? throw new ApiException("لا يوجد إصدار حالي للوثيقة", StatusCodes.Status404NotFound);
        if (!System.IO.File.Exists(version.FilePath))
        {
            throw new ApiException("ملف الوثيقة غير موجود على التخزين", StatusCodes.Status404NotFound);
        }

        await LogDocumentAccessAsync(document, version.Id, actorId, permissionAction, cancellationToken);
        await auditService.LogAsync(auditAction, "document", documentId.ToString(), metadata: new { versionId = version.Id }, cancellationToken: cancellationToken);
        if (inline)
        {
            Response.Headers.ContentDisposition = $"inline; filename=\"{version.FileName}\"";
            return PhysicalFile(version.FilePath, "application/pdf", enableRangeProcessing: true);
        }

        return PhysicalFile(version.FilePath, "application/pdf", version.FileName, enableRangeProcessing: true);
    }

    private async Task<DocumentVersion> SaveDocumentVersionAsync(
        long documentId,
        long actorId,
        IFormFile file,
        string versionNumber,
        DateOnly? issueDate,
        DateOnly? effectiveDate,
        DateOnly? reviewDate,
        string? changeSummary,
        bool isCurrent,
        CancellationToken cancellationToken)
    {
        var uploadsRoot = configuration["Storage:UploadsPath"] ?? "/data/uploads";
        var directory = Path.Combine(uploadsRoot, "documents", documentId.ToString());
        Directory.CreateDirectory(directory);

        var storedName = $"{Guid.NewGuid():N}.pdf";
        var path = Path.Combine(directory, storedName);
        await using (var stream = System.IO.File.Create(path))
        {
            await file.CopyToAsync(stream, cancellationToken);
        }

        var checksum = await ComputeChecksumAsync(path, cancellationToken);
        var version = new DocumentVersion
        {
            DocumentId = documentId,
            VersionNumber = versionNumber,
            FileName = Path.GetFileName(file.FileName),
            StoredFileName = storedName,
            FilePath = path,
            FileSize = file.Length,
            MimeType = "application/pdf",
            Checksum = checksum,
            IssueDate = issueDate,
            EffectiveDate = effectiveDate,
            ReviewDate = reviewDate,
            UploadedByUserId = actorId,
            UploadedAt = DateTimeOffset.UtcNow,
            ChangeSummary = changeSummary,
            IsCurrent = isCurrent
        };
        db.DocumentVersions.Add(version);
        await db.SaveChangesAsync(cancellationToken);
        return version;
    }

    private async Task ValidatePdfFileAsync(IFormFile file, CancellationToken cancellationToken)
    {
        if (file.Length == 0)
        {
            throw new ApiException("ملف الوثيقة فارغ");
        }

        var uploadsEnabled = await settingsStore.GetValueAsync("attachments.allow_uploads", true, cancellationToken);
        if (!uploadsEnabled)
        {
            throw new ApiException("رفع الملفات معطل من الإعدادات العامة للمرفقات");
        }

        var configuredDocumentMax = configuration.GetValue("Documents:MaxFileSizeMb", 25);
        var globalMaxSizeMb = await settingsStore.GetValueAsync("attachments.max_file_size_mb", 10, cancellationToken);
        var globalHardLimit = await settingsStore.GetValueAsync("attachments.is_hard_limit", true, cancellationToken);
        var maxSizeMb = globalHardLimit ? Math.Min(configuredDocumentMax, globalMaxSizeMb) : configuredDocumentMax;
        if (file.Length > maxSizeMb * 1024L * 1024L)
        {
            throw new ApiException($"حجم ملف PDF يتجاوز الحد الأقصى وهو {maxSizeMb} MB");
        }

        var extension = Path.GetExtension(file.FileName).TrimStart('.').ToLowerInvariant();
        if (extension != "pdf")
        {
            throw new ApiException("مكتبة الوثائق تقبل ملفات PDF فقط");
        }

        if (!string.IsNullOrWhiteSpace(file.ContentType) &&
            file.ContentType != "application/pdf" &&
            file.ContentType != "application/octet-stream")
        {
            throw new ApiException("نوع الملف يجب أن يكون PDF");
        }

        await using var stream = file.OpenReadStream();
        var header = new byte[4];
        var read = await stream.ReadAsync(header, cancellationToken);
        if (read < 4 || header[0] != '%' || header[1] != 'P' || header[2] != 'D' || header[3] != 'F')
        {
            throw new ApiException("الملف لا يبدو ملف PDF صالحاً");
        }
    }

    private async Task EnsureDocumentAccessAsync(Document document, long actorId, string action, CancellationToken cancellationToken)
    {
        if (!await CanAccessDocumentAsync(document, actorId, action, cancellationToken))
        {
            var message = action switch
            {
                "download" => "لا تملك صلاحية تحميل هذه الوثيقة",
                "print" => "لا تملك صلاحية طباعة هذه الوثيقة",
                "manage" => "لا تملك صلاحية إدارة هذه الوثيقة",
                _ => "لا تملك صلاحية عرض هذه الوثيقة"
            };
            throw new ApiException(message, StatusCodes.Status403Forbidden);
        }
    }

    private async Task<bool> CanAccessDocumentAsync(Document document, long actorId, string action, CancellationToken cancellationToken)
    {
        if (await permissionService.HasPermissionAsync(actorId, "documents.manage", cancellationToken))
        {
            return true;
        }

        var actor = await db.Users.AsNoTracking().FirstOrDefaultAsync(x => x.Id == actorId, cancellationToken);
        if (actor is null || !actor.IsActive || actor.IsLocked)
        {
            return false;
        }

        var permissionCode = action switch
        {
            "download" => "documents.download",
            "print" => "documents.print",
            "manage" => "documents.manage",
            _ => "documents.view"
        };
        var hasGlobalPermission = await permissionService.HasPermissionAsync(actorId, permissionCode, cancellationToken);
        if (action == "view" && !hasGlobalPermission)
        {
            return false;
        }

        var explicitPermission = await db.DocumentPermissions.AsNoTracking().AnyAsync(x =>
            (x.DocumentId == document.Id || (x.DocumentId == null && x.CategoryId == document.CategoryId)) &&
            (x.RoleId == actor.RoleId || x.DepartmentId == actor.DepartmentId || (x.RoleId == null && x.DepartmentId == null)) &&
            ((action == "view" && x.CanView) ||
             (action == "download" && x.CanDownload) ||
             (action == "print" && x.CanPrint) ||
             (action == "manage" && x.CanManage)),
            cancellationToken);

        if (action is "download" or "print" or "manage")
        {
            return hasGlobalPermission || explicitPermission;
        }

        if (document is { IsActive: true, Status: "active" } && document.Classification is "public" or "internal")
        {
            return true;
        }

        return explicitPermission;
    }

    private async Task<bool> HasAcknowledgedAsync(long documentId, long? versionId, long actorId, CancellationToken cancellationToken)
    {
        if (!versionId.HasValue)
        {
            return false;
        }

        return await db.DocumentAcknowledgements.AsNoTracking().AnyAsync(x => x.DocumentId == documentId && x.VersionId == versionId.Value && x.UserId == actorId, cancellationToken);
    }

    private async Task<DocumentListItemDto> MapListItemAsync(Document item, long actorId, CancellationToken cancellationToken)
    {
        var canDownload = await CanAccessDocumentAsync(item, actorId, "download", cancellationToken);
        var canPrint = await CanAccessDocumentAsync(item, actorId, "print", cancellationToken);
        var acknowledged = await HasAcknowledgedAsync(item.Id, item.CurrentVersionId, actorId, cancellationToken);
        return new DocumentListItemDto(
            item.Id,
            item.TitleAr,
            item.TitleEn,
            item.DocumentNumber,
            item.CategoryId,
            item.Category?.NameAr,
            item.Category?.Code,
            item.OwnerDepartmentId,
            item.OwnerDepartment?.NameAr,
            item.Classification,
            item.Status,
            item.RequiresAcknowledgement,
            item.IsActive,
            item.CurrentVersionId,
            item.CurrentVersion?.VersionNumber,
            item.CurrentVersion?.IssueDate,
            item.CurrentVersion?.EffectiveDate,
            item.CurrentVersion?.ReviewDate,
            item.UpdatedAt,
            canDownload,
            canPrint,
            acknowledged);
    }

    private async Task<DocumentDetailsDto> MapDetailsAsync(Document item, long actorId, CancellationToken cancellationToken)
    {
        var canDownload = await CanAccessDocumentAsync(item, actorId, "download", cancellationToken);
        var canPrint = await CanAccessDocumentAsync(item, actorId, "print", cancellationToken);
        var canManage = await CanAccessDocumentAsync(item, actorId, "manage", cancellationToken);
        var acknowledged = await HasAcknowledgedAsync(item.Id, item.CurrentVersionId, actorId, cancellationToken);
        return new DocumentDetailsDto(
            item.Id,
            item.TitleAr,
            item.TitleEn,
            item.DocumentNumber,
            item.Description,
            item.CategoryId,
            item.Category?.NameAr,
            item.Category?.Code,
            item.OwnerDepartmentId,
            item.OwnerDepartment?.NameAr,
            item.Classification,
            item.Status,
            item.CurrentVersionId,
            item.RequiresAcknowledgement,
            item.Keywords,
            item.IsActive,
            item.CreatedByUserId,
            item.CreatedByUser?.NameAr,
            item.CreatedAt,
            item.UpdatedAt,
            canDownload,
            canPrint,
            canManage,
            acknowledged,
            item.CurrentVersion is null ? null : MapVersion(item.CurrentVersion),
            item.Versions.OrderByDescending(x => x.UploadedAt).Select(MapVersion).ToList());
    }

    private static DocumentCategoryDto MapCategory(DocumentCategory item)
    {
        var activeDocuments = item.Documents.Where(x => x.IsActive).ToList();
        return new DocumentCategoryDto(
            item.Id,
            item.NameAr,
            item.NameEn,
            item.Code,
            item.Description,
            item.Icon,
            item.Color,
            item.SortOrder,
            item.IsActive,
            activeDocuments.Count,
            activeDocuments.Count == 0 ? null : activeDocuments.Max(x => x.UpdatedAt),
            item.CreatedAt,
            item.UpdatedAt);
    }

    private static DocumentVersionDto MapVersion(DocumentVersion item) =>
        new(
            item.Id,
            item.DocumentId,
            item.VersionNumber,
            item.FileName,
            item.FileSize,
            item.MimeType,
            item.Checksum,
            item.IssueDate,
            item.EffectiveDate,
            item.ReviewDate,
            item.UploadedByUserId,
            item.UploadedByUser?.NameAr,
            item.UploadedAt,
            item.ChangeSummary,
            item.IsCurrent);

    private static DocumentPermissionDto MapPermission(DocumentPermission item) =>
        new(
            item.Id,
            item.CategoryId,
            item.Category?.NameAr,
            item.DocumentId,
            item.Document?.TitleAr,
            item.RoleId,
            item.Role?.NameAr,
            item.DepartmentId,
            item.Department?.NameAr,
            item.CanView,
            item.CanDownload,
            item.CanPrint,
            item.CanManage,
            item.CreatedAt,
            item.UpdatedAt);

    private static DocumentAcknowledgementDto MapAcknowledgement(DocumentAcknowledgement item) =>
        new(item.Id, item.DocumentId, item.VersionId, item.UserId, item.User?.NameAr, item.AcknowledgedAt);

    private static DocumentAccessLogDto MapAccessLog(DocumentAccessLog item) =>
        new(item.Id, item.DocumentId, item.VersionId, item.Action, item.UserId, item.User?.NameAr, item.IpAddress, item.UserAgent, item.CreatedAt);

    private static object MapCategoryLegacy(DocumentCategory item)
    {
        var activeDocuments = item.Documents.Where(x => x.IsActive).ToList();
        return new
        {
            id = item.Id,
            name_ar = item.NameAr,
            name_en = item.NameEn,
            code = item.Code,
            description = item.Description,
            icon = item.Icon,
            color = item.Color,
            sort_order = item.SortOrder,
            is_active = item.IsActive,
            documents_count = activeDocuments.Count,
            last_updated_at = activeDocuments.Count == 0 ? null : (DateTimeOffset?)activeDocuments.Max(x => x.UpdatedAt),
            created_at = item.CreatedAt,
            updated_at = item.UpdatedAt
        };
    }

    private async Task<object> MapDocumentLegacyAsync(Document item, long actorId, CancellationToken cancellationToken)
    {
        var canDownload = await CanAccessDocumentAsync(item, actorId, "download", cancellationToken);
        var canPrint = await CanAccessDocumentAsync(item, actorId, "print", cancellationToken);
        var canManage = await CanAccessDocumentAsync(item, actorId, "manage", cancellationToken);
        var acknowledged = await HasAcknowledgedAsync(item.Id, item.CurrentVersionId, actorId, cancellationToken);
        return new
        {
            id = item.Id,
            title_ar = item.TitleAr,
            title_en = item.TitleEn,
            document_number = item.DocumentNumber,
            description = item.Description,
            classification = item.Classification,
            status = item.Status,
            requires_acknowledgement = item.RequiresAcknowledgement,
            keywords = item.Keywords,
            is_active = item.IsActive,
            created_at = item.CreatedAt,
            updated_at = item.UpdatedAt,
            category = item.Category is null ? null : new
            {
                id = item.Category.Id,
                name_ar = item.Category.NameAr,
                name_en = item.Category.NameEn,
                code = item.Category.Code,
                color = item.Category.Color,
                icon = item.Category.Icon
            },
            owner_department = item.OwnerDepartment is null ? null : new
            {
                id = item.OwnerDepartment.Id,
                name_ar = item.OwnerDepartment.NameAr,
                name_en = item.OwnerDepartment.NameEn
            },
            current_version = item.CurrentVersion is null ? null : MapVersionLegacy(item.CurrentVersion),
            versions = item.Versions.OrderByDescending(x => x.UploadedAt).Select(MapVersionLegacy).ToList(),
            acknowledged,
            capabilities = new
            {
                can_view = true,
                can_download = canDownload,
                can_print = canPrint,
                can_manage = canManage
            }
        };
    }

    private static object MapVersionLegacy(DocumentVersion item) => new
    {
        id = item.Id,
        document_id = item.DocumentId,
        version_number = item.VersionNumber,
        file_name = item.FileName,
        file_size = item.FileSize,
        mime_type = item.MimeType,
        checksum = item.Checksum,
        issue_date = item.IssueDate,
        effective_date = item.EffectiveDate,
        review_date = item.ReviewDate,
        uploaded_by_user_id = item.UploadedByUserId,
        uploaded_by_name_ar = item.UploadedByUser?.NameAr,
        uploaded_at = item.UploadedAt,
        change_summary = item.ChangeSummary,
        is_current = item.IsCurrent
    };

    private static object MapPermissionLegacy(DocumentPermission item) => new
    {
        id = item.Id,
        category_id = item.CategoryId,
        document_id = item.DocumentId,
        role_id = item.RoleId,
        department_id = item.DepartmentId,
        category = item.Category is null ? null : new { id = item.Category.Id, name_ar = item.Category.NameAr },
        document = item.Document is null ? null : new { id = item.Document.Id, title_ar = item.Document.TitleAr },
        role = item.Role is null ? null : new { id = item.Role.Id, name_ar = item.Role.NameAr, code = item.Role.Code },
        department = item.Department is null ? null : new { id = item.Department.Id, name_ar = item.Department.NameAr },
        can_view = item.CanView,
        can_download = item.CanDownload,
        can_print = item.CanPrint,
        can_manage = item.CanManage,
        created_at = item.CreatedAt,
        updated_at = item.UpdatedAt
    };

    private static object MapUserLegacy(User item) => new
    {
        id = item.Id,
        full_name_ar = item.NameAr,
        full_name_en = item.NameEn,
        email = item.Email,
        username = item.Username,
        department = item.Department is null ? null : new { id = item.Department.Id, name_ar = item.Department.NameAr }
    };

    private static void ApplyCategory(DocumentCategory category, UpsertDocumentCategoryRequest request)
    {
        category.NameAr = request.NameAr.Trim();
        category.NameEn = string.IsNullOrWhiteSpace(request.NameEn) ? null : request.NameEn.Trim();
        category.Code = request.Code.Trim();
        category.Description = request.Description;
        category.Icon = request.Icon;
        category.Color = request.Color;
        category.SortOrder = request.SortOrder;
        category.IsActive = request.IsActive;
    }

    private static void ApplyPermission(DocumentPermission permission, UpsertDocumentPermissionRequest request)
    {
        permission.CategoryId = request.CategoryId;
        permission.DocumentId = request.DocumentId;
        permission.RoleId = request.RoleId;
        permission.DepartmentId = request.DepartmentId;
        permission.CanView = request.CanView;
        permission.CanDownload = request.CanDownload;
        permission.CanPrint = request.CanPrint;
        permission.CanManage = request.CanManage;
    }

    private async Task ValidatePermissionRequestAsync(UpsertDocumentPermissionRequest request, CancellationToken cancellationToken)
    {
        if (request.CategoryId.HasValue)
        {
            await EnsureCategoryExistsAsync(request.CategoryId.Value, cancellationToken);
        }

        if (request.DocumentId.HasValue && !await db.Documents.AnyAsync(x => x.Id == request.DocumentId.Value, cancellationToken))
        {
            throw new ApiException("الوثيقة المحددة غير موجودة");
        }

        if (request.RoleId.HasValue && !await db.Roles.AnyAsync(x => x.Id == request.RoleId.Value, cancellationToken))
        {
            throw new ApiException("الدور المحدد غير موجود");
        }

        if (request.DepartmentId.HasValue)
        {
            await EnsureDepartmentExistsAsync(request.DepartmentId.Value, cancellationToken);
        }
    }

    private async Task<AcknowledgementReportPayload> BuildAcknowledgementReportAsync(Document document, long? departmentId, CancellationToken cancellationToken)
    {
        var version = document.CurrentVersion;
        var versionId = document.CurrentVersionId;
        var users = await db.Users
            .AsNoTracking()
            .Include(x => x.Department)
            .Where(x => x.IsActive && !x.IsLocked)
            .Where(x => !departmentId.HasValue || x.DepartmentId == departmentId.Value)
            .OrderBy(x => x.NameAr)
            .ToListAsync(cancellationToken);
        var acknowledgementRows = await db.DocumentAcknowledgements
            .AsNoTracking()
            .Include(x => x.User).ThenInclude(x => x!.Department)
            .Include(x => x.Version)
            .Where(x => x.DocumentId == document.Id)
            .Where(x => !versionId.HasValue || x.VersionId == versionId.Value)
            .ToListAsync(cancellationToken);
        var acknowledgedUserIds = acknowledgementRows.Select(x => x.UserId).ToHashSet();
        var acknowledged = acknowledgementRows
            .OrderByDescending(x => x.AcknowledgedAt)
            .Select(x => (object)new
            {
                id = x.Id,
                acknowledged_at = x.AcknowledgedAt,
                user = x.User is null ? null : MapUserLegacy(x.User),
                version = x.Version is null ? null : MapVersionLegacy(x.Version)
            })
            .ToList();
        var pending = users
            .Where(x => !acknowledgedUserIds.Contains(x.Id))
            .Select(x => (object)new { user = MapUserLegacy(x) })
            .ToList();

        return new AcknowledgementReportPayload(
            document: new { id = document.Id, title_ar = document.TitleAr, requires_acknowledgement = document.RequiresAcknowledgement },
            version: version is null ? null : MapVersionLegacy(version),
            total: users.Count,
            acknowledged_count: acknowledged.Count,
            pending_count: pending.Count,
            acknowledged: acknowledged,
            pending: pending);
    }

    private async Task LogDocumentAccessAsync(Document document, long? versionId, long actorId, string action, CancellationToken cancellationToken)
    {
        db.DocumentAccessLogs.Add(new DocumentAccessLog
        {
            DocumentId = document.Id,
            VersionId = versionId,
            UserId = actorId,
            Action = action,
            IpAddress = currentUser.IpAddress,
            UserAgent = currentUser.UserAgent,
            CreatedAt = DateTimeOffset.UtcNow
        });
        await db.SaveChangesAsync(cancellationToken);
    }

    private async Task EnsureCategoryExistsAsync(long categoryId, CancellationToken cancellationToken)
    {
        if (!await db.DocumentCategories.AnyAsync(x => x.Id == categoryId && x.IsActive, cancellationToken))
        {
            throw new ApiException("تصنيف الوثيقة غير صالح");
        }
    }

    private async Task EnsureDepartmentExistsAsync(long? departmentId, CancellationToken cancellationToken)
    {
        if (departmentId.HasValue && !await db.Departments.AnyAsync(x => x.Id == departmentId.Value && x.IsActive, cancellationToken))
        {
            throw new ApiException("الإدارة المالكة غير صالحة");
        }
    }

    private static void ValidateClassification(string classification)
    {
        if (!AllowedClassifications.Contains(classification))
        {
            throw new ApiException("درجة السرية غير صالحة");
        }
    }

    private static void ValidateStatus(string status)
    {
        if (!AllowedStatuses.Contains(status))
        {
            throw new ApiException("حالة الوثيقة غير صالحة");
        }
    }

    private long RequireCurrentUserId() =>
        currentUser.UserId ?? throw new ApiException("المستخدم غير مصادق", StatusCodes.Status401Unauthorized);

    private static async Task<string> ComputeChecksumAsync(string path, CancellationToken cancellationToken)
    {
        await using var stream = System.IO.File.OpenRead(path);
        var hash = await SHA256.HashDataAsync(stream, cancellationToken);
        return Convert.ToHexString(hash).ToLowerInvariant();
    }
}
