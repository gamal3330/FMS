using System.Text.Json;
using System.Text.Json.Serialization;

namespace Qib.ServicePortal.Api.Application.DTOs;

public record SpecializedSectionDto(
    long Id,
    string Code,
    string NameAr,
    string? NameEn,
    long? DepartmentId,
    string? DepartmentNameAr,
    long? ManagerUserId,
    string? ManagerNameAr,
    bool AllowManualAssignment,
    string AutoAssignStrategy,
    bool IsActive);

public record RequestTypeDto(
    long Id,
    string NameAr,
    string? NameEn,
    string Code,
    string? Category,
    string? Description,
    string? Icon,
    string? Color,
    long? SpecializedSectionId,
    string? SpecializedSectionNameAr,
    bool IsActive,
    long? CurrentVersionId,
    int? CurrentVersionNumber,
    int SortOrder,
    DateTimeOffset CreatedAt,
    DateTimeOffset UpdatedAt,
    RequestTypeSettingsDto? Settings);

public record CreateRequestTypeRequest(
    [property: JsonPropertyName("name_ar")]
    string NameAr,
    [property: JsonPropertyName("name_en")]
    string? NameEn,
    [property: JsonPropertyName("code")]
    string Code,
    [property: JsonPropertyName("category")]
    string? Category,
    [property: JsonPropertyName("description")]
    string? Description,
    [property: JsonPropertyName("icon")]
    string? Icon,
    [property: JsonPropertyName("color")]
    string? Color,
    [property: JsonPropertyName("specialized_section_id")]
    long? SpecializedSectionId,
    [property: JsonPropertyName("assigned_section")]
    string? AssignedSection,
    [property: JsonPropertyName("default_priority")]
    string DefaultPriority,
    [property: JsonPropertyName("requires_attachment")]
    bool RequiresAttachment,
    [property: JsonPropertyName("allow_multiple_attachments")]
    bool AllowMultipleAttachments,
    [property: JsonPropertyName("sort_order")]
    int SortOrder);

public record UpdateRequestTypeRequest(
    [property: JsonPropertyName("name_ar")]
    string NameAr,
    [property: JsonPropertyName("name_en")]
    string? NameEn,
    [property: JsonPropertyName("category")]
    string? Category,
    [property: JsonPropertyName("description")]
    string? Description,
    [property: JsonPropertyName("icon")]
    string? Icon,
    [property: JsonPropertyName("color")]
    string? Color,
    [property: JsonPropertyName("specialized_section_id")]
    long? SpecializedSectionId,
    [property: JsonPropertyName("assigned_section")]
    string? AssignedSection,
    [property: JsonPropertyName("default_priority")]
    string DefaultPriority,
    [property: JsonPropertyName("requires_attachment")]
    bool RequiresAttachment,
    [property: JsonPropertyName("allow_multiple_attachments")]
    bool AllowMultipleAttachments,
    [property: JsonPropertyName("max_attachments")]
    int MaxAttachments,
    [property: JsonPropertyName("max_file_size_mb")]
    int MaxFileSizeMb,
    [property: JsonPropertyName("allowed_extensions_json")]
    JsonElement? AllowedExtensionsJson,
    [property: JsonPropertyName("sla_response_hours")]
    int? SlaResponseHours,
    [property: JsonPropertyName("sla_resolution_hours")]
    int? SlaResolutionHours,
    [property: JsonPropertyName("show_in_employee_portal")]
    bool ShowInEmployeePortal,
    [property: JsonPropertyName("requires_manager")]
    bool RequiresManager,
    [property: JsonPropertyName("allow_cancel_by_requester")]
    bool AllowCancelByRequester,
    [property: JsonPropertyName("allow_reopen")]
    bool AllowReopen,
    [property: JsonPropertyName("allow_edit_before_approval")]
    bool AllowEditBeforeApproval,
    [property: JsonPropertyName("sort_order")]
    int SortOrder);

public record PatchRequestTypeStatusRequest(
    [property: JsonPropertyName("is_active")]
    bool IsActive);

