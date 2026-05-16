using System.Security.Cryptography;
using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Qib.ServicePortal.Api.Application.DTOs;
using Qib.ServicePortal.Api.Application.Interfaces;
using Qib.ServicePortal.Api.Application.Services;
using Qib.ServicePortal.Api.Common.Exceptions;
using Qib.ServicePortal.Api.Domain.Entities;
using Qib.ServicePortal.Api.Infrastructure.Data;

namespace Qib.ServicePortal.Api.Controllers;

[ApiController]
[Route("api/dotnet/v1")]
[Authorize(Policy = "Permission:messages.view")]
public class MessagesController(
    ServicePortalDbContext db,
    ICurrentUserService currentUser,
    IPermissionService permissionService,
    IAuditService auditService,
    ISettingsStore settingsStore,
    INotificationRealtimeService realtimeNotifications,
    IConfiguration configuration) : ControllerBase
{
    private static readonly HashSet<string> AllowedPriorities = ["normal", "high", "urgent"];
    private static readonly HashSet<string> BlockedExtensions = ["exe", "bat", "cmd", "ps1", "sh", "js", "vbs", "msi"];
    private static readonly HashSet<string> AllowedExtensions = ["pdf", "png", "jpg", "jpeg", "doc", "docx", "xls", "xlsx"];
    private static readonly HashSet<string> ImageExtensionAliases = ["image", "images", "photo", "photos", "picture", "pictures", "صورة", "صور"];
    private static readonly string[] ImageExtensions = ["png", "jpg", "jpeg", "webp", "heic", "heif"];
    private static readonly HashSet<string> ClarificationTypeCodes = ["clarification", "clarification_request", "request_clarification", "clarification_response", "reply_to_clarification"];
    private static readonly HashSet<string> ExecutionNoteTypeCodes = ["execution_note", "implementation_note", "request_execution_note"];
    private static readonly HashSet<string> CircularTypeCodes = ["circular", "announcement", "broadcast"];
    private static readonly Dictionary<string, object?> MessagingGeneralDefaults = new()
    {
        ["enable_messaging"] = true,
        ["allow_general_messages"] = true,
        ["allow_replies"] = true,
        ["allow_forwarding"] = true,
        ["allow_archiving"] = true,
        ["enable_read_receipts"] = true,
        ["enable_unread_badge"] = true,
        ["allow_multiple_recipients"] = true,
        ["allow_broadcast_messages"] = false,
        ["module_name_ar"] = "المراسلات الداخلية",
        ["module_name_en"] = "Internal Messaging",
        ["default_priority"] = "normal",
        ["max_recipients"] = 100,
        ["enable_templates"] = true
    };
    private static readonly Dictionary<string, object?> MessagingRequestDefaults = new()
    {
        ["allow_link_to_request"] = true,
        ["show_messages_tab_in_request_details"] = true,
        ["allow_send_message_from_request"] = true,
        ["require_request_for_clarification"] = true,
        ["require_request_for_execution_note"] = true,
        ["include_official_messages_in_request_pdf"] = true,
        ["exclude_internal_messages_from_pdf"] = true,
        ["show_message_count_on_request"] = true,
        ["allow_request_owner_to_view_messages"] = false,
        ["allow_approvers_to_view_request_messages"] = true,
        ["show_request_notification_checkbox"] = true,
        ["default_send_request_notification"] = true,
        ["allow_requester_toggle_notification"] = true
    };
    private static readonly Dictionary<string, object?> MessagingRecipientsDefaults = new()
    {
        ["allow_send_to_user"] = true,
        ["allow_send_to_department"] = true,
        ["allow_multiple_recipients"] = true,
        ["allow_broadcast"] = false,
        ["enable_department_broadcasts"] = true,
        ["prevent_sending_to_inactive_users"] = true,
        ["max_recipients"] = 100,
        ["department_recipient_behavior"] = "selected_department_users",
        ["circular_allowed_user_ids"] = Array.Empty<long>()
    };
    private static readonly Dictionary<string, object?> MessagingNotificationDefaults = new()
    {
        ["enable_message_notifications"] = true,
        ["notify_on_new_message"] = true,
        ["notify_on_reply"] = true,
        ["notify_on_read"] = false,
        ["notify_on_clarification_request"] = true,
        ["notify_on_official_message"] = true,
        ["show_unread_count"] = true,
        ["enable_unread_reminder"] = false,
        ["unread_reminder_hours"] = 24
    };
    private static readonly Dictionary<string, object?> MessagingAttachmentDefaults = new()
    {
        ["allow_message_attachments"] = true,
        ["hide_real_file_path"] = true,
        ["log_attachment_downloads"] = true,
        ["enable_virus_scan"] = false,
        ["block_executable_files"] = true,
        ["max_file_size_mb"] = 10,
        ["max_attachments_per_message"] = 5,
        ["message_upload_path"] = "messages",
        ["allowed_extensions_json"] = AllowedExtensions.ToArray()
    };

    [HttpGet("messages/counters")]
    public async Task<ActionResult<object>> Counters(CancellationToken cancellationToken)
    {
        var actorId = RequireCurrentUserId();
        var general = await GetMessagingGeneralSettingsAsync(cancellationToken);
        var notifications = await GetMessagingNotificationSettingsAsync(cancellationToken);
        if (!ToBool(general["enable_unread_badge"]) || !ToBool(notifications["show_unread_count"]))
        {
            return Ok(new { unread = 0, inbox = 0, archived = 0, sent = 0 });
        }

        var unread = await db.MessageRecipients.CountAsync(x => x.RecipientId == actorId && !x.IsRead && !x.IsArchived, cancellationToken);
        var inbox = await db.MessageRecipients.CountAsync(x => x.RecipientId == actorId && !x.IsArchived, cancellationToken);
        var archived = await db.MessageRecipients.CountAsync(x => x.RecipientId == actorId && x.IsArchived, cancellationToken);
        var sent = await db.Messages.CountAsync(x => x.SenderId == actorId, cancellationToken);
        return Ok(new { unread, inbox, archived, sent });
    }

    [HttpGet("messages/users")]
    public async Task<ActionResult<IReadOnlyCollection<object>>> MessageUsers(
        [FromQuery] string? search,
        CancellationToken cancellationToken)
    {
        _ = RequireCurrentUserId();
        var allowSendToUser = await settingsStore.GetValueAsync("messaging.recipients.allow_send_to_user", true, cancellationToken);
        if (!allowSendToUser)
        {
            return Ok(Array.Empty<object>());
        }

        var preventInactive = await settingsStore.GetValueAsync("messaging.recipients.prevent_sending_to_inactive_users", true, cancellationToken);
        var query = db.Users
            .Include(x => x.Role)
            .Include(x => x.Department)
            .AsNoTracking();

        query = preventInactive
            ? query.Where(x => x.IsActive && !x.IsLocked)
            : query.Where(x => !x.IsLocked);

        if (!string.IsNullOrWhiteSpace(search))
        {
            var value = search.Trim().ToLowerInvariant();
            query = query.Where(x =>
                x.NameAr.ToLower().Contains(value) ||
                x.Email.ToLower().Contains(value) ||
                x.Username.ToLower().Contains(value) ||
                (x.NameEn != null && x.NameEn.ToLower().Contains(value)) ||
                (x.EmployeeNumber != null && x.EmployeeNumber.ToLower().Contains(value)));
        }

        var users = await query
            .OrderBy(x => x.NameAr)
            .Take(500)
            .ToListAsync(cancellationToken);

        return Ok(users.Select(MapMessageUser).ToList());
    }

    [HttpGet("messages/settings")]
    public async Task<ActionResult<object>> GetLegacyMessageSettings(CancellationToken cancellationToken)
    {
        var general = await GetMessagingGeneralSettingsAsync(cancellationToken);
        var request = await GetMessagingRequestSettingsAsync(cancellationToken);
        var recipients = await GetMessagingRecipientSettingsAsync(cancellationToken);
        var notifications = await GetMessagingNotificationSettingsAsync(cancellationToken);
        var attachments = await GetAttachmentSettingsAsync(cancellationToken);
        var broadcastEnabled = ToBool(general.GetValueOrDefault("allow_broadcast_messages")) || ToBool(recipients.GetValueOrDefault("allow_broadcast"));

        return Ok(new
        {
            module_name_ar = Convert.ToString(general["module_name_ar"]) ?? "المراسلات الداخلية",
            module_name_en = Convert.ToString(general["module_name_en"]) ?? "Internal Messaging",
            enabled = ToBool(general["enable_messaging"]),
            enable_attachments = attachments.AllowMessageAttachments,
            enable_drafts = false,
            enable_templates = ToBool(general["enable_templates"]),
            allow_archiving = ToBool(general["allow_archiving"]),
            allow_general_messages = ToBool(general["allow_general_messages"]),
            allow_replies = ToBool(general["allow_replies"]),
            allow_forwarding = ToBool(general["allow_forwarding"]),
            allow_multiple_recipients = ToBool(general["allow_multiple_recipients"]),
            allow_user_delete_own_messages = false,
            prevent_hard_delete = true,
            exclude_official_messages_from_delete = true,
            exclude_confidential_messages_from_delete = true,
            allow_send_to_user = ToBool(recipients["allow_send_to_user"]),
            allow_send_to_department = ToBool(recipients["allow_send_to_department"]),
            allow_broadcast = broadcastEnabled,
            enable_circulars = broadcastEnabled,
            enable_department_broadcasts = ToBool(recipients["enable_department_broadcasts"]),
            enable_read_receipts = ToBool(general["enable_read_receipts"]),
            enable_unread_badge = ToBool(general["enable_unread_badge"]),
            enable_linked_requests = ToBool(request["allow_link_to_request"]),
            allow_send_message_from_request = ToBool(request["allow_send_message_from_request"]),
            show_messages_tab_in_request_details = ToBool(request["show_messages_tab_in_request_details"]),
            show_message_count_on_request = ToBool(request["show_message_count_on_request"]),
            require_request_for_clarification = ToBool(request["require_request_for_clarification"]),
            require_request_for_execution_note = ToBool(request["require_request_for_execution_note"]),
            include_official_messages_in_request_pdf = ToBool(request["include_official_messages_in_request_pdf"]),
            exclude_internal_messages_from_pdf = ToBool(request["exclude_internal_messages_from_pdf"]),
            allow_request_owner_to_view_messages = ToBool(request["allow_request_owner_to_view_messages"]),
            allow_approvers_to_view_request_messages = ToBool(request["allow_approvers_to_view_request_messages"]),
            show_request_notification_checkbox = ToBool(request["show_request_notification_checkbox"]),
            default_send_request_notification = ToBool(request["default_send_request_notification"]),
            allow_requester_toggle_notification = ToBool(request["allow_requester_toggle_notification"]),
            enable_message_notifications = ToBool(notifications["enable_message_notifications"]),
            notify_on_new_message = ToBool(notifications["notify_on_new_message"]),
            notify_on_reply = ToBool(notifications["notify_on_reply"]),
            notify_on_read = ToBool(notifications["notify_on_read"]),
            notify_on_clarification_request = ToBool(notifications["notify_on_clarification_request"]),
            notify_on_official_message = ToBool(notifications["notify_on_official_message"]),
            max_attachment_mb = attachments.MaxFileSizeMb,
            max_attachments_per_message = attachments.MaxAttachments,
            max_recipients = ToInt(recipients["max_recipients"]),
            default_priority = Convert.ToString(general["default_priority"]) ?? "normal",
            default_message_type = "internal_message",
            allowed_extensions = attachments.AllowedExtensions,
            block_executable_files = attachments.BlockExecutableFiles,
            department_recipient_behavior = Convert.ToString(recipients["department_recipient_behavior"]) ?? "selected_department_users"
        });
    }

    [HttpGet("messages/capabilities")]
    public async Task<ActionResult<object>> MessageCapabilities(CancellationToken cancellationToken)
    {
        var actorId = RequireCurrentUserId();
        var general = await settingsStore.GetValuesAsync("messaging", "messaging.general", new Dictionary<string, object?>
        {
            ["allow_broadcast_messages"] = false,
            ["enable_templates"] = true
        }, cancellationToken);
        var recipients = await settingsStore.GetValuesAsync("messaging", "messaging.recipients", new Dictionary<string, object?>
        {
            ["allow_send_to_department"] = true,
            ["allow_broadcast"] = false,
            ["enable_department_broadcasts"] = true,
            ["circular_allowed_user_ids"] = Array.Empty<long>()
        }, cancellationToken);
        var broadcastEnabled = ToBool(general.GetValueOrDefault("allow_broadcast_messages")) || ToBool(recipients.GetValueOrDefault("allow_broadcast"));
        var circularAllowedUserIds = ToLongList(recipients.GetValueOrDefault("circular_allowed_user_ids"));
        var canSendCircular = broadcastEnabled && circularAllowedUserIds.Contains(actorId);

        return Ok(new
        {
            can_send_circular = canSendCircular,
            can_send_department_broadcast = canSendCircular && ToBool(recipients.GetValueOrDefault("allow_send_to_department")) && ToBool(recipients.GetValueOrDefault("enable_department_broadcasts")),
            can_use_templates = ToBool(general.GetValueOrDefault("enable_templates"))
        });
    }

    [HttpGet("messages/inbox")]
    public Task<ActionResult<IReadOnlyCollection<MessageListItemDto>>> Inbox(
        [FromQuery] string? search,
        [FromQuery] long? type,
        [FromQuery(Name = "message_type")] string? messageType,
        [FromQuery] string? priority,
        [FromQuery(Name = "sender_id")] long? senderId,
        [FromQuery(Name = "related_request")] string? relatedRequest,
        [FromQuery(Name = "official_only")] bool? officialOnly,
        [FromQuery(Name = "clarification_only")] bool? clarificationOnly,
        [FromQuery(Name = "unread_only")] bool? unreadOnly,
        [FromQuery(Name = "read_status")] string? readStatus,
        [FromQuery(Name = "date_from")] DateTimeOffset? dateFrom,
        [FromQuery(Name = "date_to")] DateTimeOffset? dateTo,
        [FromQuery] int? limit,
        [FromQuery] int? offset,
        CancellationToken cancellationToken) =>
        GetFolder("inbox", search, type, messageType, priority, senderId, relatedRequest, officialOnly, clarificationOnly, unreadOnly, readStatus, dateFrom, dateTo, limit, offset, cancellationToken);

    [HttpGet("messages/sent")]
    public Task<ActionResult<IReadOnlyCollection<MessageListItemDto>>> Sent(
        [FromQuery] string? search,
        [FromQuery] long? type,
        [FromQuery(Name = "message_type")] string? messageType,
        [FromQuery] string? priority,
        [FromQuery(Name = "sender_id")] long? senderId,
        [FromQuery(Name = "related_request")] string? relatedRequest,
        [FromQuery(Name = "official_only")] bool? officialOnly,
        [FromQuery(Name = "clarification_only")] bool? clarificationOnly,
        [FromQuery(Name = "unread_only")] bool? unreadOnly,
        [FromQuery(Name = "read_status")] string? readStatus,
        [FromQuery(Name = "date_from")] DateTimeOffset? dateFrom,
        [FromQuery(Name = "date_to")] DateTimeOffset? dateTo,
        [FromQuery] int? limit,
        [FromQuery] int? offset,
        CancellationToken cancellationToken) =>
        GetFolder("sent", search, type, messageType, priority, senderId, relatedRequest, officialOnly, clarificationOnly, unreadOnly, readStatus, dateFrom, dateTo, limit, offset, cancellationToken);

    [HttpGet("messages/archived")]
    public Task<ActionResult<IReadOnlyCollection<MessageListItemDto>>> Archived(
        [FromQuery] string? search,
        [FromQuery] long? type,
        [FromQuery(Name = "message_type")] string? messageType,
        [FromQuery] string? priority,
        [FromQuery(Name = "sender_id")] long? senderId,
        [FromQuery(Name = "related_request")] string? relatedRequest,
        [FromQuery(Name = "official_only")] bool? officialOnly,
        [FromQuery(Name = "clarification_only")] bool? clarificationOnly,
        [FromQuery(Name = "unread_only")] bool? unreadOnly,
        [FromQuery(Name = "read_status")] string? readStatus,
        [FromQuery(Name = "date_from")] DateTimeOffset? dateFrom,
        [FromQuery(Name = "date_to")] DateTimeOffset? dateTo,
        [FromQuery] int? limit,
        [FromQuery] int? offset,
        CancellationToken cancellationToken) =>
        GetFolder("archived", search, type, messageType, priority, senderId, relatedRequest, officialOnly, clarificationOnly, unreadOnly, readStatus, dateFrom, dateTo, limit, offset, cancellationToken);

    [HttpGet("messages/unread")]
    public Task<ActionResult<IReadOnlyCollection<MessageListItemDto>>> Unread(
        [FromQuery] string? search,
        [FromQuery] long? type,
        [FromQuery(Name = "message_type")] string? messageType,
        [FromQuery] string? priority,
        [FromQuery(Name = "sender_id")] long? senderId,
        [FromQuery(Name = "related_request")] string? relatedRequest,
        [FromQuery(Name = "official_only")] bool? officialOnly,
        [FromQuery(Name = "clarification_only")] bool? clarificationOnly,
        [FromQuery(Name = "date_from")] DateTimeOffset? dateFrom,
        [FromQuery(Name = "date_to")] DateTimeOffset? dateTo,
        [FromQuery] int? limit,
        [FromQuery] int? offset,
        CancellationToken cancellationToken) =>
        GetFolder("unread", search, type, messageType, priority, senderId, relatedRequest, officialOnly, clarificationOnly, true, "unread", dateFrom, dateTo, limit, offset, cancellationToken);

    [HttpGet("messages/request-linked")]
    public Task<ActionResult<IReadOnlyCollection<MessageListItemDto>>> RequestLinked(
        [FromQuery] string? search,
        [FromQuery] long? type,
        [FromQuery(Name = "message_type")] string? messageType,
        [FromQuery] string? priority,
        [FromQuery(Name = "sender_id")] long? senderId,
        [FromQuery(Name = "related_request")] string? relatedRequest,
        [FromQuery(Name = "official_only")] bool? officialOnly,
        [FromQuery(Name = "clarification_only")] bool? clarificationOnly,
        [FromQuery(Name = "unread_only")] bool? unreadOnly,
        [FromQuery(Name = "read_status")] string? readStatus,
        [FromQuery(Name = "date_from")] DateTimeOffset? dateFrom,
        [FromQuery(Name = "date_to")] DateTimeOffset? dateTo,
        [FromQuery] int? limit,
        [FromQuery] int? offset,
        CancellationToken cancellationToken) =>
        GetFolder("request-linked", search, type, messageType, priority, senderId, relatedRequest, officialOnly, clarificationOnly, unreadOnly, readStatus, dateFrom, dateTo, limit, offset, cancellationToken);

    [HttpGet("messages/drafts")]
    public ActionResult<IReadOnlyCollection<MessageListItemDto>> Drafts() => Ok(Array.Empty<MessageListItemDto>());

    [HttpGet("messages/{id:long}")]
    public async Task<ActionResult<MessageDetailsDto>> GetMessage(long id, CancellationToken cancellationToken)
    {
        var actorId = RequireCurrentUserId();
        var message = await LoadMessageQuery()
            .FirstOrDefaultAsync(x => x.Id == id, cancellationToken)
            ?? throw new ApiException("المراسلة غير موجودة", StatusCodes.Status404NotFound);
        await EnsureCanReadMessageAsync(message, actorId, cancellationToken);

        var recipient = message.Recipients.FirstOrDefault(x => x.RecipientId == actorId);
        if (recipient is not null && !recipient.IsRead)
        {
            recipient.IsRead = true;
            recipient.ReadAt = DateTimeOffset.UtcNow;
            await db.SaveChangesAsync(cancellationToken);
            await CreateMessageReadNotificationAsync(message, actorId, cancellationToken);
            await auditService.LogAsync("message_read", "message", id.ToString(), metadata: new { message.Subject }, cancellationToken: cancellationToken);
        }

        return Ok(MapDetails(message, actorId));
    }

    [HttpPost("messages")]
    [Authorize(Policy = "Permission:messages.send")]
    public async Task<ActionResult<MessageDetailsDto>> CreateMessage([FromBody] JsonElement request, CancellationToken cancellationToken)
    {
        var actorId = RequireCurrentUserId();
        var sender = await db.Users.AsNoTracking().FirstOrDefaultAsync(x => x.Id == actorId && x.IsActive && !x.IsLocked, cancellationToken)
            ?? throw new ApiException("المستخدم غير صالح", StatusCodes.Status403Forbidden);
        var type = await ResolveMessageTypeAsync(request, 0, cancellationToken);
        var classificationId = await ResolveClassificationIdAsync(request, null, cancellationToken);
        var relatedRequestId = LongProp(request, "related_request_id", "relatedRequestId");
        var recipientIds = LongArrayProp(request, "recipient_ids", "recipientIds");
        var priority = StringProp(request, "priority")?.Trim() ?? "normal";
        var subject = RequiredString(request, "subject");
        var body = RequiredString(request, "body");
        var includeInRequestPdf = BoolProp(request, false, "include_in_request_pdf", "includeInRequestPdf");

        await EnsureMessagingCanSendAsync(relatedRequestId, cancellationToken);
        await EnsureMessageTypeAllowedAsync(type, actorId, relatedRequestId, cancellationToken);
        ValidatePriority(priority);
        await ValidateClassificationAsync(classificationId, cancellationToken);
        await ValidateRecipientsAsync(recipientIds, cancellationToken);

        if (relatedRequestId.HasValue)
        {
            await EnsureCanViewRequestAsync(relatedRequestId.Value, actorId, cancellationToken);
        }

        var now = DateTimeOffset.UtcNow;
        var message = new Message
        {
            SenderId = sender.Id,
            MessageTypeId = type.Id,
            ClassificationId = classificationId,
            RelatedRequestId = relatedRequestId,
            Subject = subject,
            Body = body,
            Priority = priority,
            IsOfficial = type.IsOfficial,
            IncludeInRequestPdf = type.IsOfficial && includeInRequestPdf && relatedRequestId.HasValue,
            SentAt = now,
            Recipients = recipientIds.Distinct().Select(id => new MessageRecipient
            {
                RecipientId = id,
                IsRead = id == actorId,
                ReadAt = id == actorId ? now : null
            }).ToList()
        };

        db.Messages.Add(message);
        await db.SaveChangesAsync(cancellationToken);
        await CreateMessageNotificationsAsync(message, sender.NameAr, "new", cancellationToken);
        await auditService.LogAsync("message_sent", "message", message.Id.ToString(), newValue: new { message.Subject, message.MessageTypeId, message.RelatedRequestId }, cancellationToken: cancellationToken);

        var created = await LoadMessageQuery().FirstAsync(x => x.Id == message.Id, cancellationToken);
        return CreatedAtAction(nameof(GetMessage), new { id = message.Id }, MapDetails(created, actorId));
    }

    [HttpPost("messages/{id:long}/reply")]
    [Authorize(Policy = "Permission:messages.send")]
    public async Task<ActionResult<MessageDetailsDto>> Reply(long id, ReplyMessageRequest request, CancellationToken cancellationToken)
    {
        var actorId = RequireCurrentUserId();
        var actorName = await db.Users
            .AsNoTracking()
            .Where(x => x.Id == actorId)
            .Select(x => x.NameAr)
            .FirstOrDefaultAsync(cancellationToken) ?? "مستخدم النظام";
        var original = await LoadMessageQuery()
            .FirstOrDefaultAsync(x => x.Id == id, cancellationToken)
            ?? throw new ApiException("المراسلة غير موجودة", StatusCodes.Status404NotFound);
        await EnsureMessagingCanReplyAsync(cancellationToken);
        await EnsureCanReadMessageAsync(original, actorId, cancellationToken);
        if (original.MessageType?.AllowReply == false)
        {
            throw new ApiException("هذا النوع من المراسلات لا يسمح بالرد");
        }

        var recipients = request.RecipientIds?.Where(x => x > 0).Distinct().ToList();
        if (recipients is null || recipients.Count == 0)
        {
            recipients = original.SenderId == actorId
                ? original.Recipients.Select(x => x.RecipientId).Where(x => x != actorId).Distinct().ToList()
                : [original.SenderId];
        }

        await ValidateRecipientsAsync(recipients, cancellationToken);
        var type = await ResolveMessageTypeAsync(request.MessageTypeId, request.MessageType, original.MessageTypeId, cancellationToken);
        await EnsureMessageTypeAllowedAsync(type, actorId, original.RelatedRequestId, cancellationToken);
        var classificationId = await ResolveClassificationIdAsync(request.ClassificationId, request.ClassificationCode, original.ClassificationId, cancellationToken);
        var priority = string.IsNullOrWhiteSpace(request.Priority) ? original.Priority : request.Priority.Trim();
        ValidatePriority(priority);
        var now = DateTimeOffset.UtcNow;
        var reply = new Message
        {
            SenderId = actorId,
            MessageTypeId = type.Id,
            ClassificationId = classificationId,
            ParentMessageId = original.Id,
            RelatedRequestId = original.RelatedRequestId,
            Subject = string.IsNullOrWhiteSpace(request.Subject) ? $"رد: {original.Subject}" : request.Subject.Trim(),
            Body = request.Body.Trim(),
            Priority = priority,
            IsOfficial = type.IsOfficial,
            IncludeInRequestPdf = type.IsOfficial && (request.IncludeInRequestPdf ?? original.IncludeInRequestPdf) && original.RelatedRequestId.HasValue,
            SentAt = now,
            Recipients = recipients.Select(recipientId => new MessageRecipient
            {
                RecipientId = recipientId,
                IsRead = recipientId == actorId,
                ReadAt = recipientId == actorId ? now : null
            }).ToList()
        };

        db.Messages.Add(reply);
        await db.SaveChangesAsync(cancellationToken);
        await CreateMessageNotificationsAsync(reply, actorName, "reply", cancellationToken);
        await auditService.LogAsync("message_replied", "message", reply.Id.ToString(), metadata: new { parentMessageId = id }, cancellationToken: cancellationToken);

        var created = await LoadMessageQuery().FirstAsync(x => x.Id == reply.Id, cancellationToken);
        return CreatedAtAction(nameof(GetMessage), new { id = created.Id }, MapDetails(created, actorId));
    }

    [HttpPost("messages/{id:long}/archive")]
    public async Task<IActionResult> Archive(long id, CancellationToken cancellationToken)
    {
        var allowArchiving = await settingsStore.GetValueAsync("messaging.general.allow_archiving", true, cancellationToken);
        if (!allowArchiving)
        {
            throw new ApiException("أرشفة المراسلات غير مفعلة من إعدادات المراسلات", StatusCodes.Status403Forbidden);
        }

        var actorId = RequireCurrentUserId();
        var recipient = await db.MessageRecipients.FirstOrDefaultAsync(x => x.MessageId == id && x.RecipientId == actorId, cancellationToken)
            ?? throw new ApiException("لا يمكن أرشفة مراسلة لست مستلماً لها", StatusCodes.Status403Forbidden);
        recipient.IsArchived = true;
        recipient.ArchivedAt = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync(cancellationToken);
        await auditService.LogAsync("message_archived", "message", id.ToString(), cancellationToken: cancellationToken);
        return NoContent();
    }

    [HttpPost("messages/{id:long}/restore")]
    public async Task<IActionResult> Restore(long id, CancellationToken cancellationToken)
    {
        var actorId = RequireCurrentUserId();
        var recipient = await db.MessageRecipients.FirstOrDefaultAsync(x => x.MessageId == id && x.RecipientId == actorId, cancellationToken)
            ?? throw new ApiException("المراسلة غير موجودة في صندوقك", StatusCodes.Status404NotFound);
        recipient.IsArchived = false;
        recipient.ArchivedAt = null;
        await db.SaveChangesAsync(cancellationToken);
        await auditService.LogAsync("message_restored", "message", id.ToString(), cancellationToken: cancellationToken);
        return NoContent();
    }

    [HttpPost("messages/{id:long}/delete")]
    public async Task<IActionResult> DeleteOwnMessage(long id, CancellationToken cancellationToken)
    {
        var actorId = RequireCurrentUserId();
        var allowDelete = await settingsStore.GetValueAsync("messaging.retention.allow_user_delete_own_messages", false, cancellationToken);
        if (!allowDelete)
        {
            throw new ApiException("حذف الرسائل غير مفعل من إعدادات الأرشفة والاحتفاظ");
        }

        var preventHardDelete = await settingsStore.GetValueAsync("messaging.retention.prevent_hard_delete", true, cancellationToken);
        var excludeOfficial = await settingsStore.GetValueAsync("messaging.retention.exclude_official_messages_from_delete", true, cancellationToken);
        var excludeConfidential = await settingsStore.GetValueAsync("messaging.retention.exclude_confidential_messages_from_delete", true, cancellationToken);
        var message = await db.Messages
            .Include(x => x.Classification)
            .Include(x => x.Recipients)
            .FirstOrDefaultAsync(x => x.Id == id, cancellationToken)
            ?? throw new ApiException("المراسلة غير موجودة", StatusCodes.Status404NotFound);

        var recipient = message.Recipients.FirstOrDefault(x => x.RecipientId == actorId);
        if (message.SenderId != actorId && recipient is null)
        {
            throw new ApiException("لا تملك صلاحية حذف هذه المراسلة", StatusCodes.Status403Forbidden);
        }

        if (excludeOfficial && message.IsOfficial)
        {
            throw new ApiException("لا يمكن حذف المراسلات الرسمية");
        }

        if (excludeConfidential && string.Equals(message.Classification?.Code, "confidential", StringComparison.OrdinalIgnoreCase))
        {
            throw new ApiException("لا يمكن حذف المراسلات السرية");
        }

        if (preventHardDelete || recipient is not null)
        {
            recipient ??= new MessageRecipient { MessageId = id, RecipientId = actorId };
            recipient.IsArchived = true;
            recipient.ArchivedAt = DateTimeOffset.UtcNow;
            if (recipient.Id == 0)
            {
                db.MessageRecipients.Add(recipient);
            }
        }
        else
        {
            db.Messages.Remove(message);
        }

        await db.SaveChangesAsync(cancellationToken);
        await auditService.LogAsync("message_deleted", "message", id.ToString(), metadata: new { soft_delete = preventHardDelete || recipient is not null }, cancellationToken: cancellationToken);
        return NoContent();
    }

    [HttpPost("messages/bulk/archive")]
    public async Task<IActionResult> BulkArchive([FromBody] JsonElement request, CancellationToken cancellationToken)
    {
        var allowArchiving = await settingsStore.GetValueAsync("messaging.general.allow_archiving", true, cancellationToken);
        if (!allowArchiving)
        {
            throw new ApiException("أرشفة المراسلات غير مفعلة من إعدادات المراسلات", StatusCodes.Status403Forbidden);
        }

        var actorId = RequireCurrentUserId();
        var ids = LongArrayProp(request, "message_ids", "messageIds");
        if (ids.Count == 0)
        {
            return NoContent();
        }

        var recipients = await db.MessageRecipients
            .Where(x => ids.Contains(x.MessageId) && x.RecipientId == actorId)
            .ToListAsync(cancellationToken);
        foreach (var recipient in recipients)
        {
            recipient.IsArchived = true;
            recipient.ArchivedAt = DateTimeOffset.UtcNow;
        }

        await db.SaveChangesAsync(cancellationToken);
        await auditService.LogAsync("messages_bulk_archived", "message", metadata: new { message_ids = ids }, cancellationToken: cancellationToken);
        return NoContent();
    }

    [HttpPost("messages/bulk/read")]
    public async Task<IActionResult> BulkMarkRead([FromBody] JsonElement request, CancellationToken cancellationToken)
    {
        var actorId = RequireCurrentUserId();
        var ids = LongArrayProp(request, "message_ids", "messageIds");
        if (ids.Count == 0)
        {
            return NoContent();
        }

        var recipients = await db.MessageRecipients
            .Where(x => ids.Contains(x.MessageId) && x.RecipientId == actorId)
            .ToListAsync(cancellationToken);
        foreach (var recipient in recipients)
        {
            recipient.IsRead = true;
            recipient.ReadAt ??= DateTimeOffset.UtcNow;
        }

        await db.SaveChangesAsync(cancellationToken);
        await auditService.LogAsync("messages_bulk_marked_read", "message", metadata: new { message_ids = ids }, cancellationToken: cancellationToken);
        return NoContent();
    }

    [HttpPost("messages/bulk/delete")]
    public async Task<IActionResult> BulkDelete([FromBody] JsonElement request, CancellationToken cancellationToken)
    {
        var preventHardDelete = await settingsStore.GetValueAsync("messaging.retention.prevent_hard_delete", true, cancellationToken);
        var actorId = RequireCurrentUserId();
        var ids = LongArrayProp(request, "message_ids", "messageIds");
        if (ids.Count == 0)
        {
            return NoContent();
        }

        if (preventHardDelete || !await permissionService.HasPermissionAsync(actorId, "messages.manage", cancellationToken))
        {
            var recipients = await db.MessageRecipients
                .Where(x => ids.Contains(x.MessageId) && x.RecipientId == actorId)
                .ToListAsync(cancellationToken);
            foreach (var recipient in recipients)
            {
                recipient.IsArchived = true;
                recipient.ArchivedAt = DateTimeOffset.UtcNow;
            }
        }
        else
        {
            var messages = await db.Messages
                .Include(x => x.Recipients)
                .Where(x => ids.Contains(x.Id) && x.SenderId == actorId)
                .ToListAsync(cancellationToken);
            db.Messages.RemoveRange(messages);
        }

        await db.SaveChangesAsync(cancellationToken);
        await auditService.LogAsync("messages_bulk_deleted", "message", metadata: new { message_ids = ids, soft_delete = preventHardDelete }, cancellationToken: cancellationToken);
        return NoContent();
    }

    [HttpPost("messages/{id:long}/forward")]
    [Authorize(Policy = "Permission:messages.send")]
    public async Task<ActionResult<MessageDetailsDto>> Forward(long id, [FromBody] JsonElement request, CancellationToken cancellationToken)
    {
        await EnsureMessagingEnabledAsync(cancellationToken);
        var allowForwarding = await settingsStore.GetValueAsync("messaging.general.allow_forwarding", true, cancellationToken);
        if (!allowForwarding)
        {
            throw new ApiException("تحويل الرسائل معطل من إعدادات المراسلات");
        }

        var actorId = RequireCurrentUserId();
        var actorName = await db.Users
            .AsNoTracking()
            .Where(x => x.Id == actorId)
            .Select(x => x.NameAr)
            .FirstOrDefaultAsync(cancellationToken) ?? "مستخدم النظام";
        var original = await LoadMessageQuery()
            .FirstOrDefaultAsync(x => x.Id == id, cancellationToken)
            ?? throw new ApiException("المراسلة غير موجودة", StatusCodes.Status404NotFound);
        await EnsureCanReadMessageAsync(original, actorId, cancellationToken);

        var recipientIds = LongArrayProp(request, "recipient_ids", "recipientIds");
        await ValidateRecipientsAsync(recipientIds, cancellationToken);

        var type = await ResolveMessageTypeAsync(request, original.MessageTypeId, cancellationToken);
        await EnsureMessageTypeAllowedAsync(type, actorId, original.RelatedRequestId, cancellationToken);
        var classificationId = await ResolveClassificationIdAsync(request, original.ClassificationId, cancellationToken);
        var priority = StringProp(request, "priority")?.Trim() ?? original.Priority;
        ValidatePriority(priority);
        var note = StringProp(request, "note", "body")?.Trim();
        var forwardedBody = string.IsNullOrWhiteSpace(note)
            ? original.Body
            : $"{note}\n\n----- الرسالة الأصلية -----\n{original.Body}";
        var now = DateTimeOffset.UtcNow;
        var message = new Message
        {
            SenderId = actorId,
            MessageTypeId = type.Id,
            ClassificationId = classificationId,
            ParentMessageId = original.Id,
            RelatedRequestId = original.RelatedRequestId,
            Subject = $"تحويل: {original.Subject}",
            Body = forwardedBody,
            Priority = priority,
            IsOfficial = type.IsOfficial,
            IncludeInRequestPdf = type.IsOfficial && original.IncludeInRequestPdf && original.RelatedRequestId.HasValue,
            SentAt = now,
            Recipients = recipientIds.Select(recipientId => new MessageRecipient
            {
                RecipientId = recipientId,
                IsRead = recipientId == actorId,
                ReadAt = recipientId == actorId ? now : null
            }).ToList()
        };

        db.Messages.Add(message);
        await db.SaveChangesAsync(cancellationToken);
        await CreateMessageNotificationsAsync(message, actorName, "new", cancellationToken);
        await auditService.LogAsync("message_forwarded", "message", message.Id.ToString(), metadata: new { original_message_id = id }, cancellationToken: cancellationToken);

        var created = await LoadMessageQuery().FirstAsync(x => x.Id == message.Id, cancellationToken);
        return CreatedAtAction(nameof(GetMessage), new { id = created.Id }, MapDetails(created, actorId));
    }

    [HttpPost("messages/{id:long}/mark-read")]
    public Task<IActionResult> MarkRead(long id, CancellationToken cancellationToken) => SetReadStatus(id, true, cancellationToken);

    [HttpPost("messages/{id:long}/read")]
    public Task<IActionResult> Read(long id, CancellationToken cancellationToken) => SetReadStatus(id, true, cancellationToken);

    [HttpPost("messages/{id:long}/mark-unread")]
    public Task<IActionResult> MarkUnread(long id, CancellationToken cancellationToken) => SetReadStatus(id, false, cancellationToken);

    [HttpPost("messages/{id:long}/unread")]
    public Task<IActionResult> Unread(long id, CancellationToken cancellationToken) => SetReadStatus(id, false, cancellationToken);

    [HttpPost("messages/{id:long}/attachments")]
    [Authorize(Policy = "Permission:messages.send")]
    public async Task<ActionResult<MessageAttachmentDto>> UploadAttachment(long id, IFormFile file, CancellationToken cancellationToken)
    {
        var actorId = RequireCurrentUserId();
        var message = await LoadMessageQuery().FirstOrDefaultAsync(x => x.Id == id, cancellationToken)
            ?? throw new ApiException("المراسلة غير موجودة", StatusCodes.Status404NotFound);
        if (message.SenderId != actorId && !await permissionService.HasPermissionAsync(actorId, "messages.manage", cancellationToken))
        {
            throw new ApiException("لا تملك صلاحية إرفاق ملف بهذه المراسلة", StatusCodes.Status403Forbidden);
        }

        if (file.Length == 0)
        {
            throw new ApiException("الملف فارغ");
        }

        var settings = await GetAttachmentSettingsAsync(cancellationToken);
        if (!settings.AllowMessageAttachments)
        {
            throw new ApiException("إرفاق الملفات في المراسلات غير مفعل من إعدادات المراسلات");
        }

        if (settings.EnableVirusScan)
        {
            throw new ApiException("فحص الفيروسات مفعل لكن خدمة الفحص غير مهيأة في Backend .NET المستقل");
        }

        if (file.Length > settings.MaxFileSizeMb * 1024L * 1024L)
        {
            throw new ApiException($"حجم الملف يتجاوز الحد الأقصى للمراسلات وهو {settings.MaxFileSizeMb} MB");
        }

        var extension = Path.GetExtension(file.FileName).TrimStart('.').ToLowerInvariant();
        var allowedExtensions = ExpandConfiguredExtensions(settings.AllowedExtensions);
        if (string.IsNullOrWhiteSpace(extension) || settings.BlockedExtensions.Contains(extension) || !allowedExtensions.Contains(extension))
        {
            throw new ApiException($"نوع الملف غير مسموح. الامتدادات المسموحة: {string.Join(", ", allowedExtensions)}");
        }

        if (message.Attachments.Count(x => !x.IsDeleted) >= settings.MaxAttachments)
        {
            throw new ApiException($"لا يمكن تجاوز عدد المرفقات المسموح وهو {settings.MaxAttachments}");
        }

        var uploadsRoot = configuration["Storage:UploadsPath"] ?? "/data/uploads";
        var directory = Path.Combine(uploadsRoot, settings.MessageUploadPath, id.ToString());
        Directory.CreateDirectory(directory);
        var storedName = $"{Guid.NewGuid():N}.{extension}";
        var path = Path.Combine(directory, storedName);

        await using (var stream = System.IO.File.Create(path))
        {
            await file.CopyToAsync(stream, cancellationToken);
        }

        var checksum = await ComputeChecksumAsync(path, cancellationToken);
        var attachment = new MessageAttachment
        {
            MessageId = id,
            FileName = Path.GetFileName(file.FileName),
            StoredFileName = storedName,
            StoragePath = path,
            ContentType = string.IsNullOrWhiteSpace(file.ContentType) ? "application/octet-stream" : file.ContentType,
            FileSize = file.Length,
            Checksum = checksum,
            UploadedByUserId = actorId,
            UploadedAt = DateTimeOffset.UtcNow
        };
        db.MessageAttachments.Add(attachment);
        await db.SaveChangesAsync(cancellationToken);
        await auditService.LogAsync("message_attachment_uploaded", "message", id.ToString(), metadata: new { attachment.FileName, attachment.FileSize }, cancellationToken: cancellationToken);

        var saved = await db.MessageAttachments
            .Include(x => x.UploadedByUser)
            .FirstAsync(x => x.Id == attachment.Id, cancellationToken);
        return Ok(MapAttachment(saved));
    }

    [HttpGet("messages/{messageId:long}/attachments/{attachmentId:long}/download")]
    public async Task<IActionResult> DownloadAttachment(long messageId, long attachmentId, CancellationToken cancellationToken)
    {
        var actorId = RequireCurrentUserId();
        var message = await LoadMessageQuery().FirstOrDefaultAsync(x => x.Id == messageId, cancellationToken)
            ?? throw new ApiException("المراسلة غير موجودة", StatusCodes.Status404NotFound);
        await EnsureCanReadMessageAsync(message, actorId, cancellationToken);
        var attachment = message.Attachments.FirstOrDefault(x => x.Id == attachmentId && !x.IsDeleted)
            ?? throw new ApiException("المرفق غير موجود", StatusCodes.Status404NotFound);
        if (!System.IO.File.Exists(attachment.StoragePath))
        {
            throw new ApiException("ملف المرفق غير موجود على التخزين", StatusCodes.Status404NotFound);
        }

        await auditService.LogAsync("message_attachment_downloaded", "message", messageId.ToString(), metadata: new { attachmentId }, cancellationToken: cancellationToken);
        return PhysicalFile(attachment.StoragePath, attachment.ContentType, attachment.FileName);
    }

    [HttpGet("requests/{requestId:long}/messages")]
    public async Task<ActionResult<IReadOnlyCollection<MessageListItemDto>>> RequestMessages(long requestId, CancellationToken cancellationToken)
    {
        var actorId = RequireCurrentUserId();
        var requestSettings = await GetMessagingRequestSettingsAsync(cancellationToken);
        if (!ToBool(requestSettings["allow_link_to_request"]) || !ToBool(requestSettings["show_messages_tab_in_request_details"]))
        {
            return Ok(Array.Empty<MessageListItemDto>());
        }

        await EnsureCanViewRequestAsync(requestId, actorId, cancellationToken);
        var canManageMessages = await permissionService.HasPermissionAsync(actorId, "messages.manage", cancellationToken);
        var allowOwnerToView = ToBool(requestSettings["allow_request_owner_to_view_messages"]);
        var allowApproversToView = ToBool(requestSettings["allow_approvers_to_view_request_messages"]);
        var canViewLinkedMessages = canManageMessages ||
                                    await CanViewLinkedRequestMessagesAsync(requestId, actorId, allowOwnerToView, allowApproversToView, cancellationToken);
        var messages = await BaseMessageQuery()
            .Where(x => x.RelatedRequestId == requestId)
            .Where(x => canViewLinkedMessages || x.SenderId == actorId || x.Recipients.Any(r => r.RecipientId == actorId))
            .OrderByDescending(x => x.SentAt)
            .ToListAsync(cancellationToken);
        return Ok(messages.Select(x => MapListItem(x, actorId)).ToList());
    }

    [HttpGet("settings/messaging/message-types")]
    public async Task<ActionResult<IReadOnlyCollection<object>>> GetMessageTypes(CancellationToken cancellationToken)
    {
        var items = await db.MessageTypes.AsNoTracking().OrderBy(x => x.SortOrder).ThenBy(x => x.Id).ToListAsync(cancellationToken);
        return Ok(items.Select(MapType).ToList());
    }

    [HttpGet("messages/types")]
    public async Task<ActionResult<IReadOnlyCollection<object>>> GetActiveMessageTypes(CancellationToken cancellationToken)
    {
        var items = await db.MessageTypes
            .AsNoTracking()
            .Where(x => x.IsActive)
            .OrderBy(x => x.SortOrder)
            .ThenBy(x => x.Id)
            .ToListAsync(cancellationToken);
        return Ok(items.Select(MapType).ToList());
    }

    [HttpPost("settings/messaging/message-types")]
    [Authorize(Policy = "Permission:settings.manage")]
    public async Task<ActionResult<object>> CreateMessageType([FromBody] JsonElement request, CancellationToken cancellationToken)
    {
        var code = NormalizeCode(RequiredString(request, "code"));
        if (await db.MessageTypes.AnyAsync(x => x.Code == code, cancellationToken))
        {
            throw new ApiException("رمز نوع الرسالة مستخدم مسبقاً", StatusCodes.Status409Conflict);
        }

        var item = new MessageType { Code = code };
        ApplyMessageTypePayload(item, request);
        db.MessageTypes.Add(item);
        await db.SaveChangesAsync(cancellationToken);
        await auditService.LogAsync("message_type_created", "messaging_settings", item.Id.ToString(), newValue: MapType(item), cancellationToken: cancellationToken);
        return Created($"settings/messaging/message-types/{item.Id}", MapType(item));
    }

    [HttpPut("settings/messaging/message-types/{id:long}")]
    [Authorize(Policy = "Permission:settings.manage")]
    public async Task<ActionResult<object>> UpdateMessageType(long id, [FromBody] JsonElement request, CancellationToken cancellationToken)
    {
        var item = await db.MessageTypes.FirstOrDefaultAsync(x => x.Id == id, cancellationToken)
                   ?? throw new ApiException("نوع الرسالة غير موجود", StatusCodes.Status404NotFound);
        var oldValue = MapType(item);
        ApplyMessageTypePayload(item, request);
        await db.SaveChangesAsync(cancellationToken);
        await auditService.LogAsync("message_type_updated", "messaging_settings", item.Id.ToString(), oldValue: oldValue, newValue: MapType(item), cancellationToken: cancellationToken);
        return Ok(MapType(item));
    }

    [HttpPatch("settings/messaging/message-types/{id:long}/status")]
    [Authorize(Policy = "Permission:settings.manage")]
    public async Task<ActionResult<object>> UpdateMessageTypeStatus(long id, [FromBody] JsonElement request, CancellationToken cancellationToken)
    {
        var item = await db.MessageTypes.FirstOrDefaultAsync(x => x.Id == id, cancellationToken)
                   ?? throw new ApiException("نوع الرسالة غير موجود", StatusCodes.Status404NotFound);
        var oldValue = MapType(item);
        item.IsActive = BoolProp(request, item.IsActive, "is_active", "isActive");
        await db.SaveChangesAsync(cancellationToken);
        await auditService.LogAsync(item.IsActive ? "message_type_enabled" : "message_type_disabled", "messaging_settings", item.Id.ToString(), oldValue: oldValue, newValue: MapType(item), cancellationToken: cancellationToken);
        return Ok(MapType(item));
    }

    [HttpDelete("settings/messaging/message-types/{id:long}")]
    [Authorize(Policy = "Permission:settings.manage")]
    public async Task<ActionResult<object>> DeleteMessageType(long id, CancellationToken cancellationToken)
    {
        var item = await db.MessageTypes.FirstOrDefaultAsync(x => x.Id == id, cancellationToken)
                   ?? throw new ApiException("نوع الرسالة غير موجود", StatusCodes.Status404NotFound);
        var oldValue = MapType(item);
        var used = await db.Messages.AnyAsync(x => x.MessageTypeId == id, cancellationToken)
                   || await db.MessageTemplates.AnyAsync(x => x.MessageTypeId == id, cancellationToken);
        if (used)
        {
            item.IsActive = false;
            await db.SaveChangesAsync(cancellationToken);
            await auditService.LogAsync("message_type_disabled", "messaging_settings", id.ToString(), oldValue: oldValue, newValue: MapType(item), cancellationToken: cancellationToken);
            return Ok(new { disabled = true, item = MapType(item) });
        }

        db.MessageTypes.Remove(item);
        await db.SaveChangesAsync(cancellationToken);
        await auditService.LogAsync("message_type_deleted", "messaging_settings", id.ToString(), oldValue: oldValue, cancellationToken: cancellationToken);
        return Ok(new { deleted = true });
    }

    [HttpGet("settings/messaging/classifications")]
    public async Task<ActionResult<IReadOnlyCollection<object>>> GetClassifications(CancellationToken cancellationToken)
    {
        var items = await db.MessageClassifications.AsNoTracking().OrderBy(x => x.SortOrder).ThenBy(x => x.Id).ToListAsync(cancellationToken);
        return Ok(items.Select(MapClassification).ToList());
    }

    [HttpGet("messages/classifications")]
    public async Task<ActionResult<IReadOnlyCollection<object>>> GetActiveClassifications(CancellationToken cancellationToken)
    {
        var items = await db.MessageClassifications
            .AsNoTracking()
            .Where(x => x.IsActive)
            .OrderBy(x => x.SortOrder)
            .ThenBy(x => x.Id)
            .ToListAsync(cancellationToken);
        return Ok(items.Select(MapClassification).ToList());
    }

    [HttpPost("settings/messaging/classifications")]
    [Authorize(Policy = "Permission:settings.manage")]
    public async Task<ActionResult<object>> CreateClassification([FromBody] JsonElement request, CancellationToken cancellationToken)
    {
        var code = NormalizeCode(RequiredString(request, "code"));
        if (await db.MessageClassifications.AnyAsync(x => x.Code == code, cancellationToken))
        {
            throw new ApiException("رمز تصنيف السرية مستخدم مسبقاً", StatusCodes.Status409Conflict);
        }

        var item = new MessageClassification { Code = code };
        ApplyClassificationPayload(item, request);
        db.MessageClassifications.Add(item);
        await db.SaveChangesAsync(cancellationToken);
        await auditService.LogAsync("message_classification_created", "messaging_settings", item.Id.ToString(), newValue: MapClassification(item), cancellationToken: cancellationToken);
        return Created($"settings/messaging/classifications/{item.Id}", MapClassification(item));
    }

    [HttpPut("settings/messaging/classifications/{id:long}")]
    [Authorize(Policy = "Permission:settings.manage")]
    public async Task<ActionResult<object>> UpdateClassification(long id, [FromBody] JsonElement request, CancellationToken cancellationToken)
    {
        var item = await db.MessageClassifications.FirstOrDefaultAsync(x => x.Id == id, cancellationToken)
                   ?? throw new ApiException("تصنيف السرية غير موجود", StatusCodes.Status404NotFound);
        var oldValue = MapClassification(item);
        ApplyClassificationPayload(item, request);
        await db.SaveChangesAsync(cancellationToken);
        await auditService.LogAsync("message_classification_updated", "messaging_settings", item.Id.ToString(), oldValue: oldValue, newValue: MapClassification(item), cancellationToken: cancellationToken);
        return Ok(MapClassification(item));
    }

    [HttpDelete("settings/messaging/classifications/{id:long}")]
    [Authorize(Policy = "Permission:settings.manage")]
    public async Task<ActionResult<object>> DeleteClassification(long id, CancellationToken cancellationToken)
    {
        var item = await db.MessageClassifications.FirstOrDefaultAsync(x => x.Id == id, cancellationToken)
                   ?? throw new ApiException("تصنيف السرية غير موجود", StatusCodes.Status404NotFound);
        var oldValue = MapClassification(item);
        if (await db.Messages.AnyAsync(x => x.ClassificationId == id, cancellationToken))
        {
            item.IsActive = false;
            await db.SaveChangesAsync(cancellationToken);
            await auditService.LogAsync("message_classification_disabled", "messaging_settings", id.ToString(), oldValue: oldValue, newValue: MapClassification(item), cancellationToken: cancellationToken);
            return Ok(new { disabled = true, item = MapClassification(item) });
        }

        db.MessageClassifications.Remove(item);
        await db.SaveChangesAsync(cancellationToken);
        await auditService.LogAsync("message_classification_deleted", "messaging_settings", id.ToString(), oldValue: oldValue, cancellationToken: cancellationToken);
        return Ok(new { deleted = true });
    }

    [HttpGet("settings/messaging/templates")]
    [HttpGet("messages/templates")]
    public async Task<ActionResult<IReadOnlyCollection<object>>> GetTemplates(CancellationToken cancellationToken)
    {
        var items = await db.MessageTemplates
            .AsNoTracking()
            .Include(x => x.MessageType)
            .OrderBy(x => x.SortOrder)
            .ThenBy(x => x.Id)
            .ToListAsync(cancellationToken);
        return Ok(items.Select(MapTemplate).ToList());
    }

    [HttpPost("settings/messaging/templates")]
    [Authorize(Policy = "Permission:settings.manage")]
    public async Task<ActionResult<object>> CreateTemplate([FromBody] JsonElement request, CancellationToken cancellationToken)
    {
        var code = NormalizeCode(StringProp(request, "code") ?? $"template_{DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()}");
        if (await db.MessageTemplates.AnyAsync(x => x.Code == code, cancellationToken))
        {
            throw new ApiException("رمز قالب الرسالة مستخدم مسبقاً", StatusCodes.Status409Conflict);
        }

        var item = new MessageTemplate { Code = code };
        await ApplyTemplatePayloadAsync(item, request, cancellationToken);
        db.MessageTemplates.Add(item);
        await db.SaveChangesAsync(cancellationToken);
        var saved = await db.MessageTemplates.Include(x => x.MessageType).FirstAsync(x => x.Id == item.Id, cancellationToken);
        await auditService.LogAsync("message_template_created", "messaging_settings", item.Id.ToString(), newValue: MapTemplate(saved), cancellationToken: cancellationToken);
        return Created($"settings/messaging/templates/{item.Id}", MapTemplate(saved));
    }

    [HttpPut("settings/messaging/templates/{id:long}")]
    [Authorize(Policy = "Permission:settings.manage")]
    public async Task<ActionResult<object>> UpdateTemplate(long id, [FromBody] JsonElement request, CancellationToken cancellationToken)
    {
        var item = await db.MessageTemplates.Include(x => x.MessageType).FirstOrDefaultAsync(x => x.Id == id, cancellationToken)
                   ?? throw new ApiException("قالب الرسالة غير موجود", StatusCodes.Status404NotFound);
        var oldValue = MapTemplate(item);
        await ApplyTemplatePayloadAsync(item, request, cancellationToken);
        await db.SaveChangesAsync(cancellationToken);
        var saved = await db.MessageTemplates.Include(x => x.MessageType).FirstAsync(x => x.Id == item.Id, cancellationToken);
        await auditService.LogAsync("message_template_updated", "messaging_settings", item.Id.ToString(), oldValue: oldValue, newValue: MapTemplate(saved), cancellationToken: cancellationToken);
        return Ok(MapTemplate(saved));
    }

    [HttpDelete("settings/messaging/templates/{id:long}")]
    [Authorize(Policy = "Permission:settings.manage")]
    public async Task<ActionResult<object>> DeleteTemplate(long id, CancellationToken cancellationToken)
    {
        var item = await db.MessageTemplates.Include(x => x.MessageType).FirstOrDefaultAsync(x => x.Id == id, cancellationToken)
                   ?? throw new ApiException("قالب الرسالة غير موجود", StatusCodes.Status404NotFound);
        var oldValue = MapTemplate(item);
        db.MessageTemplates.Remove(item);
        await db.SaveChangesAsync(cancellationToken);
        await auditService.LogAsync("message_template_deleted", "messaging_settings", id.ToString(), oldValue: oldValue, cancellationToken: cancellationToken);
        return Ok(new { deleted = true });
    }

    [HttpPost("settings/messaging/templates/{id:long}/preview")]
    [Authorize(Policy = "Permission:settings.view")]
    public async Task<ActionResult<object>> PreviewTemplate(long id, [FromBody] JsonElement request, CancellationToken cancellationToken)
    {
        var item = await db.MessageTemplates.AsNoTracking().FirstOrDefaultAsync(x => x.Id == id, cancellationToken)
                   ?? throw new ApiException("قالب الرسالة غير موجود", StatusCodes.Status404NotFound);
        var values = request.TryGetProperty("sample_data", out var sampleData) && sampleData.ValueKind == JsonValueKind.Object
            ? sampleData.EnumerateObject().ToDictionary(x => x.Name, x => x.Value.ToString())
            : new Dictionary<string, string>();
        return Ok(new
        {
            subject = RenderTemplate(item.SubjectTemplate, values),
            body = RenderTemplate(item.BodyTemplate, values)
        });
    }

    [HttpGet("settings/messaging/attachments")]
    public async Task<ActionResult<MessagingAttachmentSettingsDto>> GetMessagingAttachmentSettings(CancellationToken cancellationToken) =>
        Ok(await GetAttachmentSettingsAsync(cancellationToken));

    [HttpPut("settings/messaging/attachments")]
    [Authorize(Policy = "Permission:settings.manage")]
    public async Task<ActionResult<MessagingAttachmentSettingsDto>> UpdateMessagingAttachmentSettings(
        Dictionary<string, JsonElement> request,
        CancellationToken cancellationToken)
    {
        var item = await FirstOrCreateAsync(db.MessageAttachmentSettings, () => new MessageAttachmentSettings(), cancellationToken);
        var current = ReadAttachmentSettingsValues(item);
        var values = new Dictionary<string, object?>(current, StringComparer.OrdinalIgnoreCase);
        foreach (var (key, value) in request)
        {
            if (MessagingAttachmentDefaults.ContainsKey(key))
            {
                values[key] = SystemSettingsStore.ConvertJsonElement(value);
            }
        }

        var allowed = SanitizeExtensions(ToStringList(values["allowed_extensions_json"]));
        values["allowed_extensions_json"] = allowed;
        var maxFileSizeMb = ToInt(values["max_file_size_mb"]);
        var maxAttachments = ToInt(values["max_attachments_per_message"]);
        if (maxFileSizeMb < 1 || maxAttachments < 1)
        {
            throw new ApiException("إعدادات المرفقات غير صالحة");
        }

        var globalMaxFileSizeMb = await settingsStore.GetValueAsync("attachments.max_file_size_mb", 10, cancellationToken);
        var globalHardLimit = await settingsStore.GetValueAsync("attachments.is_hard_limit", true, cancellationToken);
        if (globalHardLimit && maxFileSizeMb > globalMaxFileSizeMb)
        {
            throw new ApiException($"لا يمكن أن يتجاوز حجم مرفق المراسلات الحد الأقصى العام للمرفقات وهو {globalMaxFileSizeMb} MB.");
        }

        item.AllowAttachments = ToBool(values["allow_message_attachments"]);
        item.MaxAttachments = maxAttachments;
        item.MaxFileSizeMb = maxFileSizeMb;
        item.AllowedExtensionsJson = JsonSerializer.Serialize(allowed);
        item.VirusScanEnabled = ToBool(values["enable_virus_scan"]);
        item.SettingsJson = MergeSettingsJson(item.SettingsJson, values);
        await db.SaveChangesAsync(cancellationToken);
        await settingsStore.SetValuesAsync("messaging", "messaging.attachments", values, MessagingAttachmentDefaults, cancellationToken);
        await auditService.LogAsync("message_attachment_settings_updated", "message_attachment_settings", item.Id.ToString(), oldValue: current, newValue: values, cancellationToken: cancellationToken);
        return Ok(await GetAttachmentSettingsAsync(cancellationToken));
    }

    private async Task<ActionResult<IReadOnlyCollection<MessageListItemDto>>> GetFolder(
        string folder,
        string? search,
        long? type,
        string? messageType,
        string? priority,
        long? senderId,
        string? relatedRequest,
        bool? officialOnly,
        bool? clarificationOnly,
        bool? unreadOnly,
        string? readStatus,
        DateTimeOffset? dateFrom,
        DateTimeOffset? dateTo,
        int? limit,
        int? offset,
        CancellationToken cancellationToken)
    {
        var actorId = RequireCurrentUserId();
        var canManage = await permissionService.HasPermissionAsync(actorId, "messages.manage", cancellationToken);
        var general = await GetMessagingGeneralSettingsAsync(cancellationToken);
        if (!ToBool(general["enable_messaging"]))
        {
            return Ok(Array.Empty<MessageListItemDto>());
        }

        if (folder == "archived" && !ToBool(general["allow_archiving"]))
        {
            return Ok(Array.Empty<MessageListItemDto>());
        }

        var requestSettings = await GetMessagingRequestSettingsAsync(cancellationToken);
        if (folder == "request-linked" && !ToBool(requestSettings["allow_link_to_request"]))
        {
            return Ok(Array.Empty<MessageListItemDto>());
        }
        var allowRequestOwnerToView = ToBool(requestSettings["allow_request_owner_to_view_messages"]);
        var allowApproversToView = ToBool(requestSettings["allow_approvers_to_view_request_messages"]);
        var actorRoleId = await GetActorRoleIdAsync(actorId, cancellationToken);

        var query = BaseMessageQuery();

        query = folder switch
        {
            "inbox" => query.Where(x => x.Recipients.Any(r => r.RecipientId == actorId && !r.IsArchived)),
            "sent" => query.Where(x => x.SenderId == actorId),
            "archived" => query.Where(x => x.Recipients.Any(r => r.RecipientId == actorId && r.IsArchived)),
            "unread" => query.Where(x => x.Recipients.Any(r => r.RecipientId == actorId && !r.IsRead && !r.IsArchived)),
            "request-linked" => query.Where(x =>
                x.RelatedRequestId != null &&
                (canManage ||
                 x.SenderId == actorId ||
                 x.Recipients.Any(r => r.RecipientId == actorId) ||
                 (x.RelatedRequest != null &&
                  ((allowRequestOwnerToView && x.RelatedRequest.RequesterId == actorId) ||
                   (allowApproversToView &&
                    (x.RelatedRequest.AssignedToId == actorId ||
                     x.RelatedRequest.WorkflowSnapshots.Any(s => s.ApproverUserId == actorId || s.ActionByUserId == actorId || (actorRoleId.HasValue && s.ApproverRoleId == actorRoleId.Value)) ||
                     x.RelatedRequest.WorkflowSnapshots.Any(s => s.TargetDepartment != null && s.TargetDepartment.ManagerUserId == actorId) ||
                     (x.RelatedRequest.Requester != null && x.RelatedRequest.Requester.DirectManagerId == actorId) ||
                     (x.RelatedRequest.Department != null && x.RelatedRequest.Department.ManagerUserId == actorId) ||
                     (x.RelatedRequest.SpecializedSection != null &&
                      (x.RelatedRequest.SpecializedSection.ManagerUserId == actorId ||
                       x.RelatedRequest.SpecializedSection.DefaultAssigneeUserId == actorId ||
                       (x.RelatedRequest.SpecializedSection.Department != null && x.RelatedRequest.SpecializedSection.Department.ManagerUserId == actorId))))))))),
            _ => query.Where(x => x.Recipients.Any(r => r.RecipientId == actorId && !r.IsArchived))
        };

        if (!string.IsNullOrWhiteSpace(search))
        {
            var value = search.Trim().ToLowerInvariant();
            query = query.Where(x =>
                x.Subject.ToLower().Contains(value) ||
                x.Body.ToLower().Contains(value) ||
                x.Sender!.NameAr.ToLower().Contains(value) ||
                (x.RelatedRequest != null && x.RelatedRequest.RequestNumber.ToLower().Contains(value)) ||
                x.Recipients.Any(r => r.Recipient!.NameAr.ToLower().Contains(value) || r.Recipient.Email.ToLower().Contains(value)));
        }

        if (type.HasValue)
        {
            query = query.Where(x => x.MessageTypeId == type.Value);
        }

        if (!string.IsNullOrWhiteSpace(messageType))
        {
            var filter = messageType.Trim();
            if (long.TryParse(filter, out var typeId))
            {
                query = query.Where(x => x.MessageTypeId == typeId);
            }
            else
            {
                var code = NormalizeCode(filter);
                query = query.Where(x => x.MessageType != null && x.MessageType.Code == code);
            }
        }

        if (officialOnly == true)
        {
            query = query.Where(x => x.IsOfficial || (x.MessageType != null && x.MessageType.IsOfficial));
        }

        if (clarificationOnly == true)
        {
            query = query.Where(x => x.MessageType != null && ClarificationTypeCodes.Contains(x.MessageType.Code));
        }

        if (senderId.HasValue)
        {
            query = query.Where(x => x.SenderId == senderId.Value);
        }

        if (!string.IsNullOrWhiteSpace(relatedRequest))
        {
            var related = relatedRequest.Trim().ToLowerInvariant();
            if (long.TryParse(related, out var relatedId))
            {
                query = query.Where(x => x.RelatedRequestId == relatedId || (x.RelatedRequest != null && x.RelatedRequest.RequestNumber.ToLower().Contains(related)));
            }
            else
            {
                query = query.Where(x => x.RelatedRequest != null && x.RelatedRequest.RequestNumber.ToLower().Contains(related));
            }
        }

        if (!string.IsNullOrWhiteSpace(priority))
        {
            query = query.Where(x => x.Priority == priority);
        }

        if (unreadOnly == true)
        {
            query = query.Where(x => x.Recipients.Any(r => r.RecipientId == actorId && !r.IsRead));
        }

        if (readStatus == "read")
        {
            query = query.Where(x => x.SenderId == actorId || x.Recipients.Any(r => r.RecipientId == actorId && r.IsRead));
        }
        else if (readStatus == "unread")
        {
            query = query.Where(x => x.Recipients.Any(r => r.RecipientId == actorId && !r.IsRead));
        }

        if (dateFrom.HasValue)
        {
            query = query.Where(x => x.SentAt >= dateFrom.Value);
        }

        if (dateTo.HasValue)
        {
            query = query.Where(x => x.SentAt <= dateTo.Value);
        }

        var messages = await query
            .OrderByDescending(x => x.SentAt)
            .Skip(Math.Max(offset ?? 0, 0))
            .Take(Math.Clamp(limit ?? 500, 1, 500))
            .ToListAsync(cancellationToken);
        return Ok(messages.Select(x => MapListItem(x, actorId)).ToList());
    }

    private async Task<IActionResult> SetReadStatus(long id, bool isRead, CancellationToken cancellationToken)
    {
        var actorId = RequireCurrentUserId();
        var recipient = await db.MessageRecipients.FirstOrDefaultAsync(x => x.MessageId == id && x.RecipientId == actorId, cancellationToken)
            ?? throw new ApiException("لا يمكن تغيير حالة قراءة مراسلة لست مستلماً لها", StatusCodes.Status403Forbidden);
        var wasRead = recipient.IsRead;
        recipient.IsRead = isRead;
        recipient.ReadAt = isRead ? DateTimeOffset.UtcNow : null;
        await db.SaveChangesAsync(cancellationToken);
        await auditService.LogAsync(isRead ? "message_marked_read" : "message_marked_unread", "message", id.ToString(), cancellationToken: cancellationToken);
        var message = await LoadMessageQuery().FirstAsync(x => x.Id == id, cancellationToken);
        if (isRead && !wasRead)
        {
            await CreateMessageReadNotificationAsync(message, actorId, cancellationToken);
        }

        return Ok(MapDetails(message, actorId));
    }

    private async Task<MessageType> ResolveMessageTypeAsync(JsonElement request, long fallbackId, CancellationToken cancellationToken)
    {
        return await ResolveMessageTypeAsync(
            LongProp(request, "message_type_id", "messageTypeId"),
            StringProp(request, "message_type", "messageType"),
            fallbackId,
            cancellationToken);
    }

    private async Task<MessageType> ResolveMessageTypeAsync(long? id, string? raw, long fallbackId, CancellationToken cancellationToken)
    {
        if (!id.HasValue && !string.IsNullOrWhiteSpace(raw) && long.TryParse(raw, out var parsedId))
        {
            id = parsedId;
        }

        if (id.HasValue)
        {
            return await db.MessageTypes.AsNoTracking().FirstOrDefaultAsync(x => x.Id == id.Value && x.IsActive, cancellationToken)
                   ?? throw new ApiException("نوع الرسالة غير صالح");
        }

        if (!string.IsNullOrWhiteSpace(raw))
        {
            var code = NormalizeCode(raw);
            return await db.MessageTypes.AsNoTracking().FirstOrDefaultAsync(x => x.Code == code && x.IsActive, cancellationToken)
                   ?? throw new ApiException("نوع الرسالة غير صالح");
        }

        return await db.MessageTypes.AsNoTracking().FirstOrDefaultAsync(x => x.Id == fallbackId, cancellationToken)
               ?? throw new ApiException("نوع الرسالة الأصلي غير موجود");
    }

    private async Task<long?> ResolveClassificationIdAsync(JsonElement request, long? fallbackId, CancellationToken cancellationToken)
    {
        return await ResolveClassificationIdAsync(
            LongProp(request, "classification_id", "classificationId"),
            StringProp(request, "classification_code", "classificationCode"),
            fallbackId,
            cancellationToken);
    }

    private async Task<long?> ResolveClassificationIdAsync(long? id, string? raw, long? fallbackId, CancellationToken cancellationToken)
    {
        if (id.HasValue)
        {
            if (!await db.MessageClassifications.AnyAsync(x => x.Id == id.Value && x.IsActive, cancellationToken))
            {
                throw new ApiException("تصنيف السرية غير صالح");
            }

            return id.Value;
        }

        if (!string.IsNullOrWhiteSpace(raw))
        {
            var code = NormalizeCode(raw);
            return await db.MessageClassifications
                .AsNoTracking()
                .Where(x => x.Code == code && x.IsActive)
                .Select(x => (long?)x.Id)
                .FirstOrDefaultAsync(cancellationToken)
                ?? throw new ApiException("تصنيف السرية غير صالح");
        }

        return fallbackId;
    }

    private async Task CreateMessageNotificationsAsync(Message message, string senderName, string eventType, CancellationToken cancellationToken)
    {
        if (!await ShouldSendMessageNotificationAsync(message, eventType, cancellationToken))
        {
            return;
        }

        var recipientIds = message.Recipients
            .Select(x => x.RecipientId)
            .Where(x => x != message.SenderId)
            .Distinct()
            .ToList();
        if (recipientIds.Count == 0)
        {
            return;
        }

        var title = message.IsOfficial ? "مراسلة رسمية جديدة" : "رسالة داخلية جديدة";
        var body = $"{senderName}: {message.Subject}";
        var notifications = recipientIds.Select(recipientId => new Notification
        {
            UserId = recipientId,
            Title = title,
            Body = body,
            Channel = "messages",
            RelatedRoute = "/messages",
            IsRead = false
        }).ToList();
        db.Notifications.AddRange(notifications);
        await db.SaveChangesAsync(cancellationToken);

        foreach (var notification in notifications)
        {
            await realtimeNotifications.SendToUserAsync(notification.UserId, new
            {
                type = "new_message",
                id = notification.Id,
                title = notification.Title,
                body = notification.Body,
                subject = message.Subject,
                channel = notification.Channel,
                related_route = notification.RelatedRoute,
                message_id = message.Id,
                created_at = notification.CreatedAt
            }, cancellationToken);
        }
    }

    private async Task CreateMessageReadNotificationAsync(Message message, long readerId, CancellationToken cancellationToken)
    {
        if (message.SenderId == readerId || !await ShouldSendReadNotificationAsync(cancellationToken))
        {
            return;
        }

        var readerName = await db.Users
            .AsNoTracking()
            .Where(x => x.Id == readerId)
            .Select(x => x.NameAr)
            .FirstOrDefaultAsync(cancellationToken) ?? "مستخدم النظام";
        var notification = new Notification
        {
            UserId = message.SenderId,
            Title = "تمت قراءة الرسالة",
            Body = $"{readerName}: {message.Subject}",
            Channel = "messages",
            RelatedRoute = $"/messages/{message.Id}",
            IsRead = false
        };
        db.Notifications.Add(notification);
        await db.SaveChangesAsync(cancellationToken);
        await realtimeNotifications.SendToUserAsync(notification.UserId, new
        {
            type = "message_read",
            id = notification.Id,
            title = notification.Title,
            body = notification.Body,
            subject = message.Subject,
            channel = notification.Channel,
            related_route = notification.RelatedRoute,
            message_id = message.Id,
            created_at = notification.CreatedAt
        }, cancellationToken);
    }

    private async Task<bool> ShouldSendMessageNotificationAsync(Message message, string eventType, CancellationToken cancellationToken)
    {
        var notifications = await GetMessagingNotificationSettingsAsync(cancellationToken);
        if (!ToBool(notifications["enable_message_notifications"]))
        {
            return false;
        }

        if (eventType == "reply" && !ToBool(notifications["notify_on_reply"]))
        {
            return false;
        }

        if (eventType != "reply" && !ToBool(notifications["notify_on_new_message"]))
        {
            return false;
        }

        var messageType = message.MessageType;
        if (messageType is null)
        {
            messageType = await db.MessageTypes
                .AsNoTracking()
                .FirstOrDefaultAsync(x => x.Id == message.MessageTypeId, cancellationToken);
        }

        var typeCode = messageType?.Code ?? "";
        if ((message.IsOfficial || messageType?.IsOfficial == true || string.Equals(typeCode, "official_message", StringComparison.OrdinalIgnoreCase)) &&
            !ToBool(notifications["notify_on_official_message"]))
        {
            return false;
        }

        if (ClarificationTypeCodes.Contains(typeCode) && !ToBool(notifications["notify_on_clarification_request"]))
        {
            return false;
        }

        return true;
    }

    private async Task<bool> ShouldSendReadNotificationAsync(CancellationToken cancellationToken)
    {
        var notifications = await GetMessagingNotificationSettingsAsync(cancellationToken);
        return ToBool(notifications["enable_message_notifications"]) && ToBool(notifications["notify_on_read"]);
    }

    private Task<Dictionary<string, object?>> GetMessagingGeneralSettingsAsync(CancellationToken cancellationToken) =>
        settingsStore.GetValuesAsync("messaging", "messaging.general", MessagingGeneralDefaults, cancellationToken);

    private Task<Dictionary<string, object?>> GetMessagingRequestSettingsAsync(CancellationToken cancellationToken) =>
        settingsStore.GetValuesAsync("messaging", "messaging.request", MessagingRequestDefaults, cancellationToken);

    private Task<Dictionary<string, object?>> GetMessagingRecipientSettingsAsync(CancellationToken cancellationToken) =>
        settingsStore.GetValuesAsync("messaging", "messaging.recipients", MessagingRecipientsDefaults, cancellationToken);

    private Task<Dictionary<string, object?>> GetMessagingNotificationSettingsAsync(CancellationToken cancellationToken) =>
        settingsStore.GetValuesAsync("messaging", "messaging.notifications", MessagingNotificationDefaults, cancellationToken);

    private async Task EnsureMessagingEnabledAsync(CancellationToken cancellationToken)
    {
        var general = await GetMessagingGeneralSettingsAsync(cancellationToken);
        if (!ToBool(general["enable_messaging"]))
        {
            throw new ApiException("نظام المراسلات غير مفعل من إعدادات النظام", StatusCodes.Status403Forbidden);
        }
    }

    private async Task EnsureMessagingCanSendAsync(long? relatedRequestId, CancellationToken cancellationToken)
    {
        await EnsureMessagingEnabledAsync(cancellationToken);
        var general = await GetMessagingGeneralSettingsAsync(cancellationToken);
        var requestSettings = await GetMessagingRequestSettingsAsync(cancellationToken);
        if (!relatedRequestId.HasValue && !ToBool(general["allow_general_messages"]))
        {
            throw new ApiException("المراسلات العامة غير مفعلة من إعدادات المراسلات", StatusCodes.Status403Forbidden);
        }

        if (relatedRequestId.HasValue && !ToBool(requestSettings["allow_link_to_request"]))
        {
            throw new ApiException("ربط المراسلات بالطلبات غير مفعل من إعدادات المراسلات", StatusCodes.Status403Forbidden);
        }

        if (relatedRequestId.HasValue && !ToBool(requestSettings["allow_send_message_from_request"]))
        {
            throw new ApiException("إرسال مراسلة مرتبطة بطلب غير مفعل من إعدادات المراسلات", StatusCodes.Status403Forbidden);
        }
    }

    private async Task EnsureMessagingCanReplyAsync(CancellationToken cancellationToken)
    {
        await EnsureMessagingEnabledAsync(cancellationToken);
        var general = await GetMessagingGeneralSettingsAsync(cancellationToken);
        if (!ToBool(general["allow_replies"]))
        {
            throw new ApiException("الرد على المراسلات غير مفعل من إعدادات المراسلات", StatusCodes.Status403Forbidden);
        }
    }

    private async Task EnsureMessageTypeAllowedAsync(MessageType type, long actorId, long? relatedRequestId, CancellationToken cancellationToken)
    {
        var code = type.Code;
        if (await MessageTypeRequiresRequestAsync(type, cancellationToken) && !relatedRequestId.HasValue)
        {
            throw new ApiException(MessageTypeRequestRequiredMessage(type), StatusCodes.Status400BadRequest);
        }

        if (!CircularTypeCodes.Contains(code))
        {
            return;
        }

        var general = await GetMessagingGeneralSettingsAsync(cancellationToken);
        var recipients = await GetMessagingRecipientSettingsAsync(cancellationToken);
        var broadcastEnabled = ToBool(general.GetValueOrDefault("allow_broadcast_messages")) || ToBool(recipients.GetValueOrDefault("allow_broadcast"));
        if (!broadcastEnabled)
        {
            throw new ApiException("التعاميم غير مفعلة من إعدادات المراسلات", StatusCodes.Status403Forbidden);
        }

        var allowedUserIds = ToLongList(recipients.GetValueOrDefault("circular_allowed_user_ids"));
        if (allowedUserIds.Count == 0 || !allowedUserIds.Contains(actorId))
        {
            throw new ApiException("لا تملك صلاحية إرسال التعاميم", StatusCodes.Status403Forbidden);
        }
    }

    private async Task<bool> MessageTypeRequiresRequestAsync(MessageType type, CancellationToken cancellationToken)
    {
        var requestSettings = await GetMessagingRequestSettingsAsync(cancellationToken);
        if (ClarificationTypeCodes.Contains(type.Code))
        {
            return ToBool(requestSettings["require_request_for_clarification"]);
        }

        if (ExecutionNoteTypeCodes.Contains(type.Code))
        {
            return ToBool(requestSettings["require_request_for_execution_note"]);
        }

        return type.RequiresRequest;
    }

    private static string MessageTypeRequestRequiredMessage(MessageType type)
    {
        if (ClarificationTypeCodes.Contains(type.Code))
        {
            return "طلب الاستيضاح يتطلب طلباً مرتبطاً";
        }

        if (ExecutionNoteTypeCodes.Contains(type.Code))
        {
            return "ملاحظة التنفيذ تتطلب طلباً مرتبطاً";
        }

        return "هذا التصنيف يتطلب طلباً مرتبطاً";
    }

    private IQueryable<Message> BaseMessageQuery() => LoadMessageQuery().AsNoTracking();

    private IQueryable<Message> LoadMessageQuery() =>
        db.Messages
            .Include(x => x.Sender)
            .Include(x => x.MessageType)
            .Include(x => x.Classification)
            .Include(x => x.RelatedRequest)
            .Include(x => x.Recipients).ThenInclude(x => x.Recipient)
            .Include(x => x.Attachments).ThenInclude(x => x.UploadedByUser);

    private async Task EnsureCanReadMessageAsync(Message message, long actorId, CancellationToken cancellationToken)
    {
        if (message.SenderId == actorId || message.Recipients.Any(x => x.RecipientId == actorId))
        {
            return;
        }

        if (await permissionService.HasPermissionAsync(actorId, "messages.manage", cancellationToken))
        {
            if (message.RelatedRequestId.HasValue)
            {
                await EnsureCanViewRequestAsync(message.RelatedRequestId.Value, actorId, cancellationToken);
            }
            return;
        }

        if (message.RelatedRequestId.HasValue)
        {
            var requestSettings = await GetMessagingRequestSettingsAsync(cancellationToken);
            if (ToBool(requestSettings["allow_link_to_request"]) &&
                ToBool(requestSettings["show_messages_tab_in_request_details"]) &&
                await CanViewLinkedRequestMessagesAsync(
                    message.RelatedRequestId.Value,
                    actorId,
                    ToBool(requestSettings["allow_request_owner_to_view_messages"]),
                    ToBool(requestSettings["allow_approvers_to_view_request_messages"]),
                    cancellationToken))
            {
                return;
            }
        }

        throw new ApiException("لا تملك صلاحية عرض هذه المراسلة", StatusCodes.Status403Forbidden);
    }

    private async Task<long?> GetActorRoleIdAsync(long actorId, CancellationToken cancellationToken)
    {
        return await db.Users
            .AsNoTracking()
            .Where(x => x.Id == actorId && x.IsActive && !x.IsLocked)
            .Select(x => (long?)x.RoleId)
            .FirstOrDefaultAsync(cancellationToken);
    }

    private async Task<bool> CanViewLinkedRequestMessagesAsync(
        long requestId,
        long actorId,
        bool allowOwnerToView,
        bool allowApproversToView,
        CancellationToken cancellationToken)
    {
        var actorRoleId = await GetActorRoleIdAsync(actorId, cancellationToken);
        return await db.Requests.AsNoTracking().AnyAsync(x =>
            x.Id == requestId &&
            ((allowOwnerToView && x.RequesterId == actorId) ||
             (allowApproversToView &&
              (x.AssignedToId == actorId ||
               x.WorkflowSnapshots.Any(s => s.ApproverUserId == actorId || s.ActionByUserId == actorId || (actorRoleId.HasValue && s.ApproverRoleId == actorRoleId.Value)) ||
               x.WorkflowSnapshots.Any(s => s.TargetDepartment != null && s.TargetDepartment.ManagerUserId == actorId) ||
               (x.Requester != null && x.Requester.DirectManagerId == actorId) ||
               (x.Department != null && x.Department.ManagerUserId == actorId) ||
               (x.SpecializedSection != null &&
                (x.SpecializedSection.ManagerUserId == actorId ||
                 x.SpecializedSection.DefaultAssigneeUserId == actorId ||
                 (x.SpecializedSection.Department != null && x.SpecializedSection.Department.ManagerUserId == actorId)))))),
            cancellationToken);
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

        var actorRoleId = await GetActorRoleIdAsync(actorId, cancellationToken);
        var canView = await db.Requests.AnyAsync(x =>
            x.Id == requestId &&
            (x.RequesterId == actorId ||
             x.AssignedToId == actorId ||
             x.WorkflowSnapshots.Any(s => s.ApproverUserId == actorId || s.ActionByUserId == actorId || (actorRoleId.HasValue && s.ApproverRoleId == actorRoleId.Value)) ||
             x.WorkflowSnapshots.Any(s => s.TargetDepartment != null && s.TargetDepartment.ManagerUserId == actorId) ||
             (x.Requester != null && x.Requester.DirectManagerId == actorId) ||
             (x.Department != null && x.Department.ManagerUserId == actorId) ||
             (x.SpecializedSection != null &&
              (x.SpecializedSection.ManagerUserId == actorId ||
               x.SpecializedSection.DefaultAssigneeUserId == actorId ||
               (x.SpecializedSection.Department != null && x.SpecializedSection.Department.ManagerUserId == actorId)))),
            cancellationToken);
        if (!canView)
        {
            throw new ApiException("لا تملك صلاحية الوصول إلى الطلب المرتبط", StatusCodes.Status403Forbidden);
        }
    }

    private async Task ValidateRecipientsAsync(IEnumerable<long> recipientIds, CancellationToken cancellationToken)
    {
        var ids = recipientIds.Distinct().ToList();
        if (ids.Count == 0)
        {
            throw new ApiException("يجب تحديد مستلم واحد على الأقل");
        }

        var general = await GetMessagingGeneralSettingsAsync(cancellationToken);
        var recipientSettings = await GetMessagingRecipientSettingsAsync(cancellationToken);
        var maxRecipients = Math.Max(ToInt(recipientSettings["max_recipients"]), 1);
        if (ids.Count > maxRecipients)
        {
            throw new ApiException($"لا يمكن تجاوز الحد الأقصى للمستلمين وهو {maxRecipients}");
        }

        if (ids.Count > 1 && (!ToBool(general["allow_multiple_recipients"]) || !ToBool(recipientSettings["allow_multiple_recipients"])))
        {
            throw new ApiException("إرسال الرسالة لأكثر من مستلم غير مفعل من إعدادات المراسلات");
        }

        var preventInactive = ToBool(recipientSettings["prevent_sending_to_inactive_users"]);
        var query = db.Users.Where(x => ids.Contains(x.Id) && !x.IsLocked);
        if (preventInactive)
        {
            query = query.Where(x => x.IsActive);
        }

        var existing = await query
            .Select(x => x.Id)
            .ToListAsync(cancellationToken);
        var missing = ids.Except(existing).ToList();
        if (missing.Count > 0)
        {
            throw new ApiException("يوجد مستلم غير نشط أو غير موجود");
        }
    }

    private async Task ValidateClassificationAsync(long? classificationId, CancellationToken cancellationToken)
    {
        if (!classificationId.HasValue)
        {
            return;
        }

        if (!await db.MessageClassifications.AnyAsync(x => x.Id == classificationId.Value && x.IsActive, cancellationToken))
        {
            throw new ApiException("تصنيف السرية غير صالح");
        }
    }

    private static void ValidatePriority(string priority)
    {
        if (!AllowedPriorities.Contains(priority))
        {
            throw new ApiException("الأولوية المحددة غير صالحة");
        }
    }

    private async Task<MessagingAttachmentSettingsDto> GetAttachmentSettingsAsync(CancellationToken cancellationToken)
    {
        var values = ReadAttachmentSettingsValues(await FirstOrCreateAsync(db.MessageAttachmentSettings, () => new MessageAttachmentSettings(), cancellationToken));
        var maxAttachments = ToInt(values["max_attachments_per_message"]);
        var maxFileSizeMb = ToInt(values["max_file_size_mb"]);
        var allowed = SanitizeExtensions(ToStringList(values["allowed_extensions_json"]));
        var globalMaxFileSizeMb = await settingsStore.GetValueAsync("attachments.max_file_size_mb", configuration.GetValue("Messaging:Attachments:MaxFileSizeMb", 10), cancellationToken);
        var globalHardLimit = await settingsStore.GetValueAsync("attachments.is_hard_limit", true, cancellationToken);
        if (globalHardLimit && maxFileSizeMb > globalMaxFileSizeMb)
        {
            maxFileSizeMb = globalMaxFileSizeMb;
        }

        return new MessagingAttachmentSettingsDto(
            maxAttachments,
            maxFileSizeMb,
            allowed,
            BlockedExtensions.ToList(),
            ToBool(values["allow_message_attachments"]),
            ToBool(values["hide_real_file_path"]),
            ToBool(values["log_attachment_downloads"]),
            ToBool(values["enable_virus_scan"]),
            ToBool(values["block_executable_files"]),
            Convert.ToString(values["message_upload_path"]) ?? "messages");
    }

    private static Dictionary<string, object?> ReadAttachmentSettingsValues(MessageAttachmentSettings item)
    {
        var values = MergePersistedSettings(MessagingAttachmentDefaults, item.SettingsJson);
        values["allow_message_attachments"] = item.AllowAttachments;
        values["max_attachments_per_message"] = item.MaxAttachments;
        values["max_file_size_mb"] = item.MaxFileSizeMb;
        values["allowed_extensions_json"] = DeserializeStringList(item.AllowedExtensionsJson);
        values["enable_virus_scan"] = item.VirusScanEnabled;
        return values;
    }

    private async Task<T> FirstOrCreateAsync<T>(DbSet<T> set, Func<T> create, CancellationToken cancellationToken) where T : BaseEntity
    {
        var item = await set.OrderBy(x => x.Id).FirstOrDefaultAsync(cancellationToken);
        if (item is not null)
        {
            return item;
        }

        item = create();
        set.Add(item);
        return item;
    }

    private static Dictionary<string, object?> MergePersistedSettings(IReadOnlyDictionary<string, object?> defaults, string? json)
    {
        var persisted = ReadSettingsJson(json);
        var values = new Dictionary<string, object?>(StringComparer.OrdinalIgnoreCase);
        foreach (var (key, fallback) in defaults)
        {
            values[key] = persisted.TryGetValue(key, out var value) ? value : fallback;
        }

        return values;
    }

    private static Dictionary<string, object?> ReadSettingsJson(string? json)
    {
        var values = new Dictionary<string, object?>(StringComparer.OrdinalIgnoreCase);
        if (string.IsNullOrWhiteSpace(json))
        {
            return values;
        }

        try
        {
            using var document = JsonDocument.Parse(json);
            if (document.RootElement.ValueKind != JsonValueKind.Object)
            {
                return values;
            }

            foreach (var property in document.RootElement.EnumerateObject())
            {
                values[property.Name] = property.Value.ValueKind switch
                {
                    JsonValueKind.True => true,
                    JsonValueKind.False => false,
                    JsonValueKind.Number when property.Value.TryGetInt64(out var longValue) => longValue,
                    JsonValueKind.String => property.Value.GetString(),
                    JsonValueKind.Array => property.Value.EnumerateArray().Select(x => x.ToString()).ToList(),
                    JsonValueKind.Null or JsonValueKind.Undefined => null,
                    _ => property.Value.ToString()
                };
            }
        }
        catch
        {
            return values;
        }

        return values;
    }

    private static string MergeSettingsJson(string? existingJson, IReadOnlyDictionary<string, object?> values)
    {
        var existing = ReadSettingsJson(existingJson);
        foreach (var (key, value) in values)
        {
            existing[key] = value is JsonElement element ? element.ToString() : value;
        }

        return JsonSerializer.Serialize(existing);
    }

    private static IReadOnlyCollection<string> DeserializeStringList(string? json)
    {
        if (string.IsNullOrWhiteSpace(json))
        {
            return AllowedExtensions.ToList();
        }

        try
        {
            return JsonSerializer.Deserialize<List<string>>(json) ?? AllowedExtensions.ToList();
        }
        catch
        {
            return AllowedExtensions.ToList();
        }
    }

    private static List<string> SanitizeExtensions(IEnumerable<string> extensions)
    {
        var cleaned = extensions
            .SelectMany(ExpandAllowedExtension)
            .Where(x => x.Length > 0)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .OrderBy(x => x)
            .ToList();
        if (cleaned.Count == 0)
        {
            throw new ApiException("يجب تحديد امتداد واحد على الأقل");
        }

        var blocked = cleaned.Where(x => BlockedExtensions.Contains(x)).ToList();
        if (blocked.Count > 0)
        {
            throw new ApiException($"لا يمكن السماح بامتدادات خطرة: {string.Join(", ", blocked)}");
        }

        return cleaned;
    }

    private static List<string> ExpandConfiguredExtensions(IEnumerable<string> extensions)
    {
        return extensions
            .SelectMany(ExpandAllowedExtension)
            .Where(x => x.Length > 0)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .OrderBy(x => x)
            .ToList();
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

    private static IReadOnlyCollection<string> ToStringList(object? value) =>
        value switch
        {
            JsonElement { ValueKind: JsonValueKind.Array } element => element.EnumerateArray().Select(x => x.ToString()).Where(x => !string.IsNullOrWhiteSpace(x)).ToList(),
            JsonElement { ValueKind: JsonValueKind.String } element => (element.GetString() ?? "").Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries).ToList(),
            string text => text.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries).ToList(),
            IEnumerable<string> strings => strings.Where(x => !string.IsNullOrWhiteSpace(x)).ToList(),
            IEnumerable<object?> list => list.Select(x => Convert.ToString(x) ?? "").Where(x => !string.IsNullOrWhiteSpace(x)).ToList(),
            _ => []
        };

    private static IReadOnlyCollection<long> ToLongList(object? value) =>
        value switch
        {
            JsonElement { ValueKind: JsonValueKind.Array } element => element.EnumerateArray().Select(x => ToNullableLong(x)).Where(x => x.HasValue).Select(x => x!.Value).Distinct().ToList(),
            JsonElement { ValueKind: JsonValueKind.String } element => ParseLongList(element.GetString()),
            string text => ParseLongList(text),
            IEnumerable<long> longs => longs.Distinct().ToList(),
            IEnumerable<int> ints => ints.Select(x => (long)x).Distinct().ToList(),
            IEnumerable<object?> objects => objects.Select(ToNullableLong).Where(x => x.HasValue).Select(x => x!.Value).Distinct().ToList(),
            _ => []
        };

    private static int ToInt(object? value) =>
        value switch
        {
            JsonElement { ValueKind: JsonValueKind.Number } element when element.TryGetInt32(out var intValue) => intValue,
            JsonElement { ValueKind: JsonValueKind.String } element when int.TryParse(element.GetString(), out var result) => result,
            int intValue => intValue,
            long longValue => (int)longValue,
            decimal decimalValue => (int)decimalValue,
            double doubleValue => (int)doubleValue,
            string text when int.TryParse(text, out var result) => result,
            _ => 0
        };

    private static bool ToBool(object? value) =>
        value switch
        {
            JsonElement { ValueKind: JsonValueKind.True } => true,
            JsonElement { ValueKind: JsonValueKind.False } => false,
            JsonElement { ValueKind: JsonValueKind.String } element when bool.TryParse(element.GetString(), out var result) => result,
            JsonElement { ValueKind: JsonValueKind.Number } element when element.TryGetInt32(out var number) => number != 0,
            bool boolValue => boolValue,
            string text when bool.TryParse(text, out var result) => result,
            _ => false
        };

    private long RequireCurrentUserId() =>
        currentUser.UserId ?? throw new ApiException("المستخدم غير مصادق", StatusCodes.Status401Unauthorized);

    private static void ApplyMessageTypePayload(MessageType item, JsonElement request)
    {
        item.NameAr = RequiredString(request, "name_ar", "nameAr").Trim();
        item.NameEn = StringProp(request, "name_en", "nameEn")?.Trim();
        item.Description = StringProp(request, "description")?.Trim();
        item.Color = StringProp(request, "color")?.Trim() ?? item.Color;
        item.Icon = StringProp(request, "icon")?.Trim();
        item.IsOfficial = BoolProp(request, item.IsOfficial, "is_official", "isOfficial");
        item.RequiresRequest = BoolProp(request, item.RequiresRequest, "requires_request", "requiresRequest");
        item.RequiresAttachment = BoolProp(request, item.RequiresAttachment, "requires_attachment", "requiresAttachment");
        item.ShowInPdf = BoolProp(request, item.ShowInPdf, "show_in_pdf", "showInPdf");
        item.AllowReply = BoolProp(request, item.AllowReply, "allow_reply", "allowReply");
        item.VisibleToRequester = BoolProp(request, item.VisibleToRequester, "visible_to_requester", "visibleToRequester");
        item.SortOrder = IntProp(request, item.SortOrder, "sort_order", "sortOrder");
        item.IsActive = BoolProp(request, item.IsActive, "is_active", "isActive");
    }

    private static void ApplyClassificationPayload(MessageClassification item, JsonElement request)
    {
        item.NameAr = RequiredString(request, "name_ar", "nameAr").Trim();
        item.NameEn = StringProp(request, "name_en", "nameEn")?.Trim();
        item.Description = StringProp(request, "description")?.Trim();
        item.Color = StringProp(request, "color")?.Trim() ?? item.Color;
        item.IsConfidential = BoolProp(request, item.IsConfidential, "is_confidential", "isConfidential");
        item.RequiresPermission = BoolProp(request, item.RequiresPermission, "restricted_access", "requires_permission", "requiresPermission");
        item.ShowInPdf = BoolProp(request, item.ShowInPdf, "show_in_pdf", "showInPdf");
        item.ShowInReports = BoolProp(request, item.ShowInReports, "show_in_reports", "showInReports");
        item.AllowAttachmentDownload = BoolProp(request, item.AllowAttachmentDownload, "allow_attachment_download", "allowAttachmentDownload");
        item.LogDownloads = BoolProp(request, item.LogDownloads, "log_downloads", "logDownloads");
        item.RequiresSpecialPermission = BoolProp(request, item.RequiresSpecialPermission, "requires_special_permission", "requiresSpecialPermission");
        item.SortOrder = IntProp(request, item.SortOrder, "sort_order", "sortOrder");
        item.IsActive = BoolProp(request, item.IsActive, "is_active", "isActive");
    }

    private async Task ApplyTemplatePayloadAsync(MessageTemplate item, JsonElement request, CancellationToken cancellationToken)
    {
        item.NameAr = RequiredString(request, "name", "name_ar", "nameAr").Trim();
        item.NameEn = StringProp(request, "name_en", "nameEn")?.Trim();
        item.SubjectTemplate = RequiredString(request, "subject_template", "subjectTemplate").Trim();
        item.BodyTemplate = RequiredString(request, "body_template", "bodyTemplate").Trim();
        item.SortOrder = IntProp(request, item.SortOrder, "sort_order", "sortOrder");
        item.IsActive = BoolProp(request, item.IsActive, "is_active", "isActive");
        var messageTypeId = LongProp(request, "message_type_id", "messageTypeId");
        if (messageTypeId.HasValue && !await db.MessageTypes.AnyAsync(x => x.Id == messageTypeId.Value, cancellationToken))
        {
            throw new ApiException("نوع الرسالة المرتبط بالقالب غير موجود");
        }

        item.MessageTypeId = messageTypeId;
    }

    private static string RenderTemplate(string template, IReadOnlyDictionary<string, string> values)
    {
        var output = template;
        foreach (var (key, value) in values)
        {
            output = output.Replace("{{" + key + "}}", value, StringComparison.OrdinalIgnoreCase);
        }

        return output;
    }

    private static string RequiredString(JsonElement request, params string[] names)
    {
        var value = StringProp(request, names);
        if (string.IsNullOrWhiteSpace(value))
        {
            throw new ApiException("يرجى تعبئة الحقول المطلوبة");
        }

        return value;
    }

    private static string? StringProp(JsonElement request, params string[] names)
    {
        if (request.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        foreach (var name in names)
        {
            if (request.TryGetProperty(name, out var value))
            {
                return value.ValueKind switch
                {
                    JsonValueKind.String => value.GetString(),
                    JsonValueKind.Null or JsonValueKind.Undefined => null,
                    _ => value.ToString()
                };
            }
        }

        return null;
    }

    private static long? LongProp(JsonElement request, params string[] names)
    {
        var raw = StringProp(request, names);
        if (string.IsNullOrWhiteSpace(raw))
        {
            return null;
        }

        return long.TryParse(raw, out var value) ? value : null;
    }

    private static IReadOnlyCollection<long> LongArrayProp(JsonElement request, params string[] names)
    {
        if (request.ValueKind != JsonValueKind.Object)
        {
            return [];
        }

        foreach (var name in names)
        {
            if (!request.TryGetProperty(name, out var value))
            {
                continue;
            }

            return value.ValueKind switch
            {
                JsonValueKind.Array => value.EnumerateArray().Select(x => ToNullableLong(x)).Where(x => x.HasValue).Select(x => x!.Value).Distinct().ToList(),
                JsonValueKind.String => ParseLongList(value.GetString()),
                JsonValueKind.Number when value.TryGetInt64(out var single) => [single],
                _ => []
            };
        }

        return [];
    }

    private static IReadOnlyCollection<long> ParseLongList(string? text) =>
        string.IsNullOrWhiteSpace(text)
            ? []
            : text.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
                .Select(x => long.TryParse(x, out var id) ? id : (long?)null)
                .Where(x => x.HasValue)
                .Select(x => x!.Value)
                .Distinct()
                .ToList();

    private static long? ToNullableLong(object? value) =>
        value switch
        {
            null => null,
            long longValue => longValue,
            int intValue => intValue,
            decimal decimalValue => (long)decimalValue,
            double doubleValue => (long)doubleValue,
            JsonElement { ValueKind: JsonValueKind.Number } element when element.TryGetInt64(out var longValue) => longValue,
            JsonElement { ValueKind: JsonValueKind.String } element when long.TryParse(element.GetString(), out var longValue) => longValue,
            string text when long.TryParse(text, out var parsed) => parsed,
            _ => null
        };

    private static int IntProp(JsonElement request, int fallback, params string[] names)
    {
        var raw = StringProp(request, names);
        if (string.IsNullOrWhiteSpace(raw))
        {
            return fallback;
        }

        return int.TryParse(raw, out var value) ? value : fallback;
    }

    private static bool BoolProp(JsonElement request, bool fallback, params string[] names)
    {
        if (request.ValueKind != JsonValueKind.Object)
        {
            return fallback;
        }

        foreach (var name in names)
        {
            if (!request.TryGetProperty(name, out var value))
            {
                continue;
            }

            return value.ValueKind switch
            {
                JsonValueKind.True => true,
                JsonValueKind.False => false,
                JsonValueKind.String when bool.TryParse(value.GetString(), out var parsed) => parsed,
                JsonValueKind.Number when value.TryGetInt32(out var number) => number != 0,
                _ => fallback
            };
        }

        return fallback;
    }

    private static string NormalizeCode(string code)
    {
        var cleaned = new string(code.Trim().ToLowerInvariant().Select(ch => char.IsLetterOrDigit(ch) ? ch : '_').ToArray());
        while (cleaned.Contains("__", StringComparison.Ordinal))
        {
            cleaned = cleaned.Replace("__", "_", StringComparison.Ordinal);
        }

        cleaned = cleaned.Trim('_');
        if (string.IsNullOrWhiteSpace(cleaned))
        {
            throw new ApiException("الرمز غير صالح");
        }

        return cleaned;
    }

    private static async Task<string> ComputeChecksumAsync(string path, CancellationToken cancellationToken)
    {
        await using var stream = System.IO.File.OpenRead(path);
        var hash = await SHA256.HashDataAsync(stream, cancellationToken);
        return Convert.ToHexString(hash).ToLowerInvariant();
    }

    private static MessageListItemDto MapListItem(Message item, long actorId)
    {
        var recipient = item.Recipients.FirstOrDefault(x => x.RecipientId == actorId);
        var preview = item.Body.Length <= 120 ? item.Body : $"{item.Body[..120]}...";
        return new MessageListItemDto(
            item.Id,
            item.Subject,
            preview,
            item.SenderId,
            item.Sender?.NameAr,
            item.MessageTypeId,
            item.MessageType?.NameAr,
            item.MessageType?.Color,
            item.ClassificationId,
            item.Classification?.NameAr,
            item.Classification?.Color,
            item.Priority,
            item.IsOfficial,
            item.RelatedRequestId,
            item.RelatedRequest?.RequestNumber,
            item.SentAt,
            recipient?.IsRead ?? item.SenderId == actorId,
            recipient?.IsArchived ?? false,
            item.Recipients.Count,
            item.Attachments.Count(x => !x.IsDeleted));
    }

    private static MessageDetailsDto MapDetails(Message item, long? actorId = null)
    {
        var recipient = actorId.HasValue ? item.Recipients.FirstOrDefault(x => x.RecipientId == actorId.Value) : null;
        return new(
            item.Id,
            item.Subject,
            item.Body,
            item.SenderId,
            item.Sender?.NameAr,
            item.Sender?.Email,
            item.MessageTypeId,
            item.MessageType?.NameAr,
            item.MessageType?.Color,
            item.MessageType?.AllowReply ?? true,
            item.ClassificationId,
            item.Classification?.NameAr,
            item.Classification?.Color,
            item.Priority,
            item.IsOfficial,
            item.OfficialReferenceNumber,
            item.OfficialPdfDocumentId,
            item.OfficialStatus,
            item.IncludeInRequestPdf,
            item.ParentMessageId,
            item.RelatedRequestId,
            item.RelatedRequest?.RequestNumber,
            item.SentAt,
            recipient?.IsRead ?? (actorId.HasValue && item.SenderId == actorId.Value),
            recipient?.IsArchived ?? false,
            item.Recipients.Select(x => new MessageRecipientDto(x.RecipientId, x.Recipient?.NameAr, x.Recipient?.Email, x.IsRead, x.ReadAt, x.IsArchived)).ToList(),
            item.Attachments.Where(x => !x.IsDeleted).Select(MapAttachment).ToList());
    }

    private static MessageAttachmentDto MapAttachment(MessageAttachment item) =>
        new(item.Id, item.FileName, item.ContentType, item.FileSize, item.Checksum, item.UploadedByUserId, item.UploadedByUser?.NameAr, item.UploadedAt);

    private static object MapMessageUser(User user) => new
    {
        user.Id,
        full_name_ar = user.NameAr,
        name_ar = user.NameAr,
        full_name_en = user.NameEn,
        name_en = user.NameEn,
        email = user.Email,
        username = user.Username,
        employee_id = user.EmployeeNumber,
        employee_number = user.EmployeeNumber,
        role = user.Role?.Code,
        role_name_ar = user.Role?.NameAr,
        department_id = user.DepartmentId,
        department_name = user.Department?.NameAr,
        department_name_ar = user.Department?.NameAr,
        department_manager_id = user.Department?.ManagerUserId
    };

    private static object MapType(MessageType item) =>
        new
        {
            id = item.Id,
            code = item.Code,
            name_ar = item.NameAr,
            name_en = item.NameEn,
            description = item.Description,
            color = item.Color,
            icon = item.Icon,
            is_official = item.IsOfficial,
            requires_request = item.RequiresRequest,
            requires_attachment = item.RequiresAttachment,
            show_in_pdf = item.ShowInPdf,
            allow_reply = item.AllowReply,
            visible_to_requester = item.VisibleToRequester,
            sort_order = item.SortOrder,
            is_active = item.IsActive,
            created_at = item.CreatedAt,
            updated_at = item.UpdatedAt
        };

    private static object MapClassification(MessageClassification item) =>
        new
        {
            id = item.Id,
            code = item.Code,
            name_ar = item.NameAr,
            name_en = item.NameEn,
            description = item.Description,
            color = item.Color,
            is_confidential = item.IsConfidential,
            restricted_access = item.RequiresPermission,
            requires_permission = item.RequiresPermission,
            show_in_pdf = item.ShowInPdf,
            show_in_reports = item.ShowInReports,
            allow_attachment_download = item.AllowAttachmentDownload,
            log_downloads = item.LogDownloads,
            requires_special_permission = item.RequiresSpecialPermission,
            sort_order = item.SortOrder,
            is_active = item.IsActive,
            created_at = item.CreatedAt,
            updated_at = item.UpdatedAt
        };

    private static object MapTemplate(MessageTemplate item) =>
        new
        {
            id = item.Id,
            code = item.Code,
            name = item.NameAr,
            name_ar = item.NameAr,
            name_en = item.NameEn,
            message_type_id = item.MessageTypeId,
            message_type_name = item.MessageType?.NameAr,
            message_type_code = item.MessageType?.Code,
            subject_template = item.SubjectTemplate,
            body_template = item.BodyTemplate,
            sort_order = item.SortOrder,
            is_active = item.IsActive,
            created_at = item.CreatedAt,
            updated_at = item.UpdatedAt
        };
}
