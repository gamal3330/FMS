namespace Qib.ServicePortal.Api.Domain.Entities;

public class RolePermission
{
    public long RoleId { get; set; }
    public Role? Role { get; set; }
    public long PermissionId { get; set; }
    public Permission? Permission { get; set; }
    public bool IsAllowed { get; set; } = true;
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
}
