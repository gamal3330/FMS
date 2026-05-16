namespace Qib.ServicePortal.Api.Domain.Entities;

public class SlaRule : BaseEntity
{
    public long? RequestTypeId { get; set; }
    public RequestType? RequestType { get; set; }
    public string? PriorityCode { get; set; }
    public int ResponseTimeHours { get; set; }
    public int ResolutionTimeHours { get; set; }
    public bool BusinessHoursOnly { get; set; }
    public bool PauseWhenWaitingForUser { get; set; } = true;
    public long? EscalationUserId { get; set; }
    public User? EscalationUser { get; set; }
    public long? EscalationRoleId { get; set; }
    public Role? EscalationRole { get; set; }
    public bool IsActive { get; set; } = true;
}
