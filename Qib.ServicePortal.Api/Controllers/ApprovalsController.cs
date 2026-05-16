using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Qib.ServicePortal.Api.Application.DTOs;
using Qib.ServicePortal.Api.Application.Interfaces;
using Qib.ServicePortal.Api.Common.Exceptions;
using Qib.ServicePortal.Api.Domain.Entities;
using Qib.ServicePortal.Api.Infrastructure.Data;
using RequestEntity = Qib.ServicePortal.Api.Domain.Entities.Request;

namespace Qib.ServicePortal.Api.Controllers;

[ApiController]
[Route("api/dotnet/v1")]
[Authorize(Policy = "Permission:approvals.view")]
public class ApprovalsController(
    ServicePortalDbContext db,
    ICurrentUserService currentUser,
    IPermissionService permissionService,
    IAuditService auditService) : ControllerBase
{
    private static readonly HashSet<string> ExecutionStepTypes = ["implementation_engineer", "department_specialist", "specialized_section", "execution", "execute_request"];

    [HttpGet("approvals/summary")]
    public async Task<ActionResult<ApprovalSummaryDto>> GetSummary(CancellationToken cancellationToken)
    {
        var actor = await LoadActorAsync(cancellationToken);
        var canManage = await CanManageRequestsAsync(actor.Id, cancellationToken);
        var query = ApprovalBaseQuery().AsNoTracking();
        if (!canManage)
        {
            query = ApplyApprovalScope(query, actor);
        }

        var rows = await query.Take(1000).ToListAsync(cancellationToken);

        var now = DateTimeOffset.UtcNow;
        var pending = rows.Select(x => new { Request = x, Step = CurrentPendingStep(x) }).Where(x => x.Step is not null).ToList();
        var actionable = pending.Where(x => canManage || CanActOnStep(x.Request, x.Step!, actor)).ToList();
        var today = now.Date;

        return Ok(new ApprovalSummaryDto(
            PendingMyApproval: actionable.Count(x => !IsExecutionStep(x.Step!)),
            Tracking: rows.Count(x => x.RequesterId == actor.Id),
            PendingExecution: actionable.Count(x => IsExecutionStep(x.Step!)),
            ReturnedForEdit: rows.Count(x => x.Status == "returned_for_edit" && (canManage || x.RequesterId == actor.Id)),
            Overdue: actionable.Count(x => x.Step!.SlaDueAt.HasValue && x.Step.SlaDueAt.Value < now),
            CompletedToday: rows.Count(x => x.WorkflowSnapshots.Any(s => s.ActionByUserId == actor.Id && s.ActionAt.HasValue && s.ActionAt.Value.UtcDateTime.Date == today))));
    }

    [HttpGet("approvals")]
    public async Task<ActionResult<IReadOnlyCollection<ApprovalQueueItemDto>>> GetApprovals(
        [FromQuery] string? tab,
        [FromQuery] string? search,
        [FromQuery] string? status,
        [FromQuery] string? priority,
        [FromQuery] long? requestTypeId,
        [FromQuery(Name = "request_type_id")] long? requestTypeIdSnake,
        [FromQuery] long? departmentId,
        [FromQuery(Name = "department_id")] long? departmentIdSnake,
        [FromQuery] long? specializedSectionId,
        [FromQuery(Name = "specialized_section_id")] long? specializedSectionIdSnake,
        [FromQuery] string? slaStatus,
        [FromQuery(Name = "sla_status")] string? slaStatusSnake,
        [FromQuery] DateTimeOffset? dateFrom,
        [FromQuery(Name = "date_from")] DateTimeOffset? dateFromSnake,
        [FromQuery] DateTimeOffset? dateTo,
        [FromQuery(Name = "date_to")] DateTimeOffset? dateToSnake,
        CancellationToken cancellationToken)
    {
        var actor = await LoadActorAsync(cancellationToken);
        var canManage = await CanManageRequestsAsync(actor.Id, cancellationToken);
        var query = ApprovalBaseQuery().AsNoTracking();

        if (!canManage)
        {
            query = ApplyApprovalScope(query, actor);
        }

        if (!string.IsNullOrWhiteSpace(status))
        {
            query = query.Where(x => x.Status == status);
        }

        if (!string.IsNullOrWhiteSpace(priority))
        {
            query = query.Where(x => x.Priority == priority);
        }

        var effectiveRequestTypeId = requestTypeId ?? requestTypeIdSnake;
        if (effectiveRequestTypeId.HasValue)
        {
            query = query.Where(x => x.RequestTypeId == effectiveRequestTypeId.Value);
        }

        var effectiveDepartmentId = departmentId ?? departmentIdSnake;
        if (effectiveDepartmentId.HasValue)
        {
            query = query.Where(x => x.DepartmentId == effectiveDepartmentId.Value);
        }

        var effectiveSpecializedSectionId = specializedSectionId ?? specializedSectionIdSnake;
        if (effectiveSpecializedSectionId.HasValue)
        {
            query = query.Where(x => x.SpecializedSectionId == effectiveSpecializedSectionId.Value);
        }

        var effectiveDateFrom = dateFrom ?? dateFromSnake;
        if (effectiveDateFrom.HasValue)
        {
            query = query.Where(x => x.CreatedAt >= effectiveDateFrom.Value);
        }

        var effectiveDateTo = dateTo ?? dateToSnake;
        if (effectiveDateTo.HasValue)
        {
            query = query.Where(x => x.CreatedAt <= effectiveDateTo.Value);
        }

        if (!string.IsNullOrWhiteSpace(search))
        {
            var value = search.Trim().ToLowerInvariant();
            query = query.Where(x =>
                x.RequestNumber.ToLower().Contains(value) ||
                x.Title.ToLower().Contains(value) ||
                x.Requester!.NameAr.ToLower().Contains(value));
        }

        var rows = await query
            .OrderByDescending(x => x.CreatedAt)
            .Take(500)
            .ToListAsync(cancellationToken);

        var now = DateTimeOffset.UtcNow;
        var normalizedTab = NormalizeTab(tab);
        if (normalizedTab is "completed")
        {
            var today = now.Date;
            rows = rows
                .Where(x => x.WorkflowSnapshots.Any(s =>
                    s.ActionByUserId == actor.Id &&
                    s.ActionAt.HasValue &&
                    s.ActionAt.Value.UtcDateTime.Date == today))
                .ToList();
        }

        var includeHistorical = IsHistoricalTab(tab);
        var items = rows
            .Select(x => MapQueueItemOrNull(x, actor, canManage, now, includeHistorical))
            .Where(x => x is not null)
            .Select(x => x!)
            .ToList();

        items = FilterByTab(items, tab, actor).ToList();
        var effectiveSlaStatus = slaStatus ?? slaStatusSnake;
        if (effectiveSlaStatus == "overdue")
        {
            items = items.Where(x => x.IsOverdue).ToList();
        }

        return Ok(items);
    }

    [HttpGet("approvals/{requestId:long}")]
    public async Task<ActionResult<ApprovalDetailsDto>> GetApprovalDetails(long requestId, CancellationToken cancellationToken)
    {
        await EnsureCanViewApprovalRequestAsync(requestId, cancellationToken);
        var request = await LoadDetailsAsync(requestId, cancellationToken);
        await auditService.LogAsync("approval_viewed", "request", requestId.ToString(), cancellationToken: cancellationToken);
        return Ok(MapDetails(request));
    }

    [HttpPost("requests/{requestId:long}/approval")]
    public async Task<ActionResult<ApprovalDetailsDto>> ActOnApproval(long requestId, ApprovalActionRequest actionRequest, CancellationToken cancellationToken)
    {
        var actor = await LoadActorAsync(cancellationToken);
        var canManage = await CanManageRequestsAsync(actor.Id, cancellationToken);
        var request = await LoadMutableRequestAsync(requestId, cancellationToken);
        var step = request.WorkflowSnapshots.OrderBy(x => x.SortOrder).FirstOrDefault(x => x.Status == "pending")
                   ?? throw new ApiException("لا توجد مرحلة موافقة حالية لهذا الطلب");

        if (!canManage && !CanActOnStep(request, step, actor))
        {
            throw new ApiException("لا تملك صلاحية تنفيذ هذا الإجراء على المرحلة الحالية", StatusCodes.Status403Forbidden);
        }

        var action = (actionRequest.Action ?? string.Empty).Trim().ToLowerInvariant();
        if (string.IsNullOrWhiteSpace(action))
        {
            throw new ApiException("الإجراء مطلوب");
        }

        var oldStatus = request.Status;
        var previousStepStatus = step.Status;
        var now = DateTimeOffset.UtcNow;

        var comments = actionRequest.Comments ?? actionRequest.Note;
        switch (action)
        {
            case "approve":
            case "approved":
                ApproveStep(request, step, actor.Id, comments, now);
                break;
            case "reject":
            case "rejected":
                RejectRequest(request, step, actor.Id, comments, now);
                break;
            case "return_for_edit":
            case "returned_for_edit":
                ReturnForEdit(request, step, actor.Id, comments, now);
                break;
            case "execute":
            case "executed":
                ExecuteStep(request, step, actor.Id, actionRequest.ExecutionNotes ?? comments, now);
                break;
            case "close":
            case "closed":
                CloseRequest(request, step, actor.Id, comments, now, canManage);
                break;
            default:
                throw new ApiException("الإجراء غير معروف");
        }

        db.RequestStatusHistory.Add(new RequestStatusHistory
        {
            RequestId = request.Id,
            OldStatus = oldStatus,
            NewStatus = request.Status,
            ChangedByUserId = actor.Id,
            ChangedAt = now,
            Comment = comments ?? actionRequest.ExecutionNotes
        });

        await db.SaveChangesAsync(cancellationToken);
        await auditService.LogAsync(
            AuditActionFor(action),
            "request",
            request.Id.ToString(),
            actor.Id,
            oldValue: new { RequestStatus = oldStatus, StepStatus = previousStepStatus, StepId = step.Id },
            newValue: new { RequestStatus = request.Status, StepStatus = step.Status, StepId = step.Id },
            metadata: new { Comments = comments, actionRequest.ExecutionNotes },
            cancellationToken: cancellationToken);

        var updated = await LoadDetailsAsync(requestId, cancellationToken);
        return Ok(MapDetails(updated));
    }

    [HttpGet("requests/{requestId:long}/approval-history")]
    public async Task<ActionResult<IReadOnlyCollection<ApprovalHistoryDto>>> GetApprovalHistory(long requestId, CancellationToken cancellationToken)
    {
        await EnsureCanViewApprovalRequestAsync(requestId, cancellationToken);
        var steps = await db.RequestWorkflowSnapshots
            .Include(x => x.ActionByUser)
            .AsNoTracking()
            .Where(x => x.RequestId == requestId)
            .OrderBy(x => x.SortOrder)
            .ToListAsync(cancellationToken);
        return Ok(steps.Select(MapApprovalHistory).ToList());
    }

    [HttpGet("requests/{requestId:long}/workflow-snapshot")]
    public async Task<ActionResult<IReadOnlyCollection<RequestWorkflowSnapshotDto>>> GetWorkflowSnapshot(long requestId, CancellationToken cancellationToken)
    {
        await EnsureCanViewApprovalRequestAsync(requestId, cancellationToken);
        var steps = await db.RequestWorkflowSnapshots
            .Include(x => x.ApproverRole)
            .Include(x => x.ApproverUser)
            .Include(x => x.TargetDepartment)
            .Include(x => x.ActionByUser)
            .AsNoTracking()
            .Where(x => x.RequestId == requestId)
            .OrderBy(x => x.SortOrder)
            .ToListAsync(cancellationToken);
        return Ok(steps.Select(MapWorkflowSnapshot).ToList());
    }

    private void ApproveStep(RequestEntity request, RequestWorkflowSnapshot step, long actorId, string? comments, DateTimeOffset now)
    {
        if (!step.CanApprove)
        {
            throw new ApiException("هذه المرحلة لا تسمح بالموافقة");
        }

        CompleteStep(step, "approved", actorId, comments, now);
        MoveToNextStepOrFinish(request, step, now, "approved");
        MarkFirstResponseIfNeeded(request, now);
    }

    private static void RejectRequest(RequestEntity request, RequestWorkflowSnapshot step, long actorId, string? comments, DateTimeOffset now)
    {
        if (!step.CanReject)
        {
            throw new ApiException("هذه المرحلة لا تسمح بالرفض");
        }

        if (string.IsNullOrWhiteSpace(comments))
        {
            throw new ApiException("سبب الرفض مطلوب");
        }

        CompleteStep(step, "rejected", actorId, comments, now);
        request.Status = "rejected";
        request.ClosedAt = now;
        foreach (var waiting in request.WorkflowSnapshots.Where(x => x.Status == "waiting"))
        {
            waiting.Status = "cancelled";
        }
    }

    private static void ReturnForEdit(RequestEntity request, RequestWorkflowSnapshot step, long actorId, string? comments, DateTimeOffset now)
    {
        if (!step.CanReturnForEdit)
        {
            throw new ApiException("هذه المرحلة لا تسمح بإرجاع الطلب للتعديل");
        }

        if (string.IsNullOrWhiteSpace(comments))
        {
            throw new ApiException("سبب الإرجاع للتعديل مطلوب");
        }

        CompleteStep(step, "returned_for_edit", actorId, comments, now);
        request.Status = "returned_for_edit";
    }

    private void ExecuteStep(RequestEntity request, RequestWorkflowSnapshot step, long actorId, string? executionNotes, DateTimeOffset now)
    {
        if (!IsExecutionStep(step))
        {
            throw new ApiException("التنفيذ مسموح فقط في مرحلة تنفيذ الطلب");
        }

        if (string.IsNullOrWhiteSpace(executionNotes))
        {
            throw new ApiException("ملاحظات التنفيذ مطلوبة");
        }

        CompleteStep(step, "executed", actorId, executionNotes, now);
        db.RequestExecutionLogs.Add(new RequestExecutionLog
        {
            RequestId = request.Id,
            ExecutedByUserId = actorId,
            ExecutionNotes = executionNotes,
            Status = "completed",
            ExecutedAt = now
        });
        MoveToNextStepOrFinish(request, step, now, "completed");
    }

    private static void CloseRequest(RequestEntity request, RequestWorkflowSnapshot step, long actorId, string? comments, DateTimeOffset now, bool canManage)
    {
        if (!canManage && step.StepType != "close_request")
        {
            throw new ApiException("إغلاق الطلب غير مسموح في هذه المرحلة");
        }

        CompleteStep(step, "closed", actorId, comments, now);
        request.Status = "closed";
        request.ClosedAt = now;
    }

    private static void CompleteStep(RequestWorkflowSnapshot step, string status, long actorId, string? comments, DateTimeOffset now)
    {
        if (step.Status != "pending")
        {
            throw new ApiException("تمت معالجة هذه المرحلة مسبقاً");
        }

        step.Status = status;
        step.ActionByUserId = actorId;
        step.ActionAt = now;
        step.Comments = comments;
    }

    private static void MoveToNextStepOrFinish(RequestEntity request, RequestWorkflowSnapshot completedStep, DateTimeOffset now, string finalStatus)
    {
        var next = request.WorkflowSnapshots
            .Where(x => x.Status == "waiting" && x.SortOrder > completedStep.SortOrder)
            .OrderBy(x => x.SortOrder)
            .FirstOrDefault();

        if (next is null)
        {
            request.Status = finalStatus;
            if (finalStatus is "completed" or "closed" or "rejected")
            {
                request.ClosedAt = now;
            }
            return;
        }

        next.Status = "pending";
        next.PendingAt = now;
        request.Status = IsExecutionStep(next) ? "in_progress" : "pending_approval";
    }

    private static bool IsExecutionStep(RequestWorkflowSnapshot step)
    {
        return ExecutionStepTypes.Contains(step.StepType);
    }

    private void MarkFirstResponseIfNeeded(RequestEntity request, DateTimeOffset now)
    {
        if (request.SlaTracking is not null && request.SlaTracking.FirstResponseAt is null)
        {
            request.SlaTracking.FirstResponseAt = now;
        }
    }

    private async Task<User> LoadActorAsync(CancellationToken cancellationToken)
    {
        var actorId = currentUser.UserId ?? throw new ApiException("غير مصرح", StatusCodes.Status401Unauthorized);
        return await db.Users
            .Include(x => x.Role)
            .Include(x => x.Department)
            .Include(x => x.SpecializedSection)
            .AsNoTracking()
            .FirstOrDefaultAsync(x => x.Id == actorId && x.IsActive && !x.IsLocked, cancellationToken)
            ?? throw new ApiException("المستخدم غير صالح", StatusCodes.Status403Forbidden);
    }

    private async Task<bool> CanManageRequestsAsync(long actorId, CancellationToken cancellationToken)
    {
        return await permissionService.HasPermissionAsync(actorId, "requests.manage", cancellationToken);
    }

    private IQueryable<RequestEntity> ApprovalBaseQuery()
    {
        return db.Requests
            .Include(x => x.RequestType)
            .Include(x => x.RequestTypeVersion)
            .Include(x => x.Requester).ThenInclude(x => x!.DirectManager)
            .Include(x => x.Department).ThenInclude(x => x!.ManagerUser)
            .Include(x => x.SpecializedSection).ThenInclude(x => x!.ManagerUser)
            .Include(x => x.SpecializedSection).ThenInclude(x => x!.Department).ThenInclude(x => x!.ManagerUser)
            .Include(x => x.SpecializedSection).ThenInclude(x => x!.DefaultAssigneeUser)
            .Include(x => x.AssignedTo)
            .Include(x => x.Attachments)
            .Include(x => x.WorkflowSnapshots).ThenInclude(x => x.ApproverRole)
            .Include(x => x.WorkflowSnapshots).ThenInclude(x => x.ApproverUser)
            .Include(x => x.WorkflowSnapshots).ThenInclude(x => x.TargetDepartment).ThenInclude(x => x!.ManagerUser)
            .Include(x => x.WorkflowSnapshots).ThenInclude(x => x.ActionByUser);
    }

    private async Task<RequestEntity> LoadDetailsAsync(long requestId, CancellationToken cancellationToken)
    {
        return await ApprovalBaseQuery()
            .Include(x => x.FieldSnapshots)
            .Include(x => x.StatusHistory).ThenInclude(x => x.ChangedByUser)
            .Include(x => x.SlaTracking)
            .AsNoTracking()
            .FirstOrDefaultAsync(x => x.Id == requestId, cancellationToken)
            ?? throw new ApiException("الطلب غير موجود", StatusCodes.Status404NotFound);
    }

    private async Task<RequestEntity> LoadMutableRequestAsync(long requestId, CancellationToken cancellationToken)
    {
        return await db.Requests
            .Include(x => x.Requester)
            .Include(x => x.Department).ThenInclude(x => x!.ManagerUser)
            .Include(x => x.SpecializedSection).ThenInclude(x => x!.ManagerUser)
            .Include(x => x.SpecializedSection).ThenInclude(x => x!.Department).ThenInclude(x => x!.ManagerUser)
            .Include(x => x.SpecializedSection).ThenInclude(x => x!.DefaultAssigneeUser)
            .Include(x => x.AssignedTo)
            .Include(x => x.WorkflowSnapshots).ThenInclude(x => x.ApproverRole)
            .Include(x => x.WorkflowSnapshots).ThenInclude(x => x.ApproverUser)
            .Include(x => x.WorkflowSnapshots).ThenInclude(x => x.TargetDepartment).ThenInclude(x => x!.ManagerUser)
            .Include(x => x.SlaTracking)
            .FirstOrDefaultAsync(x => x.Id == requestId, cancellationToken)
            ?? throw new ApiException("الطلب غير موجود", StatusCodes.Status404NotFound);
    }

    private async Task EnsureCanViewApprovalRequestAsync(long requestId, CancellationToken cancellationToken)
    {
        var actor = await LoadActorAsync(cancellationToken);
        var canManage = await CanManageRequestsAsync(actor.Id, cancellationToken);
        var request = await ApprovalBaseQuery().AsNoTracking().FirstOrDefaultAsync(x => x.Id == requestId, cancellationToken)
                      ?? throw new ApiException("الطلب غير موجود", StatusCodes.Status404NotFound);

        if (!canManage && !CanSeeRequest(request, actor))
        {
            throw new ApiException("لا تملك صلاحية عرض هذا الطلب", StatusCodes.Status403Forbidden);
        }
    }

    private static RequestWorkflowSnapshot? CurrentPendingStep(RequestEntity request)
    {
        return request.WorkflowSnapshots.OrderBy(x => x.SortOrder).FirstOrDefault(x => x.Status == "pending");
    }

    private static bool CanSeeRequest(RequestEntity request, User actor)
    {
        return request.RequesterId == actor.Id ||
               request.AssignedToId == actor.Id ||
               request.WorkflowSnapshots.Any(x => x.ApproverUserId == actor.Id || x.ApproverRoleId == actor.RoleId || x.ActionByUserId == actor.Id) ||
               request.WorkflowSnapshots.Any(x => x.TargetDepartment != null && x.TargetDepartment.ManagerUserId == actor.Id) ||
               request.Requester?.DirectManagerId == actor.Id ||
               request.Department?.ManagerUserId == actor.Id ||
               request.SpecializedSection?.ManagerUserId == actor.Id ||
               request.SpecializedSection?.Department?.ManagerUserId == actor.Id ||
               request.SpecializedSection?.DefaultAssigneeUserId == actor.Id ||
               (actor.SpecializedSectionId.HasValue && request.SpecializedSectionId == actor.SpecializedSectionId);
    }

    private static bool CanActOnStep(RequestEntity request, RequestWorkflowSnapshot step, User actor)
    {
        if (step.Status != "pending")
        {
            return false;
        }

        if (step.ApproverUserId == actor.Id || step.ApproverRoleId == actor.RoleId)
        {
            return true;
        }

        return step.StepType switch
        {
            "direct_manager" => request.Requester?.DirectManagerId == actor.Id,
            "department_manager" => request.SpecializedSection?.Department?.ManagerUserId == actor.Id || request.SpecializedSection?.ManagerUserId == actor.Id || request.Department?.ManagerUserId == actor.Id,
            "specific_department_manager" => step.TargetDepartment?.ManagerUserId == actor.Id,
            "specialized_section" => request.SpecializedSection?.ManagerUserId == actor.Id || request.SpecializedSection?.DefaultAssigneeUserId == actor.Id || request.AssignedToId == actor.Id,
            "department_specialist" or "implementation_engineer" or "execution" or "execute_request" => request.AssignedToId == actor.Id || request.SpecializedSection?.DefaultAssigneeUserId == actor.Id || (actor.SpecializedSectionId.HasValue && request.SpecializedSectionId == actor.SpecializedSectionId),
            "information_security" or "it_manager" or "executive_management" => actor.Role?.Code == step.StepType,
            "specific_role" => step.ApproverRoleId == actor.RoleId,
            "specific_user" => step.ApproverUserId == actor.Id,
            "close_request" => request.AssignedToId == actor.Id,
            _ => false
        };
    }

    private static ApprovalQueueItemDto? MapQueueItemOrNull(RequestEntity request, User actor, bool canManage, DateTimeOffset now, bool includeHistorical)
    {
        var step = CurrentPendingStep(request) ?? (includeHistorical ? LatestWorkflowStep(request) : null);
        if (step is null)
        {
            return null;
        }

        var canAct = canManage || CanActOnStep(request, step, actor);
        if (!canAct && request.RequesterId != actor.Id && !includeHistorical)
        {
            return null;
        }

        var waitingHours = step.PendingAt.HasValue ? Math.Max(0, (int)Math.Floor((now - step.PendingAt.Value).TotalHours)) : 0;
        return new ApprovalQueueItemDto(
            request.Id,
            request.RequestNumber,
            request.Title,
            request.RequestTypeId,
            request.RequestType?.NameAr,
            request.RequesterId,
            request.Requester?.NameAr,
            request.DepartmentId,
            request.Department?.NameAr,
            request.SpecializedSectionId,
            request.SpecializedSection?.NameAr,
            request.SpecializedSection?.Department?.NameAr,
            request.Status,
            request.Priority,
            request.CreatedAt,
            request.SubmittedAt,
            request.SlaResolutionDueAt,
            step.Id,
            step.StepNameAr,
            step.StepType,
            step.Status,
            step.PendingAt,
            step.SlaDueAt,
            waitingHours,
            step.SlaDueAt.HasValue && step.SlaDueAt.Value < now,
            step.Status == "pending" && canAct && step.CanApprove && !IsExecutionStep(step),
            step.Status == "pending" && canAct && step.CanReject,
            step.Status == "pending" && canAct && step.CanReturnForEdit,
            step.Status == "pending" && canAct && IsExecutionStep(step),
            step.Status == "pending" && canAct && step.StepType == "close_request");
    }

    private static IEnumerable<ApprovalQueueItemDto> FilterByTab(IEnumerable<ApprovalQueueItemDto> items, string? tab, User actor)
    {
        return NormalizeTab(tab) switch
        {
            "tracking" or "my_requests" => items.Where(x => x.RequesterId == actor.Id),
            "execution" or "pending_execution" => items.Where(x => x.CanExecute),
            "returned" or "returned_for_edit" => items.Where(x => x.Status == "returned_for_edit"),
            "overdue" => items.Where(x => x.IsOverdue),
            "completed" => items,
            "history" => items,
            _ => items.Where(x => x.CanApprove || x.CanReject || x.CanReturnForEdit || x.CanExecute || x.CanClose)
        };
    }

    private static bool IsHistoricalTab(string? tab)
    {
        return NormalizeTab(tab) is "tracking" or "my_requests" or "returned" or "returned_for_edit" or "completed" or "history";
    }

    private static string NormalizeTab(string? tab)
    {
        return (tab ?? string.Empty).Trim().ToLowerInvariant();
    }

    private static IQueryable<RequestEntity> ApplyApprovalScope(IQueryable<RequestEntity> query, User actor)
    {
        return query.Where(x =>
            x.RequesterId == actor.Id ||
            x.AssignedToId == actor.Id ||
            x.WorkflowSnapshots.Any(s => s.ApproverUserId == actor.Id || s.ApproverRoleId == actor.RoleId || s.ActionByUserId == actor.Id) ||
            x.WorkflowSnapshots.Any(s => s.TargetDepartment != null && s.TargetDepartment.ManagerUserId == actor.Id) ||
            x.Requester!.DirectManagerId == actor.Id ||
            x.Department!.ManagerUserId == actor.Id ||
            x.SpecializedSection!.ManagerUserId == actor.Id ||
            x.SpecializedSection!.Department!.ManagerUserId == actor.Id ||
            x.SpecializedSection!.DefaultAssigneeUserId == actor.Id ||
            (actor.SpecializedSectionId.HasValue && x.SpecializedSectionId == actor.SpecializedSectionId));
    }

    private static RequestWorkflowSnapshot? LatestWorkflowStep(RequestEntity request)
    {
        return request.WorkflowSnapshots
            .Where(x => x.Status != "waiting")
            .OrderByDescending(x => x.ActionAt ?? x.PendingAt ?? DateTimeOffset.MinValue)
            .ThenByDescending(x => x.SortOrder)
            .FirstOrDefault();
    }

    private static ApprovalDetailsDto MapDetails(RequestEntity request)
    {
        var workflow = request.WorkflowSnapshots.OrderBy(x => x.SortOrder).Select(MapWorkflowSnapshot).ToList();
        return new ApprovalDetailsDto(
            MapRequest(request),
            workflow.FirstOrDefault(x => x.Status == "pending"),
            request.FieldSnapshots.OrderBy(x => x.SortOrder).Select(MapFieldSnapshot).ToList(),
            workflow,
            request.Attachments.Where(x => !x.IsDeleted).OrderByDescending(x => x.UploadedAt).Select(MapAttachment).ToList(),
            request.StatusHistory.OrderBy(x => x.ChangedAt).Select(MapStatusHistory).ToList(),
            request.WorkflowSnapshots.OrderBy(x => x.SortOrder).Select(MapApprovalHistory).ToList(),
            request.SlaTracking is null ? null : new RequestSlaTrackingDto(request.SlaTracking.ResponseDueAt, request.SlaTracking.ResolutionDueAt, request.SlaTracking.FirstResponseAt, request.SlaTracking.ResolvedAt, request.SlaTracking.IsBreached, request.SlaTracking.BreachReason));
    }

    private static RequestDto MapRequest(RequestEntity entity)
    {
        var totalSteps = entity.WorkflowSnapshots.Count;
        var doneSteps = entity.WorkflowSnapshots.Count(x => x.Status is "approved" or "executed" or "closed");
        var progress = totalSteps == 0 ? 0 : (int)Math.Round(doneSteps * 100m / totalSteps);
        return new RequestDto(
            entity.Id,
            entity.RequestNumber,
            entity.Title,
            entity.RequestTypeId,
            entity.RequestType?.NameAr,
            entity.RequestTypeVersionId,
            entity.RequestTypeVersion?.VersionNumber,
            entity.RequesterId,
            entity.Requester?.NameAr,
            entity.DepartmentId,
            entity.Department?.NameAr,
            entity.SpecializedSectionId,
            entity.SpecializedSection?.NameAr,
            entity.SpecializedSection?.Department?.NameAr,
            entity.AssignedToId,
            entity.AssignedTo?.NameAr,
            entity.Status,
            entity.Priority,
            entity.SlaResponseDueAt,
            entity.SlaResolutionDueAt,
            entity.SubmittedAt,
            entity.ClosedAt,
            entity.CreatedAt,
            entity.UpdatedAt,
            entity.Attachments.Count(x => !x.IsDeleted),
            progress);
    }

    private static RequestFieldSnapshotDto MapFieldSnapshot(RequestFieldSnapshot item)
    {
        return new RequestFieldSnapshotDto(item.Id, item.FieldName, item.LabelAr, item.LabelEn, item.FieldType, item.ValueText, item.ValueNumber, item.ValueDate, item.ValueJson, item.SortOrder, item.SectionName);
    }

    private static RequestWorkflowSnapshotDto MapWorkflowSnapshot(RequestWorkflowSnapshot item)
    {
        return new RequestWorkflowSnapshotDto(item.Id, item.StepNameAr, item.StepNameEn, item.StepType, item.ApproverRoleId, item.ApproverRole?.NameAr, item.ApproverUserId, item.ApproverUser?.NameAr, item.TargetDepartmentId, item.TargetDepartment?.NameAr, item.Status, item.ActionByUserId, item.ActionByUser?.NameAr, item.ActionAt, item.PendingAt, item.Comments, item.SlaDueAt, item.SortOrder, item.CanApprove, item.CanReject, item.CanReturnForEdit, item.CanDelegate);
    }

    private static RequestAttachmentDto MapAttachment(RequestAttachment item)
    {
        return new RequestAttachmentDto(item.Id, item.FileName, item.ContentType, item.FileSize, item.Checksum, item.UploadedByUserId, item.UploadedByUser?.NameAr, item.UploadedAt);
    }

    private static RequestStatusHistoryDto MapStatusHistory(RequestStatusHistory item)
    {
        return new RequestStatusHistoryDto(item.Id, item.OldStatus, item.NewStatus, item.ChangedByUserId, item.ChangedByUser?.NameAr, item.ChangedAt, item.Comment);
    }

    private static ApprovalHistoryDto MapApprovalHistory(RequestWorkflowSnapshot item)
    {
        return new ApprovalHistoryDto(
            item.Id,
            item.StepNameAr,
            item.StepType,
            item.Status,
            item.ActionByUserId,
            item.ActionByUser?.NameAr,
            item.ActionAt,
            item.Comments,
            item.Status == "waiting" || item.Status == "pending" ? null : "pending",
            item.Status);
    }

    private static string AuditActionFor(string action)
    {
        return action switch
        {
            "approve" or "approved" => "request_approved",
            "reject" or "rejected" => "request_rejected",
            "returned_for_edit" => "request_returned_for_edit",
            "return_for_edit" => "request_returned_for_edit",
            "execute" or "executed" => "request_executed",
            "close" or "closed" => "request_closed",
            _ => "approval_action"
        };
    }
}
