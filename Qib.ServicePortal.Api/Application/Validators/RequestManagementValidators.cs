using FluentValidation;
using Qib.ServicePortal.Api.Application.DTOs;

namespace Qib.ServicePortal.Api.Application.Validators;

public class CreateRequestTypeRequestValidator : AbstractValidator<CreateRequestTypeRequest>
{
    public CreateRequestTypeRequestValidator()
    {
        RuleFor(x => x.NameAr).NotEmpty().MaximumLength(255);
        RuleFor(x => x.Code).NotEmpty().MaximumLength(100).Matches("^[a-zA-Z0-9._-]+$");
        RuleFor(x => x.DefaultPriority).NotEmpty().MaximumLength(50);
    }
}

public class UpdateRequestTypeRequestValidator : AbstractValidator<UpdateRequestTypeRequest>
{
    public UpdateRequestTypeRequestValidator()
    {
        RuleFor(x => x.NameAr).NotEmpty().MaximumLength(255);
        RuleFor(x => x.DefaultPriority).NotEmpty().MaximumLength(50);
        RuleFor(x => x.MaxAttachments).GreaterThanOrEqualTo(1).LessThanOrEqualTo(50);
        RuleFor(x => x.MaxFileSizeMb).GreaterThanOrEqualTo(1).LessThanOrEqualTo(100);
    }
}

public class UpsertRequestTypeFieldRequestValidator : AbstractValidator<UpsertRequestTypeFieldRequest>
{
    private static readonly string[] FieldTypes =
    [
        "text", "textarea", "number", "date", "datetime", "select", "multi_select",
        "checkbox", "file", "ip_address", "mac_address", "email", "phone",
        "department", "user_picker"
    ];

    public UpsertRequestTypeFieldRequestValidator()
    {
        RuleFor(x => x.FieldName).NotEmpty().MaximumLength(100).Matches("^[a-zA-Z][a-zA-Z0-9_]*$");
        RuleFor(x => x.LabelAr).NotEmpty().MaximumLength(255);
        RuleFor(x => x.FieldType).Must(x => FieldTypes.Contains(x)).WithMessage("نوع الحقل غير مدعوم");
        RuleFor(x => x.Width).NotEmpty().MaximumLength(30);
        RuleFor(x => x.SortOrder).GreaterThanOrEqualTo(0);
        RuleFor(x => x.OptionsJson)
            .NotEmpty()
            .When(x => x.FieldType is "select" or "multi_select")
            .WithMessage("حقول الاختيار يجب أن تحتوي على خيارات");
    }
}

public class UpsertWorkflowStepRequestValidator : AbstractValidator<UpsertWorkflowStepRequest>
{
    private static readonly string[] StepTypes =
    [
        "direct_manager", "specific_role", "specific_user", "department_manager",
        "specific_department_manager", "specialized_section", "specialized_section_manager",
        "information_security", "it_manager", "executive_management",
        "implementation_engineer", "close_request"
    ];

    public UpsertWorkflowStepRequestValidator()
    {
        RuleFor(x => x.StepNameAr).NotEmpty().MaximumLength(255);
        RuleFor(x => x.StepType).Must(x => StepTypes.Contains(x)).WithMessage("نوع المرحلة غير مدعوم");
        RuleFor(x => x.SortOrder).GreaterThanOrEqualTo(0);
        RuleFor(x => x.ApproverRoleId).NotNull().When(x => x.StepType == "specific_role").WithMessage("يجب اختيار دور لهذه المرحلة");
        RuleFor(x => x)
            .Must(x => x.ApproverUserId.HasValue || !string.IsNullOrWhiteSpace(x.ApproverEmployeeNumber))
            .When(x => x.StepType == "specific_user")
            .WithMessage("يجب إدخال الرقم الوظيفي للموظف لهذه المرحلة");
        RuleFor(x => x.TargetDepartmentId).NotNull().When(x => x.StepType == "specific_department_manager").WithMessage("يجب اختيار إدارة محددة");
    }
}
