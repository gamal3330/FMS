namespace Qib.ServicePortal.Api.Domain.Entities;

public class DocumentPermission : BaseEntity
{
    public long? CategoryId { get; set; }
    public DocumentCategory? Category { get; set; }
    public long? DocumentId { get; set; }
    public Document? Document { get; set; }
    public long? RoleId { get; set; }
    public Role? Role { get; set; }
    public long? DepartmentId { get; set; }
    public Department? Department { get; set; }
    public bool CanView { get; set; } = true;
    public bool CanDownload { get; set; }
    public bool CanPrint { get; set; }
    public bool CanManage { get; set; }
}
