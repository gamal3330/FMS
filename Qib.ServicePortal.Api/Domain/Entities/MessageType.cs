namespace Qib.ServicePortal.Api.Domain.Entities;

public class MessageType : BaseEntity
{
    public string Code { get; set; } = string.Empty;
    public string NameAr { get; set; } = string.Empty;
    public string? NameEn { get; set; }
    public string? Description { get; set; }
    public string Color { get; set; } = "#1d4ed8";
    public string? Icon { get; set; }
    public bool IsOfficial { get; set; }
    public bool RequiresRequest { get; set; }
    public bool RequiresAttachment { get; set; }
    public bool ShowInPdf { get; set; }
    public bool AllowReply { get; set; } = true;
    public bool VisibleToRequester { get; set; } = true;
    public int SortOrder { get; set; } = 100;
    public bool IsActive { get; set; } = true;
    public ICollection<Message> Messages { get; set; } = new List<Message>();
    public ICollection<MessageTemplate> Templates { get; set; } = new List<MessageTemplate>();
}
