namespace Qib.ServicePortal.Api.Domain.Entities;

public class OfficialMessageSettings
{
    public long Id { get; set; }
    public bool IsEnabled { get; set; } = true;
    public long? DefaultLetterheadTemplateId { get; set; }
    public OfficialLetterheadTemplate? DefaultLetterheadTemplate { get; set; }
    public bool OfficialMessageRequiresApproval { get; set; }
    public bool IncludeOfficialMessagesInRequestPdf { get; set; } = true;
    public bool AllowPreviewForAllUsers { get; set; } = true;
    public bool AllowUnverifiedSignature { get; set; }
    public bool AllowSignatureUploadByUser { get; set; } = true;
    public DateTimeOffset UpdatedAt { get; set; } = DateTimeOffset.UtcNow;
}
