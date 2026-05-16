namespace Qib.ServicePortal.Api.Domain.Entities;

public class RequestFieldSnapshot
{
    public long Id { get; set; }
    public long RequestId { get; set; }
    public Request? Request { get; set; }
    public string FieldName { get; set; } = string.Empty;
    public string LabelAr { get; set; } = string.Empty;
    public string? LabelEn { get; set; }
    public string FieldType { get; set; } = "text";
    public string? ValueText { get; set; }
    public decimal? ValueNumber { get; set; }
    public DateTimeOffset? ValueDate { get; set; }
    public string? ValueJson { get; set; }
    public int SortOrder { get; set; }
    public string? SectionName { get; set; }
}
