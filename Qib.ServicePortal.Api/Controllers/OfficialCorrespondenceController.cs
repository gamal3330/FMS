using System.Security.Cryptography;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Qib.ServicePortal.Api.Application.DTOs;
using Qib.ServicePortal.Api.Application.Interfaces;
using Qib.ServicePortal.Api.Common.Exceptions;
using Qib.ServicePortal.Api.Domain.Entities;
using Qib.ServicePortal.Api.Infrastructure.Data;
using Qib.ServicePortal.Api.Infrastructure.Pdf;

namespace Qib.ServicePortal.Api.Controllers;

[ApiController]
[Route("api/dotnet/v1")]
[Authorize]
public class OfficialCorrespondenceController(
    ServicePortalDbContext db,
    ICurrentUserService currentUser,
    IPermissionService permissionService,
    IAuditService auditService,
    IConfiguration configuration) : ControllerBase
{
    [HttpGet("settings/official-letterheads")]
    public async Task<ActionResult<IReadOnlyCollection<OfficialLetterheadTemplateDto>>> GetLetterheads(CancellationToken cancellationToken)
    {
        var templates = await db.OfficialLetterheadTemplates
            .AsNoTracking()
            .OrderByDescending(x => x.IsDefault)
            .ThenBy(x => x.NameAr)
            .ToListAsync(cancellationToken);
        return Ok(templates.Select(MapLetterhead).ToList());
    }

    [HttpPost("settings/official-letterheads")]
    [Authorize(Policy = "Permission:official_letterheads.manage")]
    public async Task<ActionResult<OfficialLetterheadTemplateDto>> CreateLetterhead(UpsertOfficialLetterheadTemplateRequest request, CancellationToken cancellationToken)
    {
        var actorId = RequireCurrentUserId();
        var code = NormalizeCode(request.Code, request.NameAr);
        if (await db.OfficialLetterheadTemplates.AnyAsync(x => x.Code == code, cancellationToken))
        {
            throw new ApiException("رمز قالب الترويسة مستخدم مسبقاً");
        }

        var item = new OfficialLetterheadTemplate
        {
            NameAr = request.NameAr.Trim(),
            NameEn = request.NameEn?.Trim(),
            Code = code,
            LogoPath = request.LogoPath?.Trim(),
            HeaderHtml = request.HeaderHtml ?? string.Empty,
            FooterHtml = request.FooterHtml ?? string.Empty,
            PrimaryColor = request.PrimaryColor.Trim(),
            SecondaryColor = request.SecondaryColor.Trim(),
            ShowPageNumber = request.ShowPageNumber,
            ShowConfidentialityLabel = request.ShowConfidentialityLabel,
            IsDefault = request.IsDefault,
            IsActive = request.IsActive,
            CreatedByUserId = actorId
        };

        if (item.IsDefault)
        {
            await ClearDefaultLetterheadsAsync(cancellationToken);
        }

        db.OfficialLetterheadTemplates.Add(item);
        await db.SaveChangesAsync(cancellationToken);
        await EnsureSettingsHasDefaultAsync(item, cancellationToken);
        await auditService.LogAsync("official_letterhead_created", "official_letterhead_template", item.Id.ToString(), newValue: new { item.Code, item.NameAr }, cancellationToken: cancellationToken);
        return CreatedAtAction(nameof(GetLetterheads), MapLetterhead(item));
    }

    [HttpPut("settings/official-letterheads/{id:long}")]
    [Authorize(Policy = "Permission:official_letterheads.manage")]
    public async Task<ActionResult<OfficialLetterheadTemplateDto>> UpdateLetterhead(long id, UpsertOfficialLetterheadTemplateRequest request, CancellationToken cancellationToken)
    {
        var item = await db.OfficialLetterheadTemplates.FirstOrDefaultAsync(x => x.Id == id, cancellationToken)
            ?? throw new ApiException("قالب الترويسة غير موجود", StatusCodes.Status404NotFound);
        var code = NormalizeCode(request.Code, request.NameAr);
        if (await db.OfficialLetterheadTemplates.AnyAsync(x => x.Id != id && x.Code == code, cancellationToken))
        {
            throw new ApiException("رمز قالب الترويسة مستخدم مسبقاً");
        }

        var oldValue = new { item.NameAr, item.Code, item.IsDefault, item.IsActive };
        item.NameAr = request.NameAr.Trim();
        item.NameEn = request.NameEn?.Trim();
        item.Code = code;
        item.LogoPath = request.LogoPath?.Trim();
        item.HeaderHtml = request.HeaderHtml ?? string.Empty;
        item.FooterHtml = request.FooterHtml ?? string.Empty;
        item.PrimaryColor = request.PrimaryColor.Trim();
        item.SecondaryColor = request.SecondaryColor.Trim();
        item.ShowPageNumber = request.ShowPageNumber;
        item.ShowConfidentialityLabel = request.ShowConfidentialityLabel;
        item.IsActive = request.IsActive;
        item.IsDefault = request.IsDefault;

        if (item.IsDefault)
        {
            await ClearDefaultLetterheadsAsync(cancellationToken, item.Id);
        }

        await db.SaveChangesAsync(cancellationToken);
        await EnsureSettingsHasDefaultAsync(item, cancellationToken);
        await auditService.LogAsync("official_letterhead_updated", "official_letterhead_template", item.Id.ToString(), oldValue: oldValue, newValue: new { item.NameAr, item.Code, item.IsDefault, item.IsActive }, cancellationToken: cancellationToken);
        return Ok(MapLetterhead(item));
    }

    [HttpPatch("settings/official-letterheads/{id:long}/status")]
    [Authorize(Policy = "Permission:official_letterheads.manage")]
    public async Task<ActionResult<OfficialLetterheadTemplateDto>> SetLetterheadStatus(long id, [FromBody] OfficialAssetStatusRequest? request, [FromQuery] bool? isActive, CancellationToken cancellationToken)
    {
        var nextIsActive = request?.IsActive ?? isActive ?? throw new ApiException("حالة القالب مطلوبة");
        var item = await db.OfficialLetterheadTemplates.FirstOrDefaultAsync(x => x.Id == id, cancellationToken)
            ?? throw new ApiException("قالب الترويسة غير موجود", StatusCodes.Status404NotFound);
        item.IsActive = nextIsActive;
        if (!nextIsActive && item.IsDefault)
        {
            item.IsDefault = false;
        }

        await db.SaveChangesAsync(cancellationToken);
        await auditService.LogAsync(nextIsActive ? "official_letterhead_enabled" : "official_letterhead_disabled", "official_letterhead_template", id.ToString(), cancellationToken: cancellationToken);
        return Ok(MapLetterhead(item));
    }

    [HttpPost("settings/official-letterheads/{id:long}/set-default")]
    [Authorize(Policy = "Permission:official_letterheads.manage")]
    public async Task<ActionResult<OfficialLetterheadTemplateDto>> SetDefaultLetterhead(long id, CancellationToken cancellationToken)
    {
        var item = await db.OfficialLetterheadTemplates.FirstOrDefaultAsync(x => x.Id == id && x.IsActive, cancellationToken)
            ?? throw new ApiException("قالب الترويسة غير موجود أو غير مفعل", StatusCodes.Status404NotFound);
        await ClearDefaultLetterheadsAsync(cancellationToken, item.Id);
        item.IsDefault = true;
        var settings = await GetOrCreateSettingsAsync(cancellationToken);
        settings.DefaultLetterheadTemplateId = item.Id;
        settings.UpdatedAt = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync(cancellationToken);
        await auditService.LogAsync("official_letterhead_set_default", "official_letterhead_template", id.ToString(), cancellationToken: cancellationToken);
        return Ok(MapLetterhead(item));
    }

    [HttpPost("settings/official-letterheads/{id:long}/logo")]
    [Authorize(Policy = "Permission:official_letterheads.manage")]
    public async Task<ActionResult<OfficialLetterheadTemplateDto>> UploadLetterheadLogo(long id, IFormFile file, CancellationToken cancellationToken)
    {
        var item = await db.OfficialLetterheadTemplates.FirstOrDefaultAsync(x => x.Id == id, cancellationToken)
            ?? throw new ApiException("قالب الترويسة غير موجود", StatusCodes.Status404NotFound);
        if (file.Length == 0)
        {
            throw new ApiException("ملف الشعار فارغ");
        }

        var extension = Path.GetExtension(file.FileName).TrimStart('.').ToLowerInvariant();
        if (extension is not ("png" or "jpg" or "jpeg"))
        {
            throw new ApiException("يسمح برفع شعار بصيغة PNG أو JPG فقط");
        }

        var uploadsRoot = configuration["Storage:UploadsPath"] ?? "/data/uploads";
        var directory = Path.Combine(uploadsRoot, "official-letterheads", id.ToString());
        Directory.CreateDirectory(directory);
        var storedName = $"logo-{Guid.NewGuid():N}.{extension}";
        var path = Path.Combine(directory, storedName);
        await using (var stream = System.IO.File.Create(path))
        {
            await file.CopyToAsync(stream, cancellationToken);
        }

        item.LogoPath = path;
        item.UpdatedAt = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync(cancellationToken);
        await auditService.LogAsync("official_letterhead_logo_uploaded", "official_letterhead_template", id.ToString(), metadata: new { file.FileName, file.Length }, cancellationToken: cancellationToken);
        return Ok(MapLetterhead(item));
    }

    [HttpPost("settings/official-letterheads/{id:long}/pdf-template")]
    [Authorize(Policy = "Permission:official_letterheads.manage")]
    public async Task<ActionResult<OfficialLetterheadTemplateDto>> UploadLetterheadPdfTemplate(long id, IFormFile file, CancellationToken cancellationToken)
    {
        var item = await db.OfficialLetterheadTemplates.FirstOrDefaultAsync(x => x.Id == id, cancellationToken)
            ?? throw new ApiException("قالب الترويسة غير موجود", StatusCodes.Status404NotFound);
        if (file.Length == 0)
        {
            throw new ApiException("ملف قالب PDF فارغ");
        }

        if (!string.Equals(Path.GetExtension(file.FileName), ".pdf", StringComparison.OrdinalIgnoreCase))
        {
            throw new ApiException("يسمح برفع قالب PDF فقط");
        }

        var uploadsRoot = configuration["Storage:UploadsPath"] ?? "/data/uploads";
        var directory = Path.Combine(uploadsRoot, "official-letterheads", id.ToString());
        Directory.CreateDirectory(directory);
        var path = Path.Combine(directory, $"template-{Guid.NewGuid():N}.pdf");
        await using (var stream = System.IO.File.Create(path))
        {
            await file.CopyToAsync(stream, cancellationToken);
        }

        item.UpdatedAt = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync(cancellationToken);
        await auditService.LogAsync("official_letterhead_pdf_template_uploaded", "official_letterhead_template", id.ToString(), metadata: new { file.FileName, file.Length }, cancellationToken: cancellationToken);
        return Ok(MapLetterhead(item));
    }

    [HttpPost("settings/official-letterheads/{id:long}/preview")]
    [Authorize(Policy = "Permission:settings.view")]
    public async Task<IActionResult> PreviewLetterhead(long id, CancellationToken cancellationToken)
    {
        var template = await db.OfficialLetterheadTemplates.AsNoTracking().FirstOrDefaultAsync(x => x.Id == id && x.IsActive, cancellationToken)
            ?? throw new ApiException("قالب الترويسة غير موجود أو غير مفعل", StatusCodes.Status404NotFound);
        var actor = await LoadCurrentUserAsync(cancellationToken);
        var bytes = OfficialMessagePdfGenerator.Generate(new OfficialPdfRenderModel(
            template.Id,
            "بنك القطيبي الإسلامي",
            "Al-Qutaibi Islamic Bank",
            template.NameAr,
            template.HeaderHtml,
            template.FooterHtml,
            template.PrimaryColor,
            template.SecondaryColor,
            "معاينة قالب الترويسة",
            "هذه معاينة لشكل الخطاب الرسمي داخل النظام.",
            actor.NameAr,
            actor.Department?.NameAr,
            ["مستلم تجريبي"],
            "PREVIEW",
            null,
            "داخلي",
            DateTimeOffset.UtcNow,
            actor.NameAr,
            null,
            null,
            null,
            true,
            true,
            true,
            true,
            template.ShowPageNumber,
            template.ShowConfidentialityLabel));
        await auditService.LogAsync("official_letterhead_previewed", "official_letterhead_template", id.ToString(), cancellationToken: cancellationToken);
        return File(bytes, "application/pdf", "letterhead-preview.pdf");
    }

    [HttpGet("settings/official-messages")]
    public async Task<ActionResult<OfficialMessageSettingsDto>> GetOfficialSettings(CancellationToken cancellationToken)
    {
        var settings = await GetOrCreateSettingsAsync(cancellationToken);
        return Ok(MapSettings(settings));
    }

    [HttpGet("settings/signatures")]
    [Authorize(Policy = "Permission:signatures.manage")]
    public async Task<ActionResult<IReadOnlyCollection<UserSignatureDto>>> GetSignatures(CancellationToken cancellationToken)
    {
        var items = await db.UserSignatures
            .AsNoTracking()
            .Include(x => x.User)
            .OrderByDescending(x => x.UploadedAt)
            .ToListAsync(cancellationToken);
        return Ok(items.Select(MapSignature).ToList());
    }

    [HttpGet("signatures/me")]
    public async Task<ActionResult<IReadOnlyCollection<UserSignatureDto>>> GetMySignatures(CancellationToken cancellationToken)
    {
        var actorId = RequireCurrentUserId();
        var items = await db.UserSignatures
            .AsNoTracking()
            .Include(x => x.User)
            .Where(x => x.UserId == actorId)
            .OrderByDescending(x => x.UploadedAt)
            .ToListAsync(cancellationToken);
        return Ok(items.Select(MapSignature).ToList());
    }

    [HttpPost("signatures/me")]
    public async Task<ActionResult<UserSignatureDto>> UploadMySignature(
        [FromForm(Name = "signature_label")] string? signatureLabel,
        IFormFile file,
        CancellationToken cancellationToken)
    {
        var actorId = RequireCurrentUserId();
        var settings = await GetOrCreateSettingsAsync(cancellationToken);
        var canManageSignatures = await permissionService.HasPermissionAsync(actorId, "signatures.manage", cancellationToken);
        if (!settings.AllowSignatureUploadByUser && !canManageSignatures)
        {
            throw new ApiException("رفع التوقيع غير مفعل من إعدادات المراسلات الرسمية", StatusCodes.Status403Forbidden);
        }

        if (file.Length == 0)
        {
            throw new ApiException("صورة التوقيع فارغة");
        }

        if (file.Length > 5 * 1024 * 1024)
        {
            throw new ApiException("حجم صورة التوقيع يتجاوز 5 MB");
        }

        var extension = Path.GetExtension(file.FileName).TrimStart('.').ToLowerInvariant();
        if (extension is not ("png" or "jpg" or "jpeg"))
        {
            throw new ApiException("يسمح بحفظ التوقيع بصيغة PNG أو JPG فقط");
        }

        if (!await LooksLikeAllowedImageAsync(file, extension, cancellationToken))
        {
            throw new ApiException("ملف التوقيع ليس صورة PNG/JPG صالحة");
        }

        var uploadsRoot = configuration["Storage:UploadsPath"] ?? "/data/uploads";
        var directory = Path.Combine(uploadsRoot, "user-signatures", actorId.ToString());
        Directory.CreateDirectory(directory);
        var storedName = $"signature-{Guid.NewGuid():N}.{extension}";
        var path = Path.Combine(directory, storedName);
        await using (var stream = System.IO.File.Create(path))
        {
            await file.CopyToAsync(stream, cancellationToken);
        }

        var item = new UserSignature
        {
            UserId = actorId,
            SignatureImagePath = path,
            SignatureLabel = string.IsNullOrWhiteSpace(signatureLabel) ? "توقيعي الرسمي" : signatureLabel.Trim(),
            IsActive = true,
            IsVerified = true,
            UploadedAt = DateTimeOffset.UtcNow,
            VerifiedByUserId = actorId,
            VerifiedAt = DateTimeOffset.UtcNow
        };
        db.UserSignatures.Add(item);
        await db.SaveChangesAsync(cancellationToken);
        var saved = await db.UserSignatures.Include(x => x.User).FirstAsync(x => x.Id == item.Id, cancellationToken);
        await auditService.LogAsync("user_signature_uploaded", "user_signature", item.Id.ToString(), metadata: new { item.SignatureLabel, file.Length }, cancellationToken: cancellationToken);
        return Ok(MapSignature(saved));
    }

    [HttpPost("settings/signatures/{id:long}/verify")]
    [Authorize(Policy = "Permission:signatures.manage")]
    public async Task<ActionResult<object>> VerifySignature(long id, CancellationToken cancellationToken)
    {
        var actorId = RequireCurrentUserId();
        var item = await db.UserSignatures.Include(x => x.User).FirstOrDefaultAsync(x => x.Id == id, cancellationToken)
            ?? throw new ApiException("التوقيع غير موجود", StatusCodes.Status404NotFound);
        item.IsVerified = true;
        item.VerifiedByUserId = actorId;
        item.VerifiedAt = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync(cancellationToken);
        await auditService.LogAsync("user_signature_verified", "user_signature", id.ToString(), cancellationToken: cancellationToken);
        return Ok(MapSignature(item));
    }

    [HttpPatch("settings/signatures/{id:long}/status")]
    [Authorize(Policy = "Permission:signatures.manage")]
    public async Task<ActionResult<UserSignatureDto>> SetSignatureStatus(long id, [FromBody] OfficialAssetStatusRequest? request, [FromQuery] bool? isActive, CancellationToken cancellationToken)
    {
        var nextIsActive = request?.IsActive ?? isActive ?? throw new ApiException("حالة التوقيع مطلوبة");
        var item = await db.UserSignatures.Include(x => x.User).FirstOrDefaultAsync(x => x.Id == id, cancellationToken)
            ?? throw new ApiException("التوقيع غير موجود", StatusCodes.Status404NotFound);
        item.IsActive = nextIsActive;
        await db.SaveChangesAsync(cancellationToken);
        await auditService.LogAsync(nextIsActive ? "user_signature_enabled" : "user_signature_disabled", "user_signature", id.ToString(), cancellationToken: cancellationToken);
        return Ok(MapSignature(item));
    }

    [HttpPut("settings/official-messages")]
    [Authorize]
    public async Task<ActionResult<OfficialMessageSettingsDto>> UpdateOfficialSettings(UpdateOfficialMessageSettingsRequest request, CancellationToken cancellationToken)
    {
        var actorId = RequireCurrentUserId();
        var canManageOfficialSettings =
            await permissionService.HasPermissionAsync(actorId, "settings.manage", cancellationToken) ||
            await permissionService.HasPermissionAsync(actorId, "official_letterheads.manage", cancellationToken);
        if (!canManageOfficialSettings)
        {
            throw new ApiException("لا تملك صلاحية تعديل إعدادات المراسلات الرسمية", StatusCodes.Status403Forbidden);
        }

        if (request.DefaultLetterheadTemplateId.HasValue &&
            !await db.OfficialLetterheadTemplates.AnyAsync(x => x.Id == request.DefaultLetterheadTemplateId.Value && x.IsActive, cancellationToken))
        {
            throw new ApiException("قالب الترويسة الافتراضي غير موجود أو غير مفعل");
        }

        var rows = await db.OfficialMessageSettings.OrderBy(x => x.Id).ToListAsync(cancellationToken);
        if (rows.Count == 0)
        {
            rows.Add(await GetOrCreateSettingsAsync(cancellationToken));
        }

        var settings = rows[0];
        var oldValue = MapSettings(settings);
        foreach (var row in rows)
        {
            ApplyOfficialSettings(row, request);
        }

        await db.SaveChangesAsync(cancellationToken);
        await auditService.LogAsync("official_message_settings_updated", "official_message_settings", settings.Id.ToString(), oldValue: oldValue, newValue: MapSettings(settings), cancellationToken: cancellationToken);
        return Ok(MapSettings(settings));
    }

    [HttpPost("messages/official/preview-pdf")]
    public async Task<IActionResult> PreviewOfficialPdf(OfficialPdfPreviewRequest request, CancellationToken cancellationToken)
    {
        var actorId = RequireCurrentUserId();
        var settings = await GetOrCreateSettingsAsync(cancellationToken);
        EnsureOfficialFeatureEnabled(settings);
        if (!settings.AllowPreviewForAllUsers && !await permissionService.HasPermissionAsync(actorId, "official_messages.preview", cancellationToken))
        {
            throw new ApiException("لا تملك صلاحية معاينة الخطاب الرسمي", StatusCodes.Status403Forbidden);
        }

        var model = await BuildRenderModelAsync(request, actorId, cancellationToken);
        var bytes = OfficialMessagePdfGenerator.Generate(model);
        await auditService.LogAsync("official_message_pdf_previewed", "official_message", request.MessageId?.ToString(), metadata: new { model.Subject, request.RelatedRequestId }, cancellationToken: cancellationToken);
        return File(bytes, "application/pdf", "official-message-preview.pdf");
    }

    [HttpPost("messages/{messageId:long}/official/generate-pdf")]
    [Authorize(Policy = "Permission:official_messages.generate")]
    public async Task<ActionResult<OfficialMessageDocumentDto>> GenerateOfficialPdf(long messageId, GenerateOfficialPdfRequest request, CancellationToken cancellationToken)
    {
        var actorId = RequireCurrentUserId();
        var settings = await GetOrCreateSettingsAsync(cancellationToken);
        EnsureOfficialFeatureEnabled(settings);
        var message = await LoadOfficialMessageAsync(messageId, cancellationToken);
        if (!message.IsOfficial)
        {
            throw new ApiException("هذه المراسلة ليست مراسلة رسمية");
        }

        if (message.SenderId != actorId && !await permissionService.HasPermissionAsync(actorId, "messages.manage", cancellationToken))
        {
            throw new ApiException("لا تملك صلاحية توليد الخطاب الرسمي لهذه المراسلة", StatusCodes.Status403Forbidden);
        }

        var previewRequest = new OfficialPdfPreviewRequest(
            message.Id,
            request.LetterheadTemplateId,
            null,
            request.Body,
            null,
            message.RelatedRequestId,
            request.ReferenceNumber,
            request.IncludeSignature,
            request.SignatureId,
            request.ShowSenderDepartment,
            request.ShowRecipients,
            request.ShowGeneratedBy,
            request.ShowGeneratedAt);
        var model = await BuildRenderModelAsync(previewRequest, actorId, cancellationToken);
        var bytes = OfficialMessagePdfGenerator.Generate(model);
        var uploadsRoot = configuration["Storage:UploadsPath"] ?? "/data/uploads";
        var directory = Path.Combine(uploadsRoot, "official-messages", messageId.ToString());
        Directory.CreateDirectory(directory);
        var fileName = $"{Guid.NewGuid():N}.pdf";
        var path = Path.Combine(directory, fileName);
        await System.IO.File.WriteAllBytesAsync(path, bytes, cancellationToken);

        var document = new OfficialMessageDocument
        {
            MessageId = message.Id,
            RelatedRequestId = message.RelatedRequestId,
            LetterheadTemplateId = model.LetterheadTemplateId,
            SignatureId = model.SignatureId,
            ReferenceNumber = request.ReferenceNumber,
            PdfFilePath = path,
            FileSize = bytes.LongLength,
            Checksum = ComputeChecksum(bytes),
            GeneratedByUserId = actorId,
            GeneratedAt = DateTimeOffset.UtcNow
        };
        db.OfficialMessageDocuments.Add(document);
        await db.SaveChangesAsync(cancellationToken);

        message.OfficialReferenceNumber = request.ReferenceNumber;
        message.OfficialPdfDocumentId = document.Id;
        message.OfficialStatus = "sent";
        await db.SaveChangesAsync(cancellationToken);

        await auditService.LogAsync("official_message_pdf_generated", "message", messageId.ToString(), metadata: new { document.Id, document.ReferenceNumber }, cancellationToken: cancellationToken);
        var saved = await db.OfficialMessageDocuments
            .Include(x => x.GeneratedByUser)
            .FirstAsync(x => x.Id == document.Id, cancellationToken);
        return Ok(MapDocument(saved));
    }

    [HttpGet("messages/{messageId:long}/official/pdf/download")]
    [Authorize(Policy = "Permission:official_messages.download")]
    public Task<IActionResult> DownloadOfficialPdf(long messageId, CancellationToken cancellationToken) =>
        ReturnOfficialPdf(messageId, true, cancellationToken);

    [HttpGet("messages/{messageId:long}/official/pdf/preview")]
    public Task<IActionResult> PreviewGeneratedOfficialPdf(long messageId, CancellationToken cancellationToken) =>
        ReturnOfficialPdf(messageId, false, cancellationToken);

    private async Task<OfficialPdfRenderModel> BuildRenderModelAsync(OfficialPdfPreviewRequest request, long actorId, CancellationToken cancellationToken)
    {
        var actor = await LoadCurrentUserAsync(cancellationToken);
        Message? message = null;
        if (request.MessageId.HasValue)
        {
            message = await LoadOfficialMessageAsync(request.MessageId.Value, cancellationToken);
            await EnsureCanReadMessageAsync(message, actorId, cancellationToken);
        }

        if (request.RelatedRequestId.HasValue)
        {
            await EnsureCanViewRequestAsync(request.RelatedRequestId.Value, actorId, cancellationToken);
        }

        var settings = await GetOrCreateSettingsAsync(cancellationToken);
        var template = await ResolveTemplateAsync(request.LetterheadTemplateId ?? settings.DefaultLetterheadTemplateId, cancellationToken);
        var recipientNames = message is not null
            ? message.Recipients.Select(x => x.Recipient?.NameAr ?? x.Recipient?.Email ?? $"#{x.RecipientId}").ToList()
            : await db.Users.AsNoTracking()
                .Where(x => (request.RecipientIds ?? Array.Empty<long>()).Contains(x.Id))
                .Select(x => x.NameAr)
                .ToListAsync(cancellationToken);
        var relatedRequest = message?.RelatedRequest;
        if (relatedRequest is null && request.RelatedRequestId.HasValue)
        {
            relatedRequest = await db.Requests.AsNoTracking().FirstOrDefaultAsync(x => x.Id == request.RelatedRequestId.Value, cancellationToken);
        }
        var signature = request.IncludeSignature
            ? await ResolveSignatureAsync(request.SignatureId, actorId, settings, cancellationToken)
            : null;

        return new OfficialPdfRenderModel(
            template.Id,
            "بنك القطيبي الإسلامي",
            "Al-Qutaibi Islamic Bank",
            template.NameAr,
            template.HeaderHtml,
            template.FooterHtml,
            template.PrimaryColor,
            template.SecondaryColor,
            message?.Subject ?? request.Subject?.Trim() ?? "خطاب رسمي",
            !string.IsNullOrWhiteSpace(request.Body) ? request.Body.Trim() : message?.Body ?? string.Empty,
            message?.Sender?.NameAr ?? actor.NameAr,
            message?.Sender?.Department?.NameAr ?? actor.Department?.NameAr,
            recipientNames,
            request.ReferenceNumber ?? message?.OfficialReferenceNumber,
            relatedRequest?.RequestNumber,
            message?.Classification?.NameAr,
            DateTimeOffset.UtcNow,
            actor.NameAr,
            signature?.Id,
            signature?.SignatureImagePath,
            signature?.SignatureLabel,
            request.ShowSenderDepartment,
            request.ShowRecipients,
            request.ShowGeneratedBy,
            request.ShowGeneratedAt,
            template.ShowPageNumber,
            template.ShowConfidentialityLabel);
    }

    private async Task<IActionResult> ReturnOfficialPdf(long messageId, bool asAttachment, CancellationToken cancellationToken)
    {
        var actorId = RequireCurrentUserId();
        var message = await LoadOfficialMessageAsync(messageId, cancellationToken);
        await EnsureCanReadMessageAsync(message, actorId, cancellationToken);
        var documentId = message.OfficialPdfDocumentId;
        var document = documentId.HasValue
            ? await db.OfficialMessageDocuments.FirstOrDefaultAsync(x => x.Id == documentId.Value, cancellationToken)
            : await db.OfficialMessageDocuments.OrderByDescending(x => x.GeneratedAt).FirstOrDefaultAsync(x => x.MessageId == messageId, cancellationToken);
        if (document is null || !System.IO.File.Exists(document.PdfFilePath))
        {
            throw new ApiException("لم يتم توليد PDF رسمي لهذه المراسلة بعد", StatusCodes.Status404NotFound);
        }

        await auditService.LogAsync(asAttachment ? "official_message_pdf_downloaded" : "official_message_pdf_previewed", "message", messageId.ToString(), metadata: new { document.Id }, cancellationToken: cancellationToken);
        return PhysicalFile(document.PdfFilePath, "application/pdf", asAttachment ? $"official-message-{messageId}.pdf" : null);
    }

    private async Task<Message> LoadOfficialMessageAsync(long messageId, CancellationToken cancellationToken) =>
        await db.Messages
            .Include(x => x.Sender).ThenInclude(x => x!.Department)
            .Include(x => x.MessageType)
            .Include(x => x.Classification)
            .Include(x => x.RelatedRequest)
            .Include(x => x.Recipients).ThenInclude(x => x.Recipient)
            .FirstOrDefaultAsync(x => x.Id == messageId, cancellationToken)
        ?? throw new ApiException("المراسلة غير موجودة", StatusCodes.Status404NotFound);

    private async Task<User> LoadCurrentUserAsync(CancellationToken cancellationToken)
    {
        var actorId = RequireCurrentUserId();
        return await db.Users.Include(x => x.Department).FirstOrDefaultAsync(x => x.Id == actorId, cancellationToken)
            ?? throw new ApiException("المستخدم غير صالح", StatusCodes.Status401Unauthorized);
    }

    private async Task EnsureCanReadMessageAsync(Message message, long actorId, CancellationToken cancellationToken)
    {
        if (message.SenderId == actorId || message.Recipients.Any(x => x.RecipientId == actorId))
        {
            return;
        }

        if (await permissionService.HasPermissionAsync(actorId, "messages.manage", cancellationToken))
        {
            return;
        }

        throw new ApiException("لا تملك صلاحية عرض هذه المراسلة", StatusCodes.Status403Forbidden);
    }

    private async Task EnsureCanViewRequestAsync(long requestId, long actorId, CancellationToken cancellationToken)
    {
        if (await permissionService.HasPermissionAsync(actorId, "requests.manage", cancellationToken))
        {
            if (await db.Requests.AnyAsync(x => x.Id == requestId, cancellationToken))
            {
                return;
            }
        }

        var canView = await db.Requests.AnyAsync(x =>
            x.Id == requestId &&
            (x.RequesterId == actorId || x.AssignedToId == actorId || x.WorkflowSnapshots.Any(s => s.ApproverUserId == actorId || s.ActionByUserId == actorId)),
            cancellationToken);
        if (!canView)
        {
            throw new ApiException("لا تملك صلاحية الوصول إلى الطلب المرتبط", StatusCodes.Status403Forbidden);
        }
    }

    private async Task<OfficialMessageSettings> GetOrCreateSettingsAsync(CancellationToken cancellationToken)
    {
        var settings = await db.OfficialMessageSettings.OrderBy(x => x.Id).FirstOrDefaultAsync(cancellationToken);
        if (settings is not null)
        {
            return settings;
        }

        var defaultTemplate = await db.OfficialLetterheadTemplates.FirstOrDefaultAsync(x => x.IsDefault && x.IsActive, cancellationToken);
        settings = new OfficialMessageSettings
        {
            IsEnabled = true,
            DefaultLetterheadTemplateId = defaultTemplate?.Id,
            IncludeOfficialMessagesInRequestPdf = true,
            AllowPreviewForAllUsers = true,
            AllowUnverifiedSignature = false,
            AllowSignatureUploadByUser = true,
            UpdatedAt = DateTimeOffset.UtcNow
        };
        db.OfficialMessageSettings.Add(settings);
        await db.SaveChangesAsync(cancellationToken);
        return settings;
    }

    private static void ApplyOfficialSettings(OfficialMessageSettings settings, UpdateOfficialMessageSettingsRequest request)
    {
        settings.IsEnabled = request.IsEnabled;
        settings.DefaultLetterheadTemplateId = request.DefaultLetterheadTemplateId;
        settings.OfficialMessageRequiresApproval = request.OfficialMessageRequiresApproval;
        settings.IncludeOfficialMessagesInRequestPdf = request.IncludeOfficialMessagesInRequestPdf;
        settings.AllowPreviewForAllUsers = request.AllowPreviewForAllUsers;
        settings.AllowUnverifiedSignature = request.AllowUnverifiedSignature;
        settings.AllowSignatureUploadByUser = request.AllowSignatureUploadByUser;
        settings.UpdatedAt = DateTimeOffset.UtcNow;
    }

    private async Task<OfficialLetterheadTemplate> ResolveTemplateAsync(long? templateId, CancellationToken cancellationToken)
    {
        var template = templateId.HasValue
            ? await db.OfficialLetterheadTemplates.AsNoTracking().FirstOrDefaultAsync(x => x.Id == templateId.Value && x.IsActive, cancellationToken)
            : await db.OfficialLetterheadTemplates.AsNoTracking().FirstOrDefaultAsync(x => x.IsDefault && x.IsActive, cancellationToken);
        return template ?? throw new ApiException("لا يوجد قالب ترويسة رسمي مفعل");
    }

    private async Task<UserSignature> ResolveSignatureAsync(long? signatureId, long actorId, OfficialMessageSettings settings, CancellationToken cancellationToken)
    {
        if (!signatureId.HasValue)
        {
            throw new ApiException("اختر توقيعاً لإدراجه في الخطاب الرسمي");
        }

        var signature = await db.UserSignatures
            .AsNoTracking()
            .FirstOrDefaultAsync(x => x.Id == signatureId.Value && x.IsActive, cancellationToken)
            ?? throw new ApiException("التوقيع غير موجود أو غير مفعل", StatusCodes.Status404NotFound);
        if (signature.UserId != actorId)
        {
            throw new ApiException("لا يمكنك استخدام توقيع مستخدم آخر", StatusCodes.Status403Forbidden);
        }

        if (!signature.IsVerified && !settings.AllowUnverifiedSignature)
        {
            throw new ApiException("هذا التوقيع غير موثق ولا يمكن استخدامه حالياً", StatusCodes.Status403Forbidden);
        }

        if (!System.IO.File.Exists(signature.SignatureImagePath))
        {
            throw new ApiException("ملف التوقيع غير موجود على التخزين", StatusCodes.Status404NotFound);
        }

        return signature;
    }

    private async Task ClearDefaultLetterheadsAsync(CancellationToken cancellationToken, long? exceptId = null)
    {
        var query = db.OfficialLetterheadTemplates.Where(x => x.IsDefault);
        if (exceptId.HasValue)
        {
            query = query.Where(x => x.Id != exceptId.Value);
        }

        await query.ExecuteUpdateAsync(x => x.SetProperty(t => t.IsDefault, false), cancellationToken);
    }

    private async Task EnsureSettingsHasDefaultAsync(OfficialLetterheadTemplate template, CancellationToken cancellationToken)
    {
        var settings = await GetOrCreateSettingsAsync(cancellationToken);
        if (template.IsDefault || settings.DefaultLetterheadTemplateId is null)
        {
            settings.DefaultLetterheadTemplateId = template.Id;
            settings.UpdatedAt = DateTimeOffset.UtcNow;
            await db.SaveChangesAsync(cancellationToken);
        }
    }

    private static void EnsureOfficialFeatureEnabled(OfficialMessageSettings settings)
    {
        if (!settings.IsEnabled)
        {
            throw new ApiException("خدمة المراسلات الرسمية بترويسة البنك غير مفعلة");
        }
    }

    private long RequireCurrentUserId() =>
        currentUser.UserId ?? throw new ApiException("المستخدم غير مصادق", StatusCodes.Status401Unauthorized);

    private static string NormalizeCode(string? code, string nameAr)
    {
        var raw = string.IsNullOrWhiteSpace(code) ? nameAr : code;
        var normalized = new string(raw.Trim().ToLowerInvariant().Select(ch =>
            char.IsLetterOrDigit(ch) ? ch : '_').ToArray());
        normalized = string.Join('_', normalized.Split('_', StringSplitOptions.RemoveEmptyEntries));
        if (string.IsNullOrWhiteSpace(normalized))
        {
            normalized = $"letterhead_{DateTimeOffset.UtcNow:yyyyMMddHHmmss}";
        }

        return normalized;
    }

    private static async Task<bool> LooksLikeAllowedImageAsync(IFormFile file, string extension, CancellationToken cancellationToken)
    {
        await using var stream = file.OpenReadStream();
        var header = new byte[8];
        var read = await stream.ReadAsync(header.AsMemory(0, header.Length), cancellationToken);

        if (extension == "png")
        {
            return read >= 8 &&
                   header[0] == 0x89 &&
                   header[1] == 0x50 &&
                   header[2] == 0x4E &&
                   header[3] == 0x47 &&
                   header[4] == 0x0D &&
                   header[5] == 0x0A &&
                   header[6] == 0x1A &&
                   header[7] == 0x0A;
        }

        return read >= 3 && header[0] == 0xFF && header[1] == 0xD8 && header[2] == 0xFF;
    }

    private static string ComputeChecksum(byte[] bytes) =>
        Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();

    private static OfficialLetterheadTemplateDto MapLetterhead(OfficialLetterheadTemplate item) =>
        new(item.Id, item.NameAr, item.NameEn, item.Code, item.LogoPath, null, item.HeaderHtml, item.FooterHtml, item.PrimaryColor, item.SecondaryColor, item.ShowPageNumber, item.ShowConfidentialityLabel, item.IsDefault, item.IsActive, item.CreatedAt, item.UpdatedAt);

    private static OfficialMessageSettingsDto MapSettings(OfficialMessageSettings item) =>
        new(item.Id, item.IsEnabled, item.DefaultLetterheadTemplateId, item.OfficialMessageRequiresApproval, item.IncludeOfficialMessagesInRequestPdf, item.AllowPreviewForAllUsers, item.AllowUnverifiedSignature, item.AllowSignatureUploadByUser, item.UpdatedAt);

    private static OfficialMessageDocumentDto MapDocument(OfficialMessageDocument item) =>
        new(item.Id, item.MessageId, item.RelatedRequestId, item.LetterheadTemplateId, item.SignatureId, item.ReferenceNumber, item.FileSize, item.Checksum, item.GeneratedByUserId, item.GeneratedByUser?.NameAr, item.GeneratedAt);

    private static UserSignatureDto MapSignature(UserSignature item) =>
        new(item.Id, item.UserId, item.User?.NameAr, item.SignatureLabel, item.IsVerified, item.IsActive, item.UploadedAt, item.VerifiedByUserId, item.VerifiedAt);
}
