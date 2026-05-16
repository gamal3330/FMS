namespace Qib.ServicePortal.Api.Domain.Entities;

public class MessageClassification : BaseEntity
{
    public string Code { get; set; } = string.Empty;
    public string NameAr { get; set; } = string.Empty;
    public string? NameEn { get; set; }
    public string? Description { get; set; }
    public string Color { get; set; } = "#64748b";
    public bool IsConfidential { get; set; }
    public bool RequiresPermission { get; set; }
    public bool ShowInPdf { get; set; }
    public bool ShowInReports { get; set; } = true;
    public bool AllowAttachmentDownload { get; set; } = true;
    public bool LogDownloads { get; set; }
    public bool RequiresSpecialPermission { get; set; }
    public int SortOrder { get; set; } = 100;
    public bool IsActive { get; set; } = true;
    public ICollection<Message> Messages { get; set; } = new List<Message>();
}
