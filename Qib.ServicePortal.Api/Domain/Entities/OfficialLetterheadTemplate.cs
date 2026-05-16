namespace Qib.ServicePortal.Api.Domain.Entities;

public class OfficialLetterheadTemplate : BaseEntity
{
    public string NameAr { get; set; } = string.Empty;
    public string? NameEn { get; set; }
    public string Code { get; set; } = string.Empty;
    public string? LogoPath { get; set; }
    public string HeaderHtml { get; set; } = string.Empty;
    public string FooterHtml { get; set; } = string.Empty;
    public string PrimaryColor { get; set; } = "#0f5132";
    public string SecondaryColor { get; set; } = "#9bd84e";
    public bool ShowPageNumber { get; set; } = true;
    public bool ShowConfidentialityLabel { get; set; } = true;
    public bool IsDefault { get; set; }
    public bool IsActive { get; set; } = true;
    public long? CreatedByUserId { get; set; }
    public User? CreatedByUser { get; set; }
}
