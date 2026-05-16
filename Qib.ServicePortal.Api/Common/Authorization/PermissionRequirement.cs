using Microsoft.AspNetCore.Authorization;

namespace Qib.ServicePortal.Api.Common.Authorization;

public class PermissionRequirement(string permissionCode) : IAuthorizationRequirement
{
    public string PermissionCode { get; } = permissionCode;
}
