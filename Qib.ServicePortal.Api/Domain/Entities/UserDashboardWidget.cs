namespace Qib.ServicePortal.Api.Domain.Entities;

public class UserDashboardWidget : BaseEntity
{
    public long UserId { get; set; }
    public User? User { get; set; }
    public string WidgetCode { get; set; } = string.Empty;
    public bool IsEnabled { get; set; } = true;
    public int SortOrder { get; set; } = 100;
    public string Size { get; set; } = "medium";
    public string? SettingsJson { get; set; }
}
