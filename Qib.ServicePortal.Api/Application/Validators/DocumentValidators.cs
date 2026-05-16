using FluentValidation;
using Qib.ServicePortal.Api.Application.DTOs;

namespace Qib.ServicePortal.Api.Application.Validators;

public class UpsertDocumentCategoryRequestValidator : AbstractValidator<UpsertDocumentCategoryRequest>
{
    public UpsertDocumentCategoryRequestValidator()
    {
        RuleFor(x => x.NameAr).NotEmpty().MaximumLength(255);
        RuleFor(x => x.Code).NotEmpty().Matches("^[a-z0-9_\\-]+$").MaximumLength(100);
        RuleFor(x => x.Color).NotEmpty().MaximumLength(30);
        RuleFor(x => x.SortOrder).GreaterThanOrEqualTo(0);
    }
}

public class UpdateDocumentRequestValidator : AbstractValidator<UpdateDocumentRequest>
{
    public UpdateDocumentRequestValidator()
    {
        RuleFor(x => x.TitleAr).NotEmpty().MaximumLength(300);
        RuleFor(x => x.CategoryId).GreaterThan(0);
        RuleFor(x => x.Classification).Must(DocumentValidationValues.IsValidClassification).WithMessage("درجة السرية غير صالحة");
        RuleFor(x => x.Status).Must(DocumentValidationValues.IsValidStatus).WithMessage("حالة الوثيقة غير صالحة");
    }
}

public class UploadDocumentMetadataRequestValidator : AbstractValidator<UploadDocumentMetadataRequest>
{
    public UploadDocumentMetadataRequestValidator()
    {
        RuleFor(x => x.TitleAr).NotEmpty().MaximumLength(300);
        RuleFor(x => x.CategoryId).GreaterThan(0);
        RuleFor(x => x.Classification).Must(DocumentValidationValues.IsValidClassification).WithMessage("درجة السرية غير صالحة");
        RuleFor(x => x.VersionNumber).MaximumLength(40);
    }
}

public class UploadDocumentVersionMetadataRequestValidator : AbstractValidator<UploadDocumentVersionMetadataRequest>
{
    public UploadDocumentVersionMetadataRequestValidator()
    {
        RuleFor(x => x.VersionNumber).MaximumLength(40);
        RuleFor(x => x.ChangeSummary).MaximumLength(1000);
    }
}

public class UpsertDocumentPermissionRequestValidator : AbstractValidator<UpsertDocumentPermissionRequest>
{
    public UpsertDocumentPermissionRequestValidator()
    {
        RuleFor(x => x).Must(x => x.CategoryId.HasValue || x.DocumentId.HasValue)
            .WithMessage("يجب تحديد تصنيف أو وثيقة");
        RuleFor(x => x).Must(x => x.RoleId.HasValue || x.DepartmentId.HasValue)
            .WithMessage("يجب تحديد دور أو إدارة");
    }
}

internal static class DocumentValidationValues
{
    private static readonly HashSet<string> Classifications = ["public", "internal", "confidential", "top_secret"];
    private static readonly HashSet<string> Statuses = ["draft", "active", "archived", "expired"];

    public static bool IsValidClassification(string value) => Classifications.Contains(value);
    public static bool IsValidStatus(string value) => Statuses.Contains(value);
}
