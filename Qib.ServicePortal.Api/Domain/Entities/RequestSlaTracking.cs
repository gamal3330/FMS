namespace Qib.ServicePortal.Api.Domain.Entities;

public class RequestSlaTracking
{
    public long Id { get; set; }
    public long RequestId { get; set; }
    public Request? Request { get; set; }
    public DateTimeOffset? ResponseDueAt { get; set; }
    public DateTimeOffset? ResolutionDueAt { get; set; }
    public DateTimeOffset? FirstResponseAt { get; set; }
    public DateTimeOffset? ResolvedAt { get; set; }
    public bool IsBreached { get; set; }
    public string? BreachReason { get; set; }
}
