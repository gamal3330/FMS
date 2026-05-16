namespace Qib.ServicePortal.Api.Domain.Entities;

public class RequestTypeVersion : BaseEntity
{
    public long RequestTypeId { get; set; }
    public RequestType? RequestType { get; set; }
    public int VersionNumber { get; set; }
    public string Status { get; set; } = "draft";
    public string? ChangeSummary { get; set; }
    public long? CreatedByUserId { get; set; }
    public User? CreatedByUser { get; set; }
    public DateTimeOffset? ActivatedAt { get; set; }
    public ICollection<RequestTypeField> Fields { get; set; } = new List<RequestTypeField>();
    public ICollection<WorkflowTemplateStep> WorkflowSteps { get; set; } = new List<WorkflowTemplateStep>();
    public RequestTypeSettings? Settings { get; set; }
}
