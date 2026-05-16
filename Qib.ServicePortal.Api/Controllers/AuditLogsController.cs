using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Qib.ServicePortal.Api.Application.DTOs;
using Qib.ServicePortal.Api.Infrastructure.Data;

namespace Qib.ServicePortal.Api.Controllers;

[ApiController]
[Route("api/dotnet/v1/audit-logs")]
[Authorize(Policy = "Permission:audit.view")]
public class AuditLogsController(ServicePortalDbContext db) : ControllerBase
{
    [HttpGet]
    public async Task<ActionResult<IReadOnlyCollection<AuditLogDto>>> GetAuditLogs(
        [FromQuery] string? action,
        [FromQuery] long? userId,
        [FromQuery] DateTimeOffset? dateFrom,
        [FromQuery] DateTimeOffset? dateTo,
        CancellationToken cancellationToken)
    {
        var query = db.AuditLogs.Include(x => x.User).AsNoTracking();
        if (!string.IsNullOrWhiteSpace(action))
        {
            query = query.Where(x => x.Action == action);
        }

        if (userId.HasValue)
        {
            query = query.Where(x => x.UserId == userId.Value);
        }

        if (dateFrom.HasValue)
        {
            query = query.Where(x => x.CreatedAt >= dateFrom.Value);
        }

        if (dateTo.HasValue)
        {
            query = query.Where(x => x.CreatedAt <= dateTo.Value);
        }

        var logs = await query.OrderByDescending(x => x.CreatedAt).Take(500).ToListAsync(cancellationToken);
        return Ok(logs.Select(x => new AuditLogDto(
            x.Id,
            x.Action,
            x.EntityType,
            x.EntityId,
            x.Result,
            x.UserId,
            x.User?.Username,
            x.IpAddress,
            x.UserAgent,
            x.OldValueJson,
            x.NewValueJson,
            x.MetadataJson,
            x.CreatedAt)).ToList());
    }
}
