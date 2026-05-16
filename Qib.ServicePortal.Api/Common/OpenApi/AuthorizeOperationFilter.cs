using Microsoft.AspNetCore.Authorization;
using Microsoft.OpenApi.Models;
using Swashbuckle.AspNetCore.SwaggerGen;

namespace Qib.ServicePortal.Api.Common.OpenApi;

public sealed class AuthorizeOperationFilter : IOperationFilter
{
    public void Apply(OpenApiOperation operation, OperationFilterContext context)
    {
        var endpointMetadata = context.ApiDescription.ActionDescriptor.EndpointMetadata;
        var allowsAnonymous = endpointMetadata.OfType<IAllowAnonymous>().Any();
        if (allowsAnonymous)
        {
            return;
        }

        var requiresAuthorization = endpointMetadata.OfType<IAuthorizeData>().Any();
        if (!requiresAuthorization)
        {
            return;
        }

        operation.Security ??= [];
        operation.Security.Add(new OpenApiSecurityRequirement
        {
            [
                new OpenApiSecurityScheme
                {
                    Reference = new OpenApiReference
                    {
                        Type = ReferenceType.SecurityScheme,
                        Id = "Bearer"
                    }
                }
            ] = []
        });

        operation.Responses.TryAdd("401", new OpenApiResponse { Description = "غير مصرح: يجب تسجيل الدخول." });
        operation.Responses.TryAdd("403", new OpenApiResponse { Description = "ممنوع: لا توجد صلاحية كافية." });
    }
}
