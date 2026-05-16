namespace Qib.ServicePortal.Api.Domain.Entities;

public class Notification : BaseEntity
{
    public long UserId { get; set; }
    public User? User { get; set; }
    public string Title { get; set; } = string.Empty;
    public string Body { get; set; } = string.Empty;
    public string Channel { get; set; } = "system";
    public string? RelatedRoute { get; set; }
    public bool IsRead { get; set; }
    public DateTimeOffset? ReadAt { get; set; }
}
