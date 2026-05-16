using System.Linq;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Qib.ServicePortal.Api.Application.Interfaces;
using Qib.ServicePortal.Api.Common.Exceptions;
using Qib.ServicePortal.Api.Domain.Entities;
using Qib.ServicePortal.Api.Infrastructure.Data;
using RequestEntity = Qib.ServicePortal.Api.Domain.Entities.Request;

namespace Qib.ServicePortal.Api.Controllers;

[ApiController]
[Route("api/dotnet/v1/dashboard")]
[Authorize(Policy = "Permission:dashboard.view")]
public class DashboardController(ServicePortalDbContext db, ICurrentUserService currentUser, IPermissionService permissionService) : ControllerBase
{
    private static readonly HashSet<string> FinalStatuses = ["completed", "closed", "rejected", "cancelled"];

    [HttpGet("stats")]
    public async Task<ActionResult<object>> GetStats(CancellationToken cancellationToken)
    {
        var actor = await LoadActorAsync(cancellationToken);
        var canSeeAllRequests = await permissionService.HasPermissionAsync(actor.Id, "requests.manage", cancellationToken);
        var now = DateTimeOffset.UtcNow;

        var requests = await ApplyRequestScope(BaseRequestQuery().AsNoTracking(), actor, canSeeAllRequests)
            .OrderByDescending(x => x.UpdatedAt)
            .Take(5000)
            .ToListAsync(cancellationToken);

        var openRequests = requests.Count(x => !FinalStatuses.Contains(x.Status));
        var pendingApprovals = requests.SelectMany(x => x.WorkflowSnapshots).Count(x => x.Status == "pending");
        var completedRequests = requests.Count(x => x.Status is "completed" or "closed");
        var delayedRequests = requests.Count(x => !FinalStatuses.Contains(x.Status) && (x.SlaResolutionDueAt ?? x.SlaTracking?.ResolutionDueAt) < now);
        var returnedForEdit = requests.Count(x => x.Status == "returned_for_edit");

        var messages = await BuildMessagesStatsAsync(actor.Id, cancellationToken);
        var attentionItems = new List<object>();
        if (pendingApprovals > 0)
        {
            attentionItems.Add(new { tone = "warning", title = "موافقات معلقة", description = $"{pendingApprovals} خطوة اعتماد ما زالت بانتظار الإجراء." });
        }

        if (returnedForEdit > 0)
        {
            attentionItems.Add(new { tone = "info", title = "طلبات معادة للتعديل", description = $"{returnedForEdit} طلب يحتاج تحديثاً قبل إعادة الإرسال." });
        }

        if (messages.unread > 0)
        {
            attentionItems.Add(new { tone = "message", title = "رسائل غير مقروءة", description = $"{messages.unread} رسالة في الوارد لم تتم قراءتها." });
        }

        if (delayedRequests > 0)
        {
            attentionItems.Add(new { tone = "danger", title = "طلبات متأخرة", description = $"{delayedRequests} طلب تجاوز وقت الإنجاز المتوقع." });
        }

        return Ok(new
        {
            open_requests = openRequests,
            pending_approvals = pendingApprovals,
            completed_requests = completedRequests,
            delayed_requests = delayedRequests,
            monthly_statistics = requests
                .GroupBy(x => x.CreatedAt.ToString("yyyy-MM"))
                .OrderBy(x => x.Key)
                .Select(x => new { month = x.Key, count = x.Count() })
                .ToList(),
            requests_by_department = requests
                .GroupBy(x => x.Department?.NameAr ?? "غير محدد")
                .OrderByDescending(x => x.Count())
                .Select(x => new { department = x.Key, count = x.Count() })
                .ToList(),
            requests_by_status = requests
                .GroupBy(x => x.Status)
                .OrderByDescending(x => x.Count())
                .Select(x => new { status = x.Key, label = StatusLabel(x.Key), count = x.Count() })
                .ToList(),
            requests_by_type = requests
                .GroupBy(x => new { id = x.RequestTypeId, label = x.RequestType?.NameAr ?? x.RequestType?.Code ?? "غير محدد" })
                .OrderByDescending(x => x.Count())
                .Take(8)
                .Select(x => new { type = x.Key.id.ToString(), label = x.Key.label, count = x.Count() })
                .ToList(),
            messages,
            recent_requests = requests
                .OrderByDescending(x => x.UpdatedAt)
                .Take(6)
                .Select(x => new
                {
                    id = x.Id,
                    request_number = x.RequestNumber,
                    title = x.Title,
                    status_label = StatusLabel(x.Status),
                    requester_name = x.Requester?.NameAr ?? "-",
                    updated_at = x.UpdatedAt
                })
                .ToList(),
            attention_items = attentionItems.Take(5).ToList(),
            can_view_it_staff_statistics = canSeeAllRequests,
            it_staff_statistics = canSeeAllRequests ? BuildStaffStatistics(requests) : Array.Empty<object>()
        });
    }

