namespace Qib.ServicePortal.Api.Domain.Entities;

public class MessageRecipient
{
    public long Id { get; set; }
    public long MessageId { get; set; }
    public Message? Message { get; set; }
    public long RecipientId { get; set; }
    public User? Recipient { get; set; }
    public bool IsRead { get; set; }
    public DateTimeOffset? ReadAt { get; set; }
    public bool IsArchived { get; set; }
    public DateTimeOffset? ArchivedAt { get; set; }
}
