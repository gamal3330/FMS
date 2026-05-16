namespace Qib.ServicePortal.Api.Domain.Entities;

public class RequestTypeSettings : BaseEntity
{
    public long RequestTypeId { get; set; }
    public RequestType? RequestType { get; set; }
    public long VersionId { get; set; }
    public RequestTypeVersion? Version { get; set; }
    public bool RequiresAttachment { get; set; }
    public bool AllowMultipleAttachments { get; set; } = true;
    public int MaxAttachments { get; set; } = 5;
    public int MaxFileSizeMb { get; set; } = 10;
    public string AllowedExtensionsJson { get; set; } = "[\"pdf\",\"png\",\"jpg\",\"jpeg\"]";
    public bool RequireAttachmentBeforeSubmit { get; set; }
    public bool RequireAttachmentOnReturn { get; set; }
    public bool AllowAttachmentAfterSubmission { get; set; } = true;
    public string DefaultPriority { get; set; } = "normal";
    public int? SlaResponseHours { get; set; }
    public int? SlaResolutionHours { get; set; }
    public bool BusinessHoursOnly { get; set; }
    public bool PauseSlaWhenWaitingForUser { get; set; } = true;
    public bool AllowCancelByRequester { get; set; } = true;
    public bool AllowReopen { get; set; }
    public bool AllowEditBeforeApproval { get; set; } = true;
    public bool ShowInEmployeePortal { get; set; } = true;
    public bool RequiresManager { get; set; } = true;
    public bool EnableRequestMessagesTab { get; set; } = true;
    public bool IncludeOfficialMessagesInPdf { get; set; } = true;
    public string? PdfTemplateId { get; set; }
}
