namespace Qib.ServicePortal.Api.Domain.Entities;

public class UserPermissionOverride
{
    public long UserId { get; set; }
    public User? User { get; set; }
    public long PermissionId { get; set; }
    public Permission? Permission { get; set; }
    public bool IsAllowed { get; set; }
    public string? Reason { get; set; }
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
}
