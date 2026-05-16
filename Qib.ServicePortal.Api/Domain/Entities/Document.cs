namespace Qib.ServicePortal.Api.Domain.Entities;

public class Document : BaseEntity
{
    public long CategoryId { get; set; }
    public DocumentCategory? Category { get; set; }
    public string TitleAr { get; set; } = string.Empty;
    public string? TitleEn { get; set; }
    public string? DocumentNumber { get; set; }
    public string? Description { get; set; }
    public long? OwnerDepartmentId { get; set; }
    public Department? OwnerDepartment { get; set; }
    public string Classification { get; set; } = "internal";
    public string Status { get; set; } = "active";
    public long? CurrentVersionId { get; set; }
    public DocumentVersion? CurrentVersion { get; set; }
    public bool RequiresAcknowledgement { get; set; }
    public string? Keywords { get; set; }
    public bool IsActive { get; set; } = true;
    public long CreatedByUserId { get; set; }
    public User? CreatedByUser { get; set; }
    public ICollection<DocumentVersion> Versions { get; set; } = new List<DocumentVersion>();
    public ICollection<DocumentAcknowledgement> Acknowledgements { get; set; } = new List<DocumentAcknowledgement>();
}
