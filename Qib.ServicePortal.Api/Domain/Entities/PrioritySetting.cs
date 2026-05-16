namespace Qib.ServicePortal.Api.Domain.Entities;

public class PrioritySetting : BaseEntity
{
    public string Code { get; set; } = string.Empty;
    public string NameAr { get; set; } = string.Empty;
    public string? NameEn { get; set; }
    public string Color { get; set; } = "#64748b";
    public int ResponseHours { get; set; }
    public int ResolutionHours { get; set; }
    public bool EscalationEnabled { get; set; }
    public int? EscalationAfterHours { get; set; }
    public int SortOrder { get; set; }
    public bool IsActive { get; set; } = true;
}
