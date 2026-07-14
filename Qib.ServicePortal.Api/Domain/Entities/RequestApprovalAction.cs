namespace Qib.ServicePortal.Api.Domain.Entities;

public class RequestApprovalAction
{
    public long Id { get; set; }
    public long RequestId { get; set; }
    public Request? Request { get; set; }
    public long? WorkflowStepSnapshotId { get; set; }
    public RequestWorkflowSnapshot? WorkflowStepSnapshot { get; set; }
    public int WorkflowRevision { get; set; } = 1;
    public int StepOrder { get; set; }
    public string StepNameAr { get; set; } = string.Empty;
    public string StepType { get; set; } = string.Empty;
    public string Action { get; set; } = string.Empty;
    public long? ActorUserId { get; set; }
    public User? ActorUser { get; set; }
    public DateTimeOffset ActionAt { get; set; } = DateTimeOffset.UtcNow;
    public string? Comments { get; set; }
    public string? PreviousStatus { get; set; }
    public string? NewStatus { get; set; }
}
