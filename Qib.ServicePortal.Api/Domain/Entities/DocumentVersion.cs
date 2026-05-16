namespace Qib.ServicePortal.Api.Domain.Entities;

public class DocumentVersion
{
    public long Id { get; set; }
    public long DocumentId { get; set; }
    public Document? Document { get; set; }
    public string VersionNumber { get; set; } = "v1";
    public string FileName { get; set; } = string.Empty;
    public string StoredFileName { get; set; } = string.Empty;
    public string FilePath { get; set; } = string.Empty;
    public long FileSize { get; set; }
    public string MimeType { get; set; } = "application/pdf";
    public string Checksum { get; set; } = string.Empty;
    public DateOnly? IssueDate { get; set; }
    public DateOnly? EffectiveDate { get; set; }
    public DateOnly? ReviewDate { get; set; }
    public long UploadedByUserId { get; set; }
    public User? UploadedByUser { get; set; }
    public DateTimeOffset UploadedAt { get; set; } = DateTimeOffset.UtcNow;
    public string? ChangeSummary { get; set; }
    public bool IsCurrent { get; set; }
}
