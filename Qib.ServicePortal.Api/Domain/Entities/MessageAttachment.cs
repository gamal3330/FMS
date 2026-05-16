namespace Qib.ServicePortal.Api.Domain.Entities;

public class MessageAttachment
{
    public long Id { get; set; }
    public long MessageId { get; set; }
    public Message? Message { get; set; }
    public string FileName { get; set; } = string.Empty;
    public string StoredFileName { get; set; } = string.Empty;
    public string StoragePath { get; set; } = string.Empty;
    public string ContentType { get; set; } = "application/octet-stream";
    public long FileSize { get; set; }
    public string Checksum { get; set; } = string.Empty;
    public long UploadedByUserId { get; set; }
    public User? UploadedByUser { get; set; }
    public DateTimeOffset UploadedAt { get; set; } = DateTimeOffset.UtcNow;
    public bool IsDeleted { get; set; }
}
