using System.Text.Json.Serialization;

namespace Qib.ServicePortal.Api.Application.DTOs;

public record DocumentCategoryDto(
    long Id,
    string NameAr,
    string? NameEn,
    string Code,
    string? Description,
    string? Icon,
    string Color,
    int SortOrder,
    bool IsActive,
    int DocumentsCount,
    DateTimeOffset? LastUpdatedAt,
    DateTimeOffset CreatedAt,
    DateTimeOffset UpdatedAt);

public record UpsertDocumentCategoryRequest(
    [property: JsonPropertyName("name_ar")]
    string NameAr,
    [property: JsonPropertyName("name_en")]
    string? NameEn,
    string Code,
    string? Description,
    string? Icon,
    string Color,
    [property: JsonPropertyName("sort_order")]
    int SortOrder,
    [property: JsonPropertyName("is_active")]
    bool IsActive);

public record DocumentCategoryStatusRequest(
    [property: JsonPropertyName("is_active")]
    bool IsActive);

public record DocumentVersionDto(
    long Id,
    long DocumentId,
    string VersionNumber,
    string FileName,
    long FileSize,
    string MimeType,
    string Checksum,
    DateOnly? IssueDate,
    DateOnly? EffectiveDate,
    DateOnly? ReviewDate,
    long UploadedByUserId,
    string? UploadedByNameAr,
    DateTimeOffset UploadedAt,
    string? ChangeSummary,
    bool IsCurrent);

public record DocumentListItemDto(
    long Id,
    string TitleAr,
    string? TitleEn,
    string? DocumentNumber,
    long CategoryId,
    string? CategoryNameAr,
    string? CategoryCode,
    long? OwnerDepartmentId,
    string? OwnerDepartmentNameAr,
    string Classification,
    string Status,
    bool RequiresAcknowledgement,
    bool IsActive,
    long? CurrentVersionId,
    string? CurrentVersionNumber,
    DateOnly? IssueDate,
    DateOnly? EffectiveDate,
    DateOnly? ReviewDate,
    DateTimeOffset UpdatedAt,
    bool CanDownload,
    bool CanPrint,
    bool HasAcknowledgedCurrentVersion);

public record DocumentDetailsDto(
    long Id,
    string TitleAr,
    string? TitleEn,
    string? DocumentNumber,
    string? Description,
    long CategoryId,
    string? CategoryNameAr,
    string? CategoryCode,
    long? OwnerDepartmentId,
    string? OwnerDepartmentNameAr,
    string Classification,
    string Status,
    long? CurrentVersionId,
    bool RequiresAcknowledgement,
    string? Keywords,
    bool IsActive,
    long CreatedByUserId,
    string? CreatedByNameAr,
    DateTimeOffset CreatedAt,
    DateTimeOffset UpdatedAt,
    bool CanDownload,
    bool CanPrint,
    bool CanManage,
    bool HasAcknowledgedCurrentVersion,
    DocumentVersionDto? CurrentVersion,
    IReadOnlyCollection<DocumentVersionDto> Versions);

public record UpdateDocumentRequest(
    [property: JsonPropertyName("title_ar")]
    string TitleAr,
    [property: JsonPropertyName("title_en")]
    string? TitleEn,
    [property: JsonPropertyName("document_number")]
    string? DocumentNumber,
    string? Description,
    [property: JsonPropertyName("category_id")]
    long CategoryId,
    [property: JsonPropertyName("owner_department_id")]
    long? OwnerDepartmentId,
    string Classification,
    string Status,
    [property: JsonPropertyName("requires_acknowledgement")]
    bool RequiresAcknowledgement,
    string? Keywords,
    [property: JsonPropertyName("is_active")]
    bool IsActive);

public record DocumentStatusRequest(
    string Status,
    [property: JsonPropertyName("is_active")]
    bool? IsActive);

public record UploadDocumentMetadataRequest(
    string TitleAr,
    string? TitleEn,
    long CategoryId,
    string? DocumentNumber,
    string? Description,
    long? OwnerDepartmentId,
    string Classification,
    DateOnly? IssueDate,
    DateOnly? EffectiveDate,
    DateOnly? ReviewDate,
    bool RequiresAcknowledgement,
    string? Keywords,
    string? VersionNumber,
    string? ChangeSummary);

public record UploadDocumentVersionMetadataRequest(
    string? VersionNumber,
    DateOnly? IssueDate,
    DateOnly? EffectiveDate,
    DateOnly? ReviewDate,
    string? ChangeSummary,
    bool SetAsCurrent = true);

public record DocumentPermissionDto(
    long Id,
    long? CategoryId,
    string? CategoryNameAr,
    long? DocumentId,
    string? DocumentTitleAr,
    long? RoleId,
    string? RoleNameAr,
    long? DepartmentId,
    string? DepartmentNameAr,
    bool CanView,
    bool CanDownload,
    bool CanPrint,
    bool CanManage,
    DateTimeOffset CreatedAt,
    DateTimeOffset UpdatedAt);

public record UpsertDocumentPermissionRequest(
    [property: JsonPropertyName("category_id")]
    long? CategoryId,
    [property: JsonPropertyName("document_id")]
    long? DocumentId,
    [property: JsonPropertyName("role_id")]
    long? RoleId,
    [property: JsonPropertyName("department_id")]
    long? DepartmentId,
    [property: JsonPropertyName("can_view")]
    bool CanView,
    [property: JsonPropertyName("can_download")]
    bool CanDownload,
    [property: JsonPropertyName("can_print")]
    bool CanPrint,
    [property: JsonPropertyName("can_manage")]
    bool CanManage);

public record DocumentAcknowledgementReminderRequest(
    [property: JsonPropertyName("department_id")]
    long? DepartmentId,
    [property: JsonPropertyName("user_ids")]
    IReadOnlyCollection<long>? UserIds);

public record DocumentAccessLogDto(
    long Id,
    long DocumentId,
    long? VersionId,
    string Action,
    long UserId,
    string? UserNameAr,
    string? IpAddress,
    string? UserAgent,
    DateTimeOffset CreatedAt);

public record DocumentAcknowledgementDto(
    long Id,
    long DocumentId,
    long VersionId,
    long UserId,
    string? UserNameAr,
    DateTimeOffset AcknowledgedAt);
