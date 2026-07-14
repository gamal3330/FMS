using Microsoft.EntityFrameworkCore;
using Qib.ServicePortal.Api.Application.Interfaces;
using Qib.ServicePortal.Api.Domain.Entities;
using Qib.ServicePortal.Api.Infrastructure.Data;
using Quartz;

namespace Qib.ServicePortal.Api.Infrastructure.Jobs;

[DisallowConcurrentExecution]
public sealed class WorkflowSlaEscalationJob(
    ServicePortalDbContext db,
    IAuditService auditService,
    INotificationRealtimeService realtimeNotifications,
    ILogger<WorkflowSlaEscalationJob> logger) : IJob
{
    public async Task Execute(IJobExecutionContext context)
    {
        var cancellationToken = context.CancellationToken;
        var now = DateTimeOffset.UtcNow;
        var dueStepIds = await db.RequestWorkflowSnapshots
            .AsNoTracking()
            .Where(x =>
                x.Status == "pending" &&
                x.IsApplicable &&
                x.SlaDueAt.HasValue &&
                x.SlaDueAt.Value <= now &&
                !x.EscalatedAt.HasValue &&
                (x.EscalationUserId.HasValue || x.EscalationRoleId.HasValue))
            .OrderBy(x => x.SlaDueAt)
            .Select(x => x.Id)
            .Take(100)
            .ToListAsync(cancellationToken);

        foreach (var stepId in dueStepIds)
        {
            var step = await db.RequestWorkflowSnapshots
                .Include(x => x.Request)
                .FirstOrDefaultAsync(x => x.Id == stepId, cancellationToken);
            if (step is null || step.Status != "pending" || step.EscalatedAt.HasValue)
            {
                continue;
            }

            var recipientIds = new HashSet<long>();
            if (step.EscalationUserId.HasValue)
            {
                var escalationUserIsActive = await db.Users
                    .AsNoTracking()
                    .AnyAsync(x => x.Id == step.EscalationUserId.Value && x.IsActive && !x.IsLocked, cancellationToken);
                if (escalationUserIsActive)
                {
                    recipientIds.Add(step.EscalationUserId.Value);
                }
            }

            if (step.EscalationRoleId.HasValue)
            {
                var roleUsers = await db.Users
                    .AsNoTracking()
                    .Where(x => x.RoleId == step.EscalationRoleId.Value && x.IsActive && !x.IsLocked)
                    .Select(x => x.Id)
                    .ToListAsync(cancellationToken);
                recipientIds.UnionWith(roleUsers);
            }

            if (recipientIds.Count == 0)
            {
                logger.LogWarning(
                    "Workflow step {WorkflowStepId} for request {RequestId} is overdue but no active escalation recipient was resolved",
                    step.Id,
                    step.RequestId);
                continue;
            }

            step.EscalatedAt = now;
            step.EscalationCount += 1;
            var notifications = recipientIds.Select(userId => new Notification
            {
                UserId = userId,
                Title = "تصعيد مرحلة موافقة متأخرة",
                Body = $"الطلب {step.Request?.RequestNumber ?? step.RequestId.ToString()} تجاوز مهلة مرحلة «{step.StepNameAr}».",
                Channel = "approvals",
                RelatedRoute = "/approvals",
                IsRead = false
            }).ToList();
            if (notifications.Count > 0)
            {
                db.Notifications.AddRange(notifications);
            }

            await db.SaveChangesAsync(cancellationToken);
            await auditService.LogAsync(
                "approval_step_escalated",
                "request_workflow_snapshot",
                step.Id.ToString(),
                metadata: new
                {
                    step.RequestId,
                    step.StepNameAr,
                    step.SlaDueAt,
                    step.EscalationUserId,
                    step.EscalationRoleId,
                    Recipients = recipientIds
                },
                cancellationToken: cancellationToken);

            foreach (var notification in notifications)
            {
                await realtimeNotifications.SendToUserAsync(notification.UserId, new
                {
                    type = "approval_sla_escalated",
                    id = notification.Id,
                    title = notification.Title,
                    body = notification.Body,
                    channel = notification.Channel,
                    related_route = notification.RelatedRoute,
                    request_id = step.RequestId,
                    workflow_step_id = step.Id,
                    created_at = notification.CreatedAt
                }, cancellationToken);
            }
        }
    }
}
