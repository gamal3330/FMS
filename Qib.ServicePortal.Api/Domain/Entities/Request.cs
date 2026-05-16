namespace Qib.ServicePortal.Api.Domain.Entities;

public class Request : BaseEntity
{
    public string RequestNumber { get; set; } = string.Empty;
    public string Title { get; set; } = string.Empty;
    public long RequestTypeId { get; set; }
    public RequestType? RequestType { get; set; }
    public long RequestTypeVersionId { get; set; }
    public RequestTypeVersion? RequestTypeVersion { get; set; }
    public long RequesterId { get; set; }
    public User? Requester { get; set; }
    public long? DepartmentId { get; set; }
    public Department? Department { get; set; }
    public long? SpecializedSectionId { get; set; }
    public SpecializedSection? SpecializedSection { get; set; }
    public long? AssignedToId { get; set; }
    public User? AssignedTo { get; set; }
    public string Status { get; set; } = "submitted";
    public string Priority { get; set; } = "normal";
    public DateTimeOffset? SlaResponseDueAt { get; set; }
    public DateTimeOffset? SlaResolutionDueAt { get; set; }
    public string FormDataJson { get; set; } = "{}";
    public DateTimeOffset? SubmittedAt { get; set; }
    public DateTimeOffset? ClosedAt { get; set; }
    public ICollection<RequestFieldSnapshot> FieldSnapshots { get; set; } = new List<RequestFieldSnapshot>();
    public ICollection<RequestWorkflowSnapshot> WorkflowSnapshots { get; set; } = new List<RequestWorkflowSnapshot>();
    public ICollection<RequestAttachment> Attachments { get; set; } = new List<RequestAttachment>();
    public ICollection<RequestStatusHistory> StatusHistory { get; set; } = new List<RequestStatusHistory>();
    public ICollection<RequestComment> Comments { get; set; } = new List<RequestComment>();
    public ICollection<RequestExecutionLog> ExecutionLogs { get; set; } = new List<RequestExecutionLog>();
    public RequestSlaTracking? SlaTracking { get; set; }
}
