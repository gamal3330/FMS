namespace Qib.ServicePortal.Api.Domain.Entities;

public class UserSession : BaseEntity
{
    public long UserId { get; set; }
    public User? User { get; set; }
    public string SessionTokenHash { get; set; } = string.Empty;
    public string? RefreshTokenHash { get; set; }
    public string? IpAddress { get; set; }
    public string? UserAgent { get; set; }
    public DateTimeOffset StartedAt { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset? LastSeenAt { get; set; }
    public DateTimeOffset? ExpiresAt { get; set; }
    public DateTimeOffset? RevokedAt { get; set; }
    public string? RevocationReason { get; set; }
    public bool IsActive { get; set; } = true;
}

public class UserLoginAttempt : BaseEntity
{
    public long? UserId { get; set; }
    public User? User { get; set; }
    public string LoginIdentifier { get; set; } = string.Empty;
    public bool IsSuccess { get; set; }
    public string? FailureReason { get; set; }
    public string? IpAddress { get; set; }
    public string? UserAgent { get; set; }
    public DateTimeOffset AttemptedAt { get; set; } = DateTimeOffset.UtcNow;
}

public class SystemHealthCheck : BaseEntity
{
    public string CheckName { get; set; } = string.Empty;
    public string Category { get; set; } = "general";
    public string Status { get; set; } = "healthy";
    public int? LatencyMs { get; set; }
    public string? Message { get; set; }
    public string? DetailsJson { get; set; }
    public DateTimeOffset CheckedAt { get; set; } = DateTimeOffset.UtcNow;
}

public class SystemHealthAlert : BaseEntity
{
    public string AlertType { get; set; } = string.Empty;
    public string Severity { get; set; } = "info";
    public string Title { get; set; } = string.Empty;
    public string? Message { get; set; }
    public string? RecommendedAction { get; set; }
    public string? RelatedRoute { get; set; }
    public bool IsResolved { get; set; }
    public DateTimeOffset? ResolvedAt { get; set; }
    public long? ResolvedByUserId { get; set; }
    public User? ResolvedByUser { get; set; }
}

public class SystemHealthMetric : BaseEntity
{
    public string MetricName { get; set; } = string.Empty;
    public decimal MetricValue { get; set; }
    public string? MetricUnit { get; set; }
    public string Category { get; set; } = "general";
    public DateTimeOffset RecordedAt { get; set; } = DateTimeOffset.UtcNow;
}

public class SystemHealthSettings : BaseEntity
{
    public int DiskWarningPercent { get; set; } = 80;
    public int DiskCriticalPercent { get; set; } = 90;
    public int ErrorsWarningCount { get; set; } = 10;
    public int ErrorsCriticalCount { get; set; } = 50;
    public int DbLatencyWarningMs { get; set; } = 300;
    public int DbLatencyCriticalMs { get; set; } = 1000;
    public bool AutoCheckEnabled { get; set; } = true;
    public int AutoCheckIntervalMinutes { get; set; } = 15;
    public int RetentionDays { get; set; } = 30;
}

public class DatabaseBackup : BaseEntity
{
    public string BackupName { get; set; } = string.Empty;
    public string BackupType { get; set; } = "manual";
    public string Status { get; set; } = "pending";
    public string? FilePath { get; set; }
    public long? FileSize { get; set; }
    public string? Checksum { get; set; }
    public string? ErrorMessage { get; set; }
    public long? CreatedByUserId { get; set; }
    public User? CreatedByUser { get; set; }
    public DateTimeOffset StartedAt { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset? CompletedAt { get; set; }
}

public class DatabaseJob : BaseEntity
{
    public string JobType { get; set; } = string.Empty;
    public string Status { get; set; } = "pending";
    public int ProgressPercent { get; set; }
    public string? ResultJson { get; set; }
    public string? ErrorMessage { get; set; }
    public long? StartedByUserId { get; set; }
    public User? StartedByUser { get; set; }
    public DateTimeOffset? StartedAt { get; set; }
    public DateTimeOffset? FinishedAt { get; set; }
}

public class DatabaseMaintenanceLog : BaseEntity
{
    public string Operation { get; set; } = string.Empty;
    public string Status { get; set; } = "success";
    public string? Message { get; set; }
    public string? DetailsJson { get; set; }
    public long? ActorUserId { get; set; }
    public User? ActorUser { get; set; }
}

public class DatabaseRestoreJob : BaseEntity
{
    public string RestoreToken { get; set; } = string.Empty;
    public string Status { get; set; } = "pending";
    public string? SourceBackupPath { get; set; }
    public string? PreviewJson { get; set; }
    public string? ErrorMessage { get; set; }
    public long? RequestedByUserId { get; set; }
    public User? RequestedByUser { get; set; }
    public DateTimeOffset? CompletedAt { get; set; }
}

public class RollbackPoint : BaseEntity
{
    public string Name { get; set; } = string.Empty;
    public string? Version { get; set; }
    public string? BackupPath { get; set; }
    public string Status { get; set; } = "available";
    public long? CreatedByUserId { get; set; }
    public User? CreatedByUser { get; set; }
}

public class SystemVersion : BaseEntity
{
    public string Version { get; set; } = string.Empty;
    public string? BuildNumber { get; set; }
    public string Status { get; set; } = "active";
    public DateTimeOffset? AppliedAt { get; set; }
    public long? AppliedByUserId { get; set; }
    public User? AppliedByUser { get; set; }
    public string? Notes { get; set; }
}

public class UpdatePackage : BaseEntity
{
    public string PackageName { get; set; } = string.Empty;
    public string Version { get; set; } = string.Empty;
    public string Status { get; set; } = "uploaded";
    public string? FilePath { get; set; }
    public long? FileSize { get; set; }
    public string? Checksum { get; set; }
    public string? ManifestJson { get; set; }
    public long? UploadedByUserId { get; set; }
    public User? UploadedByUser { get; set; }
}

public class UpdateJob : BaseEntity
{
    public long? PackageId { get; set; }
    public UpdatePackage? Package { get; set; }
    public string JobType { get; set; } = "update";
    public string Status { get; set; } = "pending";
    public int ProgressPercent { get; set; }
    public string? CurrentStep { get; set; }
    public string? ResultJson { get; set; }
    public string? ErrorMessage { get; set; }
    public long? StartedByUserId { get; set; }
    public User? StartedByUser { get; set; }
    public DateTimeOffset? StartedAt { get; set; }
    public DateTimeOffset? FinishedAt { get; set; }
}

public class UpdateLog : BaseEntity
{
    public long? UpdateJobId { get; set; }
    public UpdateJob? UpdateJob { get; set; }
    public string Level { get; set; } = "info";
    public string Message { get; set; } = string.Empty;
    public string? DetailsJson { get; set; }
    public DateTimeOffset LoggedAt { get; set; } = DateTimeOffset.UtcNow;
}

public class UpdateHistory : BaseEntity
{
    public string Version { get; set; } = string.Empty;
    public string Status { get; set; } = "success";
    public DateTimeOffset? StartedAt { get; set; }
    public DateTimeOffset? CompletedAt { get; set; }
    public long? AppliedByUserId { get; set; }
    public User? AppliedByUser { get; set; }
    public string? Summary { get; set; }
}

public class SavedReport : BaseEntity
{
    public string Name { get; set; } = string.Empty;
    public string? Description { get; set; }
    public string ReportType { get; set; } = "requests";
    public string FiltersJson { get; set; } = "{}";
    public bool IsFavorite { get; set; }
    public long CreatedByUserId { get; set; }
    public User? CreatedByUser { get; set; }
}

public class ReportTemplate : BaseEntity
{
    public string NameAr { get; set; } = string.Empty;
    public string Code { get; set; } = string.Empty;
    public string ReportType { get; set; } = "requests";
    public string? Description { get; set; }
    public string DefaultFiltersJson { get; set; } = "{}";
    public string DefaultColumnsJson { get; set; } = "[]";
    public bool IsActive { get; set; } = true;
    public long? CreatedByUserId { get; set; }
    public User? CreatedByUser { get; set; }
}

public class ScheduledReport : BaseEntity
{
    public string Name { get; set; } = string.Empty;
    public long? ReportTemplateId { get; set; }
    public ReportTemplate? ReportTemplate { get; set; }
    public string Frequency { get; set; } = "monthly";
    public TimeOnly RunTime { get; set; } = new(8, 0);
    public string RecipientsJson { get; set; } = "[]";
    public string ExportFormat { get; set; } = "excel";
    public bool IsActive { get; set; } = true;
    public DateTimeOffset? LastRunAt { get; set; }
    public DateTimeOffset? NextRunAt { get; set; }
    public long CreatedByUserId { get; set; }
    public User? CreatedByUser { get; set; }
}

public class ReportExportLog : BaseEntity
{
    public string ReportType { get; set; } = string.Empty;
    public string ExportFormat { get; set; } = "excel";
    public string FiltersJson { get; set; } = "{}";
    public string? FilePath { get; set; }
    public long ExportedByUserId { get; set; }
    public User? ExportedByUser { get; set; }
    public string? IpAddress { get; set; }
    public DateTimeOffset ExportedAt { get; set; } = DateTimeOffset.UtcNow;
}

public class AiSettings : BaseEntity
{
    public bool IsEnabled { get; set; }
    public string Provider { get; set; } = "ollama";
    public string? BaseUrl { get; set; }
    public string? ModelName { get; set; }
    public int MaxInputChars { get; set; } = 5000;
    public string? SystemPrompt { get; set; }
    public string? SettingsJson { get; set; }
    public long? UpdatedByUserId { get; set; }
    public User? UpdatedByUser { get; set; }
}

public class AiUsageLog : BaseEntity
{
    public long? UserId { get; set; }
    public User? User { get; set; }
    public string Feature { get; set; } = string.Empty;
    public int InputChars { get; set; }
    public int OutputChars { get; set; }
    public int LatencyMs { get; set; }
    public string Status { get; set; } = "success";
    public string? ErrorMessage { get; set; }
}

public class AiPromptTemplate : BaseEntity
{
    public string Code { get; set; } = string.Empty;
    public string NameAr { get; set; } = string.Empty;
    public string PromptText { get; set; } = string.Empty;
    public string Feature { get; set; } = string.Empty;
    public bool IsActive { get; set; } = true;
}

public class AiHealthCheck : BaseEntity
{
    public string Provider { get; set; } = string.Empty;
    public string Status { get; set; } = "unknown";
    public int? LatencyMs { get; set; }
    public string? Message { get; set; }
    public DateTimeOffset CheckedAt { get; set; } = DateTimeOffset.UtcNow;
}

public class AiFeaturePermission : BaseEntity
{
    public string Feature { get; set; } = string.Empty;
    public long? RoleId { get; set; }
    public Role? Role { get; set; }
    public long? UserId { get; set; }
    public User? User { get; set; }
    public bool IsAllowed { get; set; } = true;
}

public class AiFeedback : BaseEntity
{
    public long? UserId { get; set; }
    public User? User { get; set; }
    public string Feature { get; set; } = string.Empty;
    public int Rating { get; set; }
    public string? Comments { get; set; }
    public string? MetadataJson { get; set; }
}

public class MessagingSettings : BaseEntity
{
    public bool IsEnabled { get; set; } = true;
    public int MaxRecipients { get; set; } = 1000;
    public bool AllowSendToUsers { get; set; } = true;
    public bool AllowSendToDepartments { get; set; } = true;
    public bool AllowMultipleRecipients { get; set; } = true;
    public bool RestrictToActiveUsers { get; set; } = true;
    public string? SettingsJson { get; set; }
    public long? UpdatedByUserId { get; set; }
    public User? UpdatedByUser { get; set; }
}

public class MessageAttachmentSettings : BaseEntity
{
    public bool AllowAttachments { get; set; } = true;
    public int MaxAttachments { get; set; } = 5;
    public int MaxFileSizeMb { get; set; } = 10;
    public string AllowedExtensionsJson { get; set; } = "[\"pdf\",\"png\",\"jpg\",\"jpeg\",\"doc\",\"docx\",\"xls\",\"xlsx\"]";
    public bool VirusScanEnabled { get; set; }
    public string? SettingsJson { get; set; }
}

public class MessageNotificationSettings : BaseEntity
{
    public bool NotifyOnNewMessage { get; set; } = true;
    public bool NotifyOnRead { get; set; }
    public bool NotifyOnRequestLinkedMessage { get; set; } = true;
    public bool AllowUserPreference { get; set; }
    public string? SettingsJson { get; set; }
}

public class MessageRequestIntegrationSettings : BaseEntity
{
    public bool AllowLinkToRequest { get; set; } = true;
    public bool ShowMessagesTabInRequestDetails { get; set; } = true;
    public bool AllowSendMessageFromRequest { get; set; } = true;
    public bool IncludeOfficialMessagesInRequestPdf { get; set; } = true;
    public bool ExcludeInternalMessagesFromPdf { get; set; } = true;
    public bool AllowRequesterToViewMessages { get; set; }
    public bool AllowApproversToViewRequestMessages { get; set; } = true;
    public string? SettingsJson { get; set; }
}

public class MessageRetentionPolicy : BaseEntity
{
    public bool AllowArchive { get; set; } = true;
    public int MessageRetentionDays { get; set; } = 2555;
    public int AttachmentRetentionDays { get; set; } = 2555;
    public bool PreventPermanentDelete { get; set; } = true;
    public bool AllowUserDeleteOwnMessage { get; set; }
    public bool OfficialMessagesProtected { get; set; } = true;
    public bool ConfidentialMessagesProtected { get; set; } = true;
    public string? SettingsJson { get; set; }
}

public class MessageSecurityPolicy : BaseEntity
{
    public bool HideSensitiveData { get; set; } = true;
    public bool MaskEmail { get; set; } = true;
    public bool MaskPhone { get; set; } = true;
    public bool MaskEmployeeNumber { get; set; } = true;
    public bool AllowContextSending { get; set; } = true;
    public bool AllowAttachmentsToModel { get; set; }
    public string? SettingsJson { get; set; }
}

public class MessageAiSettings : BaseEntity
{
    public bool IsEnabled { get; set; } = true;
    public bool ShowAssistantInCompose { get; set; } = true;
    public int MaxInputChars { get; set; } = 5000;
    public string? SystemPrompt { get; set; }
    public string? SettingsJson { get; set; }
}

public class MessageAutoRule : BaseEntity
{
    public string EventCode { get; set; } = string.Empty;
    public bool IsEnabled { get; set; } = true;
    public string? MessageTypeCode { get; set; }
    public long? MessageTypeId { get; set; }
    public MessageType? MessageType { get; set; }
    public string? TemplateCode { get; set; }
    public string SubjectTemplate { get; set; } = string.Empty;
    public string BodyTemplate { get; set; } = string.Empty;
    public string? RecipientsJson { get; set; }
}

public class UserSignature : BaseEntity
{
    public long UserId { get; set; }
    public User? User { get; set; }
    public string SignatureImagePath { get; set; } = string.Empty;
    public string? SignatureLabel { get; set; }
    public bool IsVerified { get; set; }
    public bool IsActive { get; set; } = true;
    public DateTimeOffset UploadedAt { get; set; } = DateTimeOffset.UtcNow;
    public long? VerifiedByUserId { get; set; }
    public User? VerifiedByUser { get; set; }
    public DateTimeOffset? VerifiedAt { get; set; }
}

public class RequestTypeDocument : BaseEntity
{
    public long RequestTypeId { get; set; }
    public RequestType? RequestType { get; set; }
    public long DocumentId { get; set; }
    public Document? Document { get; set; }
    public bool IsRequiredReading { get; set; }
}
