using System.Text.Json;
using Qib.ServicePortal.Api.Application.Interfaces;
using Qib.ServicePortal.Api.Domain.Entities;
using Qib.ServicePortal.Api.Infrastructure.Data;

namespace Qib.ServicePortal.Api.Application.Services;

public class AuditService(ServicePortalDbContext db, ICurrentUserService currentUser) : IAuditService
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    public async Task LogAsync(
        string action,
        string entityType,
        string? entityId = null,
        long? actorUserId = null,
        object? oldValue = null,
        object? newValue = null,
        object? metadata = null,
        string result = "success",
        CancellationToken cancellationToken = default)
    {
        db.AuditLogs.Add(new AuditLog
        {
            UserId = actorUserId ?? currentUser.UserId,
            Action = action,
            EntityType = entityType,
            EntityId = entityId,
            Result = result,
            IpAddress = currentUser.IpAddress,
            UserAgent = currentUser.UserAgent,
            OldValueJson = oldValue is null ? null : JsonSerializer.Serialize(oldValue, JsonOptions),
            NewValueJson = newValue is null ? null : JsonSerializer.Serialize(newValue, JsonOptions),
            MetadataJson = metadata is null ? null : JsonSerializer.Serialize(metadata, JsonOptions),
            CreatedAt = DateTimeOffset.UtcNow
        });

        await db.SaveChangesAsync(cancellationToken);
    }
}
