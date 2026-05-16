namespace Qib.ServicePortal.Api.Domain.Entities;

public class SystemSetting : BaseEntity
{
    public string Key { get; set; } = string.Empty;
    public string? Value { get; set; }
    public string Group { get; set; } = "general";
    public string DataType { get; set; } = "string";
    public bool IsSensitive { get; set; }
    public string? DescriptionAr { get; set; }
    public long? UpdatedByUserId { get; set; }
    public User? UpdatedByUser { get; set; }
}
