using FluentValidation;
using Qib.ServicePortal.Api.Application.DTOs;

namespace Qib.ServicePortal.Api.Application.Validators;

public class CreateMessageRequestValidator : AbstractValidator<CreateMessageRequest>
{
    public CreateMessageRequestValidator()
    {
        RuleFor(x => x.RecipientIds).NotEmpty().WithMessage("يجب تحديد مستلم واحد على الأقل");
        RuleForEach(x => x.RecipientIds).GreaterThan(0);
        RuleFor(x => x.MessageTypeId).GreaterThan(0);
        RuleFor(x => x.Priority).NotEmpty().MaximumLength(30);
        RuleFor(x => x.Subject).NotEmpty().MaximumLength(300);
        RuleFor(x => x.Body).NotEmpty().MaximumLength(20000);
    }
}

public class ReplyMessageRequestValidator : AbstractValidator<ReplyMessageRequest>
{
    public ReplyMessageRequestValidator()
    {
        RuleFor(x => x.Body).NotEmpty().MaximumLength(20000);
        RuleFor(x => x.Subject).MaximumLength(300);
    }
}
