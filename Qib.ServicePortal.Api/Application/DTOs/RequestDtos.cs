using System.Text.Json;

namespace Qib.ServicePortal.Api.Application.DTOs;

public record CreateRequestRequest(
    long RequestTypeId,
    string Title,
    string? Priority,
    Dictionary<string, JsonElement> FormData,
    bool? SendNotification = null);

public record UpdateRequestRequest(
    string Title,
    string? Priority,
    Dictionary<string, JsonElement> FormData);

public record RequestActionRequest(string? Comment);

public record RequestDto(
    long Id,
    string RequestNumber,
    string Title,
    long RequestTypeId,
    string? RequestTypeNameAr,
    long RequestTypeVersionId,
    int? RequestTypeVersionNumber,
    long RequesterId,
    string? RequesterNameAr,
    long? DepartmentId,
    string? DepartmentNameAr,
    long? SpecializedSectionId,
    string? SpecializedSectionNameAr,
    string? SpecializedDepartmentNameAr,
    long? AssignedToId,
    string? AssignedToNameAr,
    string Status,
    string Priority,
    DateTimeOffset? SlaResponseDueAt,
    DateTimeOffset? SlaResolutionDueAt,
    DateTimeOffset? SubmittedAt,
    DateTimeOffset? ClosedAt,
    DateTimeOffset CreatedAt,
    DateTimeOffset UpdatedAt,
    int AttachmentsCount,
    int WorkflowProgressPercent);

public record RequestDetailsDto(
    RequestDto Request,
    IReadOnlyCollection<RequestFieldSnapshotDto> Fields,
    IReadOnlyCollection<RequestWorkflowSnapshotDto> Workflow,
    IReadOnlyCollection<RequestAttachmentDto> Attachments,
    IReadOnlyCollection<RequestStatusHistoryDto> StatusHistory,
    RequestSlaTrackingDto? Sla);

public record RequestFieldSnapshotDto(
    long Id,
    string FieldName,
    string LabelAr,
    string? LabelEn,
    string FieldType,
    string? ValueText,
    decimal? ValueNumber,
    DateTimeOffset? ValueDate,
    string? ValueJson,
    int SortOrder,
    string? SectionName);

public record RequestWorkflowSnapshotDto(
    long Id,
    string StepNameAr,
    string? StepNameEn,
    string StepType,
    long? ApproverRoleId,
    string? ApproverRoleNameAr,
    long? ApproverUserId,
    string? ApproverUserNameAr,
    long? TargetDepartmentId,
    string? TargetDepartmentNameAr,
    string Status,
    long? ActionByUserId,
    string? ActionByNameAr,
    DateTimeOffset? ActionAt,
    DateTimeOffset? PendingAt,
    string? Comments,
    DateTimeOffset? SlaDueAt,
    int SortOrder,
    bool CanApprove,
    bool CanReject,
    bool CanReturnForEdit,
    bool CanDelegate);

public record RequestAttachmentDto(
    long Id,
    string FileName,
    string ContentType,
    long FileSize,
    string Checksum,
    long UploadedByUserId,
    string? UploadedByNameAr,
    DateTimeOffset UploadedAt);

public record RequestStatusHistoryDto(
    long Id,
    string? OldStatus,
    string NewStatus,
    long? ChangedByUserId,
    string? ChangedByNameAr,
    DateTimeOffset ChangedAt,
    string? Comment);

public record RequestSlaTrackingDto(
    DateTimeOffset? ResponseDueAt,
    DateTimeOffset? ResolutionDueAt,
    DateTimeOffset? FirstResponseAt,
    DateTimeOffset? ResolvedAt,
    bool IsBreached,
    string? BreachReason);

public record RequestTimelineItemDto(
    string Type,
    string Title,
    string? Description,
    DateTimeOffset CreatedAt,
    string? ActorNameAr);