    private IQueryable<RequestEntity> BaseRequestQuery() =>
        db.Requests
            .Include(x => x.RequestType)
            .Include(x => x.Requester).ThenInclude(x => x!.DirectManager)
            .Include(x => x.Department)
            .Include(x => x.SpecializedSection).ThenInclude(x => x!.Department)
            .Include(x => x.SpecializedSection).ThenInclude(x => x!.DefaultAssigneeUser)
            .Include(x => x.AssignedTo)
            .Include(x => x.WorkflowSnapshots).ThenInclude(x => x.ActionByUser)
            .Include(x => x.SlaTracking);

    private static IQueryable<RequestEntity> ApplyRequestScope(IQueryable<RequestEntity> query, User actor, bool canSeeAll)
    {
        if (canSeeAll)
        {
            return query;
        }

        var actorId = actor.Id;
        var roleId = actor.RoleId;
        return query.Where(x =>
            x.RequesterId == actorId ||
            x.AssignedToId == actorId ||
            x.Requester!.DirectManagerId == actorId ||
            x.Department!.ManagerUserId == actorId ||
            x.SpecializedSection!.ManagerUserId == actorId ||
            x.SpecializedSection!.Department!.ManagerUserId == actorId ||
            x.SpecializedSection!.DefaultAssigneeUserId == actorId ||
            x.WorkflowSnapshots.Any(s => s.TargetDepartment != null && s.TargetDepartment.ManagerUserId == actorId) ||
            x.WorkflowSnapshots.Any(s => s.ApproverUserId == actorId || s.ApproverRoleId == roleId || s.ActionByUserId == actorId));
    }

