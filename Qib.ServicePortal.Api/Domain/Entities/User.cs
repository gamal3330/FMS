namespace Qib.ServicePortal.Api.Domain.Entities;

public class User : BaseEntity
{
    public string Username { get; set; } = string.Empty;
    public string Email { get; set; } = string.Empty;
    public string? EmployeeNumber { get; set; }
    public string NameAr { get; set; } = string.Empty;
    public string? NameEn { get; set; }
    public string? Phone { get; set; }
    public string? JobTitle { get; set; }
    public string RelationshipType { get; set; } = "employee";
    public string PasswordHash { get; set; } = string.Empty;
    public bool IsActive { get; set; } = true;
    public bool IsLocked { get; set; }
    public bool ForcePasswordChange { get; set; }
    public DateTimeOffset? LastLoginAt { get; set; }
    public DateTimeOffset? PasswordChangedAt { get; set; }
    public long RoleId { get; set; }
    public Role? Role { get; set; }
    public long? DepartmentId { get; set; }
    public Department? Department { get; set; }
    public long? SpecializedSectionId { get; set; }
    public SpecializedSection? SpecializedSection { get; set; }
    public long? DirectManagerId { get; set; }
    public User? DirectManager { get; set; }
    public ICollection<User> DirectReports { get; set; } = new List<User>();
    public ICollection<RefreshToken> RefreshTokens { get; set; } = new List<RefreshToken>();
    public ICollection<UserPermissionOverride> PermissionOverrides { get; set; } = new List<UserPermissionOverride>();
}
