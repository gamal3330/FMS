namespace Qib.ServicePortal.Api.Application.DTOs;

public class ReportFilters
{
    public DateTimeOffset? DateFrom { get; set; }
    public DateTimeOffset? DateTo { get; set; }
    public long? DepartmentId { get; set; }
    public long? RequestTypeId { get; set; }
    public string? Status { get; set; }
    public string? Priority { get; set; }
    public long? SpecializedSectionId { get; set; }
    public long? RequesterId { get; set; }
    public long? AssignedUserId { get; set; }
    public string? ApprovalStep { get; set; }
    public string? SlaStatus { get; set; }
    public string? MessageType { get; set; }
    public string? AuditAction { get; set; }
    public string? ReportType { get; set; }
}

public record ReportMetricDto(
    string Key,
    string LabelAr,
    decimal Value,
    string? Unit = null);

public record ReportChartItemDto(
    string Key,
    string Label,
    decimal Value);

public record ReportsSummaryDto(
    IReadOnlyCollection<ReportMetricDto> Metrics,
    IReadOnlyCollection<ReportChartItemDto> RequestsByStatus,
    IReadOnlyCollection<ReportChartItemDto> RequestsByMonth,
    IReadOnlyCollection<ReportChartItemDto> RequestsByDepartment,
    IReadOnlyCollection<ReportChartItemDto> SlaCompliance);

public record RequestReportRowDto(
    long Id,
    string RequestNumber,
    string Title,
    string? RequestTypeNameAr,
    string? RequesterNameAr,
    string? DepartmentNameAr,
    string? SpecializedSectionNameAr,
    string? AssignedToNameAr,
    string Status,
    string Priority,
    DateTimeOffset CreatedAt,
    DateTimeOffset? ClosedAt,
    int? CompletionHours,
    string SlaStatus);

public record RequestReportDto(
    int Total,
    IReadOnlyCollection<ReportChartItemDto> ByStatus,
    IReadOnlyCollection<ReportChartItemDto> ByRequestType,
    IReadOnlyCollection<ReportChartItemDto> ByDepartment,
    IReadOnlyCollection<ReportChartItemDto> ByPriority,
    IReadOnlyCollection<RequestReportRowDto> Rows);

public record ApprovalReportRowDto(
    long RequestId,
    string RequestNumber,
    string? RequestTypeNameAr,
    string StepNameAr,
    string StepType,
    string? ApproverNameAr,
    string Status,
    int WaitingHours,
    DateTimeOffset? ActionAt,
    string? Comments);

public record ApprovalReportDto(
    int PendingApprovals,
    int ApprovedCount,
    int RejectedCount,
    int ReturnedForEditCount,
    decimal AverageApprovalHours,
    IReadOnlyCollection<ReportChartItemDto> ByStepStatus,
    IReadOnlyCollection<ApprovalReportRowDto> Rows);

public record SlaReportRowDto(
    long RequestId,
    string RequestNumber,
    string? RequestTypeNameAr,
    string Status,
    string? DepartmentNameAr,
    string? SpecializedSectionNameAr,
    string? AssignedToNameAr,
    DateTimeOffset? DueAt,
    int DelayHours,
    string? BreachReason);

public record SlaReportDto(
    decimal CompliancePercent,
    int BreachedRequests,
    int CloseToBreachRequests,
    decimal AverageResponseHours,
    decimal AverageResolutionHours,
    IReadOnlyCollection<ReportChartItemDto> BreachesByRequestType,
    IReadOnlyCollection<SlaReportRowDto> Rows);

public record MessagingReportRowDto(
    long Id,
    string Subject,
    string? MessageTypeNameAr,
    string? SenderNameAr,
    string Recipients,
    string? RelatedRequestNumber,
    string? ClassificationNameAr,
    string Priority,
    DateTimeOffset SentAt,
    string ReadStatus);

public record MessagingReportDto(
    int TotalMessages,
    int OfficialMessages,
    int InternalMessages,
    int UnreadMessages,
    int LinkedToRequests,
    IReadOnlyCollection<ReportChartItemDto> ByType,
    IReadOnlyCollection<MessagingReportRowDto> Rows);

public record AuditReportRowDto(
    long Id,
    string Action,
    string EntityType,
    string? EntityId,
    string? Username,
    string? IpAddress,
    string Result,
    DateTimeOffset CreatedAt,
    string? OldValueJson,
    string? NewValueJson);

public record AuditReportDto(
    int TotalActions,
    int FailedActions,
    IReadOnlyCollection<ReportChartItemDto> ByAction,
    IReadOnlyCollection<AuditReportRowDto> Rows);
