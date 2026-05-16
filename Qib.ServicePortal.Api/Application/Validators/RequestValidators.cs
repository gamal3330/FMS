using FluentValidation;
using Qib.ServicePortal.Api.Application.DTOs;

namespace Qib.ServicePortal.Api.Application.Validators;

public class CreateRequestRequestValidator : AbstractValidator<CreateRequestRequest>
{
    public CreateRequestRequestValidator()
    {
        RuleFor(x => x.RequestTypeId).GreaterThan(0);
        RuleFor(x => x.Title).NotEmpty().MaximumLength(300);
        RuleFor(x => x.FormData).NotNull();
    }
}

public class UpdateRequestRequestValidator : AbstractValidator<UpdateRequestRequest>
{
    public UpdateRequestRequestValidator()
    {
        RuleFor(x => x.Title).NotEmpty().MaximumLength(300);
        RuleFor(x => x.FormData).NotNull();
    }
}