public record RequestTypeVersionDto(
    long Id,
    long RequestTypeId,
    int VersionNumber,
    string Status,
    string? ChangeSummary,
    long? CreatedByUserId,
    string? CreatedByNameAr,
    DateTimeOffset? ActivatedAt,
    DateTimeOffset CreatedAt,
    DateTimeOffset UpdatedAt);

public record CloneRequestTypeVersionRequest(string? ChangeSummary);

public record RequestTypeFieldDto(
    long Id,
    long VersionId,
    string FieldName,
    string LabelAr,
    string? LabelEn,
    string FieldType,
    bool IsRequired,
    string? PlaceholderAr,
    string? HelpTextAr,
    string? DefaultValue,
    string? OptionsJson,
    string? ValidationRulesJson,
    int SortOrder,
    string? SectionName,
    string Width,
    bool IsActive,
    bool VisibleToRequester,
    bool VisibleToApprover,
    bool VisibleToExecutor);

public record UpsertRequestTypeFieldRequest(
    string FieldName,
    string LabelAr,
    string? LabelEn,
    string FieldType,
    bool IsRequired,
    string? PlaceholderAr,
    string? HelpTextAr,
    string? DefaultValue,
    string? OptionsJson,
    string? ValidationRulesJson,
    int SortOrder,
    string? SectionName,
    string Width,
    bool IsActive,
    bool VisibleToRequester,
    bool VisibleToApprover,
    bool VisibleToExecutor);

public record WorkflowStepDto(
    long Id,
    long VersionId,
    string StepNameAr,
    string? StepNameEn,
    string StepType,
    long? ApproverRoleId,
    string? ApproverRoleNameAr,
    long? ApproverUserId,
    string? ApproverUserNameAr,
    string? ApproverEmployeeNumber,
    long? TargetDepartmentId,
    string? TargetDepartmentNameAr,
    bool IsMandatory,
    bool CanApprove,
    bool CanReject,
    bool CanReturnForEdit,
    bool CanDelegate,
    int? SlaHours,
    long? EscalationUserId,
    long? EscalationRoleId,
    int? ReturnToStepOrder,
    int SortOrder,
    bool IsActive);

public record UpsertWorkflowStepRequest(
    string StepNameAr,
    string? StepNameEn,
    string StepType,
    long? ApproverRoleId,
    long? ApproverUserId,
    [property: JsonPropertyName("approver_employee_number")]
    string? ApproverEmployeeNumber,
    long? TargetDepartmentId,
    bool IsMandatory,
    bool CanApprove,
    bool CanReject,
    bool CanReturnForEdit,
    bool CanDelegate,
    int? SlaHours,
    long? EscalationUserId,
    long? EscalationRoleId,
    int? ReturnToStepOrder,
    int SortOrder,
    bool IsActive);

public record RequestTypeSettingsDto(
    long Id,
    long RequestTypeId,
    long VersionId,
    bool RequiresAttachment,
    bool AllowMultipleAttachments,
    int MaxAttachments,
    int MaxFileSizeMb,
    string AllowedExtensionsJson,
    bool RequireAttachmentBeforeSubmit,
    bool RequireAttachmentOnReturn,
    bool AllowAttachmentAfterSubmission,
    string DefaultPriority,
    int? SlaResponseHours,
    int? SlaResolutionHours,
    bool BusinessHoursOnly,
    bool PauseSlaWhenWaitingForUser,
    bool AllowCancelByRequester,
    bool AllowReopen,
    bool AllowEditBeforeApproval,
    bool ShowInEmployeePortal,
    bool RequiresManager,
    bool EnableRequestMessagesTab,
    bool IncludeOfficialMessagesInPdf,
    string? PdfTemplateId);

public record RequestFormSchemaDto(
    RequestTypeDto RequestType,
    RequestTypeVersionDto Version,
    RequestTypeSettingsDto Settings,
    IReadOnlyCollection<RequestTypeFieldDto> Fields,
    IReadOnlyCollection<WorkflowStepDto> WorkflowPreview);

public record RequestTypeValidationResultDto(
    bool CanActivate,
    IReadOnlyCollection<string> Errors,
    IReadOnlyCollection<string> Warnings);
