namespace Qib.ServicePortal.Api.Domain.Entities;

public class RequestExecutionLog
{
    public long Id { get; set; }
    public long RequestId { get; set; }
    public Request? Request { get; set; }
    public long ExecutedByUserId { get; set; }
    public User? ExecutedByUser { get; set; }
    public string ExecutionNotes { get; set; } = string.Empty;
    public string Status { get; set; } = "completed";
    public DateTimeOffset ExecutedAt { get; set; } = DateTimeOffset.UtcNow;
}
