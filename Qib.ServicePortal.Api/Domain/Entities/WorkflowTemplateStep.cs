namespace Qib.ServicePortal.Api.Domain.Entities;

public class WorkflowTemplateStep : BaseEntity
{
    public long VersionId { get; set; }
    public RequestTypeVersion? Version { get; set; }
    public string StepNameAr { get; set; } = string.Empty;
    public string? StepNameEn { get; set; }
    public string StepType { get; set; } = "direct_manager";
    public long? ApproverRoleId { get; set; }
    public Role? ApproverRole { get; set; }
    public long? ApproverUserId { get; set; }
    public User? ApproverUser { get; set; }
    public long? TargetDepartmentId { get; set; }
    public Department? TargetDepartment { get; set; }
    public bool IsMandatory { get; set; } = true;
    public bool CanApprove { get; set; } = true;
    public bool CanReject { get; set; } = true;
    public bool CanReturnForEdit { get; set; } = true;
    public bool CanDelegate { get; set; }
    public int? SlaHours { get; set; }
    public long? EscalationUserId { get; set; }
    public User? EscalationUser { get; set; }
    public long? EscalationRoleId { get; set; }
    public Role? EscalationRole { get; set; }
    public int? ReturnToStepOrder { get; set; }
    public int SortOrder { get; set; }
    public bool IsActive { get; set; } = true;
}
