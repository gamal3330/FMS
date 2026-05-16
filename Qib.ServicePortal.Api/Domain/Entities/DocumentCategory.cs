namespace Qib.ServicePortal.Api.Domain.Entities;

public class DocumentCategory : BaseEntity
{
    public string NameAr { get; set; } = string.Empty;
    public string? NameEn { get; set; }
    public string Code { get; set; } = string.Empty;
    public string? Description { get; set; }
    public string? Icon { get; set; }
    public string Color { get; set; } = "#0f5132";
    public int SortOrder { get; set; } = 100;
    public bool IsActive { get; set; } = true;
    public ICollection<Document> Documents { get; set; } = new List<Document>();
}
