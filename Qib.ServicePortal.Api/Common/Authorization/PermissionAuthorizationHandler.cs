using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Qib.ServicePortal.Api.Application.Interfaces;

namespace Qib.ServicePortal.Api.Common.Authorization;

public class PermissionAuthorizationHandler(IServiceScopeFactory scopeFactory) : AuthorizationHandler<PermissionRequirement>
{
    protected override async Task HandleRequirementAsync(AuthorizationHandlerContext context, PermissionRequirement requirement)
    {
        var userIdValue = context.User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (!long.TryParse(userIdValue, out var userId))
        {
            return;
        }

        using var scope = scopeFactory.CreateScope();
        var permissionService = scope.ServiceProvider.GetRequiredService<IPermissionService>();
        if (await permissionService.HasPermissionAsync(userId, requirement.PermissionCode))
        {
            context.Succeed(requirement);
        }
    }
}
