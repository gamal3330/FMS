namespace Qib.ServicePortal.Api.Domain.Entities;

public class MessageTemplate : BaseEntity
{
    public string Code { get; set; } = string.Empty;
    public string NameAr { get; set; } = string.Empty;
    public string? NameEn { get; set; }
    public long? MessageTypeId { get; set; }
    public MessageType? MessageType { get; set; }
    public string SubjectTemplate { get; set; } = string.Empty;
    public string BodyTemplate { get; set; } = string.Empty;
    public int SortOrder { get; set; } = 100;
    public bool IsActive { get; set; } = true;
}
