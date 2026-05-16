namespace Qib.ServicePortal.Api.Domain.Entities;

public class SpecializedSection : BaseEntity
{
    public string Code { get; set; } = string.Empty;
    public string NameAr { get; set; } = string.Empty;
    public string? NameEn { get; set; }
    public string? Description { get; set; }
    public long? DepartmentId { get; set; }
    public Department? Department { get; set; }
    public long? ManagerUserId { get; set; }
    public User? ManagerUser { get; set; }
    public long? DefaultAssigneeUserId { get; set; }
    public User? DefaultAssigneeUser { get; set; }
    public bool AllowManualAssignment { get; set; } = true;
    public string AutoAssignStrategy { get; set; } = "none";
    public bool IsActive { get; set; } = true;
}
