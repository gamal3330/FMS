using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Qib.ServicePortal.Api.Infrastructure.Data;

namespace Qib.ServicePortal.Api.Controllers;

[ApiController]
[Route("api/dotnet/v1/priority-settings")]
[Authorize(Policy = "Permission:request_types.view")]
public class PrioritySettingsController(ServicePortalDbContext db) : ControllerBase
{
    [HttpGet]
    public async Task<IActionResult> GetPriorities(CancellationToken cancellationToken)
    {
        var priorities = await db.PrioritySettings
            .AsNoTracking()
            .Where(x => x.IsActive)
            .OrderBy(x => x.SortOrder)
            .Select(x => new
            {
                x.Id,
                x.Code,
                x.NameAr,
                x.NameEn,
                x.Color,
                x.ResponseHours,
                x.ResolutionHours,
                x.EscalationEnabled,
                x.EscalationAfterHours
            })
            .ToListAsync(cancellationToken);
        return Ok(priorities);
    }
}
