using System.Text.Json.Serialization;

namespace Qib.ServicePortal.Api.Application.DTOs;

public record MessageTypeDto(
    long Id,
    string Code,
    string NameAr,
    string? NameEn,
    string Color,
    string? Icon,
    bool IsOfficial,
    bool RequiresRequest,
    bool RequiresAttachment,
    bool ShowInPdf,
    bool AllowReply,
    bool VisibleToRequester,
    int SortOrder,
    bool IsActive);

public record MessageClassificationDto(
    long Id,
    string Code,
    string NameAr,
    string? NameEn,
    string Color,
    bool IsConfidential,
    bool RequiresPermission,
    int SortOrder,
    bool IsActive);

public record MessageTemplateDto(
    long Id,
    string Code,
    string NameAr,
    string? NameEn,
    long? MessageTypeId,
    string? MessageTypeNameAr,
    string SubjectTemplate,
    string BodyTemplate,
    int SortOrder,
    bool IsActive);

public record MessageRecipientDto(
    long UserId,
    string? NameAr,
    string? Email,
    bool IsRead,
    DateTimeOffset? ReadAt,
    bool IsArchived);

public record MessageAttachmentDto(
    long Id,
    string FileName,
    string ContentType,
    long FileSize,
    string Checksum,
    long UploadedByUserId,
    string? UploadedByNameAr,
    DateTimeOffset UploadedAt);

public record MessageListItemDto(
    long Id,
    string Subject,
    string Preview,
    long SenderId,
    string? SenderNameAr,
    long MessageTypeId,
    string? MessageTypeNameAr,
    string? MessageTypeColor,
    long? ClassificationId,
    string? ClassificationNameAr,
    string? ClassificationColor,
    string Priority,
    bool IsOfficial,
    long? RelatedRequestId,
    string? RelatedRequestNumber,
    DateTimeOffset SentAt,
    bool IsRead,
    bool IsArchived,
    int RecipientsCount,
    int AttachmentsCount);

public record MessageDetailsDto(
    long Id,
    string Subject,
    string Body,
    long SenderId,
    string? SenderNameAr,
    string? SenderEmail,
    long MessageTypeId,
    string? MessageTypeNameAr,
    string? MessageTypeColor,
    bool MessageTypeAllowsReply,
    long? ClassificationId,
    string? ClassificationNameAr,
    string? ClassificationColor,
    string Priority,
    bool IsOfficial,
    string? OfficialReferenceNumber,
    long? OfficialPdfDocumentId,
    string OfficialStatus,
    bool IncludeInRequestPdf,
    long? ParentMessageId,
    long? RelatedRequestId,
    string? RelatedRequestNumber,
    DateTimeOffset SentAt,
    bool IsRead,
    bool IsArchived,
    IReadOnlyCollection<MessageRecipientDto> Recipients,
    IReadOnlyCollection<MessageAttachmentDto> Attachments);

public record CreateMessageRequest(
    IReadOnlyCollection<long> RecipientIds,
    long MessageTypeId,
    long? ClassificationId,
    long? RelatedRequestId,
    string Priority,
    string Subject,
    string Body,
    bool IncludeInRequestPdf);

public record ReplyMessageRequest(
    IReadOnlyCollection<long>? RecipientIds,
    string Body,
    string? Subject,
    long? MessageTypeId,
    string? MessageType,
    long? ClassificationId,
    string? ClassificationCode,
    string? Priority,
    bool? IncludeInRequestPdf);

public record MessagingAttachmentSettingsDto(
    [property: JsonPropertyName("max_attachments_per_message")]
    int MaxAttachments,
    [property: JsonPropertyName("max_file_size_mb")]
    int MaxFileSizeMb,
    [property: JsonPropertyName("allowed_extensions_json")]
    IReadOnlyCollection<string> AllowedExtensions,
    [property: JsonPropertyName("blocked_extensions_json")]
    IReadOnlyCollection<string> BlockedExtensions,
    [property: JsonPropertyName("allow_message_attachments")]
    bool AllowMessageAttachments = true,
    [property: JsonPropertyName("hide_real_file_path")]
    bool HideRealFilePath = true,
    [property: JsonPropertyName("log_attachment_downloads")]
    bool LogAttachmentDownloads = true,
    [property: JsonPropertyName("enable_virus_scan")]
    bool EnableVirusScan = false,
    [property: JsonPropertyName("block_executable_files")]
    bool BlockExecutableFiles = true,
    [property: JsonPropertyName("message_upload_path")]
    string MessageUploadPath = "messages");
