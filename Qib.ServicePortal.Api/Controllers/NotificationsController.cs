using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Qib.ServicePortal.Api.Application.Interfaces;
using Qib.ServicePortal.Api.Common.Exceptions;
using Qib.ServicePortal.Api.Domain.Entities;
using Qib.ServicePortal.Api.Infrastructure.Data;

namespace Qib.ServicePortal.Api.Controllers;

[ApiController]
[Route("api/dotnet/v1/notifications")]
[Authorize]
public class NotificationsController(
    ServicePortalDbContext db,
    ICurrentUserService currentUser,
    IAuditService auditService) : ControllerBase
{
    [HttpGet("")]
    public async Task<ActionResult<IReadOnlyCollection<object>>> List(
        [FromQuery] int limit = 20,
        [FromQuery(Name = "unread_only")] bool unreadOnly = false,
        CancellationToken cancellationToken = default)
    {
        var actorId = RequireCurrentUserId();
        limit = Math.Clamp(limit, 1, 100);
        var query = db.Notifications
            .AsNoTracking()
            .Where(x => x.UserId == actorId);

        if (unreadOnly)
        {
            query = query.Where(x => !x.IsRead);
        }

        var rows = await query
            .OrderByDescending(x => x.CreatedAt)
            .Take(limit)
            .ToListAsync(cancellationToken);

        return Ok(rows.Select(MapNotification).ToList());
    }

    [HttpGet("unread-count")]
    public async Task<ActionResult<object>> UnreadCount(CancellationToken cancellationToken)
    {
        var actorId = RequireCurrentUserId();
        var count = await db.Notifications.CountAsync(x => x.UserId == actorId && !x.IsRead, cancellationToken);
        return Ok(new { count });
    }

    [HttpPost("{id:long}/read")]
    public async Task<ActionResult<object>> MarkRead(long id, CancellationToken cancellationToken)
    {
        var actorId = RequireCurrentUserId();
        var notification = await db.Notifications.FirstOrDefaultAsync(x => x.Id == id && x.UserId == actorId, cancellationToken)
            ?? throw new ApiException("الإشعار غير موجود", StatusCodes.Status404NotFound);

        if (!notification.IsRead)
        {
            notification.IsRead = true;
            notification.ReadAt = DateTimeOffset.UtcNow;
            await db.SaveChangesAsync(cancellationToken);
            await auditService.LogAsync("notification_read", "notification", id.ToString(), metadata: new { notification.Title }, cancellationToken: cancellationToken);
        }

        return Ok(MapNotification(notification));
    }

    [HttpPost("mark-all-read")]
    public async Task<ActionResult<object>> MarkAllRead(CancellationToken cancellationToken)
    {
        var actorId = RequireCurrentUserId();
        var notifications = await db.Notifications
            .Where(x => x.UserId == actorId && !x.IsRead)
            .ToListAsync(cancellationToken);

        var now = DateTimeOffset.UtcNow;
        foreach (var notification in notifications)
        {
            notification.IsRead = true;
            notification.ReadAt = now;
        }

        await db.SaveChangesAsync(cancellationToken);
        await auditService.LogAsync("notifications_marked_read", "notification", metadata: new { updated = notifications.Count }, cancellationToken: cancellationToken);
        return Ok(new { updated = notifications.Count });
    }

    private long RequireCurrentUserId() =>
        currentUser.UserId ?? throw new ApiException("المستخدم غير مصادق", StatusCodes.Status401Unauthorized);

    private static object MapNotification(Notification notification) => new
    {
        id = notification.Id,
        title = notification.Title,
        body = notification.Body,
        channel = notification.Channel,
        related_route = notification.RelatedRoute,
        is_read = notification.IsRead,
        created_at = notification.CreatedAt
    };
}
