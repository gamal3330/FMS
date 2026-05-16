namespace Qib.ServicePortal.Api.Domain.Entities;

public class Message : BaseEntity
{
    public string Subject { get; set; } = string.Empty;
    public string Body { get; set; } = string.Empty;
    public long SenderId { get; set; }
    public User? Sender { get; set; }
    public long MessageTypeId { get; set; }
    public MessageType? MessageType { get; set; }
    public long? ClassificationId { get; set; }
    public MessageClassification? Classification { get; set; }
    public long? ParentMessageId { get; set; }
    public Message? ParentMessage { get; set; }
    public long? RelatedRequestId { get; set; }
    public Request? RelatedRequest { get; set; }
    public string Priority { get; set; } = "normal";
    public bool IsOfficial { get; set; }
    public string? OfficialReferenceNumber { get; set; }
    public long? OfficialPdfDocumentId { get; set; }
    public string OfficialStatus { get; set; } = "sent";
    public bool IncludeInRequestPdf { get; set; }
    public DateTimeOffset SentAt { get; set; } = DateTimeOffset.UtcNow;
    public ICollection<MessageRecipient> Recipients { get; set; } = new List<MessageRecipient>();
    public ICollection<MessageAttachment> Attachments { get; set; } = new List<MessageAttachment>();
}