    private async Task<MessageStats> BuildMessagesStatsAsync(long actorId, CancellationToken cancellationToken)
    {
        var unread = await db.MessageRecipients
            .CountAsync(x => x.RecipientId == actorId && !x.IsRead && !x.IsArchived, cancellationToken);
        var inboxTotal = await db.MessageRecipients
            .CountAsync(x => x.RecipientId == actorId && !x.IsArchived, cancellationToken);
        var sentTotal = await db.Messages
            .CountAsync(x => x.SenderId == actorId, cancellationToken);
        var linkedMessages = await db.Messages
            .CountAsync(x => x.RelatedRequestId.HasValue && (x.SenderId == actorId || x.Recipients.Any(r => r.RecipientId == actorId)), cancellationToken);

        var byType = await db.Messages
            .AsNoTracking()
            .Include(x => x.MessageType)
            .Where(x => x.SenderId == actorId || x.Recipients.Any(r => r.RecipientId == actorId))
            .GroupBy(x => new { x.MessageTypeId, label = x.MessageType != null ? x.MessageType.NameAr : "غير محدد", code = x.MessageType != null ? x.MessageType.Code : x.MessageTypeId.ToString() })
            .OrderByDescending(x => x.Count())
            .Select(x => new { type = x.Key.code, label = x.Key.label, count = x.Count() })
            .ToListAsync(cancellationToken);

        var recent = await db.MessageRecipients
            .AsNoTracking()
            .Include(x => x.Message).ThenInclude(x => x!.MessageType)
            .Include(x => x.Message).ThenInclude(x => x!.Sender)
            .Where(x => x.RecipientId == actorId && !x.IsArchived && x.Message != null)
            .OrderBy(x => x.IsRead)
            .ThenByDescending(x => x.Message!.SentAt)
            .Take(5)
            .Select(x => new
            {
                id = x.Message!.Id,
                message_uid = $"MSG-{x.Message.Id:000000}",
                subject = x.Message.Subject,
                message_type = x.Message.MessageType != null ? x.Message.MessageType.Code : x.Message.MessageTypeId.ToString(),
                message_type_label = x.Message.MessageType != null ? x.Message.MessageType.NameAr : "غير محدد",
                sender_name = x.Message.Sender != null ? x.Message.Sender.NameAr : "-",
                is_read = x.IsRead,
                created_at = x.Message.SentAt
            })
            .ToListAsync(cancellationToken);

        return new MessageStats
        {
            unread = unread,
            inbox_total = inboxTotal,
            sent_total = sentTotal,
            drafts = 0,
            linked_messages = linkedMessages,
            by_type = byType.Select(x => (object)x).ToList(),
            recent = recent.Select(x => (object)x).ToList()
        };
    }

    private static IReadOnlyCollection<object> BuildStaffStatistics(IEnumerable<RequestEntity> requests)
    {
        return requests
            .SelectMany(request => request.WorkflowSnapshots.Select(step => new { request, step }))
            .Where(x => x.step.ActionByUser is not null && x.step.Status is "approved" or "completed")
            .GroupBy(x => x.step.ActionByUser!)
            .OrderByDescending(x => x.Select(v => v.request.Id).Distinct().Count())
            .Take(25)
            .Select(x => new
            {
                user_id = x.Key.Id,
                full_name_ar = x.Key.NameAr,
                email = x.Key.Email,
                department = x.Key.Department?.NameAr,
                processed_requests = x.Select(v => v.request.Id).Distinct().Count(),
                processed_steps = x.Count(),
                closed_requests = x.Select(v => v.request).DistinctBy(v => v.Id).Count(v => v.Status == "closed"),
                last_action_at = x.Max(v => v.step.ActionAt)
            })
            .ToList<object>();
    }

    private async Task<User> LoadActorAsync(CancellationToken cancellationToken)
    {
        var actorId = currentUser.UserId ?? throw new ApiException("المستخدم غير معروف", StatusCodes.Status401Unauthorized);
        return await db.Users
            .AsNoTracking()
            .Include(x => x.Role)
            .Include(x => x.Department)
            .FirstOrDefaultAsync(x => x.Id == actorId, cancellationToken)
            ?? throw new ApiException("المستخدم غير موجود", StatusCodes.Status401Unauthorized);
    }

    private static string StatusLabel(string status) => status switch
    {
        "draft" => "مسودة",
        "submitted" => "مقدم",
        "pending_approval" or "pending" => "بانتظار الموافقة",
        "returned_for_edit" => "معاد للتعديل",
        "approved" => "معتمد",
        "in_progress" => "قيد التنفيذ",
        "completed" => "مكتمل",
        "closed" => "مغلق",
        "rejected" => "مرفوض",
        "cancelled" => "ملغي",
        "reopened" => "معاد فتحه",
        _ => status
    };

    private sealed class MessageStats
    {
        public int unread { get; init; }
        public int inbox_total { get; init; }
        public int sent_total { get; init; }
        public int drafts { get; init; }
        public int linked_messages { get; init; }
        public IReadOnlyCollection<object> by_type { get; init; } = Array.Empty<object>();
        public IReadOnlyCollection<object> recent { get; init; } = Array.Empty<object>();
    }
}
