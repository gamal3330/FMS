namespace Qib.ServicePortal.Api.Domain.Entities;

public class DocumentAccessLog
{
    public long Id { get; set; }
    public long DocumentId { get; set; }
    public Document? Document { get; set; }
    public long? VersionId { get; set; }
    public DocumentVersion? Version { get; set; }
    public long UserId { get; set; }
    public User? User { get; set; }
    public string Action { get; set; } = string.Empty;
    public string? IpAddress { get; set; }
    public string? UserAgent { get; set; }
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
}
