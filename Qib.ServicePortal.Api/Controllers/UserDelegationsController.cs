using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Qib.ServicePortal.Api.Application.Interfaces;
using Qib.ServicePortal.Api.Common.Exceptions;
using Qib.ServicePortal.Api.Domain.Entities;
using Qib.ServicePortal.Api.Infrastructure.Data;

namespace Qib.ServicePortal.Api.Controllers;

[ApiController]
[Route("api/dotnet/v1/users/delegations")]
[Authorize]
public class UserDelegationsController(ServicePortalDbContext db, ICurrentUserService currentUser) : ControllerBase
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    [HttpGet("me")]
    public async Task<ActionResult<IReadOnlyCollection<object>>> GetMyDelegations(CancellationToken cancellationToken)
    {
        var userId = currentUser.UserId
                     ?? throw new ApiException("جلسة المستخدم غير صالحة", StatusCodes.Status401Unauthorized);
        var now = DateTimeOffset.UtcNow;
        var rows = await ReadDelegationsAsync(cancellationToken);
        var relevant = rows
            .Where(item =>
                item.IsActive &&
                item.StartDate <= now &&
                item.EndDate >= now &&
                (item.DelegatorUserId == userId || item.DelegateUserId == userId))
            .ToList();

        var userIds = relevant
            .SelectMany(item => new[] { item.DelegatorUserId, item.DelegateUserId })
            .Distinct()
            .ToList();
        var users = await db.Users
            .AsNoTracking()
            .Where(user => userIds.Contains(user.Id))
            .ToDictionaryAsync(user => user.Id, cancellationToken);

        return Ok(relevant.Select(item => MapDelegation(item, users)).ToList());
    }

    private async Task<List<DelegationRecord>> ReadDelegationsAsync(CancellationToken cancellationToken)
    {
        var raw = await db.SystemSettings
            .AsNoTracking()
            .Where(item => item.Key == "users.delegations")
            .Select(item => item.Value)
            .FirstOrDefaultAsync(cancellationToken);
        if (string.IsNullOrWhiteSpace(raw))
        {
            return [];
        }

        try
        {
            return JsonSerializer.Deserialize<List<DelegationRecord>>(raw, JsonOptions) ?? [];
        }
        catch
        {
            return [];
        }
    }

    private static object MapDelegation(DelegationRecord item, IReadOnlyDictionary<long, User> users)
    {
        users.TryGetValue(item.DelegatorUserId, out var delegator);
        users.TryGetValue(item.DelegateUserId, out var delegateUser);
        return new
        {
            id = item.Id,
            delegator_user_id = item.DelegatorUserId,
            delegate_user_id = item.DelegateUserId,
            delegator_name = delegator?.NameAr ?? "-",
            delegate_name = delegateUser?.NameAr ?? "-",
            delegation_scope = item.DelegationScope,
            start_date = item.StartDate,
            end_date = item.EndDate,
            reason = item.Reason,
            is_active = item.IsActive
        };
    }

    private sealed record DelegationRecord(
        [property: JsonPropertyName("id")] long Id,
        [property: JsonPropertyName("delegator_user_id")] long DelegatorUserId,
        [property: JsonPropertyName("delegate_user_id")] long DelegateUserId,
        [property: JsonPropertyName("delegation_scope")] string DelegationScope,
        [property: JsonPropertyName("start_date")] DateTimeOffset StartDate,
        [property: JsonPropertyName("end_date")] DateTimeOffset EndDate,
        [property: JsonPropertyName("reason")] string? Reason,
        [property: JsonPropertyName("is_active")] bool IsActive);
}
