using FluentValidation;
using Qib.ServicePortal.Api.Application.DTOs;

namespace Qib.ServicePortal.Api.Application.Validators;

public class UpsertOfficialLetterheadTemplateRequestValidator : AbstractValidator<UpsertOfficialLetterheadTemplateRequest>
{
    public UpsertOfficialLetterheadTemplateRequestValidator()
    {
        RuleFor(x => x.NameAr).NotEmpty().MaximumLength(255);
        RuleFor(x => x.Code).NotEmpty().Matches("^[a-z0-9_\\-]+$").MaximumLength(100);
        RuleFor(x => x.PrimaryColor).NotEmpty().MaximumLength(30);
        RuleFor(x => x.SecondaryColor).NotEmpty().MaximumLength(30);
    }
}

public class OfficialPdfPreviewRequestValidator : AbstractValidator<OfficialPdfPreviewRequest>
{
    public OfficialPdfPreviewRequestValidator()
    {
        RuleFor(x => x.Subject)
            .NotEmpty()
            .MaximumLength(300)
            .When(x => !x.MessageId.HasValue);
        RuleFor(x => x.Body)
            .NotEmpty()
            .MaximumLength(20000)
            .When(x => !x.MessageId.HasValue);
    }
}
