namespace Qib.ServicePortal.Api.Domain.Entities;

public class RequestStatusHistory
{
    public long Id { get; set; }
    public long RequestId { get; set; }
    public Request? Request { get; set; }
    public string? OldStatus { get; set; }
    public string NewStatus { get; set; } = string.Empty;
    public long? ChangedByUserId { get; set; }
    public User? ChangedByUser { get; set; }
    public DateTimeOffset ChangedAt { get; set; } = DateTimeOffset.UtcNow;
    public string? Comment { get; set; }
}
