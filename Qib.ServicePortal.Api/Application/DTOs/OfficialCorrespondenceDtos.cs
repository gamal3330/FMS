using System.Text.Json.Serialization;

namespace Qib.ServicePortal.Api.Application.DTOs;

public record OfficialLetterheadTemplateDto(
    long Id,
    [property: JsonPropertyName("name_ar")]
    string NameAr,
    [property: JsonPropertyName("name_en")]
    string? NameEn,
    string Code,
    [property: JsonPropertyName("logo_path")]
    string? LogoPath,
    [property: JsonPropertyName("template_pdf_path")]
    string? TemplatePdfPath,
    [property: JsonPropertyName("header_html")]
    string HeaderHtml,
    [property: JsonPropertyName("footer_html")]
    string FooterHtml,
    [property: JsonPropertyName("primary_color")]
    string PrimaryColor,
    [property: JsonPropertyName("secondary_color")]
    string SecondaryColor,
    [property: JsonPropertyName("show_page_number")]
    bool ShowPageNumber,
    [property: JsonPropertyName("show_confidentiality_label")]
    bool ShowConfidentialityLabel,
    [property: JsonPropertyName("is_default")]
    bool IsDefault,
    [property: JsonPropertyName("is_active")]
    bool IsActive,
    [property: JsonPropertyName("created_at")]
    DateTimeOffset CreatedAt,
    [property: JsonPropertyName("updated_at")]
    DateTimeOffset UpdatedAt);

public record UpsertOfficialLetterheadTemplateRequest(
    [property: JsonPropertyName("name_ar")]
    string NameAr,
    [property: JsonPropertyName("name_en")]
    string? NameEn,
    string Code,
    [property: JsonPropertyName("logo_path")]
    string? LogoPath,
    [property: JsonPropertyName("header_html")]
    string? HeaderHtml,
    [property: JsonPropertyName("footer_html")]
    string? FooterHtml,
    [property: JsonPropertyName("primary_color")]
    string PrimaryColor,
    [property: JsonPropertyName("secondary_color")]
    string SecondaryColor,
    [property: JsonPropertyName("show_page_number")]
    bool ShowPageNumber,
    [property: JsonPropertyName("show_confidentiality_label")]
    bool ShowConfidentialityLabel,
    [property: JsonPropertyName("is_default")]
    bool IsDefault,
    [property: JsonPropertyName("is_active")]
    bool IsActive);

public record OfficialAssetStatusRequest(
    [property: JsonPropertyName("is_active")]
    bool IsActive);

public record OfficialMessageSettingsDto(
    long Id,
    [property: JsonPropertyName("enable_official_letterhead")]
    bool IsEnabled,
    [property: JsonPropertyName("default_letterhead_template_id")]
    long? DefaultLetterheadTemplateId,
    [property: JsonPropertyName("official_message_requires_approval")]
    bool OfficialMessageRequiresApproval,
    [property: JsonPropertyName("include_official_messages_in_request_pdf")]
    bool IncludeOfficialMessagesInRequestPdf,
    [property: JsonPropertyName("allow_preview_for_all_users")]
    bool AllowPreviewForAllUsers,
    [property: JsonPropertyName("allow_unverified_signature")]
    bool AllowUnverifiedSignature,
    [property: JsonPropertyName("allow_signature_upload_by_user")]
    bool AllowSignatureUploadByUser,
    [property: JsonPropertyName("updated_at")]
    DateTimeOffset UpdatedAt);

public record UpdateOfficialMessageSettingsRequest(
    [property: JsonPropertyName("enable_official_letterhead")]
    bool IsEnabled,
    [property: JsonPropertyName("default_letterhead_template_id")]
    long? DefaultLetterheadTemplateId,
    [property: JsonPropertyName("official_message_requires_approval")]
    bool OfficialMessageRequiresApproval,
    [property: JsonPropertyName("include_official_messages_in_request_pdf")]
    bool IncludeOfficialMessagesInRequestPdf,
    [property: JsonPropertyName("allow_preview_for_all_users")]
    bool AllowPreviewForAllUsers,
    [property: JsonPropertyName("allow_unverified_signature")]
    bool AllowUnverifiedSignature,
    [property: JsonPropertyName("allow_signature_upload_by_user")]
    bool AllowSignatureUploadByUser);

public record UserSignatureDto(
    long Id,
    [property: JsonPropertyName("user_id")]
    long UserId,
    [property: JsonPropertyName("user_name")]
    string? UserName,
    [property: JsonPropertyName("signature_label")]
    string? SignatureLabel,
    [property: JsonPropertyName("is_verified")]
    bool IsVerified,
    [property: JsonPropertyName("is_active")]
    bool IsActive,
    [property: JsonPropertyName("uploaded_at")]
    DateTimeOffset UploadedAt,
    [property: JsonPropertyName("verified_by_user_id")]
    long? VerifiedByUserId,
    [property: JsonPropertyName("verified_at")]
    DateTimeOffset? VerifiedAt);

public record OfficialPdfPreviewRequest(
    [property: JsonPropertyName("message_id")]
    long? MessageId,
    [property: JsonPropertyName("letterhead_template_id")]
    long? LetterheadTemplateId,
    string? Subject,
    string? Body,
    [property: JsonPropertyName("recipient_ids")]
    IReadOnlyCollection<long>? RecipientIds,
    [property: JsonPropertyName("related_request_id")]
    long? RelatedRequestId,
    [property: JsonPropertyName("official_reference_number")]
    string? ReferenceNumber,
    [property: JsonPropertyName("include_signature")]
    bool IncludeSignature,
    [property: JsonPropertyName("signature_id")]
    long? SignatureId,
    [property: JsonPropertyName("show_sender_department")]
    bool ShowSenderDepartment,
    [property: JsonPropertyName("show_recipients")]
    bool ShowRecipients,
    [property: JsonPropertyName("show_generated_by")]
    bool ShowGeneratedBy,
    [property: JsonPropertyName("show_generated_at")]
    bool ShowGeneratedAt);

public record GenerateOfficialPdfRequest(
    [property: JsonPropertyName("letterhead_template_id")]
    long? LetterheadTemplateId,
    [property: JsonPropertyName("official_reference_number")]
    string? ReferenceNumber,
    [property: JsonPropertyName("body")]
    string? Body,
    [property: JsonPropertyName("include_signature")]
    bool IncludeSignature,
    [property: JsonPropertyName("signature_id")]
    long? SignatureId,
    [property: JsonPropertyName("show_sender_department")]
    bool ShowSenderDepartment,
    [property: JsonPropertyName("show_recipients")]
    bool ShowRecipients,
    [property: JsonPropertyName("show_generated_by")]
    bool ShowGeneratedBy,
    [property: JsonPropertyName("show_generated_at")]
    bool ShowGeneratedAt);

public record OfficialMessageDocumentDto(
    long Id,
    long MessageId,
    long? RelatedRequestId,
    long LetterheadTemplateId,
    [property: JsonPropertyName("signature_id")]
    long? SignatureId,
    string? ReferenceNumber,
    long FileSize,
    string Checksum,
    long GeneratedByUserId,
    string? GeneratedByNameAr,
    DateTimeOffset GeneratedAt);
