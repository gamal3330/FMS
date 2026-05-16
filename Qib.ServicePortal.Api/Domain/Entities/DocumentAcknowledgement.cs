namespace Qib.ServicePortal.Api.Domain.Entities;

public class DocumentAcknowledgement
{
    public long Id { get; set; }
    public long DocumentId { get; set; }
    public Document? Document { get; set; }
    public long VersionId { get; set; }
    public DocumentVersion? Version { get; set; }
    public long UserId { get; set; }
    public User? User { get; set; }
    public DateTimeOffset AcknowledgedAt { get; set; } = DateTimeOffset.UtcNow;
}
