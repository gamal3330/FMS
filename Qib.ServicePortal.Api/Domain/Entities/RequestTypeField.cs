namespace Qib.ServicePortal.Api.Domain.Entities;

public class RequestTypeField : BaseEntity
{
    public long VersionId { get; set; }
    public RequestTypeVersion? Version { get; set; }
    public string FieldName { get; set; } = string.Empty;
    public string LabelAr { get; set; } = string.Empty;
    public string? LabelEn { get; set; }
    public string FieldType { get; set; } = "text";
    public bool IsRequired { get; set; }
    public string? PlaceholderAr { get; set; }
    public string? HelpTextAr { get; set; }
    public string? DefaultValue { get; set; }
    public string? OptionsJson { get; set; }
    public string? ValidationRulesJson { get; set; }
    public int SortOrder { get; set; }
    public string? SectionName { get; set; }
    public string Width { get; set; } = "full";
    public bool IsActive { get; set; } = true;
    public bool VisibleToRequester { get; set; } = true;
    public bool VisibleToApprover { get; set; } = true;
    public bool VisibleToExecutor { get; set; } = true;
}
