namespace Qib.ServicePortal.Api.Domain.Entities;

public class OfficialMessageDocument
{
    public long Id { get; set; }
    public long MessageId { get; set; }
    public Message? Message { get; set; }
    public long? RelatedRequestId { get; set; }
    public Request? RelatedRequest { get; set; }
    public long LetterheadTemplateId { get; set; }
    public OfficialLetterheadTemplate? LetterheadTemplate { get; set; }
    public long? SignatureId { get; set; }
    public UserSignature? Signature { get; set; }
    public string? ReferenceNumber { get; set; }
    public string PdfFilePath { get; set; } = string.Empty;
    public long FileSize { get; set; }
    public string Checksum { get; set; } = string.Empty;
    public long GeneratedByUserId { get; set; }
    public User? GeneratedByUser { get; set; }
    public DateTimeOffset GeneratedAt { get; set; } = DateTimeOffset.UtcNow;
}
