namespace Qib.ServicePortal.Api.Domain.Entities;

public class RequestType : BaseEntity
{
    public string NameAr { get; set; } = string.Empty;
    public string? NameEn { get; set; }
    public string Code { get; set; } = string.Empty;
    public string? Category { get; set; }
    public string? Description { get; set; }
    public string? Icon { get; set; }
    public string? Color { get; set; }
    public long? SpecializedSectionId { get; set; }
    public SpecializedSection? SpecializedSection { get; set; }
    public bool IsActive { get; set; }
    public long? CurrentVersionId { get; set; }
    public RequestTypeVersion? CurrentVersion { get; set; }
    public int SortOrder { get; set; }
    public ICollection<RequestTypeVersion> Versions { get; set; } = new List<RequestTypeVersion>();
    public ICollection<SlaRule> SlaRules { get; set; } = new List<SlaRule>();
}
