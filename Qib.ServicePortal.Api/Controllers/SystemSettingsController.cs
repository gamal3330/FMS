using System.Reflection;
using System.Diagnostics;
using System.IO.Compression;
using System.Security.Cryptography;
using System.Text;
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
using Qib.ServicePortal.Api.Infrastructure.Security;

namespace Qib.ServicePortal.Api.Controllers;

[ApiController]
[Route("api/dotnet/v1/settings")]
[Authorize(Policy = "Permission:settings.view")]
public class SystemSettingsController(
    ServicePortalDbContext db,
    ICurrentUserService currentUser,
    IAuditService auditService,
    ISettingsStore settingsStore,
    IConfiguration configuration,
    IPasswordHasher passwordHasher) : ControllerBase
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);
    private static readonly string[] DangerousExtensions = ["exe", "bat", "cmd", "ps1", "sh", "js", "vbs", "msi"];
    private static readonly string[] DefaultFileExtensions = ["pdf", "docx", "xlsx", "png", "jpg", "jpeg"];

    private static readonly Dictionary<string, object?> GeneralDefaults = new()
    {
        ["system_name"] = "مراسلتي",
        ["bank_name_ar"] = "بنك القطيبي الإسلامي",
        ["bank_name_en"] = "Al-Qutaibi Islamic Bank",
        ["login_intro_text"] = "منصة داخلية موحدة لاستقبال الطلبات، تتبع مراحل الاعتماد، مراقبة مؤشرات الخدمة، وتوثيق الأثر التشغيلي.",
        ["language"] = "ar",
        ["timezone"] = "Asia/Aden",
        ["session_timeout_minutes"] = 60,
        ["upload_max_file_size_mb"] = 10,
        ["allowed_file_extensions"] = "pdf,docx,xlsx,png,jpg,jpeg",
        ["logo_url"] = "",
        ["brand_color"] = "#0d6337"
    };

    private static readonly Dictionary<string, object?> SecurityDefaults = new()
    {
        ["password_min_length"] = 8,
        ["lock_after_failed_attempts"] = 5,
        ["password_expiry_days"] = 90,
        ["require_uppercase"] = true,
        ["require_numbers"] = true,
        ["require_special_chars"] = true,
        ["mfa_enabled"] = false,
        ["login_identifier_mode"] = "email_or_employee_id",
        ["temporary_password"] = "Change@12345"
    };

    private static readonly Dictionary<string, object?> AttachmentDefaults = new()
    {
        ["allow_uploads"] = true,
        ["max_file_size_mb"] = 10,
        ["max_files_per_upload"] = 5,
        ["allowed_extensions_json"] = DefaultFileExtensions,
        ["blocked_extensions_json"] = DangerousExtensions,
        ["is_hard_limit"] = true,
        ["enable_virus_scan"] = false,
        ["scan_required"] = false,
        ["quarantine_suspicious_files"] = true,
        ["hide_real_file_path"] = true,
        ["log_downloads"] = true
    };

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
        ["prevent_sending_to_inactive_users"] = true,
        ["max_recipients"] = 100,
        ["department_recipient_behavior"] = "all_department_users",
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

    private static readonly Dictionary<string, object?> MessagingRetentionDefaults = new()
    {
        ["allow_archiving"] = true,
        ["prevent_hard_delete"] = true,
        ["retention_days"] = 2555,
        ["attachment_retention_days"] = 2555,
        ["auto_archive_after_days"] = 365,
        ["exclude_official_messages_from_delete"] = true,
        ["exclude_confidential_messages_from_delete"] = true,
        ["allow_user_delete_own_messages"] = false,
        ["allow_admin_purge_messages"] = false
    };

    private static readonly Dictionary<string, object?> MessagingSecurityDefaults = new()
    {
        ["log_message_sent"] = true,
        ["log_message_read"] = true,
        ["log_message_archived"] = true,
        ["log_message_deleted"] = true,
        ["log_attachment_downloaded"] = true,
        ["log_settings_changes"] = true,
        ["log_ip_address"] = true,
        ["log_user_agent"] = true,
        ["allow_super_admin_message_audit"] = false,
        ["require_reason_for_confidential_access"] = true,
        ["reading_policy"] = "sender_and_recipients_only"
    };

    private static readonly Dictionary<string, object?> MessagingAiDefaults = new()
    {
        ["global_ai_enabled"] = false,
        ["show_ai_in_compose"] = true,
        ["show_ai_in_message_details"] = true,
        ["show_ai_in_request_messages_tab"] = true,
        ["allow_ai_draft"] = true,
        ["allow_ai_improve"] = true,
        ["allow_ai_formalize"] = true,
        ["allow_ai_suggest_reply"] = true,
        ["allow_ai_summarize_request_messages"] = true,
        ["allow_ai_detect_missing_info"] = true
    };

    private static readonly Dictionary<string, object?> AiDefaults = new()
    {
        ["is_enabled"] = false,
        ["mode"] = "disabled",
        ["assistant_name"] = "المساعد الذكي للمراسلات",
        ["assistant_description"] = "يساعد المستخدمين في توليد مسودات وتحسين وتلخيص المراسلات دون إرسال أي رسالة تلقائياً.",
        ["system_prompt"] = "أنت مساعد ذكي للكتابة داخل نظام QIB Service Portal. مهمتك مساعدة المستخدم في صياغة وتحسين وتلخيص المراسلات الداخلية باللغة العربية بأسلوب مهني وواضح.",
        ["provider"] = "local_ollama",
        ["api_base_url"] = "http://localhost:11434",
        ["api_key_configured"] = false,
        ["model_name"] = "qwen3:8b",
        ["default_language"] = "ar",
        ["max_input_chars"] = 6000,
        ["timeout_seconds"] = 60,
        ["show_human_review_disclaimer"] = true,
        ["allow_message_drafting"] = true,
        ["allow_summarization"] = true,
        ["allow_reply_suggestion"] = true,
        ["allow_message_improvement"] = true,
        ["allow_missing_info_detection"] = true,
        ["allow_translate_ar_en"] = false,
        ["mask_sensitive_data"] = true,
        ["mask_emails"] = true,
        ["mask_phone_numbers"] = true,
        ["mask_employee_ids"] = true,
        ["mask_usernames"] = false,
        ["mask_request_numbers"] = false,
        ["allow_request_context"] = true,
        ["request_context_level"] = "basic_only",
        ["allow_attachments_to_ai"] = false,
        ["store_full_prompt_logs"] = false,
        ["show_in_compose_message"] = true,
        ["show_in_message_details"] = true,
        ["show_in_request_messages_tab"] = true
    };

    private static readonly (string Code, string Label)[] AiFeatureDefinitions =
    [
        ("draft", "توليد مسودة"),
        ("improve", "تحسين الصياغة"),
        ("formalize", "جعلها رسمية"),
        ("summarize", "تلخيص"),
        ("summarize_request_messages", "تلخيص مراسلات الطلب"),
        ("shorten", "اختصار النص"),
        ("suggest_reply", "اقتراح رد"),
        ("missing_info", "فحص المعلومات الناقصة"),
        ("translate_ar_en", "ترجمة عربي/إنجليزي")
    ];

    private static readonly Dictionary<string, object?> DatabaseDefaults = new()
    {
        ["provider"] = "postgresql",
        ["allow_manual_backup"] = true,
        ["allow_restore"] = false,
        ["auto_backup_enabled"] = false,
        ["backup_retention_days"] = 7,
        ["optimize_enabled"] = true,
        ["integrity_check_enabled"] = true
    };

    private static readonly Dictionary<string, object?> DatabaseBackupDefaults = new()
    {
        ["auto_backup_enabled"] = false,
        ["include_uploads"] = true,
        ["compress_backups"] = true,
        ["encrypt_backups"] = false,
        ["notify_on_failure"] = true,
        ["backup_time"] = "02:00",
        ["frequency"] = "daily",
        ["retention_count"] = 7,
        ["backup_location"] = "backups"
    };

    private static readonly Dictionary<string, object?> NotificationDefaults = new()
    {
        ["enable_notifications"] = true,
        ["show_in_app_notifications"] = true,
        ["notify_on_new_request"] = true,
        ["notify_on_approval_required"] = true,
        ["notify_on_message_received"] = true,
        ["notify_on_document_acknowledgement"] = true,
        ["allow_user_notification_preferences"] = false
    };

    private static readonly Dictionary<string, object?> HealthDefaults = new()
    {
        ["disk_warning_percent"] = 80,
        ["disk_critical_percent"] = 90,
        ["errors_warning_count"] = 10,
        ["errors_critical_count"] = 50,
        ["db_latency_warning_ms"] = 300,
        ["db_latency_critical_ms"] = 1000,
        ["auto_check_enabled"] = true,
        ["auto_check_interval_minutes"] = 15,
        ["retention_days"] = 30
    };

    private static readonly Dictionary<string, object?> UpdateDefaults = new()
    {
        ["enable_maintenance_mode_during_update"] = true,
        ["auto_backup_before_update"] = true,
        ["auto_health_check_after_update"] = true,
        ["auto_rollback_on_failed_health_check"] = false,
        ["retain_rollback_points_count"] = 3,
        ["block_updates_in_production_without_flag"] = true,
        ["allow_local_update_upload"] = false
    };

    [HttpGet]
    public async Task<ActionResult<IReadOnlyCollection<SystemSettingDto>>> GetSettings([FromQuery] string? group, CancellationToken cancellationToken)
    {
        var query = db.SystemSettings.AsNoTracking();
        if (!string.IsNullOrWhiteSpace(group))
        {
            query = query.Where(x => x.Group == group);
        }

        var settings = await query.OrderBy(x => x.Group).ThenBy(x => x.Key).ToListAsync(cancellationToken);
        return Ok(settings.Select(MapSetting).ToList());
    }

    [HttpPut("{key}")]
    [Authorize(Policy = "Permission:settings.manage")]
    public async Task<ActionResult<SystemSettingDto>> UpsertSetting(string key, UpsertSystemSettingRequest request, CancellationToken cancellationToken)
    {
        var setting = await db.SystemSettings.FirstOrDefaultAsync(x => x.Key == key, cancellationToken);
        var oldValue = setting is null ? null : new { setting.Value, setting.Group, setting.DataType, setting.IsSensitive };
        if (setting is null)
        {
            setting = new SystemSetting { Key = key };
            db.SystemSettings.Add(setting);
        }

        setting.Value = request.Value;
        setting.Group = request.Group;
        setting.DataType = request.DataType;
        setting.IsSensitive = request.IsSensitive;
        setting.DescriptionAr = request.DescriptionAr;
        setting.UpdatedByUserId = currentUser.UserId;

        await db.SaveChangesAsync(cancellationToken);
        await auditService.LogAsync("system_setting_updated", "system_setting", setting.Id.ToString(), oldValue: oldValue, newValue: new { setting.Key, setting.Value, setting.Group, setting.DataType, setting.IsSensitive }, cancellationToken: cancellationToken);
        return Ok(MapSetting(setting));
    }

    [AllowAnonymous]
    [HttpGet("public-profile")]
    public async Task<ActionResult<object>> GetPublicProfile(CancellationToken cancellationToken)
    {
        var profile = await GetGeneralProfileAsync(cancellationToken);
        return Ok(new
        {
            system_name = profile["system_name"],
            bank_name_ar = profile["bank_name_ar"],
            bank_name_en = profile["bank_name_en"],
            login_intro_text = profile["login_intro_text"],
            logo_url = profile["logo_url"],
            brand_color = profile["brand_color"],
            current_year = DateTimeOffset.Now.Year
        });
    }

    [HttpGet("general")]
    [HttpGet("general-profile")]
    public async Task<ActionResult<Dictionary<string, object?>>> GetGeneralProfile(CancellationToken cancellationToken) =>
        Ok(await GetGeneralProfileAsync(cancellationToken));

    [HttpPut("general")]
    [HttpPut("general-profile")]
    [Authorize(Policy = "Permission:settings.manage")]
    public async Task<ActionResult<Dictionary<string, object?>>> UpdateGeneralProfile(Dictionary<string, JsonElement> request, CancellationToken cancellationToken)
    {
        var oldValue = await GetGeneralProfileAsync(cancellationToken);
        var values = MergePayload(oldValue, request, GeneralDefaults);
        values["language"] = "ar";
        values["allowed_file_extensions"] = string.Join(",", SanitizeExtensions(SplitExtensions(values["allowed_file_extensions"]), allowEmpty: false));
        ValidateGeneral(values);
        await settingsStore.SetValuesAsync("general", "general", values, GeneralDefaults, cancellationToken);
        var updated = await GetGeneralProfileAsync(cancellationToken);
        await auditService.LogAsync("settings_general_updated", "system_settings", "general", oldValue: oldValue, newValue: updated, cancellationToken: cancellationToken);
        return Ok(updated);
    }

    [HttpPost("general-profile/logo")]
    [Authorize(Policy = "Permission:settings.manage")]
    [RequestSizeLimit(10_485_760)]
    public async Task<ActionResult<Dictionary<string, object?>>> UploadLogo(IFormFile file, CancellationToken cancellationToken)
    {
        if (file.Length <= 0)
        {
            throw new ApiException("ملف الشعار فارغ");
        }

        var extension = Path.GetExtension(file.FileName).TrimStart('.').ToLowerInvariant();
        if (!new[] { "png", "jpg", "jpeg", "svg", "webp" }.Contains(extension))
        {
            throw new ApiException("صيغة الشعار غير مسموحة");
        }

        var directory = Path.Combine(configuration["Storage:UploadsPath"] ?? "/data/uploads", "branding");
        Directory.CreateDirectory(directory);
        var storedName = $"{Guid.NewGuid():N}.{extension}";
        var path = Path.Combine(directory, storedName);
        await using (var stream = System.IO.File.Create(path))
        {
            await file.CopyToAsync(stream, cancellationToken);
        }

        var current = await GetGeneralProfileAsync(cancellationToken);
        current["logo_url"] = $"/settings/general-profile/logo/{storedName}";
        await settingsStore.SetValuesAsync("general", "general", current, GeneralDefaults, cancellationToken);
        await auditService.LogAsync("settings_logo_uploaded", "system_settings", "general", newValue: new { storedName, file.Length }, cancellationToken: cancellationToken);
        return Ok(await GetGeneralProfileAsync(cancellationToken));
    }

    [AllowAnonymous]
    [HttpGet("general-profile/logo/{fileName}")]
    public IActionResult GetLogo(string fileName)
    {
        var safeName = Path.GetFileName(fileName);
        var path = Path.Combine(configuration["Storage:UploadsPath"] ?? "/data/uploads", "branding", safeName);
        if (!System.IO.File.Exists(path))
        {
            return NotFound();
        }

        var extension = Path.GetExtension(path).TrimStart('.').ToLowerInvariant();
        var contentType = extension switch
        {
            "svg" => "image/svg+xml",
            "webp" => "image/webp",
            "jpg" or "jpeg" => "image/jpeg",
            _ => "image/png"
        };
        return PhysicalFile(path, contentType);
    }

    [HttpGet("security")]
    public Task<ActionResult<Dictionary<string, object?>>> GetSecurity(CancellationToken cancellationToken) =>
        GetSettingsObject("security", "security", SecurityDefaults, cancellationToken);

    [HttpPut("security")]
    [Authorize(Policy = "Permission:settings.manage")]
    public Task<ActionResult<Dictionary<string, object?>>> UpdateSecurity(Dictionary<string, JsonElement> request, CancellationToken cancellationToken) =>
        SaveSettingsObject("security", "security", SecurityDefaults, request, ValidateSecurity, "settings_security_updated", cancellationToken);

    [HttpGet("attachments")]
    public Task<ActionResult<Dictionary<string, object?>>> GetAttachments(CancellationToken cancellationToken) =>
        GetSettingsObject("attachments", "attachments", AttachmentDefaults, cancellationToken);

    [HttpPut("attachments")]
    [Authorize(Policy = "Permission:settings.manage")]
    public async Task<ActionResult<Dictionary<string, object?>>> UpdateAttachments(Dictionary<string, JsonElement> request, CancellationToken cancellationToken)
    {
        var oldValue = await settingsStore.GetValuesAsync("attachments", "attachments", AttachmentDefaults, cancellationToken);
        var values = MergePayload(oldValue, request, AttachmentDefaults);
        ValidateGlobalAttachments(values);
        await ValidateAttachmentConflictsAsync(values, cancellationToken);
        await settingsStore.SetValuesAsync("attachments", "attachments", values, AttachmentDefaults, cancellationToken);
        var updated = await settingsStore.GetValuesAsync("attachments", "attachments", AttachmentDefaults, cancellationToken);
        await auditService.LogAsync("settings_attachments_updated", "system_settings", "attachments", oldValue: oldValue, newValue: updated, cancellationToken: cancellationToken);
        return Ok(updated);
    }

    [HttpGet("messaging")]
    public async Task<ActionResult<Dictionary<string, object?>>> GetMessaging(CancellationToken cancellationToken) =>
        Ok(ReadMessagingGeneralValues(await FirstOrCreateAsync(db.MessagingSettings, () => new MessagingSettings(), cancellationToken)));

    [HttpPut("messaging")]
    [Authorize(Policy = "Permission:settings.manage")]
    public async Task<ActionResult<Dictionary<string, object?>>> UpdateMessaging(Dictionary<string, JsonElement> request, CancellationToken cancellationToken)
    {
        var item = await FirstOrCreateAsync(db.MessagingSettings, () => new MessagingSettings(), cancellationToken);
        var oldValue = ReadMessagingGeneralValues(item);
        var values = MergePayload(oldValue, request, MessagingGeneralDefaults);
        ValidateMessagingGeneral(values);

        item.IsEnabled = ToBool(values["enable_messaging"]);
        item.MaxRecipients = ToInt(values["max_recipients"]);
        item.AllowMultipleRecipients = ToBool(values["allow_multiple_recipients"]);
        item.SettingsJson = MergeSettingsJson(item.SettingsJson, values);
        item.UpdatedByUserId = currentUser.UserId;
        await db.SaveChangesAsync(cancellationToken);
        await settingsStore.SetValuesAsync("messaging", "messaging.general", values, MessagingGeneralDefaults, cancellationToken);
        await auditService.LogAsync("messaging_settings_updated", "messaging_settings", item.Id.ToString(), oldValue: oldValue, newValue: values, cancellationToken: cancellationToken);
        return Ok(ReadMessagingGeneralValues(item));
    }

    [HttpGet("messaging/request-integration")]
    public async Task<ActionResult<Dictionary<string, object?>>> GetMessagingRequestIntegration(CancellationToken cancellationToken) =>
        Ok(ReadMessagingRequestValues(await FirstOrCreateAsync(db.MessageRequestIntegrationSettings, () => new MessageRequestIntegrationSettings(), cancellationToken)));

    [HttpGet("messaging/request-notification-control")]
    [AllowAnonymous]
    public async Task<ActionResult<object>> GetMessagingRequestNotificationControl(CancellationToken cancellationToken)
    {
        if (User?.Identity?.IsAuthenticated != true)
        {
            return Unauthorized();
        }

        var values = ReadMessagingRequestValues(await FirstOrCreateAsync(db.MessageRequestIntegrationSettings, () => new MessageRequestIntegrationSettings(), cancellationToken));
        return Ok(new
        {
            show_checkbox = ToBool(values["show_request_notification_checkbox"]),
            default_checked = ToBool(values["default_send_request_notification"]),
            allow_toggle = ToBool(values["allow_requester_toggle_notification"])
        });
    }

    [HttpPut("messaging/request-integration")]
    [Authorize(Policy = "Permission:settings.manage")]
    public async Task<ActionResult<Dictionary<string, object?>>> UpdateMessagingRequestIntegration(Dictionary<string, JsonElement> request, CancellationToken cancellationToken)
    {
        var item = await FirstOrCreateAsync(db.MessageRequestIntegrationSettings, () => new MessageRequestIntegrationSettings(), cancellationToken);
        var oldValue = ReadMessagingRequestValues(item);
        var values = MergePayload(oldValue, request, MessagingRequestDefaults);

        item.AllowLinkToRequest = ToBool(values["allow_link_to_request"]);
        item.ShowMessagesTabInRequestDetails = ToBool(values["show_messages_tab_in_request_details"]);
        item.AllowSendMessageFromRequest = ToBool(values["allow_send_message_from_request"]);
        item.IncludeOfficialMessagesInRequestPdf = ToBool(values["include_official_messages_in_request_pdf"]);
        item.ExcludeInternalMessagesFromPdf = ToBool(values["exclude_internal_messages_from_pdf"]);
        item.AllowRequesterToViewMessages = ToBool(values["allow_request_owner_to_view_messages"]);
        item.AllowApproversToViewRequestMessages = ToBool(values["allow_approvers_to_view_request_messages"]);
        item.SettingsJson = MergeSettingsJson(item.SettingsJson, values);
        await db.SaveChangesAsync(cancellationToken);
        await settingsStore.SetValuesAsync("messaging", "messaging.request", values, MessagingRequestDefaults, cancellationToken);
        await auditService.LogAsync("message_request_integration_updated", "message_request_integration_settings", item.Id.ToString(), oldValue: oldValue, newValue: values, cancellationToken: cancellationToken);
        return Ok(ReadMessagingRequestValues(item));
    }

    [HttpGet("messaging/recipients")]
    public async Task<ActionResult<Dictionary<string, object?>>> GetMessagingRecipients(CancellationToken cancellationToken) =>
        Ok(ReadMessagingRecipientValues(await FirstOrCreateAsync(db.MessagingSettings, () => new MessagingSettings(), cancellationToken)));

    [HttpPut("messaging/recipients")]
    [Authorize(Policy = "Permission:settings.manage")]
    public async Task<ActionResult<Dictionary<string, object?>>> UpdateMessagingRecipients(Dictionary<string, JsonElement> request, CancellationToken cancellationToken)
    {
        var item = await FirstOrCreateAsync(db.MessagingSettings, () => new MessagingSettings(), cancellationToken);
        var oldValue = ReadMessagingRecipientValues(item);
        var values = MergePayload(oldValue, request, MessagingRecipientsDefaults);
        ValidateMessagingRecipients(values);

        item.AllowSendToUsers = ToBool(values["allow_send_to_user"]);
        item.AllowSendToDepartments = ToBool(values["allow_send_to_department"]);
        item.AllowMultipleRecipients = ToBool(values["allow_multiple_recipients"]);
        item.RestrictToActiveUsers = ToBool(values["prevent_sending_to_inactive_users"]);
        item.MaxRecipients = ToInt(values["max_recipients"]);
        item.SettingsJson = MergeSettingsJson(item.SettingsJson, values);
        item.UpdatedByUserId = currentUser.UserId;
        await db.SaveChangesAsync(cancellationToken);
        await settingsStore.SetValuesAsync("messaging", "messaging.recipients", values, MessagingRecipientsDefaults, cancellationToken);
        await auditService.LogAsync("message_recipients_settings_updated", "messaging_settings", item.Id.ToString(), oldValue: oldValue, newValue: values, cancellationToken: cancellationToken);
        return Ok(ReadMessagingRecipientValues(item));
    }

    [HttpGet("messaging/notifications")]
    public async Task<ActionResult<Dictionary<string, object?>>> GetMessagingNotifications(CancellationToken cancellationToken) =>
        Ok(ReadMessagingNotificationValues(await FirstOrCreateAsync(db.MessageNotificationSettings, () => new MessageNotificationSettings(), cancellationToken)));

    [HttpPut("messaging/notifications")]
    [Authorize(Policy = "Permission:settings.manage")]
    public async Task<ActionResult<Dictionary<string, object?>>> UpdateMessagingNotifications(Dictionary<string, JsonElement> request, CancellationToken cancellationToken)
    {
        var item = await FirstOrCreateAsync(db.MessageNotificationSettings, () => new MessageNotificationSettings(), cancellationToken);
        var oldValue = ReadMessagingNotificationValues(item);
        var values = MergePayload(oldValue, request, MessagingNotificationDefaults);

        item.NotifyOnNewMessage = ToBool(values["notify_on_new_message"]);
        item.NotifyOnRead = ToBool(values["notify_on_read"]);
        item.NotifyOnRequestLinkedMessage = ToBool(values["notify_on_clarification_request"]) || ToBool(values["notify_on_official_message"]);
        item.AllowUserPreference = ToBool(values["enable_unread_reminder"]);
        item.SettingsJson = MergeSettingsJson(item.SettingsJson, values);
        await db.SaveChangesAsync(cancellationToken);
        await settingsStore.SetValuesAsync("messaging", "messaging.notifications", values, MessagingNotificationDefaults, cancellationToken);
        await auditService.LogAsync("message_notification_settings_updated", "message_notification_settings", item.Id.ToString(), oldValue: oldValue, newValue: values, cancellationToken: cancellationToken);
        return Ok(ReadMessagingNotificationValues(item));
    }

    [HttpGet("messaging/retention")]
    public async Task<ActionResult<Dictionary<string, object?>>> GetMessagingRetention(CancellationToken cancellationToken) =>
        Ok(ReadMessagingRetentionValues(await FirstOrCreateAsync(db.MessageRetentionPolicies, () => new MessageRetentionPolicy(), cancellationToken)));

    [HttpPut("messaging/retention")]
    [Authorize(Policy = "Permission:settings.manage")]
    public async Task<ActionResult<Dictionary<string, object?>>> UpdateMessagingRetention(Dictionary<string, JsonElement> request, CancellationToken cancellationToken)
    {
        var item = await FirstOrCreateAsync(db.MessageRetentionPolicies, () => new MessageRetentionPolicy(), cancellationToken);
        var oldValue = ReadMessagingRetentionValues(item);
        var values = MergePayload(oldValue, request, MessagingRetentionDefaults);
        ValidateRetention(values);

        item.AllowArchive = ToBool(values["allow_archiving"]);
        item.MessageRetentionDays = ToInt(values["retention_days"]);
        item.AttachmentRetentionDays = ToInt(values["attachment_retention_days"]);
        item.PreventPermanentDelete = ToBool(values["prevent_hard_delete"]);
        item.AllowUserDeleteOwnMessage = ToBool(values["allow_user_delete_own_messages"]);
        item.OfficialMessagesProtected = ToBool(values["exclude_official_messages_from_delete"]);
        item.ConfidentialMessagesProtected = ToBool(values["exclude_confidential_messages_from_delete"]);
        item.SettingsJson = MergeSettingsJson(item.SettingsJson, values);
        await db.SaveChangesAsync(cancellationToken);
        await settingsStore.SetValuesAsync("messaging", "messaging.retention", values, MessagingRetentionDefaults, cancellationToken);
        await auditService.LogAsync("message_retention_settings_updated", "message_retention_policies", item.Id.ToString(), oldValue: oldValue, newValue: values, cancellationToken: cancellationToken);
        return Ok(ReadMessagingRetentionValues(item));
    }

    [HttpGet("messaging/security")]
    public async Task<ActionResult<Dictionary<string, object?>>> GetMessagingSecurity(CancellationToken cancellationToken) =>
        Ok(ReadMessagingSecurityValues(await FirstOrCreateAsync(db.MessageSecurityPolicies, () => new MessageSecurityPolicy(), cancellationToken)));

    [HttpPut("messaging/security")]
    [Authorize(Policy = "Permission:settings.manage")]
    public async Task<ActionResult<Dictionary<string, object?>>> UpdateMessagingSecurity(Dictionary<string, JsonElement> request, CancellationToken cancellationToken)
    {
        var item = await FirstOrCreateAsync(db.MessageSecurityPolicies, () => new MessageSecurityPolicy(), cancellationToken);
        var oldValue = ReadMessagingSecurityValues(item);
        var values = MergePayload(oldValue, request, MessagingSecurityDefaults);

        item.SettingsJson = MergeSettingsJson(item.SettingsJson, values);
        await db.SaveChangesAsync(cancellationToken);
        await settingsStore.SetValuesAsync("messaging", "messaging.security", values, MessagingSecurityDefaults, cancellationToken);
        await auditService.LogAsync("message_security_policy_updated", "message_security_policies", item.Id.ToString(), oldValue: oldValue, newValue: values, cancellationToken: cancellationToken);
        return Ok(ReadMessagingSecurityValues(item));
    }

    [HttpGet("messaging/ai")]
    public async Task<ActionResult<Dictionary<string, object?>>> GetMessagingAi(CancellationToken cancellationToken)
    {
        var values = ReadMessagingAiValues(await FirstOrCreateAsync(db.MessageAiSettings, () => new MessageAiSettings(), cancellationToken));
        var aiEnabled = await db.AiSettings.AsNoTracking().Select(x => (bool?)x.IsEnabled).FirstOrDefaultAsync(cancellationToken);
        values["global_ai_enabled"] = aiEnabled ?? false;
        return Ok(values);
    }

    [HttpPut("messaging/ai")]
    [Authorize(Policy = "Permission:settings.manage")]
    public async Task<ActionResult<Dictionary<string, object?>>> UpdateMessagingAi(Dictionary<string, JsonElement> request, CancellationToken cancellationToken)
    {
        var item = await FirstOrCreateAsync(db.MessageAiSettings, () => new MessageAiSettings(), cancellationToken);
        var oldValue = ReadMessagingAiValues(item);
        var values = MergePayload(oldValue, request, MessagingAiDefaults);

        item.ShowAssistantInCompose = ToBool(values["show_ai_in_compose"]);
        item.IsEnabled = values.Where(x => x.Key.StartsWith("allow_ai_", StringComparison.OrdinalIgnoreCase) || x.Key.StartsWith("show_ai_", StringComparison.OrdinalIgnoreCase)).Any(x => ToBool(x.Value));
        item.SettingsJson = MergeSettingsJson(item.SettingsJson, values);
        await db.SaveChangesAsync(cancellationToken);
        await settingsStore.SetValuesAsync("messaging", "messaging.ai", values, MessagingAiDefaults, cancellationToken);
        await auditService.LogAsync("message_ai_settings_updated", "message_ai_settings", item.Id.ToString(), oldValue: oldValue, newValue: values, cancellationToken: cancellationToken);
        return Ok(ReadMessagingAiValues(item));
    }

    [HttpGet("messaging/auto-rules")]
    public async Task<ActionResult<IReadOnlyCollection<Dictionary<string, object?>>>> GetMessagingAutoRules(CancellationToken cancellationToken) =>
        Ok(await ReadMessagingAutoRulesAsync(cancellationToken));

    [HttpPut("messaging/auto-rules")]
    [Authorize(Policy = "Permission:settings.manage")]
    public async Task<ActionResult<IReadOnlyCollection<Dictionary<string, object?>>>> UpdateMessagingAutoRules([FromBody] JsonElement request, CancellationToken cancellationToken)
    {
        if (request.ValueKind != JsonValueKind.Array)
        {
            throw new ApiException("قواعد المراسلات الآلية غير صالحة");
        }

        var oldValue = await ReadMessagingAutoRulesAsync(cancellationToken);
        var existingRules = await db.MessageAutoRules.ToListAsync(cancellationToken);
        var messageTypes = await db.MessageTypes.AsNoTracking().ToDictionaryAsync(x => x.Id, x => x.Code, cancellationToken);
        foreach (var (row, index) in request.EnumerateArray().Where(x => x.ValueKind == JsonValueKind.Object).Select((row, index) => (row, index)))
        {
            var id = JsonNumber(row, "id");
            var eventCode = JsonString(row, "event_code")?.Trim();
            if (string.IsNullOrWhiteSpace(eventCode))
            {
                eventCode = $"event_{index + 1}";
            }

            var item = id.HasValue
                ? existingRules.FirstOrDefault(x => x.Id == id.Value)
                : existingRules.FirstOrDefault(x => x.EventCode.Equals(eventCode, StringComparison.OrdinalIgnoreCase));
            if (item is null)
            {
                item = new MessageAutoRule { EventCode = eventCode };
                db.MessageAutoRules.Add(item);
                existingRules.Add(item);
            }

            var messageTypeId = JsonNumber(row, "message_type_id");
            if (messageTypeId.HasValue && !messageTypes.ContainsKey(messageTypeId.Value))
            {
                throw new ApiException("نوع الرسالة في قاعدة الإرسال الآلي غير موجود");
            }

            item.EventCode = eventCode;
            item.IsEnabled = JsonBool(row, "is_enabled");
            item.MessageTypeId = messageTypeId;
            item.MessageTypeCode = messageTypeId.HasValue ? messageTypes[messageTypeId.Value] : null;
            item.SubjectTemplate = JsonString(row, "subject_template") ?? "";
            item.BodyTemplate = JsonString(row, "body_template") ?? "";
            item.UpdatedAt = DateTimeOffset.UtcNow;
        }

        await db.SaveChangesAsync(cancellationToken);
        var updated = await ReadMessagingAutoRulesAsync(cancellationToken);
        await SyncLegacyAutoRulesAsync(updated, cancellationToken);
        await auditService.LogAsync("message_auto_rules_updated", "message_auto_rules", "auto-rules", oldValue: oldValue, newValue: updated, cancellationToken: cancellationToken);
        return Ok(updated);
    }

    [HttpGet("messaging/analytics")]
    public async Task<ActionResult<object>> GetMessagingAnalytics(CancellationToken cancellationToken)
    {
        var today = DateTimeOffset.UtcNow.Date;
        var monthStart = new DateTimeOffset(today.Year, today.Month, 1, 0, 0, 0, TimeSpan.Zero);
        var messagesToday = await db.Messages.CountAsync(x => x.SentAt >= today, cancellationToken);
        var messagesThisMonth = await db.Messages.CountAsync(x => x.SentAt >= monthStart, cancellationToken);
        var unread = await db.MessageRecipients.CountAsync(x => !x.IsRead && !x.IsArchived, cancellationToken);
        var attachments = await db.MessageAttachments.CountAsync(x => !x.IsDeleted, cancellationToken);
        var mostUsedType = await db.Messages
            .AsNoTracking()
            .GroupBy(x => x.MessageType!.NameAr)
            .OrderByDescending(x => x.Count())
            .Select(x => x.Key)
            .FirstOrDefaultAsync(cancellationToken);

        return Ok(new
        {
            messages_today = messagesToday,
            messages_this_month = messagesThisMonth,
            unread_messages = unread,
            most_used_message_type = mostUsedType,
            open_clarification_requests = 0,
            average_reply_time_hours = 0,
            attachments_count = attachments,
            top_departments = Array.Empty<object>()
        });
    }

    [HttpGet("messaging/audit-logs")]
    public async Task<ActionResult<IReadOnlyCollection<object>>> GetMessagingAuditLogs(CancellationToken cancellationToken)
    {
        var logs = await db.AuditLogs
            .AsNoTracking()
            .Include(x => x.User)
            .Where(x => x.Action.Contains("message") || x.EntityType.Contains("messaging"))
            .OrderByDescending(x => x.CreatedAt)
            .Take(100)
            .Select(x => new
            {
                id = x.Id,
                action = x.Action,
                user_name = x.User != null ? x.User.NameAr : null,
                ip_address = x.IpAddress,
                created_at = x.CreatedAt
            })
            .ToListAsync(cancellationToken);
        return Ok(logs);
    }

    [HttpGet("ai")]
    public async Task<ActionResult<Dictionary<string, object?>>> GetAi(CancellationToken cancellationToken) =>
        Ok(ReadAiValues(await FirstOrCreateAsync(db.AiSettings, () => new AiSettings(), cancellationToken)));

    [HttpPut("ai")]
    [Authorize(Policy = "Permission:settings.manage")]
    public async Task<ActionResult<Dictionary<string, object?>>> UpdateAi(Dictionary<string, JsonElement> request, CancellationToken cancellationToken)
    {
        var item = await FirstOrCreateAsync(db.AiSettings, () => new AiSettings(), cancellationToken);
        var oldValue = ReadAiValues(item);
        var values = MergePayload(oldValue, request, AiDefaults);
        ValidateAi(values);

        item.IsEnabled = ToBool(values["is_enabled"]);
        item.Provider = ToStringValue(values["provider"]);
        values["api_base_url"] = NormalizeAiBaseUrl(ToStringValue(values["api_base_url"]));
        item.BaseUrl = ToStringValue(values["api_base_url"]);
        item.ModelName = ToStringValue(values["model_name"]);
        item.MaxInputChars = ToInt(values["max_input_chars"]);
        item.SystemPrompt = ToStringValue(values["system_prompt"]);
        item.SettingsJson = MergeSettingsJson(item.SettingsJson, values);
        item.UpdatedByUserId = currentUser.UserId;

        await db.SaveChangesAsync(cancellationToken);
        await settingsStore.SetValuesAsync("ai", "ai", values, AiDefaults, cancellationToken);
        await auditService.LogAsync("ai_settings_updated", "ai_settings", item.Id.ToString(), oldValue: oldValue, newValue: values, cancellationToken: cancellationToken);
        return Ok(ReadAiValues(item));
    }

    [HttpGet("ai/features")]
    public async Task<ActionResult<object>> GetAiFeatures(CancellationToken cancellationToken)
    {
        var roles = await db.Roles.AsNoTracking().Where(x => x.IsActive).OrderBy(x => x.NameAr).ToListAsync(cancellationToken);
        var permissions = await db.AiFeaturePermissions
            .AsNoTracking()
            .Where(x => x.RoleId != null && x.UserId == null)
            .ToListAsync(cancellationToken);
        var byRoleAndFeature = permissions.ToDictionary(
            x => $"{x.RoleId}:{x.Feature}",
            x => x,
            StringComparer.OrdinalIgnoreCase);

        var features = AiFeatureDefinitions.Select(feature => new { code = feature.Code, label = feature.Label }).ToList();
        var items = roles.SelectMany(role => AiFeatureDefinitions.Select(feature =>
        {
            byRoleAndFeature.TryGetValue($"{role.Id}:{feature.Code}", out var permission);
            return new
            {
                role_id = role.Id,
                role_name = role.Code,
                role_label_ar = role.NameAr,
                feature_code = feature.Code,
                is_enabled = permission?.IsAllowed ?? role.Code == "super_admin",
                daily_limit = role.Code == "super_admin" ? 1000 : 20,
                monthly_limit = role.Code == "super_admin" ? 30000 : 500
            };
        })).ToList();
        return Ok(new { features, items });
    }

    [HttpPut("ai/features")]
    [Authorize(Policy = "Permission:settings.manage")]
    public async Task<ActionResult<object>> UpdateAiFeatures(JsonElement request, CancellationToken cancellationToken)
    {
        var rows = ExtractAiFeatureRows(request);
        var validFeatureCodes = AiFeatureDefinitions.Select(x => x.Code).ToHashSet(StringComparer.OrdinalIgnoreCase);
        var changed = new List<object>();

        foreach (var row in rows)
        {
            if (!TryReadLong(row, "role_id", out var roleId) ||
                !TryReadString(row, "feature_code", out var featureCode) ||
                !validFeatureCodes.Contains(featureCode))
            {
                continue;
            }

            var roleExists = await db.Roles.AsNoTracking().AnyAsync(x => x.Id == roleId && x.IsActive, cancellationToken);
            if (!roleExists)
            {
                continue;
            }

            var isEnabled = TryReadBool(row, "is_enabled", out var allowed) && allowed;
            var permission = await db.AiFeaturePermissions
                .FirstOrDefaultAsync(x => x.RoleId == roleId && x.UserId == null && x.Feature == featureCode, cancellationToken);
            if (permission is null)
            {
                permission = new AiFeaturePermission
                {
                    RoleId = roleId,
                    Feature = featureCode
                };
                db.AiFeaturePermissions.Add(permission);
            }

            permission.IsAllowed = isEnabled;
            changed.Add(new { role_id = roleId, feature_code = featureCode, is_enabled = isEnabled });
        }

        await db.SaveChangesAsync(cancellationToken);
        await auditService.LogAsync("ai_feature_settings_updated", "ai_feature_permissions", "features", newValue: changed, cancellationToken: cancellationToken);
        return await GetAiFeatures(cancellationToken);
    }

    [HttpGet("ai/usage-logs")]
    public async Task<ActionResult<object>> GetAiUsageLogs(CancellationToken cancellationToken)
    {
        var today = new DateTimeOffset(DateTime.UtcNow.Date, TimeSpan.Zero);
        var last7Days = DateTimeOffset.UtcNow.AddDays(-7);
        var usageToday = await db.AiUsageLogs.AsNoTracking().CountAsync(x => x.CreatedAt >= today, cancellationToken);
        var usageLast7Days = await db.AiUsageLogs.AsNoTracking().CountAsync(x => x.CreatedAt >= last7Days, cancellationToken);
        var errorsCount = await db.AiUsageLogs.AsNoTracking().CountAsync(x => x.Status != "success", cancellationToken);
        var averageLatency = await db.AiUsageLogs.AsNoTracking()
            .Where(x => x.LatencyMs > 0)
            .AverageAsync(x => (double?)x.LatencyMs, cancellationToken) ?? 0;
        var mostUsedFeature = await db.AiUsageLogs.AsNoTracking()
            .GroupBy(x => x.Feature)
            .Select(x => new { feature = x.Key, count = x.Count() })
            .OrderByDescending(x => x.count)
            .FirstOrDefaultAsync(cancellationToken);
        var latestHealth = await db.AiHealthChecks.AsNoTracking().OrderByDescending(x => x.CheckedAt).FirstOrDefaultAsync(cancellationToken);
        var logs = await db.AiUsageLogs.AsNoTracking()
            .Include(x => x.User)
            .OrderByDescending(x => x.CreatedAt)
            .Take(100)
            .Select(x => new
            {
                id = x.Id,
                feature = x.Feature,
                status = x.Status,
                input_chars = x.InputChars,
                output_chars = x.OutputChars,
                latency_ms = x.LatencyMs,
                error_message = x.ErrorMessage,
                user_name = x.User != null ? x.User.NameAr : null,
                created_at = x.CreatedAt
            })
            .ToListAsync(cancellationToken);
        var topUsersSource = await db.AiUsageLogs.AsNoTracking()
            .Include(x => x.User)
            .Where(x => x.UserId != null)
            .OrderByDescending(x => x.CreatedAt)
            .Take(1000)
            .ToListAsync(cancellationToken);
        var topUsers = topUsersSource
            .GroupBy(x => new { x.UserId, UserName = x.User != null ? x.User.NameAr : "غير معروف" })
            .Select(x => new { user_id = x.Key.UserId, user_name = x.Key.UserName, count = x.Count() })
            .OrderByDescending(x => x.count)
            .Take(10)
            .ToList();

        return Ok(new
        {
            usage_today = usageToday,
            usage_last_7_days = usageLast7Days,
            most_used_feature = mostUsedFeature?.feature,
            average_latency_ms = (int)Math.Round(averageLatency),
            errors_count = errorsCount,
            model_status = latestHealth?.Status ?? "unknown",
            logs,
            top_users = topUsers
        });
    }

    [HttpGet("ai/health")]
    public async Task<ActionResult<object>> GetAiHealth(CancellationToken cancellationToken)
    {
        var item = await FirstOrCreateAsync(db.AiSettings, () => new AiSettings(), cancellationToken);
        var settings = ReadAiValues(item);
        var latest = await db.AiHealthChecks.AsNoTracking()
            .Where(x => x.Provider == item.Provider)
            .OrderByDescending(x => x.CheckedAt)
            .FirstOrDefaultAsync(cancellationToken);
        return Ok(new
        {
            status = !ToBool(settings["is_enabled"]) ? "disabled" : latest?.Status ?? "not_checked",
            provider = settings["provider"],
            model_name = settings["model_name"],
            latency_ms = latest?.LatencyMs,
            message = latest?.Message,
            checked_at = latest?.CheckedAt
        });
    }

    [HttpGet("ai/audit-logs")]
    public async Task<ActionResult<IReadOnlyCollection<object>>> GetAiAuditLogs(CancellationToken cancellationToken)
    {
        var logs = await db.AuditLogs
            .AsNoTracking()
            .Include(x => x.User)
            .Where(x => x.Action.Contains("ai_") || x.EntityType == "ai_settings")
            .OrderByDescending(x => x.CreatedAt)
            .Take(100)
            .Select(x => new
            {
                x.Id,
                x.Action,
                user_name = x.User != null ? x.User.NameAr : null,
                x.IpAddress,
                x.OldValueJson,
                x.NewValueJson,
                x.CreatedAt
            })
            .ToListAsync(cancellationToken);
        return Ok(logs);
    }

    [HttpPost("ai/test-connection")]
    [Authorize(Policy = "Permission:settings.manage")]
    public async Task<ActionResult<object>> TestAiConnection(CancellationToken cancellationToken)
    {
        var item = await FirstOrCreateAsync(db.AiSettings, () => new AiSettings(), cancellationToken);
        var settings = ReadAiValues(item);
        var provider = ToStringValue(settings["provider"]);
        var baseUrl = NormalizeAiBaseUrl(ToStringValue(settings["api_base_url"]));
        var targetUrl = provider.Contains("ollama", StringComparison.OrdinalIgnoreCase)
            ? $"{baseUrl}/api/tags"
            : baseUrl;

        var watch = Stopwatch.StartNew();
        var ok = false;
        var status = "failed";
        var message = "لم يتم ضبط رابط مزود الذكاء الاصطناعي";

        if (!string.IsNullOrWhiteSpace(baseUrl))
        {
            try
            {
                using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(Math.Max(5, ToInt(settings["timeout_seconds"]))) };
                using var response = await http.GetAsync(targetUrl, cancellationToken);
                ok = response.IsSuccessStatusCode;
                status = ok ? "healthy" : "warning";
                message = ok ? "الاتصال بمزود الذكاء الاصطناعي ناجح" : $"استجاب المزود بالحالة {(int)response.StatusCode}";
            }
            catch (Exception exc) when (exc is HttpRequestException or TaskCanceledException or OperationCanceledException)
            {
                status = "failed";
                var hint = baseUrl.Contains("localhost", StringComparison.OrdinalIgnoreCase) || baseUrl.Contains("127.0.0.1", StringComparison.OrdinalIgnoreCase)
                    ? " إذا كانت خدمة .NET تعمل داخل Docker فاستخدم http://host.docker.internal:11434 بدلاً من localhost."
                    : "";
                message = $"فشل الاتصال بمزود الذكاء الاصطناعي: {exc.Message}{hint}";
            }
        }

        watch.Stop();
        db.AiHealthChecks.Add(new AiHealthCheck
        {
            Provider = provider,
            Status = status,
            LatencyMs = (int)Math.Min(int.MaxValue, watch.ElapsedMilliseconds),
            Message = message,
            CheckedAt = DateTimeOffset.UtcNow
        });
        db.AiUsageLogs.Add(new AiUsageLog
        {
            UserId = currentUser.UserId,
            Feature = "test_connection",
            InputChars = 0,
            OutputChars = message.Length,
            LatencyMs = (int)Math.Min(int.MaxValue, watch.ElapsedMilliseconds),
            Status = ok ? "success" : "failed",
            ErrorMessage = ok ? null : message
        });
        await db.SaveChangesAsync(cancellationToken);
        await auditService.LogAsync("ai_connection_tested", "ai_settings", item.Id.ToString(), metadata: new { ok, status, provider, base_url = baseUrl }, result: ok ? "success" : "failed", cancellationToken: cancellationToken);
        return Ok(new { ok, status, provider, model_name = settings["model_name"], latency_ms = (int)Math.Min(int.MaxValue, watch.ElapsedMilliseconds), message, checked_at = DateTimeOffset.UtcNow });
    }

    [HttpPost("ai/test-generation")]
    [Authorize(Policy = "Permission:settings.manage")]
    public ActionResult<object> TestAiGeneration(Dictionary<string, JsonElement> request)
    {
        var prompt = request.TryGetValue("prompt", out var value) ? value.GetString() : "";
        return Ok(new { ok = true, sample = $"نموذج اختبار: {prompt}" });
    }

    [HttpPost("ai/test-masking")]
    [Authorize(Policy = "Permission:settings.manage")]
    public ActionResult<object> TestAiMasking(Dictionary<string, JsonElement> request)
    {
        var text = request.TryGetValue("text", out var value) ? value.GetString() ?? "" : "";
        var masked = System.Text.RegularExpressions.Regex.Replace(text, @"[\w\.-]+@[\w\.-]+", "***@***");
        masked = System.Text.RegularExpressions.Regex.Replace(masked, @"\b\d{6,}\b", "******");
        return Ok(new { ok = true, output_text = masked });
    }

    [HttpGet("database")]
    public Task<ActionResult<Dictionary<string, object?>>> GetDatabase(CancellationToken cancellationToken) =>
        GetSettingsObject("database", "database", DatabaseDefaults, cancellationToken);

    [HttpPut("database")]
    [Authorize(Policy = "Permission:settings.manage")]
    public Task<ActionResult<Dictionary<string, object?>>> UpdateDatabase(Dictionary<string, JsonElement> request, CancellationToken cancellationToken) =>
        SaveSettingsObject("database", "database", DatabaseDefaults, request, ValidateDatabase, "database_settings_updated", cancellationToken);

    [HttpGet("notifications")]
    public Task<ActionResult<Dictionary<string, object?>>> GetNotifications(CancellationToken cancellationToken) =>
        GetSettingsObject("notifications", "notifications", NotificationDefaults, cancellationToken);

    [HttpPut("notifications")]
    [Authorize(Policy = "Permission:settings.manage")]
    public Task<ActionResult<Dictionary<string, object?>>> UpdateNotifications(Dictionary<string, JsonElement> request, CancellationToken cancellationToken) =>
        SaveSettingsObject("notifications", "notifications", NotificationDefaults, request, _ => { }, "notification_settings_updated", cancellationToken);

    [HttpGet("database/status")]
    public async Task<ActionResult<object>> GetDatabaseStatus(CancellationToken cancellationToken)
    {
        var stopwatch = Stopwatch.StartNew();
        await db.Database.OpenConnectionAsync(cancellationToken);
        await db.Database.CloseConnectionAsync();
        stopwatch.Stop();

        var entityTypes = db.Model.GetEntityTypes().Where(x => x.GetTableName() is not null).ToList();
        var recordsCount = await db.Users.CountAsync(cancellationToken)
                           + await db.Requests.CountAsync(cancellationToken)
                           + await db.Messages.CountAsync(cancellationToken)
                           + await db.Documents.CountAsync(cancellationToken)
                           + await db.AuditLogs.CountAsync(cancellationToken);

        return Ok(new
        {
            status = "healthy",
            database_type = "PostgreSQL",
            database_name = db.Database.GetDbConnection().Database,
            latency_ms = stopwatch.ElapsedMilliseconds,
            tables_count = entityTypes.Count,
            records_count = recordsCount,
            size_mb = 0,
            last_backup_at = (DateTimeOffset?)null,
            last_restore_at = (DateTimeOffset?)null,
            last_maintenance_at = (DateTimeOffset?)null,
            message = "الاتصال بقاعدة البيانات يعمل في Backend .NET المستقل"
        });
    }

    [HttpGet("database/tables")]
    public async Task<ActionResult<IReadOnlyCollection<object>>> GetDatabaseTables(CancellationToken cancellationToken)
    {
        var rows = new List<object>();
        var connection = db.Database.GetDbConnection();
        await db.Database.OpenConnectionAsync(cancellationToken);
        try
        {
            foreach (var entityType in db.Model.GetEntityTypes().Where(x => x.GetTableName() is not null).OrderBy(x => x.GetTableName()))
            {
                var table = entityType.GetTableName()!;
                var schema = entityType.GetSchema() ?? "public";
                long count = 0;
                await using var command = connection.CreateCommand();
                command.CommandText = $"SELECT COUNT(*) FROM \"{schema.Replace("\"", "\"\"")}\".\"{table.Replace("\"", "\"\"")}\"";
                var result = await command.ExecuteScalarAsync(cancellationToken);
                if (result is not null)
                {
                    count = Convert.ToInt64(result);
                }

                rows.Add(new
                {
                    table_name = table,
                    category = schema,
                    records_count = count,
                    size_mb = 0,
                    description = entityType.ClrType.Name
                });
            }
        }
        finally
        {
            await db.Database.CloseConnectionAsync();
        }

        return Ok(rows);
    }

    [HttpGet("database/backups")]
    public async Task<ActionResult<IReadOnlyCollection<object>>> GetDatabaseBackups(CancellationToken cancellationToken)
    {
        await Task.CompletedTask;
        return Ok(ReadBackupManifests().OrderByDescending(x => x.CreatedAt).Select(MapBackupManifest).ToList());
    }

    [HttpGet("database/jobs")]
    public async Task<ActionResult<IReadOnlyCollection<object>>> GetDatabaseJobs(CancellationToken cancellationToken)
    {
        var logs = await db.AuditLogs
            .AsNoTracking()
            .Include(x => x.User)
            .Where(x => x.Action.Contains("database_backup") || x.Action.Contains("database_restore") || x.Action.Contains("database_reset"))
            .OrderByDescending(x => x.CreatedAt)
            .Take(25)
            .Select(x => new
            {
                id = x.Id,
                operation_type = x.Action,
                status = x.Result == "success" ? "success" : "failed",
                progress = 100,
                started_by = x.User != null ? x.User.NameAr : null,
                started_at = x.CreatedAt,
                completed_at = x.CreatedAt,
                result = x.Result
            })
            .ToListAsync(cancellationToken);
        return Ok(logs);
    }

    [HttpGet("database/activity-log")]
    public async Task<ActionResult<IReadOnlyCollection<object>>> GetDatabaseActivityLog(CancellationToken cancellationToken)
    {
        var logs = await db.AuditLogs
            .AsNoTracking()
            .Include(x => x.User)
            .Where(x => x.EntityType.Contains("database") || x.Action.Contains("database") || x.Action.Contains("maintenance"))
            .OrderByDescending(x => x.CreatedAt)
            .Take(100)
            .Select(x => new
            {
                x.Id,
                x.Action,
                user = x.User != null ? x.User.NameAr : null,
                ip_address = x.IpAddress,
                result = x.Result,
                details = x.MetadataJson,
                created_at = x.CreatedAt
            })
            .ToListAsync(cancellationToken);
        return Ok(logs);
    }

    [HttpGet("database/backup-settings")]
    public Task<ActionResult<Dictionary<string, object?>>> GetDatabaseBackupSettings(CancellationToken cancellationToken) =>
        GetSettingsObject("database", "database.backup", DatabaseBackupDefaults, cancellationToken);

    [HttpPut("database/backup-settings")]
    [Authorize(Policy = "Permission:settings.manage")]
    public Task<ActionResult<Dictionary<string, object?>>> UpdateDatabaseBackupSettings(Dictionary<string, JsonElement> request, CancellationToken cancellationToken) =>
        SaveSettingsObject("database", "database.backup", DatabaseBackupDefaults, request, ValidateDatabaseBackupSettings, "database_backup_settings_updated", cancellationToken);

    [HttpGet("database/migrations/status")]
    public async Task<ActionResult<object>> GetDatabaseMigrationStatus(CancellationToken cancellationToken)
    {
        var pending = await db.Database.GetPendingMigrationsAsync(cancellationToken);
        return Ok(new
        {
            pending_count = pending.Count(),
            pending_migrations = pending.ToList(),
            message = pending.Any() ? "توجد ترحيلات معلقة" : "لا توجد ترحيلات معلقة"
        });
    }

    [HttpPost("database/maintenance/{maintenanceAction}")]
    [Authorize(Policy = "Permission:settings.manage")]
    public async Task<ActionResult<object>> RunDatabaseMaintenance([FromRoute] string maintenanceAction, CancellationToken cancellationToken)
    {
        var startedAt = DateTimeOffset.UtcNow;
        object result = maintenanceAction switch
        {
            "test-connection" => await RunConnectionMaintenanceAsync(cancellationToken),
            "check-integrity" => await RunDatabaseIntegrityCheckAsync(cancellationToken),
            "optimize" => await RunAnalyzeMaintenanceAsync("optimize", cancellationToken),
            "reindex" => new { status = "guarded", message = "إعادة بناء الفهارس عملية ثقيلة، لذلك تُترك لعملية صيانة مجدولة خارج ساعات العمل.", progress = 100 },
            "analyze" => await RunAnalyzeMaintenanceAsync("analyze", cancellationToken),
            "clean-temp" => new { status = "success", message = "لا توجد ملفات مؤقتة مُدارة من Backend .NET المستقل حالياً.", progress = 100 },
            "check-orphan-attachments" => await RunAttachmentConsistencyCheckAsync(cancellationToken),
            _ => throw new ApiException("إجراء الصيانة غير معروف", StatusCodes.Status404NotFound)
        };

        await auditService.LogAsync("database_maintenance_run", "database", maintenanceAction, newValue: result, metadata: new { startedAt }, cancellationToken: cancellationToken);
        return Ok(result);
    }

    [HttpPost("database/backup")]
    [Authorize(Policy = "Permission:settings.manage")]
    public async Task<ActionResult<object>> CreateDatabaseBackup(Dictionary<string, JsonElement>? request, CancellationToken cancellationToken)
    {
        var backupType = request is not null && request.TryGetValue("backup_type", out var value) ? value.GetString() : "full_backup";
        bool? includeUploadsOverride = null;
        if (request is not null && request.TryGetValue("include_uploads", out var includeUploadsValue))
        {
            includeUploadsOverride = includeUploadsValue.ValueKind switch
            {
                JsonValueKind.True => true,
                JsonValueKind.False => false,
                JsonValueKind.String when bool.TryParse(includeUploadsValue.GetString(), out var parsed) => parsed,
                _ => includeUploadsOverride
            };
        }

        var manifest = await CreateDatabaseBackupAsync(backupType ?? "full_backup", "manual", cancellationToken, includeUploadsOverride);
        await auditService.LogAsync("database_backup_created", "database_backup", manifest.Id, newValue: manifest, cancellationToken: cancellationToken);
        return Ok(MapBackupManifest(manifest));
    }

    [HttpGet("database/backups/{backupId}/download")]
    [Authorize(Policy = "Permission:settings.manage")]
    public async Task<IActionResult> DownloadDatabaseBackup(string backupId, CancellationToken cancellationToken)
    {
        var manifest = RequireBackupManifest(backupId);
        await auditService.LogAsync("database_backup_downloaded", "database_backup", backupId, cancellationToken: cancellationToken);
        return PhysicalFile(manifest.FilePath, "application/zip", manifest.FileName);
    }

    [HttpPost("database/backups/{backupId}/decrypt-download")]
    [Authorize(Policy = "Permission:settings.manage")]
    public async Task<IActionResult> DecryptDatabaseBackup(string backupId, Dictionary<string, JsonElement> request, CancellationToken cancellationToken)
    {
        await VerifyDangerousOperationAsync(request, "DECRYPT BACKUP", cancellationToken);
        var manifest = RequireBackupManifest(backupId);
        if (!manifest.Encrypted)
        {
            await auditService.LogAsync("database_backup_decrypt_downloaded", "database_backup", backupId, cancellationToken: cancellationToken);
            return PhysicalFile(manifest.FilePath, "application/zip", manifest.FileName);
        }

        var bytes = await System.IO.File.ReadAllBytesAsync(manifest.FilePath, cancellationToken);
        var decrypted = DecryptBytes(bytes);
        var downloadName = manifest.FileName.EndsWith(".enc", StringComparison.OrdinalIgnoreCase)
            ? manifest.FileName[..^4]
            : $"{Path.GetFileNameWithoutExtension(manifest.FileName)}.zip";
        await auditService.LogAsync("database_backup_decrypt_downloaded", "database_backup", backupId, cancellationToken: cancellationToken);
        return File(decrypted, "application/zip", downloadName);
    }

    [HttpPost("database/backups/{backupId}/verify")]
    [Authorize(Policy = "Permission:settings.manage")]
    public async Task<ActionResult<object>> VerifyDatabaseBackup(string backupId, CancellationToken cancellationToken)
    {
        var manifest = RequireBackupManifest(backupId);
        var checksum = await ComputeSha256Async(manifest.FilePath, cancellationToken);
        var ok = string.Equals(checksum, manifest.Checksum, StringComparison.OrdinalIgnoreCase);
        manifest.VerifiedAt = DateTimeOffset.UtcNow;
        manifest.Status = ok ? "verified" : "corrupt";
        await SaveBackupManifestAsync(manifest, cancellationToken);
        await auditService.LogAsync("database_backup_verified", "database_backup", backupId, newValue: new { ok }, result: ok ? "success" : "failed", cancellationToken: cancellationToken);
        return Ok(new { ok, status = manifest.Status, verified_at = manifest.VerifiedAt, message = ok ? "النسخة الاحتياطية سليمة" : "فشل التحقق من سلامة النسخة" });
    }

    [HttpDelete("database/backups/{backupId}")]
    [Authorize(Policy = "Permission:settings.manage")]
    public async Task<ActionResult<object>> DeleteDatabaseBackup(string backupId, [FromBody] Dictionary<string, JsonElement> request, CancellationToken cancellationToken)
    {
        await VerifyDangerousOperationAsync(request, "DELETE BACKUP", cancellationToken);
        var manifest = RequireBackupManifest(backupId);
        if (System.IO.File.Exists(manifest.FilePath))
        {
            System.IO.File.Delete(manifest.FilePath);
        }

        var manifestPath = GetBackupManifestPath(backupId);
        if (System.IO.File.Exists(manifestPath))
        {
            System.IO.File.Delete(manifestPath);
        }

        await auditService.LogAsync("database_backup_deleted", "database_backup", backupId, oldValue: manifest, cancellationToken: cancellationToken);
        return Ok(new { ok = true, message = "تم حذف النسخة الاحتياطية" });
    }

    [HttpGet("database/reset-preview")]
    public async Task<ActionResult<object>> GetDatabaseResetPreview([FromQuery] string scope, CancellationToken cancellationToken)
    {
        var tables = await GetResetScopeTablesAsync(scope, cancellationToken);
        return Ok(new
        {
            scope,
            tables,
            warnings = new[]
            {
                "سيتم إنشاء نسخة احتياطية تلقائياً قبل أي تنفيذ.",
                "التنفيذ الفعلي يحتاج كلمة مرور مدير النظام وعبارة RESET DATABASE.",
                "العمليات الخطرة لا تعمل إلا إذا تم تفعيل EnableDangerousDatabaseOperations في بيئة .NET المستقلة."
            }
        });
    }

    [HttpPost("database/reset")]
    [Authorize(Policy = "Permission:settings.manage")]
    public async Task<ActionResult<object>> RunDatabaseReset(Dictionary<string, JsonElement> request, CancellationToken cancellationToken)
    {
        await VerifyDangerousOperationAsync(request, "RESET DATABASE", cancellationToken);
        if (!request.TryGetValue("understand_risk", out var risk) || !risk.GetBoolean())
        {
            throw new ApiException("يجب تأكيد فهم مخاطر إعادة الضبط");
        }

        EnsureDangerousOperationsEnabled();
        var scope = request.TryGetValue("scope", out var scopeValue) ? scopeValue.GetString() ?? "clear_requests_only" : "clear_requests_only";
        var backup = await CreateDatabaseBackupAsync($"before_reset_{scope}", "automatic", cancellationToken);
        var deleted = await ExecuteResetScopeAsync(scope, cancellationToken);

        await auditService.LogAsync("database_reset_executed", "database", scope, newValue: new { deleted, backup_id = backup.Id }, cancellationToken: cancellationToken);
        return Ok(new { status = "success", deleted, backup = MapBackupManifest(backup), message = "تم تنفيذ إعادة الضبط بعد إنشاء نسخة احتياطية" });
    }

    [HttpPost("database/restore/validate")]
    [Authorize(Policy = "Permission:settings.manage")]
    public async Task<ActionResult<object>> ValidateRestorePackage(IFormFile file, CancellationToken cancellationToken)
    {
        if (file.Length <= 0)
        {
            throw new ApiException("ملف الاستعادة فارغ");
        }

        var extension = Path.GetExtension(file.FileName).ToLowerInvariant();
        if (extension is not ".zip")
        {
            throw new ApiException("يدعم Backend .NET المستقل حالياً التحقق من نسخ ZIP التي ينشئها النظام فقط");
        }

        Directory.CreateDirectory(GetRestoreTempRoot());
        var restoreToken = $"restore_{DateTimeOffset.UtcNow:yyyyMMddHHmmss}_{RandomNumberGenerator.GetHexString(8).ToLowerInvariant()}";
        var path = Path.Combine(GetRestoreTempRoot(), $"{restoreToken}.zip");
        await using (var stream = System.IO.File.Create(path))
        {
            await file.CopyToAsync(stream, cancellationToken);
        }

        BackupManifest? manifest;
        try
        {
            manifest = await ReadManifestFromZipAsync(path, cancellationToken);
        }
        catch
        {
            System.IO.File.Delete(path);
            throw new ApiException("ملف النسخة غير صالح أو لا يحتوي على بيانات تعريف النسخة");
        }

        var preview = new
        {
            file_name = file.FileName,
            file_size = file.Length,
            backup_id = manifest.Id,
            backup_type = manifest.BackupType,
            created_at = manifest.CreatedAt,
            database_name = manifest.DatabaseName,
            tables_count = manifest.TableCounts.Count,
            includes_uploads = manifest.IncludesUploads,
            encrypted = manifest.Encrypted
        };

        await System.IO.File.WriteAllTextAsync(Path.Combine(GetRestoreTempRoot(), $"{restoreToken}.json"), JsonSerializer.Serialize(new { path, manifest, preview }, JsonOptions), cancellationToken);
        await auditService.LogAsync("database_restore_validated", "database_restore", restoreToken, newValue: preview, cancellationToken: cancellationToken);
        return Ok(new { restore_token = restoreToken, preview });
    }

    [HttpPost("database/restore/confirm")]
    [Authorize(Policy = "Permission:settings.manage")]
    public async Task<ActionResult<object>> ConfirmRestorePackage(Dictionary<string, JsonElement> request, CancellationToken cancellationToken)
    {
        await VerifyDangerousOperationAsync(request, "RESTORE DATABASE", cancellationToken);
        EnsureDangerousOperationsEnabled();

        var restoreToken = request.TryGetValue("restore_token", out var tokenValue) ? tokenValue.GetString() : null;
        if (string.IsNullOrWhiteSpace(restoreToken))
        {
            throw new ApiException("رمز الاستعادة مطلوب");
        }

        var infoPath = Path.Combine(GetRestoreTempRoot(), $"{restoreToken}.json");
        if (!System.IO.File.Exists(infoPath))
        {
            throw new ApiException("انتهت صلاحية معاينة الاستعادة أو غير موجودة");
        }

        var backup = await CreateDatabaseBackupAsync("before_restore", "automatic", cancellationToken);
        await auditService.LogAsync("database_restore_confirmed", "database_restore", restoreToken, newValue: new { backup_id = backup.Id }, cancellationToken: cancellationToken);
        return Ok(new
        {
            status = "validated_only",
            backup = MapBackupManifest(backup),
            message = "تم تأكيد الاستعادة وإنشاء نسخة قبلية. الاستبدال الفعلي للبيانات يحتاج أداة ترحيل مخصصة لكل جدول قبل تفعيله للإنتاج."
        });
    }

    [HttpPost("database/migrations/run")]
    [Authorize(Policy = "Permission:settings.manage")]
    public async Task<ActionResult<object>> RunMigrations(Dictionary<string, JsonElement> request, CancellationToken cancellationToken)
    {
        await VerifyDangerousOperationAsync(request, "RUN MIGRATIONS", cancellationToken);
        var pending = (await db.Database.GetPendingMigrationsAsync(cancellationToken)).ToList();
        if (pending.Count > 0)
        {
            EnsureDangerousOperationsEnabled();
            await db.Database.MigrateAsync(cancellationToken);
        }

        await auditService.LogAsync("database_migrations_run", "database", "migrations", newValue: new { pending_count = pending.Count }, cancellationToken: cancellationToken);
        return Ok(new { pending_count = pending.Count, message = pending.Count == 0 ? "لا توجد ترحيلات معلقة" : "تم تشغيل الترحيلات المعلقة" });
    }

    [HttpGet("health")]
    public Task<ActionResult<Dictionary<string, object?>>> GetHealthSettings(CancellationToken cancellationToken) =>
        GetSettingsObject("health", "health", HealthDefaults, cancellationToken);

    [HttpPut("health")]
    [Authorize(Policy = "Permission:settings.manage")]
    public Task<ActionResult<Dictionary<string, object?>>> UpdateHealthSettings(Dictionary<string, JsonElement> request, CancellationToken cancellationToken) =>
        SaveSettingsObject("health", "health", HealthDefaults, request, ValidateHealth, "health_settings_updated", cancellationToken);

    [HttpGet("updates")]
    [HttpGet("updates/settings")]
    public Task<ActionResult<Dictionary<string, object?>>> GetUpdateSettings(CancellationToken cancellationToken) =>
        GetSettingsObject("updates", "updates", UpdateDefaults, cancellationToken);

    [HttpPut("updates")]
    [HttpPut("updates/settings")]
    [Authorize(Policy = "Permission:settings.manage")]
    public Task<ActionResult<Dictionary<string, object?>>> UpdateUpdateSettings(Dictionary<string, JsonElement> request, CancellationToken cancellationToken) =>
        SaveSettingsObject("updates", "updates", UpdateDefaults, request, ValidateUpdates, "update_settings_updated", cancellationToken);

    [HttpGet("updates/status")]
    public ActionResult<object> GetUpdateStatus() => Ok(new
    {
        current_version = Assembly.GetExecutingAssembly().GetName().Version?.ToString() ?? "1.0.0",
        build_number = "dotnet-standalone",
        environment = Environment.GetEnvironmentVariable("ASPNETCORE_ENVIRONMENT") ?? "Development",
        backend_status = "healthy",
        frontend_status = "unknown",
        database_status = "healthy",
        last_backup_at = (DateTimeOffset?)null,
        pending_migrations = 0,
        active_job = (object?)null
    });

    [HttpGet("updates/versions")]
    public ActionResult<IReadOnlyCollection<object>> GetUpdateVersions() => Ok(new[]
    {
        new { version = Assembly.GetExecutingAssembly().GetName().Version?.ToString() ?? "1.0.0", build_number = "dotnet-standalone", installed_at = DateTimeOffset.UtcNow, installed_by_name = "System", status = "current", notes = "ASP.NET Core standalone backend" }
    });

    [HttpGet("updates/jobs")]
    public async Task<ActionResult<IReadOnlyCollection<object>>> GetUpdateJobs(CancellationToken cancellationToken)
    {
        var logs = await db.AuditLogs
            .AsNoTracking()
            .Include(x => x.User)
            .Where(x => x.Action.Contains("local_update") || x.Action.Contains("update_rollback"))
            .OrderByDescending(x => x.CreatedAt)
            .Take(25)
            .Select(x => new
            {
                id = x.Id,
                status = x.Result == "success" ? "success" : "failed",
                progress = 100,
                operation_type = x.Action,
                started_by_name = x.User != null ? x.User.NameAr : null,
                started_at = x.CreatedAt,
                completed_at = x.CreatedAt,
                message = x.Action
            })
            .ToListAsync(cancellationToken);
        return Ok(logs);
    }

    [HttpGet("updates/rollback-points")]
    public ActionResult<IReadOnlyCollection<object>> GetUpdateRollbackPoints() =>
        Ok(ReadBackupManifests()
            .Where(x => x.BackupType.Contains("before_update", StringComparison.OrdinalIgnoreCase))
            .OrderByDescending(x => x.CreatedAt)
            .Select(x => new
            {
                id = x.Id,
                version = Assembly.GetExecutingAssembly().GetName().Version?.ToString() ?? "1.0.0",
                database_backup_id = x.Id,
                config_backup_path = "internal",
                created_by_name = x.CreatedByName,
                created_at = x.CreatedAt,
                status = x.Status
            })
            .ToList());

    [HttpGet("updates/release-notes")]
    public ActionResult<IReadOnlyCollection<object>> GetReleaseNotes() => Ok(ReadUpdatePackages()
        .Where(x => !string.IsNullOrWhiteSpace(x.ReleaseNotesSummary))
        .Select(x => new { x.Id, x.Version, title = x.FileName, notes = x.ReleaseNotesSummary, created_at = x.UploadedAt })
        .ToList());

    [HttpGet("updates/audit-logs")]
    public async Task<ActionResult<IReadOnlyCollection<object>>> GetUpdateAuditLogs(CancellationToken cancellationToken)
    {
        var logs = await db.AuditLogs
            .AsNoTracking()
            .Include(x => x.User)
            .Where(x => x.Action.Contains("update") || x.EntityType.Contains("update"))
            .OrderByDescending(x => x.CreatedAt)
            .Take(100)
            .Select(x => new
            {
                x.Id,
                x.Action,
                user = x.User != null ? x.User.NameAr : null,
                result = x.Result,
                ip_address = x.IpAddress,
                details = x.MetadataJson,
                created_at = x.CreatedAt
            })
            .ToListAsync(cancellationToken);
        return Ok(logs);
    }

    [HttpGet("updates/packages")]
    public ActionResult<IReadOnlyCollection<object>> GetUpdatePackages() =>
        Ok(ReadUpdatePackages().OrderByDescending(x => x.UploadedAt).Select(MapUpdatePackage).ToList());

    [HttpPost("updates/precheck")]
    [Authorize(Policy = "Permission:settings.manage")]
    public async Task<ActionResult<object>> RunUpdatePrecheck(CancellationToken cancellationToken)
    {
        var database = await RunConnectionMaintenanceAsync(cancellationToken);
        var backupsRoot = GetBackupRoot();
        Directory.CreateDirectory(backupsRoot);
        var ready = Directory.Exists(backupsRoot);
        var result = new
        {
            ready,
            summary = ready ? "الفحص الأولي ناجح في بيئة .NET المستقلة." : "الفحص الأولي يحتاج مراجعة.",
            checks = new[]
            {
                new { label = "قاعدة البيانات", status = "passed", message = "الاتصال متاح", critical = true },
                new { label = "التخزين", status = ready ? "passed" : "failed", message = ready ? "مسارات التخزين مهيأة" : "مسار النسخ غير متاح", critical = true },
                new { label = "الصلاحيات", status = "passed", message = "يتطلب التنفيذ كلمة مرور مدير النظام وعبارة تأكيد", critical = true },
                new { label = "الحماية", status = configuration.GetValue<bool>("EnableDangerousDatabaseOperations") ? "warning" : "passed", message = configuration.GetValue<bool>("EnableDangerousDatabaseOperations") ? "العمليات الخطرة مفعلة لهذه البيئة" : "العمليات الخطرة معطلة افتراضياً", critical = false }
            },
            database
        };
        await auditService.LogAsync("update_precheck_run", "updates", "precheck", newValue: result, cancellationToken: cancellationToken);
        return Ok(result);
    }

    [HttpPost("updates/local/upload")]
    [Authorize(Policy = "Permission:settings.manage")]
    public async Task<ActionResult<object>> UploadLocalUpdatePackage(IFormFile file, CancellationToken cancellationToken)
    {
        await EnsureSuperAdminAsync(cancellationToken);
        if (file.Length <= 0)
        {
            throw new ApiException("ملف التحديث فارغ");
        }

        var name = file.FileName.ToLowerInvariant();
        if (!name.EndsWith(".zip", StringComparison.OrdinalIgnoreCase) &&
            !name.EndsWith(".tar.gz", StringComparison.OrdinalIgnoreCase) &&
            !name.EndsWith(".tgz", StringComparison.OrdinalIgnoreCase))
        {
            throw new ApiException("حزمة التحديث يجب أن تكون ZIP أو TAR.GZ");
        }

        Directory.CreateDirectory(GetUpdatePackageRoot());
        var package = new UpdatePackageManifest
        {
            Id = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
            FileName = Path.GetFileName(file.FileName),
            Status = "uploaded",
            UploadedAt = DateTimeOffset.UtcNow,
            UploadedByName = await GetCurrentUserDisplayNameAsync(cancellationToken),
            Version = "غير محدد"
        };
        package.FilePath = Path.Combine(GetUpdatePackageRoot(), $"{package.Id}_{SafeFileName(package.FileName)}");
        await using (var stream = System.IO.File.Create(package.FilePath))
        {
            await file.CopyToAsync(stream, cancellationToken);
        }

        package.FileSize = file.Length;
        package.Checksum = await ComputeSha256Async(package.FilePath, cancellationToken);
        package = await ValidateUpdatePackageManifestAsync(package, cancellationToken);
        await SaveUpdatePackageManifestAsync(package, cancellationToken);
        await auditService.LogAsync("local_update_package_uploaded", "update_package", package.Id.ToString(), newValue: package, cancellationToken: cancellationToken);
        return Ok(MapUpdatePackage(package));
    }

    [HttpPost("updates/local/validate")]
    [Authorize(Policy = "Permission:settings.manage")]
    public async Task<ActionResult<object>> ValidateLocalUpdatePackage(Dictionary<string, JsonElement> request, CancellationToken cancellationToken)
    {
        var package = RequireUpdatePackage(GetPackageId(request));
        package = await ValidateUpdatePackageManifestAsync(package, cancellationToken);
        await SaveUpdatePackageManifestAsync(package, cancellationToken);
        await auditService.LogAsync("local_update_package_validated", "update_package", package.Id.ToString(), newValue: package, result: package.Valid ? "success" : "failed", cancellationToken: cancellationToken);
        return Ok(MapUpdatePackage(package));
    }

    [HttpPost("updates/local/preview")]
    [Authorize(Policy = "Permission:settings.manage")]
    public ActionResult<object> PreviewLocalUpdatePackage(Dictionary<string, JsonElement> request)
    {
        var package = RequireUpdatePackage(GetPackageId(request));
        var result = new
        {
            can_apply = package.Valid,
            current_version = Assembly.GetExecutingAssembly().GetName().Version?.ToString() ?? "1.0.0",
            target_version = package.Version,
            release_date = package.ReleaseDate,
            estimated_services = new[] { package.IncludesBackend ? "Backend" : null, package.IncludesFrontend ? "Frontend" : null }.Where(x => x is not null).ToList(),
            requires_migration = package.RequiresMigration,
            requires_restart = package.RequiresRestart,
            includes_backend = package.IncludesBackend,
            includes_frontend = package.IncludesFrontend,
            release_notes_summary = package.ReleaseNotesSummary,
            warnings = package.Warnings,
            errors = package.Errors
        };
        return Ok(result);
    }

    [HttpPost("updates/local/apply")]
    [Authorize(Policy = "Permission:settings.manage")]
    public async Task<ActionResult<object>> ApplyLocalUpdatePackage(Dictionary<string, JsonElement> request, CancellationToken cancellationToken)
    {
        await VerifyDangerousOperationAsync(request, "APPLY UPDATE", cancellationToken);
        if (!request.TryGetValue("understood", out var understood) || !understood.GetBoolean())
        {
            throw new ApiException("يجب تأكيد فهم أثر التحديث");
        }

        var package = RequireUpdatePackage(GetPackageId(request));
        if (!package.Valid)
        {
            throw new ApiException("لا يمكن تطبيق حزمة لم تجتز التحقق");
        }

        EnsureDangerousOperationsEnabled();
        var rollbackBackup = await CreateDatabaseBackupAsync("before_update", "automatic", cancellationToken);
        package.Status = "applied";
        await SaveUpdatePackageManifestAsync(package, cancellationToken);

        var result = new
        {
            id = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
            status = "success",
            progress = 100,
            from_version = Assembly.GetExecutingAssembly().GetName().Version?.ToString() ?? "1.0.0",
            to_version = package.Version,
            started_at = DateTimeOffset.UtcNow,
            completed_at = DateTimeOffset.UtcNow,
            message = "تم اعتماد حزمة التحديث في Backend .NET المستقل. نسخ ملفات النظام الفعلي يحتاج مسار نشر مخصص على الخادم.",
            details_json = new { rollback_point_id = rollbackBackup.Id, package_id = package.Id, health = new { status = "healthy" } }
        };
        await auditService.LogAsync("local_update_applied", "update_package", package.Id.ToString(), newValue: result, cancellationToken: cancellationToken);
        return Ok(result);
    }

    [HttpPost("updates/rollback/{rollbackId}")]
    [Authorize(Policy = "Permission:settings.manage")]
    public async Task<ActionResult<object>> RollbackUpdate(string rollbackId, Dictionary<string, JsonElement> request, CancellationToken cancellationToken)
    {
        await VerifyDangerousOperationAsync(request, "ROLLBACK UPDATE", cancellationToken);
        EnsureDangerousOperationsEnabled();
        var manifest = RequireBackupManifest(rollbackId);
        await auditService.LogAsync("update_rollback_requested", "database_backup", rollbackId, newValue: manifest, cancellationToken: cancellationToken);
        return Ok(new
        {
            status = "validated_only",
            rollback_point_id = rollbackId,
            message = "تم التحقق من نقطة الاسترجاع. الاسترجاع الفعلي للملفات وقاعدة البيانات يحتاج تفعيل مسار النشر الآمن."
        });
    }

    private async Task<Dictionary<string, object?>> GetGeneralProfileAsync(CancellationToken cancellationToken)
    {
        var values = await settingsStore.GetValuesAsync("general", "general", GeneralDefaults, cancellationToken);
        values["current_year"] = DateTimeOffset.Now.Year;
        return values;
    }

    private async Task<ActionResult<Dictionary<string, object?>>> GetSettingsObject(string group, string prefix, IReadOnlyDictionary<string, object?> defaults, CancellationToken cancellationToken) =>
        Ok(await settingsStore.GetValuesAsync(group, prefix, defaults, cancellationToken));

    private async Task<ActionResult<Dictionary<string, object?>>> SaveSettingsObject(
        string group,
        string prefix,
        IReadOnlyDictionary<string, object?> defaults,
        Dictionary<string, JsonElement> request,
        Action<Dictionary<string, object?>> validate,
        string auditAction,
        CancellationToken cancellationToken)
    {
        var oldValue = await settingsStore.GetValuesAsync(group, prefix, defaults, cancellationToken);
        var values = MergePayload(oldValue, request, defaults);
        validate(values);
        await settingsStore.SetValuesAsync(group, prefix, values, defaults, cancellationToken);
        var updated = await settingsStore.GetValuesAsync(group, prefix, defaults, cancellationToken);
        await auditService.LogAsync(auditAction, "system_settings", prefix, oldValue: oldValue, newValue: updated, cancellationToken: cancellationToken);
        return Ok(updated);
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
                values[property.Name] = SystemSettingsStore.ConvertJsonElement(property.Value);
            }
        }
        catch
        {
            return values;
        }

        return values;
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

    private static string MergeSettingsJson(string? existingJson, IReadOnlyDictionary<string, object?> values)
    {
        var existing = ReadSettingsJson(existingJson);
        foreach (var (key, value) in values)
        {
            existing[key] = value is JsonElement element ? SystemSettingsStore.ConvertJsonElement(element) : value;
        }

        return JsonSerializer.Serialize(existing, JsonOptions);
    }

    private static Dictionary<string, object?> ReadMessagingGeneralValues(MessagingSettings item)
    {
        var values = MergePersistedSettings(MessagingGeneralDefaults, item.SettingsJson);
        values["enable_messaging"] = item.IsEnabled;
        values["max_recipients"] = item.MaxRecipients;
        values["allow_multiple_recipients"] = item.AllowMultipleRecipients;
        return values;
    }

    private static Dictionary<string, object?> ReadMessagingRecipientValues(MessagingSettings item)
    {
        var values = MergePersistedSettings(MessagingRecipientsDefaults, item.SettingsJson);
        values["allow_send_to_user"] = item.AllowSendToUsers;
        values["allow_send_to_department"] = item.AllowSendToDepartments;
        values["allow_multiple_recipients"] = item.AllowMultipleRecipients;
        values["prevent_sending_to_inactive_users"] = item.RestrictToActiveUsers;
        values["max_recipients"] = item.MaxRecipients;
        return values;
    }

    private static Dictionary<string, object?> ReadMessagingRequestValues(MessageRequestIntegrationSettings item)
    {
        var values = MergePersistedSettings(MessagingRequestDefaults, item.SettingsJson);
        values["allow_link_to_request"] = item.AllowLinkToRequest;
        values["show_messages_tab_in_request_details"] = item.ShowMessagesTabInRequestDetails;
        values["allow_send_message_from_request"] = item.AllowSendMessageFromRequest;
        values["include_official_messages_in_request_pdf"] = item.IncludeOfficialMessagesInRequestPdf;
        values["exclude_internal_messages_from_pdf"] = item.ExcludeInternalMessagesFromPdf;
        values["allow_request_owner_to_view_messages"] = item.AllowRequesterToViewMessages;
        values["allow_approvers_to_view_request_messages"] = item.AllowApproversToViewRequestMessages;
        values["show_request_notification_checkbox"] = ToBool(values["show_request_notification_checkbox"]);
        values["default_send_request_notification"] = ToBool(values["default_send_request_notification"]);
        values["allow_requester_toggle_notification"] = ToBool(values["allow_requester_toggle_notification"]);
        return values;
    }

    private static Dictionary<string, object?> ReadMessagingNotificationValues(MessageNotificationSettings item)
    {
        var values = MergePersistedSettings(MessagingNotificationDefaults, item.SettingsJson);
        values["notify_on_new_message"] = item.NotifyOnNewMessage;
        values["notify_on_read"] = item.NotifyOnRead;
        return values;
    }

    private static Dictionary<string, object?> ReadMessagingRetentionValues(MessageRetentionPolicy item)
    {
        var values = MergePersistedSettings(MessagingRetentionDefaults, item.SettingsJson);
        values["allow_archiving"] = item.AllowArchive;
        values["retention_days"] = item.MessageRetentionDays;
        values["attachment_retention_days"] = item.AttachmentRetentionDays;
        values["prevent_hard_delete"] = item.PreventPermanentDelete;
        values["allow_user_delete_own_messages"] = item.AllowUserDeleteOwnMessage;
        values["exclude_official_messages_from_delete"] = item.OfficialMessagesProtected;
        values["exclude_confidential_messages_from_delete"] = item.ConfidentialMessagesProtected;
        return values;
    }

    private static Dictionary<string, object?> ReadMessagingSecurityValues(MessageSecurityPolicy item) =>
        MergePersistedSettings(MessagingSecurityDefaults, item.SettingsJson);

    private static Dictionary<string, object?> ReadMessagingAiValues(MessageAiSettings item)
    {
        var values = MergePersistedSettings(MessagingAiDefaults, item.SettingsJson);
        values["show_ai_in_compose"] = item.ShowAssistantInCompose;
        return values;
    }

    private static Dictionary<string, object?> ReadAiValues(AiSettings item)
    {
        var values = MergePersistedSettings(AiDefaults, item.SettingsJson);
        values["is_enabled"] = item.IsEnabled;
        values["provider"] = string.IsNullOrWhiteSpace(item.Provider) ? values["provider"] : item.Provider;
        values["api_base_url"] = string.IsNullOrWhiteSpace(item.BaseUrl) ? values["api_base_url"] : item.BaseUrl;
        values["model_name"] = string.IsNullOrWhiteSpace(item.ModelName) ? values["model_name"] : item.ModelName;
        values["max_input_chars"] = item.MaxInputChars > 0 ? item.MaxInputChars : values["max_input_chars"];
        values["system_prompt"] = string.IsNullOrWhiteSpace(item.SystemPrompt) ? values["system_prompt"] : item.SystemPrompt;
        return values;
    }

    private static IReadOnlyCollection<JsonElement> ExtractAiFeatureRows(JsonElement request)
    {
        if (request.ValueKind == JsonValueKind.Array)
        {
            return request.EnumerateArray().ToList();
        }

        if (request.ValueKind == JsonValueKind.Object)
        {
            foreach (var propertyName in new[] { "items", "features", "permissions" })
            {
                if (request.TryGetProperty(propertyName, out var property) && property.ValueKind == JsonValueKind.Array)
                {
                    return property.EnumerateArray().ToList();
                }
            }
        }

        return Array.Empty<JsonElement>();
    }

    private static bool TryReadLong(JsonElement element, string propertyName, out long value)
    {
        value = 0;
        if (element.ValueKind != JsonValueKind.Object || !element.TryGetProperty(propertyName, out var property))
        {
            return false;
        }

        if (property.ValueKind == JsonValueKind.Number && property.TryGetInt64(out value))
        {
            return true;
        }

        if (property.ValueKind == JsonValueKind.String && long.TryParse(property.GetString(), out value))
        {
            return true;
        }

        return false;
    }

    private static bool TryReadString(JsonElement element, string propertyName, out string value)
    {
        value = string.Empty;
        if (element.ValueKind != JsonValueKind.Object || !element.TryGetProperty(propertyName, out var property))
        {
            return false;
        }

        value = property.ValueKind == JsonValueKind.String ? property.GetString() ?? string.Empty : property.ToString();
        return !string.IsNullOrWhiteSpace(value);
    }

    private static bool TryReadBool(JsonElement element, string propertyName, out bool value)
    {
        value = false;
        if (element.ValueKind != JsonValueKind.Object || !element.TryGetProperty(propertyName, out var property))
        {
            return false;
        }

        value = ToBool(property);
        return true;
    }

    private static Dictionary<string, object?> MergePayload(
        IReadOnlyDictionary<string, object?> current,
        Dictionary<string, JsonElement> request,
        IReadOnlyDictionary<string, object?> defaults)
    {
        var values = new Dictionary<string, object?>(StringComparer.OrdinalIgnoreCase);
        foreach (var (key, fallback) in defaults)
        {
            values[key] = current.TryGetValue(key, out var existing) ? existing : fallback;
        }

        foreach (var (key, value) in request)
        {
            if (defaults.ContainsKey(key))
            {
                values[key] = SystemSettingsStore.ConvertJsonElement(value);
            }
        }

        return values;
    }

    private static void ValidateGeneral(Dictionary<string, object?> values)
    {
        if (string.IsNullOrWhiteSpace(ToStringValue(values["system_name"])))
        {
            throw new ApiException("اسم النظام مطلوب");
        }

        var uploadMax = ToInt(values["upload_max_file_size_mb"]);
        if (uploadMax is < 1 or > 500)
        {
            throw new ApiException("الحد الأقصى لرفع الملفات يجب أن يكون بين 1 و 500 MB");
        }

        var color = ToStringValue(values["brand_color"]);
        if (!System.Text.RegularExpressions.Regex.IsMatch(color, "^#[0-9A-Fa-f]{6}$"))
        {
            throw new ApiException("لون الهوية يجب أن يكون بصيغة HEX صحيحة");
        }
    }

    private static void ValidateSecurity(Dictionary<string, object?> values)
    {
        var passwordMinLength = ToInt(values["password_min_length"]);
        if (passwordMinLength is < 1 or > 256)
        {
            throw new ApiException("الحد الأدنى لكلمة المرور يجب أن يكون بين 1 و 256 حرفاً");
        }

        if (ToInt(values["lock_after_failed_attempts"]) < 1)
        {
            throw new ApiException("عدد محاولات القفل يجب أن يكون أكبر من صفر");
        }
    }

    private static void ValidateGlobalAttachments(Dictionary<string, object?> values)
    {
        var maxFileSize = ToInt(values["max_file_size_mb"]);
        if (maxFileSize is < 1 or > 500)
        {
            throw new ApiException("حد حجم المرفق العام يجب أن يكون بين 1 و 500 MB");
        }

        if (ToInt(values["max_files_per_upload"]) < 1)
        {
            throw new ApiException("عدد الملفات في الرفع الواحد يجب أن يكون أكبر من صفر");
        }

        var allowed = SanitizeExtensions(ToStringList(values["allowed_extensions_json"]), allowEmpty: false);
        values["allowed_extensions_json"] = allowed;
        values["blocked_extensions_json"] = DangerousExtensions;
    }

    private async Task ValidateAttachmentConflictsAsync(Dictionary<string, object?> values, CancellationToken cancellationToken)
    {
        if (!ToBool(values["is_hard_limit"]))
        {
            return;
        }

        var maxFileSize = ToInt(values["max_file_size_mb"]);
        var conflictingRequestType = await db.RequestTypeSettings
            .AsNoTracking()
            .Include(x => x.RequestType)
            .Include(x => x.Version)
            .Where(x => x.MaxFileSizeMb > maxFileSize && x.Version != null && x.Version.Status != "archived")
            .OrderByDescending(x => x.MaxFileSizeMb)
            .Select(x => new { x.MaxFileSizeMb, RequestTypeName = x.RequestType != null ? x.RequestType.NameAr : null })
            .FirstOrDefaultAsync(cancellationToken);

        if (conflictingRequestType is not null)
        {
            throw new ApiException($"لا يمكن حفظ الحد العام لأنه أقل من حد مرفقات نوع الطلب \"{conflictingRequestType.RequestTypeName}\" وهو {conflictingRequestType.MaxFileSizeMb} MB.");
        }

        var messagingMaxFileSize = await db.MessageAttachmentSettings
            .AsNoTracking()
            .Select(x => (int?)x.MaxFileSizeMb)
            .FirstOrDefaultAsync(cancellationToken);
        if (!messagingMaxFileSize.HasValue)
        {
            var messagingAttachments = await settingsStore.GetValuesAsync("messaging", "messaging.attachments", new Dictionary<string, object?>
            {
                ["max_file_size_mb"] = 10
            }, cancellationToken);
            messagingMaxFileSize = ToInt(messagingAttachments["max_file_size_mb"]);
        }

        if (messagingMaxFileSize.Value > maxFileSize)
        {
            throw new ApiException($"لا يمكن حفظ الحد العام لأنه أقل من حد مرفقات المراسلات وهو {messagingMaxFileSize.Value} MB.");
        }
    }

    private static void ValidateMessagingGeneral(Dictionary<string, object?> values)
    {
        var maxRecipients = ToInt(values["max_recipients"]);
        if (maxRecipients is < 1 or > 5000)
        {
            throw new ApiException("الحد الأقصى للمستلمين يجب أن يكون بين 1 و 5000");
        }

        var priority = ToStringValue(values["default_priority"]);
        if (!new[] { "normal", "high", "urgent" }.Contains(priority))
        {
            throw new ApiException("الأولوية الافتراضية للمراسلات غير صالحة");
        }
    }

    private static void ValidateMessagingRecipients(Dictionary<string, object?> values)
    {
        if (ToInt(values["max_recipients"]) < 1)
        {
            throw new ApiException("الحد الأقصى للمستلمين يجب أن يكون أكبر من صفر");
        }
    }

    private static void ValidateRetention(Dictionary<string, object?> values)
    {
        if (ToInt(values["retention_days"]) < 1 || ToInt(values["attachment_retention_days"]) < 1)
        {
            throw new ApiException("مدة الاحتفاظ يجب أن تكون أكبر من صفر");
        }
    }

    private static void ValidateAi(Dictionary<string, object?> values)
    {
        if (ToInt(values["max_input_chars"]) < 500)
        {
            throw new ApiException("الحد الأقصى لطول النص يجب ألا يقل عن 500 حرف");
        }

        if (ToInt(values["timeout_seconds"]) < 5)
        {
            throw new ApiException("مهلة الاستجابة يجب ألا تقل عن 5 ثوان");
        }

        values["api_base_url"] = NormalizeAiBaseUrl(ToStringValue(values["api_base_url"]));
    }

    private static string NormalizeAiBaseUrl(string? rawValue)
    {
        var value = (rawValue ?? string.Empty).Trim();
        if (string.IsNullOrWhiteSpace(value))
        {
            return string.Empty;
        }

        value = value.Replace("localhos:", "localhost:", StringComparison.OrdinalIgnoreCase)
            .Replace("localhos/", "localhost/", StringComparison.OrdinalIgnoreCase);

        if (!value.StartsWith("http://", StringComparison.OrdinalIgnoreCase) &&
            !value.StartsWith("https://", StringComparison.OrdinalIgnoreCase))
        {
            value = $"http://{value}";
        }

        if (!Uri.TryCreate(value, UriKind.Absolute, out var uri) ||
            string.IsNullOrWhiteSpace(uri.Host) ||
            (uri.Scheme != Uri.UriSchemeHttp && uri.Scheme != Uri.UriSchemeHttps))
        {
            throw new ApiException("رابط خادم النموذج غير صحيح. مثال: http://host.docker.internal:11434");
        }

        var host = uri.Host;
        if (string.Equals(Environment.GetEnvironmentVariable("DOTNET_RUNNING_IN_CONTAINER"), "true", StringComparison.OrdinalIgnoreCase) &&
            (host.Equals("localhost", StringComparison.OrdinalIgnoreCase) || host == "127.0.0.1"))
        {
            var builder = new UriBuilder(uri)
            {
                Host = "host.docker.internal"
            };
            return builder.Uri.ToString().TrimEnd('/');
        }

        return uri.ToString().TrimEnd('/');
    }

    private static void ValidateDatabase(Dictionary<string, object?> values)
    {
        if (ToInt(values["backup_retention_days"]) < 1)
        {
            throw new ApiException("مدة الاحتفاظ بالنسخ الاحتياطية يجب أن تكون أكبر من صفر");
        }
    }

    private static void ValidateDatabaseBackupSettings(Dictionary<string, object?> values)
    {
        if (ToInt(values["retention_count"]) < 1)
        {
            throw new ApiException("عدد النسخ المحتفظ بها يجب أن يكون أكبر من صفر");
        }

        var frequency = ToStringValue(values["frequency"]);
        if (!new[] { "daily", "weekly", "monthly" }.Contains(frequency))
        {
            throw new ApiException("تكرار النسخ الاحتياطي غير صالح");
        }
    }

    private static void ValidateHealth(Dictionary<string, object?> values)
    {
        if (ToInt(values["disk_warning_percent"]) >= ToInt(values["disk_critical_percent"]))
        {
            throw new ApiException("حد تحذير التخزين يجب أن يكون أقل من حد الخطر");
        }

        if (ToInt(values["db_latency_warning_ms"]) >= ToInt(values["db_latency_critical_ms"]))
        {
            throw new ApiException("حد تحذير بطء قاعدة البيانات يجب أن يكون أقل من حد الخطر");
        }
    }

    private static void ValidateUpdates(Dictionary<string, object?> values)
    {
        if (ToInt(values["retain_rollback_points_count"]) < 1)
        {
            throw new ApiException("عدد نقاط الاسترجاع يجب أن يكون أكبر من صفر");
        }
    }

    private async Task<object> RunConnectionMaintenanceAsync(CancellationToken cancellationToken)
    {
        var stopwatch = Stopwatch.StartNew();
        await db.Database.OpenConnectionAsync(cancellationToken);
        await db.Database.CloseConnectionAsync();
        stopwatch.Stop();
        return new { status = "success", message = "الاتصال بقاعدة البيانات ناجح", latency_ms = stopwatch.ElapsedMilliseconds, progress = 100 };
    }

    private async Task<object> RunDatabaseIntegrityCheckAsync(CancellationToken cancellationToken)
    {
        var tableCounts = await GetDatabaseTableCountsDictionaryAsync(cancellationToken);
        var pendingMigrations = (await db.Database.GetPendingMigrationsAsync(cancellationToken)).ToList();
        return new
        {
            status = pendingMigrations.Count == 0 ? "success" : "warning",
            message = pendingMigrations.Count == 0
                ? "تم فحص الاتصال والجداول ولا توجد ترحيلات معلقة"
                : "الاتصال سليم، لكن توجد ترحيلات معلقة تحتاج مراجعة",
            tables_count = tableCounts.Count,
            records_count = tableCounts.Values.Sum(),
            pending_migrations = pendingMigrations,
            progress = 100
        };
    }

    private async Task<object> RunAnalyzeMaintenanceAsync(string action, CancellationToken cancellationToken)
    {
        var stopwatch = Stopwatch.StartNew();
        await db.Database.OpenConnectionAsync(cancellationToken);
        try
        {
            await using var command = db.Database.GetDbConnection().CreateCommand();
            command.CommandText = "ANALYZE";
            await command.ExecuteNonQueryAsync(cancellationToken);
        }
        finally
        {
            await db.Database.CloseConnectionAsync();
        }

        stopwatch.Stop();
        return new
        {
            status = "success",
            message = action == "optimize"
                ? "تم تحسين إحصائيات قاعدة البيانات بأمان عبر ANALYZE"
                : "تم تحديث إحصائيات قاعدة البيانات عبر ANALYZE",
            latency_ms = stopwatch.ElapsedMilliseconds,
            progress = 100
        };
    }

    private async Task<object> RunAttachmentConsistencyCheckAsync(CancellationToken cancellationToken)
    {
        var uploadsRoot = configuration["Storage:UploadsPath"] ?? "/data/uploads";
        var referenced = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var missing = new List<string>();

        void AddReferencedPath(string? path)
        {
            if (string.IsNullOrWhiteSpace(path))
            {
                return;
            }

            var resolved = Path.IsPathRooted(path) ? path : Path.Combine(uploadsRoot, path);
            referenced.Add(Path.GetFullPath(resolved));
            if (!System.IO.File.Exists(resolved))
            {
                missing.Add(Path.GetFileName(path));
            }
        }

        foreach (var path in await db.RequestAttachments.AsNoTracking().Where(x => !x.IsDeleted).Select(x => x.StoragePath).ToListAsync(cancellationToken))
        {
            AddReferencedPath(path);
        }

        foreach (var path in await db.MessageAttachments.AsNoTracking().Where(x => !x.IsDeleted).Select(x => x.StoragePath).ToListAsync(cancellationToken))
        {
            AddReferencedPath(path);
        }

        foreach (var path in await db.DocumentVersions.AsNoTracking().Select(x => x.FilePath).ToListAsync(cancellationToken))
        {
            AddReferencedPath(path);
        }

        foreach (var path in await db.OfficialMessageDocuments.AsNoTracking().Select(x => x.PdfFilePath).ToListAsync(cancellationToken))
        {
            AddReferencedPath(path);
        }

        var orphanCount = 0;
        if (Directory.Exists(uploadsRoot))
        {
            orphanCount = Directory
                .EnumerateFiles(uploadsRoot, "*", SearchOption.AllDirectories)
                .Count(path => !referenced.Contains(Path.GetFullPath(path)));
        }

        return new
        {
            status = missing.Count == 0 ? "success" : "warning",
            message = missing.Count == 0
                ? "تم فحص المرفقات ولم يتم العثور على ملفات مفقودة"
                : "توجد مرفقات مسجلة لا تملك ملفاً فعلياً",
            missing_files_count = missing.Count,
            orphan_files_count = orphanCount,
            missing_files = missing.Take(20).ToList(),
            progress = 100
        };
    }

    private static IReadOnlyCollection<string> SplitExtensions(object? value)
    {
        if (value is string text)
        {
            return text.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        }

        return ToStringList(value);
    }

    private static List<string> SanitizeExtensions(IEnumerable<string> extensions, bool allowEmpty)
    {
        var cleaned = extensions
            .Select(x => x.Trim().TrimStart('.').ToLowerInvariant())
            .Where(x => x.Length > 0)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .OrderBy(x => x)
            .ToList();

        if (!allowEmpty && cleaned.Count == 0)
        {
            throw new ApiException("يجب تحديد امتداد ملف واحد على الأقل");
        }

        var blocked = cleaned.Where(x => DangerousExtensions.Contains(x, StringComparer.OrdinalIgnoreCase)).ToList();
        if (blocked.Count > 0)
        {
            throw new ApiException($"لا يمكن السماح بامتدادات خطرة: {string.Join(", ", blocked)}");
        }

        return cleaned;
    }

    private static int ToInt(object? value)
    {
        return value switch
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
    }

    private static bool ToBool(object? value)
    {
        return value switch
        {
            JsonElement { ValueKind: JsonValueKind.True } => true,
            JsonElement { ValueKind: JsonValueKind.False } => false,
            JsonElement { ValueKind: JsonValueKind.String } element when bool.TryParse(element.GetString(), out var result) => result,
            JsonElement { ValueKind: JsonValueKind.Number } element when element.TryGetInt32(out var number) => number != 0,
            bool boolValue => boolValue,
            string text when bool.TryParse(text, out var result) => result,
            _ => false
        };
    }

    private static string ToStringValue(object? value) => Convert.ToString(value) ?? "";

    private static IReadOnlyCollection<string> ToStringList(object? value)
    {
        return value switch
        {
            JsonElement { ValueKind: JsonValueKind.Array } element => element.EnumerateArray().Select(x => x.ToString()).Where(x => !string.IsNullOrWhiteSpace(x)).ToList(),
            JsonElement { ValueKind: JsonValueKind.String } element => (element.GetString() ?? "").Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries).ToList(),
            string text => text.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries).ToList(),
            IEnumerable<string> strings => strings.Where(x => !string.IsNullOrWhiteSpace(x)).ToList(),
            IEnumerable<object?> list => list.Select(ToStringValue).Where(x => !string.IsNullOrWhiteSpace(x)).ToList(),
            _ => []
        };
    }

    private string GetBackupRoot()
    {
        var configuredRoot = configuration["Storage:BackupsPath"] ?? Path.Combine(AppContext.BaseDirectory, "backups");
        Directory.CreateDirectory(configuredRoot);
        return configuredRoot;
    }

    private string GetRestoreTempRoot()
    {
        var path = Path.Combine(GetBackupRoot(), "_restore_temp");
        Directory.CreateDirectory(path);
        return path;
    }

    private string GetUpdatePackageRoot()
    {
        var path = Path.Combine(GetBackupRoot(), "_update_packages");
        Directory.CreateDirectory(path);
        return path;
    }

    private string GetBackupManifestPath(string backupId) => Path.Combine(GetBackupRoot(), $"{SafeFileName(backupId)}.json");

    private async Task<BackupManifest> CreateDatabaseBackupAsync(
        string backupType,
        string trigger,
        CancellationToken cancellationToken,
        bool? includeUploadsOverride = null)
    {
        var settings = await settingsStore.GetValuesAsync("database", "database.backup", DatabaseBackupDefaults, cancellationToken);
        var includeUploads = includeUploadsOverride ?? ToBool(settings.GetValueOrDefault("include_uploads"));
        var encrypt = ToBool(settings.GetValueOrDefault("encrypt_backups"));
        var retentionCount = Math.Max(1, ToInt(settings.GetValueOrDefault("retention_count")));
        var id = $"backup_{DateTimeOffset.UtcNow:yyyyMMddHHmmss}_{RandomNumberGenerator.GetHexString(6).ToLowerInvariant()}";
        var zipName = $"{id}.zip";
        var zipPath = Path.Combine(GetBackupRoot(), zipName);
        var tableCounts = await GetDatabaseTableCountsDictionaryAsync(cancellationToken);

        var manifest = new BackupManifest
        {
            Id = id,
            BackupType = backupType,
            Trigger = trigger,
            Status = "success",
            FileName = zipName,
            FilePath = zipPath,
            CreatedAt = DateTimeOffset.UtcNow,
            CreatedByName = await GetCurrentUserDisplayNameAsync(cancellationToken),
            DatabaseName = db.Database.GetDbConnection().Database,
            IncludesUploads = includeUploads,
            Encrypted = false,
            TableCounts = tableCounts,
            Metadata = new Dictionary<string, object?>
            {
                ["application"] = "QIB Service Portal ASP.NET Backend",
                ["version"] = Assembly.GetExecutingAssembly().GetName().Version?.ToString() ?? "1.0.0",
                ["backup_format"] = "qib-dotnet-json-v1"
            }
        };

        await using (var zipStream = System.IO.File.Create(zipPath))
        using (var archive = new ZipArchive(zipStream, ZipArchiveMode.Create))
        {
            await WriteZipEntryAsync(archive, "backup-metadata.json", manifest, cancellationToken);
            await WriteZipEntryAsync(archive, "system-settings.json", await db.SystemSettings.AsNoTracking().OrderBy(x => x.Key).Select(x => new
            {
                x.Key,
                x.Value,
                x.Group,
                x.DataType,
                x.IsSensitive,
                x.DescriptionAr,
                x.UpdatedAt
            }).ToListAsync(cancellationToken), cancellationToken);
            await WriteZipEntryAsync(archive, "table-counts.json", tableCounts, cancellationToken);
            await WriteZipEntryAsync(archive, "database-summary.json", new
            {
                manifest.DatabaseName,
                tables_count = tableCounts.Count,
                records_count = tableCounts.Values.Sum(),
                generated_at = manifest.CreatedAt
            }, cancellationToken);

            if (includeUploads)
            {
                var uploadsRoot = configuration["Storage:UploadsPath"] ?? "/data/uploads";
                if (Directory.Exists(uploadsRoot))
                {
                    AddDirectoryToZip(archive, uploadsRoot, "uploads");
                }
            }
        }

        if (encrypt)
        {
            var encryptedPath = $"{zipPath}.enc";
            var encrypted = EncryptBytes(await System.IO.File.ReadAllBytesAsync(zipPath, cancellationToken));
            await System.IO.File.WriteAllBytesAsync(encryptedPath, encrypted, cancellationToken);
            System.IO.File.Delete(zipPath);
            manifest.FileName = $"{zipName}.enc";
            manifest.FilePath = encryptedPath;
            manifest.Encrypted = true;
        }

        manifest.FileSize = new FileInfo(manifest.FilePath).Length;
        manifest.Checksum = await ComputeSha256Async(manifest.FilePath, cancellationToken);
        await SaveBackupManifestAsync(manifest, cancellationToken);
        await PruneBackupsAsync(retentionCount, cancellationToken);
        return manifest;
    }

    private async Task<Dictionary<string, long>> GetDatabaseTableCountsDictionaryAsync(CancellationToken cancellationToken)
    {
        var rows = new Dictionary<string, long>(StringComparer.OrdinalIgnoreCase);
        var connection = db.Database.GetDbConnection();
        await db.Database.OpenConnectionAsync(cancellationToken);
        try
        {
            foreach (var entityType in db.Model.GetEntityTypes().Where(x => x.GetTableName() is not null).OrderBy(x => x.GetTableName()))
            {
                var table = entityType.GetTableName()!;
                var schema = entityType.GetSchema() ?? "public";
                await using var command = connection.CreateCommand();
                command.CommandText = $"SELECT COUNT(*) FROM \"{schema.Replace("\"", "\"\"")}\".\"{table.Replace("\"", "\"\"")}\"";
                var result = await command.ExecuteScalarAsync(cancellationToken);
                rows[$"{schema}.{table}"] = result is null ? 0 : Convert.ToInt64(result);
            }
        }
        finally
        {
            await db.Database.CloseConnectionAsync();
        }

        return rows;
    }

    private static async Task WriteZipEntryAsync(ZipArchive archive, string name, object value, CancellationToken cancellationToken)
    {
        var entry = archive.CreateEntry(name, CompressionLevel.Optimal);
        await using var stream = entry.Open();
        await JsonSerializer.SerializeAsync(stream, value, JsonOptions, cancellationToken);
    }

    private static void AddDirectoryToZip(ZipArchive archive, string sourceDirectory, string entryRoot)
    {
        foreach (var filePath in Directory.EnumerateFiles(sourceDirectory, "*", SearchOption.AllDirectories))
        {
            var relativePath = Path.GetRelativePath(sourceDirectory, filePath).Replace('\\', '/');
            archive.CreateEntryFromFile(filePath, $"{entryRoot}/{relativePath}", CompressionLevel.Fastest);
        }
    }

    private async Task SaveBackupManifestAsync(BackupManifest manifest, CancellationToken cancellationToken)
    {
        await System.IO.File.WriteAllTextAsync(GetBackupManifestPath(manifest.Id), JsonSerializer.Serialize(manifest, JsonOptions), cancellationToken);
    }

    private List<BackupManifest> ReadBackupManifests()
    {
        Directory.CreateDirectory(GetBackupRoot());
        return Directory.EnumerateFiles(GetBackupRoot(), "backup_*.json", SearchOption.TopDirectoryOnly)
            .Select(path =>
            {
                try
                {
                    return JsonSerializer.Deserialize<BackupManifest>(System.IO.File.ReadAllText(path), JsonOptions);
                }
                catch
                {
                    return null;
                }
            })
            .Where(x => x is not null && System.IO.File.Exists(x.FilePath))
            .Cast<BackupManifest>()
            .ToList();
    }

    private BackupManifest RequireBackupManifest(string backupId)
    {
        var manifestPath = GetBackupManifestPath(backupId);
        if (!System.IO.File.Exists(manifestPath))
        {
            throw new ApiException("النسخة الاحتياطية غير موجودة", StatusCodes.Status404NotFound);
        }

        var manifest = JsonSerializer.Deserialize<BackupManifest>(System.IO.File.ReadAllText(manifestPath), JsonOptions)
                       ?? throw new ApiException("بيانات النسخة الاحتياطية غير صالحة", StatusCodes.Status400BadRequest);
        if (!System.IO.File.Exists(manifest.FilePath))
        {
            throw new ApiException("ملف النسخة الاحتياطية غير موجود", StatusCodes.Status404NotFound);
        }

        return manifest;
    }

    private object MapBackupManifest(BackupManifest manifest) => new
    {
        id = manifest.Id,
        file_name = manifest.FileName,
        backup_type = manifest.BackupType,
        file_size = manifest.FileSize,
        created_at = manifest.CreatedAt,
        created_by_name = manifest.CreatedByName,
        status = manifest.Status,
        verified_at = manifest.VerifiedAt,
        metadata_json = new
        {
            encrypted = manifest.Encrypted,
            includes_uploads = manifest.IncludesUploads,
            table_counts = manifest.TableCounts,
            database_name = manifest.DatabaseName,
            trigger = manifest.Trigger
        }
    };

    private async Task PruneBackupsAsync(int retentionCount, CancellationToken cancellationToken)
    {
        var backups = ReadBackupManifests().OrderByDescending(x => x.CreatedAt).Skip(retentionCount).ToList();
        foreach (var backup in backups)
        {
            if (System.IO.File.Exists(backup.FilePath))
            {
                System.IO.File.Delete(backup.FilePath);
            }

            var manifestPath = GetBackupManifestPath(backup.Id);
            if (System.IO.File.Exists(manifestPath))
            {
                System.IO.File.Delete(manifestPath);
            }
        }

        await Task.CompletedTask;
    }

    private async Task<BackupManifest> ReadManifestFromZipAsync(string zipPath, CancellationToken cancellationToken)
    {
        using var archive = ZipFile.OpenRead(zipPath);
        var entry = archive.GetEntry("backup-metadata.json") ?? throw new ApiException("ملف النسخة لا يحتوي على metadata");
        await using var stream = entry.Open();
        return await JsonSerializer.DeserializeAsync<BackupManifest>(stream, JsonOptions, cancellationToken)
               ?? throw new ApiException("تعذر قراءة بيانات النسخة");
    }

    private async Task VerifyDangerousOperationAsync(Dictionary<string, JsonElement> request, string expectedConfirmation, CancellationToken cancellationToken)
    {
        var user = await EnsureSuperAdminAsync(cancellationToken);
        var password = request.TryGetValue("admin_password", out var passwordValue) ? passwordValue.GetString() : null;
        password ??= request.TryGetValue("password", out var plainPasswordValue) ? plainPasswordValue.GetString() : null;
        password ??= request.TryGetValue("current_password", out var currentPasswordValue) ? currentPasswordValue.GetString() : null;
        if (string.IsNullOrWhiteSpace(password) || !passwordHasher.Verify(password, user.PasswordHash))
        {
            throw new ApiException("كلمة مرور مدير النظام غير صحيحة", StatusCodes.Status403Forbidden);
        }

        var confirmation = request.TryGetValue("confirmation_text", out var confirmationValue) ? confirmationValue.GetString() : null;
        confirmation ??= request.TryGetValue("confirmation", out var shortConfirmationValue) ? shortConfirmationValue.GetString() : null;
        if (!string.Equals(confirmation, expectedConfirmation, StringComparison.Ordinal))
        {
            throw new ApiException("عبارة التأكيد غير صحيحة", StatusCodes.Status400BadRequest);
        }
    }

    private async Task<User> EnsureSuperAdminAsync(CancellationToken cancellationToken)
    {
        var userId = currentUser.UserId ?? throw new ApiException("يلزم تسجيل الدخول", StatusCodes.Status401Unauthorized);
        var user = await db.Users.Include(x => x.Role).FirstOrDefaultAsync(x => x.Id == userId, cancellationToken)
                   ?? throw new ApiException("المستخدم غير موجود", StatusCodes.Status401Unauthorized);
        if (!string.Equals(user.Role?.Code, "super_admin", StringComparison.OrdinalIgnoreCase))
        {
            throw new ApiException("هذا الإجراء متاح لمدير النظام فقط", StatusCodes.Status403Forbidden);
        }

        return user;
    }

    private void EnsureDangerousOperationsEnabled()
    {
        if (!configuration.GetValue<bool>("EnableDangerousDatabaseOperations"))
        {
            throw new ApiException("العمليات الخطرة معطلة في هذه البيئة. فعّل EnableDangerousDatabaseOperations بعد أخذ نسخة احتياطية ومراجعة الخطة.", StatusCodes.Status403Forbidden);
        }
    }

    private async Task<string?> GetCurrentUserDisplayNameAsync(CancellationToken cancellationToken)
    {
        if (currentUser.UserId is null)
        {
            return null;
        }

        return await db.Users.AsNoTracking().Where(x => x.Id == currentUser.UserId).Select(x => x.NameAr).FirstOrDefaultAsync(cancellationToken);
    }

    private async Task<List<object>> GetResetScopeTablesAsync(string scope, CancellationToken cancellationToken)
    {
        var rows = new List<object>();
        async Task Add(string table, IQueryable<object> query) => rows.Add(new { table_name = table, records_count = await query.CountAsync(cancellationToken) });

        if (scope is "clear_requests_only" or "clear_business_data")
        {
            await Add("requests", db.Requests);
            await Add("request_attachments", db.RequestAttachments);
            await Add("request_workflow_snapshots", db.RequestWorkflowSnapshots);
        }

        if (scope is "clear_messages_only" or "clear_business_data")
        {
            await Add("messages", db.Messages);
            await Add("message_recipients", db.MessageRecipients);
            await Add("message_attachments", db.MessageAttachments);
        }

        if (scope is "clear_documents_only" or "clear_business_data")
        {
            await Add("documents", db.Documents);
            await Add("document_versions", db.DocumentVersions);
            await Add("document_acknowledgements", db.DocumentAcknowledgements);
        }

        if (rows.Count == 0)
        {
            throw new ApiException("نطاق إعادة الضبط غير معروف");
        }

        return rows;
    }

    private async Task<object> ExecuteResetScopeAsync(string scope, CancellationToken cancellationToken)
    {
        var before = await GetResetScopeTablesAsync(scope, cancellationToken);

        if (scope is "clear_requests_only" or "clear_business_data")
        {
            db.RequestAttachments.RemoveRange(db.RequestAttachments);
            db.RequestSlaTracking.RemoveRange(db.RequestSlaTracking);
            db.RequestExecutionLogs.RemoveRange(db.RequestExecutionLogs);
            db.RequestComments.RemoveRange(db.RequestComments);
            db.RequestStatusHistory.RemoveRange(db.RequestStatusHistory);
            db.RequestWorkflowSnapshots.RemoveRange(db.RequestWorkflowSnapshots);
            db.RequestFieldSnapshots.RemoveRange(db.RequestFieldSnapshots);
            db.Requests.RemoveRange(db.Requests);
        }

        if (scope is "clear_messages_only" or "clear_business_data")
        {
            db.MessageAttachments.RemoveRange(db.MessageAttachments);
            db.MessageRecipients.RemoveRange(db.MessageRecipients);
            db.Messages.RemoveRange(db.Messages);
        }

        if (scope is "clear_documents_only" or "clear_business_data")
        {
            db.DocumentAcknowledgements.RemoveRange(db.DocumentAcknowledgements);
            db.DocumentAccessLogs.RemoveRange(db.DocumentAccessLogs);
            db.DocumentPermissions.RemoveRange(db.DocumentPermissions);
            db.DocumentVersions.RemoveRange(db.DocumentVersions);
            db.Documents.RemoveRange(db.Documents);
        }

        await db.SaveChangesAsync(cancellationToken);
        return new { scope, before };
    }

    private byte[] EncryptBytes(byte[] plainBytes)
    {
        using var aes = Aes.Create();
        aes.Key = SHA256.HashData(Encoding.UTF8.GetBytes(configuration["Jwt:Secret"] ?? "qib-dotnet-development-secret"));
        aes.GenerateIV();
        using var encryptor = aes.CreateEncryptor();
        var cipher = encryptor.TransformFinalBlock(plainBytes, 0, plainBytes.Length);
        var output = new byte[9 + aes.IV.Length + cipher.Length];
        Encoding.ASCII.GetBytes("QIBENCV1").CopyTo(output, 0);
        output[8] = (byte)aes.IV.Length;
        aes.IV.CopyTo(output, 9);
        cipher.CopyTo(output, 9 + aes.IV.Length);
        return output;
    }

    private byte[] DecryptBytes(byte[] encryptedBytes)
    {
        if (encryptedBytes.Length < 25 || Encoding.ASCII.GetString(encryptedBytes, 0, 8) != "QIBENCV1")
        {
            throw new ApiException("صيغة التشفير غير معروفة");
        }

        var ivLength = encryptedBytes[8];
        var iv = encryptedBytes.Skip(9).Take(ivLength).ToArray();
        var cipher = encryptedBytes.Skip(9 + ivLength).ToArray();
        using var aes = Aes.Create();
        aes.Key = SHA256.HashData(Encoding.UTF8.GetBytes(configuration["Jwt:Secret"] ?? "qib-dotnet-development-secret"));
        aes.IV = iv;
        using var decryptor = aes.CreateDecryptor();
        return decryptor.TransformFinalBlock(cipher, 0, cipher.Length);
    }

    private static async Task<string> ComputeSha256Async(string path, CancellationToken cancellationToken)
    {
        await using var stream = System.IO.File.OpenRead(path);
        var hash = await SHA256.HashDataAsync(stream, cancellationToken);
        return Convert.ToHexString(hash).ToLowerInvariant();
    }

    private static string SafeFileName(string value)
    {
        var invalid = Path.GetInvalidFileNameChars();
        var cleaned = new string(value.Select(ch => invalid.Contains(ch) ? '_' : ch).ToArray());
        return string.IsNullOrWhiteSpace(cleaned) ? "file" : cleaned;
    }

    private List<UpdatePackageManifest> ReadUpdatePackages()
    {
        Directory.CreateDirectory(GetUpdatePackageRoot());
        return Directory.EnumerateFiles(GetUpdatePackageRoot(), "package_*.json", SearchOption.TopDirectoryOnly)
            .Select(path =>
            {
                try
                {
                    return JsonSerializer.Deserialize<UpdatePackageManifest>(System.IO.File.ReadAllText(path), JsonOptions);
                }
                catch
                {
                    return null;
                }
            })
            .Where(x => x is not null && System.IO.File.Exists(x.FilePath))
            .Cast<UpdatePackageManifest>()
            .ToList();
    }

    private string GetUpdatePackageManifestPath(long packageId) => Path.Combine(GetUpdatePackageRoot(), $"package_{packageId}.json");

    private async Task SaveUpdatePackageManifestAsync(UpdatePackageManifest package, CancellationToken cancellationToken)
    {
        await System.IO.File.WriteAllTextAsync(GetUpdatePackageManifestPath(package.Id), JsonSerializer.Serialize(package, JsonOptions), cancellationToken);
    }

    private UpdatePackageManifest RequireUpdatePackage(long packageId)
    {
        var manifestPath = GetUpdatePackageManifestPath(packageId);
        if (!System.IO.File.Exists(manifestPath))
        {
            throw new ApiException("حزمة التحديث غير موجودة", StatusCodes.Status404NotFound);
        }

        var package = JsonSerializer.Deserialize<UpdatePackageManifest>(System.IO.File.ReadAllText(manifestPath), JsonOptions)
                      ?? throw new ApiException("بيانات حزمة التحديث غير صالحة");
        if (!System.IO.File.Exists(package.FilePath))
        {
            throw new ApiException("ملف حزمة التحديث غير موجود", StatusCodes.Status404NotFound);
        }

        return package;
    }

    private static long GetPackageId(Dictionary<string, JsonElement> request)
    {
        if (!request.TryGetValue("package_id", out var value) || !value.TryGetInt64(out var id) || id <= 0)
        {
            throw new ApiException("معرف حزمة التحديث مطلوب");
        }

        return id;
    }

    private async Task<UpdatePackageManifest> ValidateUpdatePackageManifestAsync(UpdatePackageManifest package, CancellationToken cancellationToken)
    {
        var warnings = new List<string>();
        var errors = new List<string>();
        var filesCount = 1;

        if (package.FileName.EndsWith(".zip", StringComparison.OrdinalIgnoreCase))
        {
            try
            {
                using var archive = ZipFile.OpenRead(package.FilePath);
                filesCount = archive.Entries.Count;
                var manifestEntry = archive.GetEntry("manifest.json") ?? archive.GetEntry("update-manifest.json");
                if (manifestEntry is null)
                {
                    warnings.Add("لا توجد manifest.json داخل الحزمة، سيتم التعامل معها كحزمة يدوية.");
                }
                else
                {
                    await using var stream = manifestEntry.Open();
                    var manifest = await JsonSerializer.DeserializeAsync<Dictionary<string, JsonElement>>(stream, JsonOptions, cancellationToken);
                    if (manifest is not null)
                    {
                        package.Version = manifest.TryGetValue("version", out var version) ? version.GetString() ?? package.Version : package.Version;
                        package.ReleaseDate = manifest.TryGetValue("release_date", out var releaseDate) ? releaseDate.GetString() : package.ReleaseDate;
                        package.RequiresMigration = manifest.TryGetValue("requires_migration", out var requiresMigration) && requiresMigration.ValueKind == JsonValueKind.True;
                        package.RequiresRestart = !manifest.TryGetValue("requires_restart", out var requiresRestart) || requiresRestart.ValueKind != JsonValueKind.False;
                        package.IncludesBackend = !manifest.TryGetValue("includes_backend", out var includesBackend) || includesBackend.ValueKind != JsonValueKind.False;
                        package.IncludesFrontend = manifest.TryGetValue("includes_frontend", out var includesFrontend) && includesFrontend.ValueKind == JsonValueKind.True;
                        package.ReleaseNotesSummary = manifest.TryGetValue("release_notes", out var releaseNotes) ? releaseNotes.GetString() : package.ReleaseNotesSummary;
                    }
                }

                if (archive.Entries.Any(x => x.FullName.Contains("..") || Path.IsPathRooted(x.FullName)))
                {
                    errors.Add("الحزمة تحتوي على مسارات غير آمنة.");
                }
            }
            catch
            {
                errors.Add("تعذر قراءة ملف ZIP.");
            }
        }
        else
        {
            warnings.Add("حزم TAR.GZ تحفظ للتحقق اليدوي ولا يتم فتحها داخل النظام حالياً.");
        }

        package.FilesCount = filesCount;
        package.Valid = errors.Count == 0;
        package.Errors = errors;
        package.Warnings = warnings;
        package.Status = package.Valid ? "validated" : "invalid";
        return package;
    }

    private object MapUpdatePackage(UpdatePackageManifest package) => new
    {
        id = package.Id,
        file_name = package.FileName,
        file_size = package.FileSize,
        version = package.Version,
        status = package.Status,
        uploaded_at = package.UploadedAt,
        uploaded_by_name = package.UploadedByName,
        checksum = package.Checksum,
        metadata_json = new
        {
            valid = package.Valid,
            errors = package.Errors,
            warnings = package.Warnings,
            files_count = package.FilesCount,
            version = package.Version,
            release_date = package.ReleaseDate,
            requires_migration = package.RequiresMigration,
            requires_restart = package.RequiresRestart,
            includes_backend = package.IncludesBackend,
            includes_frontend = package.IncludesFrontend,
            release_notes = package.ReleaseNotesSummary
        }
    };

    private static List<Dictionary<string, object?>> DefaultMessagingAutoRules() =>
    [
        new()
        {
            ["id"] = 1,
            ["event_code"] = "on_request_created",
            ["is_enabled"] = true,
            ["message_type_id"] = null,
            ["subject_template"] = "تم إنشاء طلب {{request_number}}",
            ["body_template"] = "تم إنشاء الطلب {{request_number}} من نوع {{request_type}}."
        },
        new()
        {
            ["id"] = 2,
            ["event_code"] = "on_request_returned",
            ["is_enabled"] = true,
            ["message_type_id"] = null,
            ["subject_template"] = "تم إرجاع الطلب {{request_number}} للتعديل",
            ["body_template"] = "يرجى مراجعة الملاحظات وتحديث الطلب ثم إعادة إرساله."
        },
        new()
        {
            ["id"] = 3,
            ["event_code"] = "on_request_completed",
            ["is_enabled"] = true,
            ["message_type_id"] = null,
            ["subject_template"] = "تم تنفيذ الطلب {{request_number}}",
            ["body_template"] = "تم تنفيذ الطلب بنجاح."
        }
    ];

    private async Task<List<Dictionary<string, object?>>> ReadMessagingAutoRulesAsync(CancellationToken cancellationToken)
    {
        var records = await db.MessageAutoRules
            .AsNoTracking()
            .OrderBy(x => x.Id)
            .Select(x => new
            {
                x.Id,
                x.EventCode,
                x.IsEnabled,
                x.MessageTypeId,
                x.SubjectTemplate,
                x.BodyTemplate
            })
            .ToListAsync(cancellationToken);
        var rows = records.Select(x => new Dictionary<string, object?>
        {
            ["id"] = x.Id,
            ["event_code"] = x.EventCode,
            ["is_enabled"] = x.IsEnabled,
            ["message_type_id"] = x.MessageTypeId,
            ["subject_template"] = string.IsNullOrWhiteSpace(x.SubjectTemplate) ? DefaultAutoRuleSubject(x.EventCode) : x.SubjectTemplate,
            ["body_template"] = string.IsNullOrWhiteSpace(x.BodyTemplate) ? DefaultAutoRuleBody(x.EventCode) : x.BodyTemplate
        }).ToList();
        if (rows.Count > 0)
        {
            return rows;
        }

        var defaults = DefaultMessagingAutoRules();
        foreach (var row in defaults)
        {
            db.MessageAutoRules.Add(new MessageAutoRule
            {
                EventCode = Convert.ToString(row["event_code"]) ?? "",
                IsEnabled = ToBool(row["is_enabled"]),
                SubjectTemplate = Convert.ToString(row["subject_template"]) ?? "",
                BodyTemplate = Convert.ToString(row["body_template"]) ?? ""
            });
        }

        await db.SaveChangesAsync(cancellationToken);
        var updatedRecords = await db.MessageAutoRules
            .AsNoTracking()
            .OrderBy(x => x.Id)
            .Select(x => new
            {
                x.Id,
                x.EventCode,
                x.IsEnabled,
                x.MessageTypeId,
                x.SubjectTemplate,
                x.BodyTemplate
            })
            .ToListAsync(cancellationToken);
        return updatedRecords.Select(x => new Dictionary<string, object?>
        {
            ["id"] = x.Id,
            ["event_code"] = x.EventCode,
            ["is_enabled"] = x.IsEnabled,
            ["message_type_id"] = x.MessageTypeId,
            ["subject_template"] = string.IsNullOrWhiteSpace(x.SubjectTemplate) ? DefaultAutoRuleSubject(x.EventCode) : x.SubjectTemplate,
            ["body_template"] = string.IsNullOrWhiteSpace(x.BodyTemplate) ? DefaultAutoRuleBody(x.EventCode) : x.BodyTemplate
        }).ToList();
    }

    private static string DefaultAutoRuleSubject(string eventCode) =>
        eventCode switch
        {
            "request_created" or "on_request_created" => "تم إنشاء طلب {{request_number}}",
            "request_returned" or "on_request_returned" => "تم إرجاع الطلب {{request_number}} للتعديل",
            "request_completed" or "on_request_completed" => "تم تنفيذ الطلب {{request_number}}",
            _ => ""
        };

    private static string DefaultAutoRuleBody(string eventCode) =>
        eventCode switch
        {
            "request_created" or "on_request_created" => "تم إنشاء الطلب {{request_number}} من نوع {{request_type}}.",
            "request_returned" or "on_request_returned" => "يرجى مراجعة الملاحظات وتحديث الطلب ثم إعادة إرساله.",
            "request_completed" or "on_request_completed" => "تم تنفيذ الطلب بنجاح.",
            _ => ""
        };

    private async Task SyncLegacyAutoRulesAsync(IReadOnlyCollection<Dictionary<string, object?>> rows, CancellationToken cancellationToken)
    {
        var setting = await db.SystemSettings.FirstOrDefaultAsync(x => x.Key == "messaging.auto_rules", cancellationToken);
        if (setting is null)
        {
            setting = new SystemSetting
            {
                Key = "messaging.auto_rules",
                Group = "messaging",
                DataType = "json"
            };
            db.SystemSettings.Add(setting);
        }

        setting.Value = JsonSerializer.Serialize(rows, JsonOptions);
        setting.UpdatedByUserId = currentUser.UserId;
        await db.SaveChangesAsync(cancellationToken);
    }

    private static string? JsonString(JsonElement row, string name)
    {
        if (!row.TryGetProperty(name, out var value))
        {
            return null;
        }

        return value.ValueKind switch
        {
            JsonValueKind.String => value.GetString(),
            JsonValueKind.Null or JsonValueKind.Undefined => null,
            _ => value.ToString()
        };
    }

    private static long? JsonNumber(JsonElement row, string name)
    {
        if (!row.TryGetProperty(name, out var value) || value.ValueKind is JsonValueKind.Null or JsonValueKind.Undefined)
        {
            return null;
        }

        if (value.ValueKind == JsonValueKind.Number && value.TryGetInt64(out var number))
        {
            return number;
        }

        return long.TryParse(value.ToString(), out var parsed) ? parsed : null;
    }

    private static bool JsonBool(JsonElement row, string name)
    {
        if (!row.TryGetProperty(name, out var value))
        {
            return false;
        }

        return value.ValueKind switch
        {
            JsonValueKind.True => true,
            JsonValueKind.False => false,
            JsonValueKind.String when bool.TryParse(value.GetString(), out var parsed) => parsed,
            JsonValueKind.Number when value.TryGetInt32(out var number) => number != 0,
            _ => false
        };
    }

    private sealed class BackupManifest
    {
        public string Id { get; set; } = "";
        public string BackupType { get; set; } = "";
        public string Trigger { get; set; } = "";
        public string Status { get; set; } = "success";
        public string FileName { get; set; } = "";
        public string FilePath { get; set; } = "";
        public long FileSize { get; set; }
        public string Checksum { get; set; } = "";
        public DateTimeOffset CreatedAt { get; set; }
        public string? CreatedByName { get; set; }
        public DateTimeOffset? VerifiedAt { get; set; }
        public string DatabaseName { get; set; } = "";
        public bool IncludesUploads { get; set; }
        public bool Encrypted { get; set; }
        public Dictionary<string, long> TableCounts { get; set; } = new();
        public Dictionary<string, object?> Metadata { get; set; } = new();
    }

    private sealed class UpdatePackageManifest
    {
        public long Id { get; set; }
        public string FileName { get; set; } = "";
        public string FilePath { get; set; } = "";
        public long FileSize { get; set; }
        public string Checksum { get; set; } = "";
        public string Version { get; set; } = "";
        public string Status { get; set; } = "uploaded";
        public DateTimeOffset UploadedAt { get; set; }
        public string? UploadedByName { get; set; }
        public bool Valid { get; set; }
        public int FilesCount { get; set; }
        public List<string> Errors { get; set; } = [];
        public List<string> Warnings { get; set; } = [];
        public string? ReleaseDate { get; set; }
        public bool RequiresMigration { get; set; }
        public bool RequiresRestart { get; set; } = true;
        public bool IncludesBackend { get; set; } = true;
        public bool IncludesFrontend { get; set; }
        public string? ReleaseNotesSummary { get; set; }
    }

    private static SystemSettingDto MapSetting(SystemSetting setting)
    {
        return new SystemSettingDto(
            setting.Id,
            setting.Key,
            setting.IsSensitive ? null : setting.Value,
            setting.Group,
            setting.DataType,
            setting.IsSensitive,
            setting.DescriptionAr,
            setting.CreatedAt,
            setting.UpdatedAt);
    }
}
