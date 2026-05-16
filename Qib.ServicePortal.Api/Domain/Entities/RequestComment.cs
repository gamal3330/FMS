namespace Qib.ServicePortal.Api.Domain.Entities;

public class RequestComment
{
    public long Id { get; set; }
    public long RequestId { get; set; }
    public Request? Request { get; set; }
    public long CreatedByUserId { get; set; }
    public User? CreatedByUser { get; set; }
    public string CommentType { get; set; } = "internal";
    public string Body { get; set; } = string.Empty;
    public bool VisibleToRequester { get; set; } = true;
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
}
