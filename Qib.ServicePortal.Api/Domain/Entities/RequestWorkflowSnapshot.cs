namespace Qib.ServicePortal.Api.Domain.Entities;

public class RequestWorkflowSnapshot
{
    public long Id { get; set; }
    public long RequestId { get; set; }
    public Request? Request { get; set; }
    public string StepNameAr { get; set; } = string.Empty;
    public string? StepNameEn { get; set; }
    public string StepType { get; set; } = string.Empty;
    public long? ApproverRoleId { get; set; }
    public Role? ApproverRole { get; set; }
    public long? ApproverUserId { get; set; }
    public User? ApproverUser { get; set; }
    public long? TargetDepartmentId { get; set; }
    public Department? TargetDepartment { get; set; }
    public string Status { get; set; } = "waiting";
    public long? ActionByUserId { get; set; }
    public User? ActionByUser { get; set; }
    public DateTimeOffset? ActionAt { get; set; }
    public DateTimeOffset? PendingAt { get; set; }
    public string? Comments { get; set; }
    public DateTimeOffset? SlaDueAt { get; set; }
    public int? SlaHours { get; set; }
    public int SortOrder { get; set; }
    public bool IsMandatory { get; set; } = true;
    public bool CanApprove { get; set; } = true;
    public bool CanReject { get; set; } = true;
    public bool CanReturnForEdit { get; set; } = true;
    public bool CanDelegate { get; set; }
    public long? EscalationUserId { get; set; }
    public User? EscalationUser { get; set; }
    public long? EscalationRoleId { get; set; }
    public Role? EscalationRole { get; set; }
    public DateTimeOffset? EscalatedAt { get; set; }
    public int EscalationCount { get; set; }
    public int? ReturnToStepOrder { get; set; }
    public string ExecutionMode { get; set; } = "always";
    public string? ConditionJson { get; set; }
    public bool IsApplicable { get; set; } = true;
    public string? SkipReason { get; set; }
}
