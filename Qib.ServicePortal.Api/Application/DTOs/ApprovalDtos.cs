namespace Qib.ServicePortal.Api.Application.DTOs;

public record ApprovalSummaryDto(
    int PendingMyApproval,
    int Tracking,
    int PendingExecution,
    int ReturnedForEdit,
    int Overdue,
    int CompletedToday);

public record ApprovalQueueItemDto(
    long RequestId,
    string RequestNumber,
    string Title,
    long RequestTypeId,
    string? RequestTypeNameAr,
    long RequesterId,
    string? RequesterNameAr,
    long? DepartmentId,
    string? DepartmentNameAr,
    long? SpecializedSectionId,
    string? SpecializedSectionNameAr,
    string? SpecializedDepartmentNameAr,
    string Status,
    string Priority,
    DateTimeOffset CreatedAt,
    DateTimeOffset? SubmittedAt,
    DateTimeOffset? SlaResolutionDueAt,
    long CurrentStepId,
    string CurrentStepNameAr,
    string CurrentStepType,
    string CurrentStepStatus,
    DateTimeOffset? CurrentStepPendingAt,
    DateTimeOffset? CurrentStepSlaDueAt,
    int WaitingHours,
    bool IsOverdue,
    bool CanApprove,
    bool CanReject,
    bool CanReturnForEdit,
    bool CanExecute,
    bool CanClose);

public record ApprovalDetailsDto(
    RequestDto Request,
    RequestWorkflowSnapshotDto? CurrentStep,
    IReadOnlyCollection<RequestFieldSnapshotDto> Fields,
    IReadOnlyCollection<RequestWorkflowSnapshotDto> Workflow,
    IReadOnlyCollection<RequestAttachmentDto> Attachments,
    IReadOnlyCollection<RequestStatusHistoryDto> StatusHistory,
    IReadOnlyCollection<ApprovalHistoryDto> ApprovalHistory,
    RequestSlaTrackingDto? Sla);

public record ApprovalActionRequest(
    string Action,
    string? Comments,
    string? ExecutionNotes,
    string? Note = null);

public record ApprovalHistoryDto(
    long StepId,
    string StepNameAr,
    string StepType,
    string Action,
    long? ActionByUserId,
    string? ActionByNameAr,
    DateTimeOffset? ActionAt,
    string? Comments,
    string? PreviousStatus,
    string? NewStatus);
