using System.Net;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Qib.ServicePortal.Api.Application.DTOs;
using Qib.ServicePortal.Api.Application.Interfaces;
using Qib.ServicePortal.Api.Common.Exceptions;
using Qib.ServicePortal.Api.Domain.Entities;
using Qib.ServicePortal.Api.Infrastructure.Data;
using Qib.ServicePortal.Api.Infrastructure.Pdf;
using RequestEntity = Qib.ServicePortal.Api.Domain.Entities.Request;

namespace Qib.ServicePortal.Api.Controllers;

[ApiController]
[Route("api/dotnet/v1/reports")]
[Authorize(Policy = "Permission:reports.view")]
public class ReportsController(
    ServicePortalDbContext db,
    ICurrentUserService currentUser,
    IPermissionService permissionService,
    IAuditService auditService) : ControllerBase
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    [HttpGet("summary")]
    public async Task<IActionResult> Summary([FromQuery] ReportFilters filters, CancellationToken cancellationToken)
    {
        filters = NormalizeFiltersFromQuery(filters);
        ValidateDateRange(filters);
        var actor = await LoadActorAsync(cancellationToken);
        var requestQuery = ApplyRequestFilters(ApplyRequestScope(BaseRequestQuery().AsNoTracking(), actor, await CanSeeAllRequestsAsync(actor.Id, cancellationToken)), filters);
        var messageQuery = ApplyMessageFilters(ApplyMessageScope(BaseMessageQuery().AsNoTracking(), actor, await CanSeeAllMessagesAsync(actor.Id, cancellationToken)), filters);

        var requests = await requestQuery.ToListAsync(cancellationToken);
        var messagesCount = await messageQuery.CountAsync(cancellationToken);
        var closedStatuses = new HashSet<string>(StringComparer.OrdinalIgnoreCase) { "completed", "closed" };
        var openRequests = requests.Count(x => !closedStatuses.Contains(x.Status) && x.Status != "cancelled" && x.Status != "rejected");
        var breached = requests.Count(IsSlaBreached);
        var completed = requests.Count(x => closedStatuses.Contains(x.Status));
        var slaCompliance = requests.Count == 0 ? 100 : Math.Round((decimal)(requests.Count - breached) * 100 / requests.Count, 2);
        var averageCompletionHours = requests
            .Where(x => x.ClosedAt.HasValue)
            .Select(x => (decimal)(x.ClosedAt!.Value - x.CreatedAt).TotalHours)
            .DefaultIfEmpty(0)
            .Average();

        var lastExport = await db.ReportExportLogs.AsNoTracking().OrderByDescending(x => x.ExportedAt).Select(x => x.ExportedAt).FirstOrDefaultAsync(cancellationToken);
        var summary = new Dictionary<string, object?>
        {
            ["total_requests"] = requests.Count,
            ["completed_requests"] = completed,
            ["open_requests"] = openRequests,
            ["delayed_requests"] = breached,
            ["sla_compliance"] = slaCompliance,
            ["average_completion_hours"] = Math.Round(averageCompletionHours, 2),
            ["total_messages"] = messagesCount,
            ["last_exported_report"] = lastExport == default ? null : lastExport
        };

        var charts = new Dictionary<string, IReadOnlyCollection<object>>
        {
            ["requests_by_status"] = BuildChart(requests.GroupBy(x => x.Status).Select(x => (x.Key, StatusLabel(x.Key), (decimal)x.Count()))),
            ["requests_by_month"] = BuildChart(requests.GroupBy(x => x.CreatedAt.ToString("yyyy-MM")).Select(x => (x.Key, x.Key, (decimal)x.Count())).OrderBy(x => x.Item1)),
            ["requests_by_department"] = BuildChart(requests.GroupBy(x => x.Department?.NameAr ?? "غير محدد").Select(x => (x.Key, x.Key, (decimal)x.Count()))),
            ["sla_status"] = BuildChart([
                ("met", "ضمن الوقت", (decimal)(requests.Count - breached)),
                ("breached", "متأخرة", (decimal)breached)
            ])
        };

        return Ok(BuildReportResponse(summary, charts, [], 0, 1, 15));
    }

    [HttpGet("requests")]
    public async Task<IActionResult> Requests([FromQuery] ReportFilters filters, CancellationToken cancellationToken)
    {
        filters = NormalizeFiltersFromQuery(filters);
        ValidateDateRange(filters);
        var actor = await LoadActorAsync(cancellationToken);
        var (page, pageSize) = GetPagination();
        var query = ApplyRequestFilters(ApplyRequestScope(BaseRequestQuery().AsNoTracking(), actor, await CanSeeAllRequestsAsync(actor.Id, cancellationToken)), filters);
        var total = await query.CountAsync(cancellationToken);
        var requests = await query.OrderByDescending(x => x.CreatedAt).Skip((page - 1) * pageSize).Take(pageSize).ToListAsync(cancellationToken);
        var chartSample = await query.OrderByDescending(x => x.CreatedAt).Take(1000).ToListAsync(cancellationToken);
        var rows = requests.Select(MapRequestReportRowObject).ToList();

        var summary = new Dictionary<string, object?>
        {
            ["total_requests"] = total,
            ["completed_requests"] = chartSample.Count(x => x.Status is "completed" or "closed"),
            ["open_requests"] = chartSample.Count(x => x.Status is not ("completed" or "closed" or "cancelled" or "rejected")),
            ["delayed_requests"] = chartSample.Count(IsSlaBreached)
        };
        var charts = new Dictionary<string, IReadOnlyCollection<object>>
        {
            ["by_status"] = BuildChart(chartSample.GroupBy(x => x.Status).Select(x => (x.Key, StatusLabel(x.Key), (decimal)x.Count()))),
            ["by_type"] = BuildChart(chartSample.GroupBy(x => x.RequestType?.NameAr ?? "غير محدد").Select(x => (x.Key, x.Key, (decimal)x.Count()))),
            ["requests_by_department"] = BuildChart(chartSample.GroupBy(x => x.Department?.NameAr ?? "غير محدد").Select(x => (x.Key, x.Key, (decimal)x.Count()))),
            ["requests_by_priority"] = BuildChart(chartSample.GroupBy(x => x.Priority).Select(x => (x.Key, PriorityLabel(x.Key), (decimal)x.Count())))
        };

        return Ok(BuildReportResponse(summary, charts, rows, total, page, pageSize));
    }

    [HttpGet("approvals")]
    public async Task<IActionResult> Approvals([FromQuery] ReportFilters filters, CancellationToken cancellationToken)
    {
        filters = NormalizeFiltersFromQuery(filters);
        ValidateDateRange(filters);
        var actor = await LoadActorAsync(cancellationToken);
        var (page, pageSize) = GetPagination();
        var requestIds = await ApplyRequestFilters(ApplyRequestScope(db.Requests.AsNoTracking(), actor, await CanSeeAllRequestsAsync(actor.Id, cancellationToken)), filters)
            .Select(x => x.Id)
            .ToListAsync(cancellationToken);

        var query = db.RequestWorkflowSnapshots
            .Include(x => x.Request).ThenInclude(x => x!.RequestType)
            .Include(x => x.ApproverUser)
            .Include(x => x.ActionByUser)
            .Where(x => requestIds.Contains(x.RequestId))
            .AsNoTracking();

        if (!string.IsNullOrWhiteSpace(filters.ApprovalStep))
        {
            var step = filters.ApprovalStep.Trim();
            query = query.Where(x => x.StepNameAr.Contains(step) || x.StepType.Contains(step));
        }

        var total = await query.CountAsync(cancellationToken);
        var allSteps = await query.OrderByDescending(x => x.PendingAt ?? x.ActionAt ?? DateTimeOffset.MinValue).Take(1000).ToListAsync(cancellationToken);
        var steps = allSteps.Skip((page - 1) * pageSize).Take(pageSize).ToList();

        var now = DateTimeOffset.UtcNow;
        var actedSteps = allSteps.Where(x => x.ActionAt.HasValue && x.PendingAt.HasValue).ToList();
        var averageHours = actedSteps.Count == 0 ? 0 : actedSteps.Average(x => (x.ActionAt!.Value - x.PendingAt!.Value).TotalHours);
        var rows = steps.Select(x => new Dictionary<string, object?>
        {
            ["id"] = x.Id,
            ["request_number"] = x.Request?.RequestNumber ?? "-",
            ["request_type"] = x.Request?.RequestType?.NameAr ?? "-",
            ["step_name"] = x.StepNameAr,
            ["approver"] = x.ActionByUser?.NameAr ?? x.ApproverUser?.NameAr ?? "-",
            ["status"] = StatusLabel(x.Status),
            ["wait_hours"] = x.PendingAt.HasValue ? Math.Max(0, (int)(now - x.PendingAt.Value).TotalHours) : 0,
            ["action_at"] = x.ActionAt,
            ["note"] = x.Comments
        }).Cast<object>().ToList();

        var summary = new Dictionary<string, object?>
        {
            ["pending_approvals"] = allSteps.Count(x => x.Status == "pending"),
            ["approved_count"] = allSteps.Count(x => x.Status == "approved" || x.Status == "completed"),
            ["rejected_count"] = allSteps.Count(x => x.Status == "rejected"),
            ["returned_for_edit_count"] = allSteps.Count(x => x.Status == "returned_for_edit"),
            ["average_completion_hours"] = Math.Round((decimal)averageHours, 2)
        };
        var charts = new Dictionary<string, IReadOnlyCollection<object>>
        {
            ["by_status"] = BuildChart(allSteps.GroupBy(x => x.Status).Select(x => (x.Key, StatusLabel(x.Key), (decimal)x.Count()))),
            ["by_type"] = BuildChart(allSteps.GroupBy(x => x.StepNameAr).Select(x => (x.Key, x.Key, (decimal)x.Count())))
        };

        return Ok(BuildReportResponse(summary, charts, rows, total, page, pageSize));
    }

    [HttpGet("sla")]
    public async Task<IActionResult> Sla([FromQuery] ReportFilters filters, CancellationToken cancellationToken)
    {
        filters = NormalizeFiltersFromQuery(filters);
        ValidateDateRange(filters);
        var actor = await LoadActorAsync(cancellationToken);
        var (page, pageSize) = GetPagination();
        var allRequests = await ApplyRequestFilters(ApplyRequestScope(BaseRequestQuery().AsNoTracking(), actor, await CanSeeAllRequestsAsync(actor.Id, cancellationToken)), filters)
            .OrderByDescending(x => x.CreatedAt)
            .Take(1000)
            .ToListAsync(cancellationToken);

        var now = DateTimeOffset.UtcNow;
        var breached = allRequests.Where(IsSlaBreached).ToList();
        var closeToBreach = allRequests.Count(x => x.SlaResolutionDueAt.HasValue && x.SlaResolutionDueAt.Value > now && x.SlaResolutionDueAt.Value <= now.AddHours(8));
        var averageResponse = allRequests
            .Where(x => x.SlaTracking?.FirstResponseAt is not null && x.SubmittedAt is not null)
            .Select(x => (decimal)(x.SlaTracking!.FirstResponseAt!.Value - x.SubmittedAt!.Value).TotalHours)
            .DefaultIfEmpty(0)
            .Average();
        var averageResolution = allRequests
            .Where(x => x.SlaTracking?.ResolvedAt is not null && x.SubmittedAt is not null)
            .Select(x => (decimal)(x.SlaTracking!.ResolvedAt!.Value - x.SubmittedAt!.Value).TotalHours)
            .DefaultIfEmpty(0)
            .Average();

        var visibleBreached = breached.Skip((page - 1) * pageSize).Take(pageSize).ToList();
        var rows = visibleBreached.Select(x =>
        {
            var dueAt = x.SlaTracking?.ResolutionDueAt ?? x.SlaResolutionDueAt;
            return new Dictionary<string, object?>
            {
                ["id"] = x.Id,
                ["request_number"] = x.RequestNumber,
                ["request_type"] = x.RequestType?.NameAr ?? "-",
                ["status_label"] = StatusLabel(x.Status),
                ["department"] = x.Department?.NameAr ?? "-",
                ["specialized_section"] = x.SpecializedSection?.NameAr ?? "-",
                ["assigned_user"] = x.AssignedTo?.NameAr ?? "-",
                ["sla_due_at"] = dueAt,
                ["delay_hours"] = dueAt.HasValue ? Math.Max(0, (int)(now - dueAt.Value).TotalHours) : 0,
                ["delay_reason"] = x.SlaTracking?.BreachReason
            };
        }).Cast<object>().ToList();

        var summary = new Dictionary<string, object?>
        {
            ["sla_compliance"] = allRequests.Count == 0 ? 100 : Math.Round((decimal)(allRequests.Count - breached.Count) * 100 / allRequests.Count, 2),
            ["breached_requests"] = breached.Count,
            ["average_response_time"] = Math.Round(averageResponse, 2),
            ["average_resolution_hours"] = Math.Round(averageResolution, 2),
            ["requests_close_to_breach"] = closeToBreach,
            ["requests_breached_today"] = breached.Count(x => (x.SlaTracking?.ResolutionDueAt ?? x.SlaResolutionDueAt)?.Date == now.Date)
        };
        var charts = new Dictionary<string, IReadOnlyCollection<object>>
        {
            ["by_type"] = BuildChart(breached.GroupBy(x => x.RequestType?.NameAr ?? "غير محدد").Select(x => (x.Key, x.Key, (decimal)x.Count()))),
            ["requests_by_department"] = BuildChart(breached.GroupBy(x => x.Department?.NameAr ?? "غير محدد").Select(x => (x.Key, x.Key, (decimal)x.Count())))
        };

        return Ok(BuildReportResponse(summary, charts, rows, breached.Count, page, pageSize));
    }

    [HttpGet("messaging")]
    public async Task<IActionResult> Messaging([FromQuery] ReportFilters filters, CancellationToken cancellationToken)
    {
        filters = NormalizeFiltersFromQuery(filters);
        ValidateDateRange(filters);
        var actor = await LoadActorAsync(cancellationToken);
        var (page, pageSize) = GetPagination();
        var query = ApplyMessageFilters(ApplyMessageScope(BaseMessageQuery().AsNoTracking(), actor, await CanSeeAllMessagesAsync(actor.Id, cancellationToken)), filters);
        var total = await query.CountAsync(cancellationToken);
        var messages = await query
            .OrderByDescending(x => x.SentAt)
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .ToListAsync(cancellationToken);
        var chartSample = await query.OrderByDescending(x => x.SentAt).Take(1000).ToListAsync(cancellationToken);

        var rows = messages.Select(MapMessagingReportRowObject).ToList();
        var summary = new Dictionary<string, object?>
        {
            ["total_messages"] = total,
            ["official_messages"] = chartSample.Count(x => x.IsOfficial),
            ["internal_messages"] = chartSample.Count(x => !x.IsOfficial),
            ["unread_messages"] = chartSample.Count(x => x.Recipients.Any(r => !r.IsRead)),
            ["linked_to_requests"] = chartSample.Count(x => x.RelatedRequestId.HasValue)
        };
        var charts = new Dictionary<string, IReadOnlyCollection<object>>
        {
            ["by_type"] = BuildChart(chartSample.GroupBy(x => x.MessageType?.NameAr ?? "غير محدد").Select(x => (x.Key, x.Key, (decimal)x.Count()))),
            ["by_priority"] = BuildChart(chartSample.GroupBy(x => x.Priority).Select(x => (x.Key, PriorityLabel(x.Key), (decimal)x.Count())))
        };

        return Ok(BuildReportResponse(summary, charts, rows, total, page, pageSize));
    }

    [HttpGet("users-permissions")]
    public async Task<IActionResult> UsersPermissions([FromQuery] ReportFilters filters, CancellationToken cancellationToken)
    {
        filters = NormalizeFiltersFromQuery(filters);
        ValidateDateRange(filters);
        var actor = await LoadActorAsync(cancellationToken);
        var (page, pageSize) = GetPagination();
        var canManageUsers = await permissionService.HasPermissionAsync(actor.Id, "users.manage", cancellationToken);

        var query = db.Users
            .Include(x => x.Department)
            .Include(x => x.Role).ThenInclude(x => x!.RolePermissions).ThenInclude(x => x.Permission)
            .AsNoTracking();
        if (!canManageUsers)
        {
            query = query.Where(x => x.Id == actor.Id || x.DirectManagerId == actor.Id);
        }
        if (filters.DepartmentId.HasValue)
        {
            query = query.Where(x => x.DepartmentId == filters.DepartmentId.Value);
        }

        var total = await query.CountAsync(cancellationToken);
        var users = await query.OrderBy(x => x.NameAr).Skip((page - 1) * pageSize).Take(pageSize).ToListAsync(cancellationToken);
        var sample = await query.Take(1000).ToListAsync(cancellationToken);
        var dangerousModules = new HashSet<string>(StringComparer.OrdinalIgnoreCase) { "settings", "database", "updates", "ai", "audit" };
        var rows = users.Select(x =>
        {
            var high = x.Role?.RolePermissions.Any(rp => rp.IsAllowed && rp.Permission != null && dangerousModules.Contains(rp.Permission.Module)) == true;
            return new Dictionary<string, object?>
            {
                ["id"] = x.Id,
                ["name"] = x.NameAr,
                ["email"] = x.Email,
                ["department"] = x.Department?.NameAr ?? "-",
                ["role"] = x.Role?.NameAr ?? "-",
                ["status"] = x.IsActive ? "نشط" : "معطل",
                ["last_login"] = x.LastLoginAt,
                ["has_high_privileges"] = high,
                ["notes"] = x.IsLocked ? "حساب مقفل" : x.DepartmentId is null ? "بدون إدارة" : x.DirectManagerId is null ? "بدون مدير مباشر" : "-"
            };
        }).Cast<object>().ToList();

        var summary = new Dictionary<string, object?>
        {
            ["total_users"] = total,
            ["active_users"] = sample.Count(x => x.IsActive && !x.IsLocked),
            ["inactive_users"] = sample.Count(x => !x.IsActive),
            ["locked_users"] = sample.Count(x => x.IsLocked),
            ["without_manager"] = sample.Count(x => x.DirectManagerId is null),
            ["without_department"] = sample.Count(x => x.DepartmentId is null),
            ["administrative_privileges"] = sample.Count(x => x.Role?.RolePermissions.Any(rp => rp.IsAllowed && rp.Permission != null && dangerousModules.Contains(rp.Permission.Module)) == true)
        };
        var charts = new Dictionary<string, IReadOnlyCollection<object>>
        {
            ["by_type"] = BuildChart(sample.GroupBy(x => x.Role?.NameAr ?? "غير محدد").Select(x => (x.Key, x.Key, (decimal)x.Count()))),
            ["requests_by_department"] = BuildChart(sample.GroupBy(x => x.Department?.NameAr ?? "غير محدد").Select(x => (x.Key, x.Key, (decimal)x.Count())))
        };

        return Ok(BuildReportResponse(summary, charts, rows, total, page, pageSize));
    }

    [HttpGet("attachments")]
    public async Task<IActionResult> Attachments([FromQuery] ReportFilters filters, CancellationToken cancellationToken)
    {
        filters = NormalizeFiltersFromQuery(filters);
        ValidateDateRange(filters);
        var actor = await LoadActorAsync(cancellationToken);
        var (page, pageSize) = GetPagination();
        var canSeeAllRequests = await CanSeeAllRequestsAsync(actor.Id, cancellationToken);
        var canSeeAllMessages = await CanSeeAllMessagesAsync(actor.Id, cancellationToken);

        var requestQuery = ApplyRequestScope(BaseRequestQuery().AsNoTracking(), actor, canSeeAllRequests);
        var visibleRequestIds = await ApplyRequestFilters(requestQuery, filters).Select(x => x.Id).ToListAsync(cancellationToken);
        var requestAttachments = await db.RequestAttachments
            .Include(x => x.Request)
            .Include(x => x.UploadedByUser)
            .Where(x => visibleRequestIds.Contains(x.RequestId) && !x.IsDeleted)
            .AsNoTracking()
            .ToListAsync(cancellationToken);

        var messageQuery = ApplyMessageScope(BaseMessageQuery().AsNoTracking(), actor, canSeeAllMessages);
        var visibleMessageIds = await ApplyMessageFilters(messageQuery, filters).Select(x => x.Id).ToListAsync(cancellationToken);
        var messageAttachments = await db.MessageAttachments
            .Include(x => x.Message)
            .Include(x => x.UploadedByUser)
            .Where(x => visibleMessageIds.Contains(x.MessageId) && !x.IsDeleted)
            .AsNoTracking()
            .ToListAsync(cancellationToken);

        var allRows = requestAttachments.Select(x => new Dictionary<string, object?>
            {
                ["id"] = $"request-{x.Id}",
                ["file_name"] = x.FileName,
                ["type"] = x.ContentType,
                ["size_bytes"] = x.FileSize,
                ["linked_to"] = x.Request?.RequestNumber ?? x.RequestId.ToString(),
                ["module"] = "الطلبات",
                ["uploaded_by"] = x.UploadedByUser?.NameAr ?? "-",
                ["created_at"] = x.UploadedAt,
                ["downloads_count"] = 0,
                ["status"] = "موجود"
            })
            .Concat(messageAttachments.Select(x => new Dictionary<string, object?>
            {
                ["id"] = $"message-{x.Id}",
                ["file_name"] = x.FileName,
                ["type"] = x.ContentType,
                ["size_bytes"] = x.FileSize,
                ["linked_to"] = x.Message?.Subject ?? x.MessageId.ToString(),
                ["module"] = "المراسلات",
                ["uploaded_by"] = x.UploadedByUser?.NameAr ?? "-",
                ["created_at"] = x.UploadedAt,
                ["downloads_count"] = 0,
                ["status"] = "موجود"
            }))
            .OrderByDescending(x => x["created_at"])
            .ToList();

        var total = allRows.Count;
        var rows = allRows.Skip((page - 1) * pageSize).Take(pageSize).Cast<object>().ToList();
        var summary = new Dictionary<string, object?>
        {
            ["total_attachments"] = total,
            ["total_storage_bytes"] = allRows.Sum(x => Convert.ToInt64(x["size_bytes"] ?? 0)),
            ["large_files"] = allRows.Count(x => Convert.ToInt64(x["size_bytes"] ?? 0) >= 10 * 1024 * 1024),
            ["missing_files"] = 0,
            ["orphan_files"] = 0
        };
        var charts = new Dictionary<string, IReadOnlyCollection<object>>
        {
            ["by_module"] = BuildChart(allRows.GroupBy(x => Convert.ToString(x["module"]) ?? "غير محدد").Select(x => (x.Key, x.Key, (decimal)x.Count()))),
            ["by_type"] = BuildChart(allRows.GroupBy(x => Convert.ToString(x["type"]) ?? "غير محدد").Select(x => (x.Key, x.Key, (decimal)x.Count())))
        };

        return Ok(BuildReportResponse(summary, charts, rows, total, page, pageSize));
    }

    [HttpGet("audit")]
    [Authorize(Policy = "Permission:audit.view")]
    public async Task<IActionResult> Audit([FromQuery] ReportFilters filters, CancellationToken cancellationToken)
    {
        filters = NormalizeFiltersFromQuery(filters);
        ValidateDateRange(filters);
        var (page, pageSize) = GetPagination();
        var query = db.AuditLogs.Include(x => x.User).AsNoTracking();
        if (filters.DateFrom.HasValue)
        {
            query = query.Where(x => x.CreatedAt >= filters.DateFrom.Value);
        }

        if (filters.DateTo.HasValue)
        {
            query = query.Where(x => x.CreatedAt <= filters.DateTo.Value);
        }

        if (!string.IsNullOrWhiteSpace(filters.AuditAction))
        {
            query = query.Where(x => x.Action == filters.AuditAction.Trim());
        }

        var total = await query.CountAsync(cancellationToken);
        var logs = await query.OrderByDescending(x => x.CreatedAt).Skip((page - 1) * pageSize).Take(pageSize).ToListAsync(cancellationToken);
        var sample = await query.OrderByDescending(x => x.CreatedAt).Take(1000).ToListAsync(cancellationToken);
        await auditService.LogAsync("report_viewed", "report", "audit", metadata: new { filters.DateFrom, filters.DateTo, filters.AuditAction }, cancellationToken: cancellationToken);
        var rows = logs.Select(x => new Dictionary<string, object?>
        {
            ["id"] = x.Id,
            ["action"] = x.Action,
            ["user"] = x.User?.NameAr ?? x.User?.Username ?? "-",
            ["entity_type"] = x.EntityType,
            ["entity_id"] = x.EntityId,
            ["created_at"] = x.CreatedAt,
            ["ip_address"] = x.IpAddress,
            ["result"] = x.Result,
            ["old_value"] = x.OldValueJson,
            ["new_value"] = x.NewValueJson
        }).Cast<object>().ToList();

        var summary = new Dictionary<string, object?>
        {
            ["total_logs"] = total,
            ["failed_actions"] = sample.Count(x => !string.Equals(x.Result, "success", StringComparison.OrdinalIgnoreCase))
        };
        var charts = new Dictionary<string, IReadOnlyCollection<object>>
        {
            ["by_action"] = BuildChart(sample.GroupBy(x => x.Action).Select(x => (x.Key, x.Key, (decimal)x.Count())).OrderByDescending(x => x.Item3).Take(20))
        };

        return Ok(BuildReportResponse(summary, charts, rows, total, page, pageSize));
    }

    [HttpGet("export/excel")]
    public async Task<IActionResult> ExportExcel([FromQuery] ReportFilters filters, CancellationToken cancellationToken)
    {
        ValidateDateRange(filters);
        var actor = await LoadActorAsync(cancellationToken);
        var reportType = NormalizeReportType(filters.ReportType);
        var html = reportType switch
        {
            "messaging" => BuildMessagingExcel(await GetMessagingRowsAsync(filters, actor, cancellationToken), actor.NameAr),
            "audit" => await BuildAuditExcelAsync(filters, actor, cancellationToken),
            _ => BuildRequestsExcel(await GetRequestRowsAsync(filters, actor, cancellationToken), actor.NameAr)
        };

        var fileName = $"qib-{reportType}-report.xls";
        await LogReportExportAsync(reportType, "excel", filters, actor, fileName, cancellationToken);
        await auditService.LogAsync("report_export_excel", "report", reportType, metadata: new { filters.DateFrom, filters.DateTo, filters.DepartmentId, filters.RequestTypeId }, cancellationToken: cancellationToken);
        return File(Encoding.UTF8.GetPreamble().Concat(Encoding.UTF8.GetBytes(html)).ToArray(), "application/vnd.ms-excel", fileName);
    }

    [HttpGet("export/pdf")]
    public async Task<IActionResult> ExportPdf([FromQuery] ReportFilters filters, CancellationToken cancellationToken)
    {
        ValidateDateRange(filters);
        var actor = await LoadActorAsync(cancellationToken);
        var rows = await GetRequestRowsAsync(filters, actor, cancellationToken);
        var bytes = ReportPdfGenerator.GenerateRequestsReport("تقرير الطلبات", actor.NameAr, DateTimeOffset.UtcNow, rows);
        await LogReportExportAsync("requests", "pdf", filters, actor, "qib-requests-report.pdf", cancellationToken);
        await auditService.LogAsync("report_export_pdf", "report", "requests", metadata: new { filters.DateFrom, filters.DateTo, filters.DepartmentId, filters.RequestTypeId }, cancellationToken: cancellationToken);
        return File(bytes, "application/pdf", "qib-requests-report.pdf");
    }

    [HttpGet("saved")]
    public async Task<ActionResult<IReadOnlyCollection<object>>> SavedReports(CancellationToken cancellationToken)
    {
        var actor = await LoadActorAsync(cancellationToken);
        await ImportLegacyReportSettingsIfNeededAsync(cancellationToken);
        var canManageReports = await CanManageReportsAsync(actor.Id, cancellationToken);
        var rows = await db.SavedReports
            .AsNoTracking()
            .Where(item => canManageReports || item.CreatedByUserId == actor.Id)
            .OrderByDescending(item => item.IsFavorite)
            .ThenByDescending(item => item.UpdatedAt)
            .ToListAsync(cancellationToken);
        return Ok(rows
            .Select(MapSavedReport)
            .ToList());
    }

    [HttpPost("saved")]
    public async Task<ActionResult<object>> CreateSavedReport([FromBody] JsonElement request, CancellationToken cancellationToken)
    {
        var actor = await LoadActorAsync(cancellationToken);
        var record = new SavedReport
        {
            Name = RequiredString(request, "name"),
            Description = StringProp(request, "description"),
            ReportType = NormalizeReportType(StringProp(request, "report_type", "reportType")),
            FiltersJson = JsonProp(request, "filters_json", "filtersJson").GetRawText(),
            IsFavorite = BoolProp(request, false, "is_favorite", "isFavorite"),
            CreatedByUserId = actor.Id
        };
        db.SavedReports.Add(record);
        await db.SaveChangesAsync(cancellationToken);
        await auditService.LogAsync("saved_report_created", "report", record.Id.ToString(), actorUserId: actor.Id, newValue: record, cancellationToken: cancellationToken);
        return Ok(MapSavedReport(record));
    }

    [HttpDelete("saved/{id:long}")]
    public async Task<IActionResult> DeleteSavedReport(long id, CancellationToken cancellationToken)
    {
        var actor = await LoadActorAsync(cancellationToken);
        var canManageReports = await CanManageReportsAsync(actor.Id, cancellationToken);
        var record = await db.SavedReports.FirstOrDefaultAsync(item => item.Id == id && (canManageReports || item.CreatedByUserId == actor.Id), cancellationToken);
        if (record is null)
        {
            return Ok(new { success = true, removed = 0 });
        }

        db.SavedReports.Remove(record);
        await db.SaveChangesAsync(cancellationToken);
        await auditService.LogAsync("saved_report_deleted", "report", id.ToString(), actorUserId: actor.Id, metadata: new { removed = 1 }, cancellationToken: cancellationToken);
        return Ok(new { success = true, removed = 1 });
    }

    [HttpPost("saved/{id:long}/run")]
    public async Task<IActionResult> RunSavedReport(long id, CancellationToken cancellationToken)
    {
        var actor = await LoadActorAsync(cancellationToken);
        var canManageReports = await CanManageReportsAsync(actor.Id, cancellationToken);
        var record = await db.SavedReports.AsNoTracking().FirstOrDefaultAsync(item => item.Id == id && (canManageReports || item.CreatedByUserId == actor.Id), cancellationToken)
                     ?? throw new ApiException("التقرير المحفوظ غير موجود", StatusCodes.Status404NotFound);
        var filters = DeserializeFilters(record.FiltersJson);
        filters.ReportType = record.ReportType;
        return await RunReportAsync(record.ReportType, filters, cancellationToken);
    }

    [HttpGet("templates")]
    public async Task<ActionResult<IReadOnlyCollection<object>>> ReportTemplates(CancellationToken cancellationToken)
    {
        await ImportLegacyReportSettingsIfNeededAsync(cancellationToken);
        var rows = await db.ReportTemplates
            .AsNoTracking()
            .OrderByDescending(item => item.IsActive)
            .ThenBy(item => item.NameAr)
            .ToListAsync(cancellationToken);
        return Ok(rows.OrderByDescending(item => item.IsActive).ThenBy(item => item.NameAr).Select(MapTemplate).ToList());
    }

    [HttpPost("templates")]
    public async Task<ActionResult<object>> CreateReportTemplate([FromBody] JsonElement request, CancellationToken cancellationToken)
    {
        var actor = await LoadActorAsync(cancellationToken);
        var code = RequiredString(request, "code").Trim();
        if (await db.ReportTemplates.AnyAsync(item => item.Code.ToLower() == code.ToLower(), cancellationToken))
        {
            throw new ApiException("رمز قالب التقرير مستخدم مسبقاً");
        }

        var record = new ReportTemplate
        {
            NameAr = RequiredString(request, "name_ar", "nameAr"),
            Code = code,
            ReportType = NormalizeReportType(StringProp(request, "report_type", "reportType")),
            Description = StringProp(request, "description"),
            DefaultFiltersJson = JsonProp(request, "default_filters_json", "defaultFiltersJson").GetRawText(),
            DefaultColumnsJson = JsonProp(request, "default_columns_json", "defaultColumnsJson", defaultJson: "[]").GetRawText(),
            IsActive = BoolProp(request, true, "is_active", "isActive"),
            CreatedByUserId = actor.Id
        };
        db.ReportTemplates.Add(record);
        await db.SaveChangesAsync(cancellationToken);
        await auditService.LogAsync("report_template_created", "report_template", record.Id.ToString(), actorUserId: actor.Id, newValue: record, cancellationToken: cancellationToken);
        return Ok(MapTemplate(record));
    }

    [HttpDelete("templates/{id:long}")]
    public async Task<IActionResult> DisableReportTemplate(long id, CancellationToken cancellationToken)
    {
        var actor = await LoadActorAsync(cancellationToken);
        var record = await db.ReportTemplates.FirstOrDefaultAsync(item => item.Id == id, cancellationToken)
                     ?? throw new ApiException("قالب التقرير غير موجود", StatusCodes.Status404NotFound);
        record.IsActive = false;
        record.UpdatedAt = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync(cancellationToken);
        await auditService.LogAsync("report_template_disabled", "report_template", id.ToString(), actorUserId: actor.Id, cancellationToken: cancellationToken);
        return Ok(new { success = true });
    }

    [HttpPost("templates/{id:long}/run")]
    public async Task<IActionResult> RunReportTemplate(long id, CancellationToken cancellationToken)
    {
        var record = await db.ReportTemplates.AsNoTracking().FirstOrDefaultAsync(item => item.Id == id && item.IsActive, cancellationToken)
                     ?? throw new ApiException("قالب التقرير غير موجود أو غير مفعل", StatusCodes.Status404NotFound);
        var filters = DeserializeFilters(record.DefaultFiltersJson);
        filters.ReportType = record.ReportType;
        return await RunReportAsync(record.ReportType, filters, cancellationToken);
    }

    [HttpGet("scheduled")]
    public async Task<ActionResult<IReadOnlyCollection<object>>> ScheduledReports(CancellationToken cancellationToken)
    {
        var actor = await LoadActorAsync(cancellationToken);
        await ImportLegacyReportSettingsIfNeededAsync(cancellationToken);
        var canManageReports = await CanManageReportsAsync(actor.Id, cancellationToken);
        var rows = await db.ScheduledReports
            .Include(item => item.ReportTemplate)
            .AsNoTracking()
            .Where(item => canManageReports || item.CreatedByUserId == actor.Id)
            .OrderBy(item => item.NextRunAt)
            .ToListAsync(cancellationToken);
        return Ok(rows.Select(MapScheduledReport).ToList());
    }

    [HttpPost("scheduled")]
    public async Task<ActionResult<object>> CreateScheduledReport([FromBody] JsonElement request, CancellationToken cancellationToken)
    {
        var actor = await LoadActorAsync(cancellationToken);
        var now = DateTimeOffset.UtcNow;
        var frequency = StringProp(request, "frequency") ?? "monthly";
        var templateId = LongProp(request, "report_template_id", "reportTemplateId");
        if (templateId.HasValue && !await db.ReportTemplates.AnyAsync(item => item.Id == templateId.Value && item.IsActive, cancellationToken))
        {
            throw new ApiException("قالب التقرير المحدد غير مفعل أو غير موجود");
        }

        var runTime = ParseRunTime(StringProp(request, "run_time", "runTime"));
        var record = new ScheduledReport
        {
            Name = RequiredString(request, "name"),
            ReportTemplateId = templateId,
            Frequency = frequency,
            RunTime = runTime,
            RecipientsJson = JsonProp(request, "recipients_json", "recipientsJson", defaultJson: "[]").GetRawText(),
            ExportFormat = StringProp(request, "export_format", "exportFormat") ?? "excel",
            IsActive = BoolProp(request, true, "is_active", "isActive"),
            NextRunAt = CalculateNextRun(now, frequency, runTime),
            CreatedByUserId = actor.Id
        };
        db.ScheduledReports.Add(record);
        await db.SaveChangesAsync(cancellationToken);
        await auditService.LogAsync("scheduled_report_created", "scheduled_report", record.Id.ToString(), actorUserId: actor.Id, newValue: record, cancellationToken: cancellationToken);
        var savedRecord = await db.ScheduledReports
            .Include(item => item.ReportTemplate)
            .AsNoTracking()
            .FirstAsync(item => item.Id == record.Id, cancellationToken);
        return Ok(MapScheduledReport(savedRecord));
    }

    [HttpDelete("scheduled/{id:long}")]
    public async Task<IActionResult> DeleteScheduledReport(long id, CancellationToken cancellationToken)
    {
        var actor = await LoadActorAsync(cancellationToken);
        var canManageReports = await CanManageReportsAsync(actor.Id, cancellationToken);
        var record = await db.ScheduledReports.FirstOrDefaultAsync(item => item.Id == id && (canManageReports || item.CreatedByUserId == actor.Id), cancellationToken);
        if (record is null)
        {
            return Ok(new { success = true, removed = 0 });
        }

        db.ScheduledReports.Remove(record);
        await db.SaveChangesAsync(cancellationToken);
        await auditService.LogAsync("scheduled_report_deleted", "scheduled_report", id.ToString(), actorUserId: actor.Id, metadata: new { removed = 1 }, cancellationToken: cancellationToken);
        return Ok(new { success = true, removed = 1 });
    }

    private async Task<IReadOnlyCollection<RequestReportRowDto>> GetRequestRowsAsync(ReportFilters filters, User actor, CancellationToken cancellationToken)
    {
        var requests = await ApplyRequestFilters(ApplyRequestScope(BaseRequestQuery().AsNoTracking(), actor, await CanSeeAllRequestsAsync(actor.Id, cancellationToken)), filters)
            .OrderByDescending(x => x.CreatedAt)
            .Take(1000)
            .ToListAsync(cancellationToken);
        return requests.Select(MapRequestReportRow).ToList();
    }

    private async Task<IReadOnlyCollection<MessagingReportRowDto>> GetMessagingRowsAsync(ReportFilters filters, User actor, CancellationToken cancellationToken)
    {
        var messages = await ApplyMessageFilters(ApplyMessageScope(BaseMessageQuery().AsNoTracking(), actor, await CanSeeAllMessagesAsync(actor.Id, cancellationToken)), filters)
            .OrderByDescending(x => x.SentAt)
            .Take(1000)
            .ToListAsync(cancellationToken);
        return messages.Select(x => new MessagingReportRowDto(
            x.Id,
            x.Subject,
            x.MessageType?.NameAr,
            x.Sender?.NameAr,
            string.Join("، ", x.Recipients.Select(r => r.Recipient?.NameAr).Where(v => !string.IsNullOrWhiteSpace(v))),
            x.RelatedRequest?.RequestNumber,
            x.Classification?.NameAr,
            x.Priority,
            x.SentAt,
            x.Recipients.Any(r => !r.IsRead) ? "غير مقروءة" : "مقروءة")).ToList();
    }

    private RequestReportRowDto MapRequestReportRow(RequestEntity item)
    {
        return new RequestReportRowDto(
            item.Id,
            item.RequestNumber,
            item.Title,
            item.RequestType?.NameAr,
            item.Requester?.NameAr,
            item.Department?.NameAr,
            item.SpecializedSection?.NameAr,
            item.AssignedTo?.NameAr,
            item.Status,
            item.Priority,
            item.CreatedAt,
            item.ClosedAt,
            item.ClosedAt.HasValue ? Math.Max(0, (int)(item.ClosedAt.Value - item.CreatedAt).TotalHours) : null,
            IsSlaBreached(item) ? "متأخر" : "ضمن الوقت");
    }

    private object MapRequestReportRowObject(RequestEntity item) => new Dictionary<string, object?>
    {
        ["id"] = item.Id,
        ["request_number"] = item.RequestNumber,
        ["title"] = item.Title,
        ["request_type"] = item.RequestType?.NameAr ?? "-",
        ["requester"] = item.Requester?.NameAr ?? "-",
        ["department"] = item.Department?.NameAr ?? "-",
        ["specialized_section"] = item.SpecializedSection?.NameAr ?? "-",
        ["assigned_user"] = item.AssignedTo?.NameAr ?? "-",
        ["status"] = item.Status,
        ["status_label"] = StatusLabel(item.Status),
        ["priority"] = item.Priority,
        ["priority_label"] = PriorityLabel(item.Priority),
        ["created_at"] = item.CreatedAt,
        ["closed_at"] = item.ClosedAt,
        ["duration_hours"] = item.ClosedAt.HasValue ? Math.Max(0, (int)(item.ClosedAt.Value - item.CreatedAt).TotalHours) : null,
        ["sla_status"] = IsSlaBreached(item) ? "breached" : "on_track",
        ["sla_status_label"] = IsSlaBreached(item) ? "متأخر" : "ضمن الوقت"
    };

    private object MapMessagingReportRowObject(Message item) => new Dictionary<string, object?>
    {
        ["id"] = item.Id,
        ["message_uid"] = item.Id,
        ["subject"] = item.Subject,
        ["message_type_label"] = item.MessageType?.NameAr ?? "-",
        ["sender"] = item.Sender?.NameAr ?? "-",
        ["recipients"] = string.Join("، ", item.Recipients.Select(r => r.Recipient?.NameAr).Where(v => !string.IsNullOrWhiteSpace(v))),
        ["related_request_id"] = item.RelatedRequest?.RequestNumber ?? "-",
        ["classification"] = item.Classification?.NameAr ?? "-",
        ["priority"] = item.Priority,
        ["priority_label"] = PriorityLabel(item.Priority),
        ["created_at"] = item.SentAt,
        ["read_status"] = item.Recipients.Any(r => !r.IsRead) ? "غير مقروءة" : "مقروءة"
    };

    private IQueryable<RequestEntity> BaseRequestQuery() =>
        db.Requests
            .Include(x => x.RequestType)
            .Include(x => x.Requester).ThenInclude(x => x!.DirectManager)
            .Include(x => x.Department)
            .Include(x => x.SpecializedSection)
            .Include(x => x.AssignedTo)
            .Include(x => x.WorkflowSnapshots)
            .Include(x => x.SlaTracking);

    private IQueryable<Message> BaseMessageQuery() =>
        db.Messages
            .Include(x => x.Sender)
            .Include(x => x.MessageType)
            .Include(x => x.Classification)
            .Include(x => x.RelatedRequest)
            .Include(x => x.Recipients).ThenInclude(x => x.Recipient);

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
            x.WorkflowSnapshots.Any(s => s.ApproverUserId == actorId || s.ApproverRoleId == roleId || s.ActionByUserId == actorId));
    }

    private static IQueryable<Message> ApplyMessageScope(IQueryable<Message> query, User actor, bool canSeeAll)
    {
        if (canSeeAll)
        {
            return query;
        }

        var actorId = actor.Id;
        return query.Where(x => x.SenderId == actorId || x.Recipients.Any(r => r.RecipientId == actorId));
    }

    private static IQueryable<RequestEntity> ApplyRequestFilters(IQueryable<RequestEntity> query, ReportFilters filters)
    {
        if (filters.DateFrom.HasValue)
        {
            query = query.Where(x => x.CreatedAt >= filters.DateFrom.Value);
        }

        if (filters.DateTo.HasValue)
        {
            query = query.Where(x => x.CreatedAt <= filters.DateTo.Value);
        }

        if (filters.DepartmentId.HasValue)
        {
            query = query.Where(x => x.DepartmentId == filters.DepartmentId.Value);
        }

        if (filters.RequestTypeId.HasValue)
        {
            query = query.Where(x => x.RequestTypeId == filters.RequestTypeId.Value);
        }

        if (!string.IsNullOrWhiteSpace(filters.Status))
        {
            query = query.Where(x => x.Status == filters.Status.Trim());
        }

        if (!string.IsNullOrWhiteSpace(filters.Priority))
        {
            query = query.Where(x => x.Priority == filters.Priority.Trim());
        }

        if (filters.SpecializedSectionId.HasValue)
        {
            query = query.Where(x => x.SpecializedSectionId == filters.SpecializedSectionId.Value);
        }

        if (filters.RequesterId.HasValue)
        {
            query = query.Where(x => x.RequesterId == filters.RequesterId.Value);
        }

        if (filters.AssignedUserId.HasValue)
        {
            query = query.Where(x => x.AssignedToId == filters.AssignedUserId.Value);
        }

        if (!string.IsNullOrWhiteSpace(filters.ApprovalStep))
        {
            var step = filters.ApprovalStep.Trim();
            query = query.Where(x => x.WorkflowSnapshots.Any(s => s.StepNameAr.Contains(step) || s.StepType.Contains(step)));
        }

        if (!string.IsNullOrWhiteSpace(filters.SlaStatus))
        {
            var now = DateTimeOffset.UtcNow;
            var value = filters.SlaStatus.Trim();
            query = value switch
            {
                "breached" => query.Where(x =>
                    x.SlaTracking != null && x.SlaTracking.IsBreached ||
                    x.SlaResolutionDueAt.HasValue && x.SlaResolutionDueAt.Value < now && x.Status != "completed" && x.Status != "closed" && x.Status != "cancelled" && x.Status != "rejected"),
                "no_sla" => query.Where(x => !x.SlaResolutionDueAt.HasValue && (x.SlaTracking == null || !x.SlaTracking.ResolutionDueAt.HasValue)),
                "met" or "on_track" => query.Where(x =>
                    x.Status == "completed" || x.Status == "closed" ||
                    x.SlaResolutionDueAt.HasValue && x.SlaResolutionDueAt.Value >= now),
                _ => query
            };
        }

        return query;
    }

    private static IQueryable<Message> ApplyMessageFilters(IQueryable<Message> query, ReportFilters filters)
    {
        if (filters.DateFrom.HasValue)
        {
            query = query.Where(x => x.SentAt >= filters.DateFrom.Value);
        }

        if (filters.DateTo.HasValue)
        {
            query = query.Where(x => x.SentAt <= filters.DateTo.Value);
        }

        if (!string.IsNullOrWhiteSpace(filters.MessageType))
        {
            var messageType = filters.MessageType.Trim();
            if (long.TryParse(messageType, out var messageTypeId))
            {
                query = query.Where(x => x.MessageTypeId == messageTypeId);
            }
            else
            {
                query = query.Where(x => x.MessageType != null && (x.MessageType.Code == messageType || x.MessageType.NameAr.Contains(messageType)));
            }
        }

        if (!string.IsNullOrWhiteSpace(filters.Priority))
        {
            query = query.Where(x => x.Priority == filters.Priority.Trim());
        }

        return query;
    }

    private async Task<User> LoadActorAsync(CancellationToken cancellationToken)
    {
        var actorId = currentUser.UserId ?? throw new ApiException("المستخدم غير معروف", StatusCodes.Status401Unauthorized);
        return await db.Users.Include(x => x.Role).Include(x => x.Department).AsNoTracking().FirstOrDefaultAsync(x => x.Id == actorId, cancellationToken)
            ?? throw new ApiException("المستخدم غير موجود", StatusCodes.Status401Unauthorized);
    }

    private async Task<bool> CanSeeAllRequestsAsync(long actorId, CancellationToken cancellationToken) =>
        await permissionService.HasPermissionAsync(actorId, "requests.manage", cancellationToken);

    private async Task<bool> CanSeeAllMessagesAsync(long actorId, CancellationToken cancellationToken) =>
        await permissionService.HasPermissionAsync(actorId, "messages.manage", cancellationToken);

    private async Task<bool> CanSeeAuditAsync(long actorId, CancellationToken cancellationToken) =>
        await permissionService.HasPermissionAsync(actorId, "audit.view", cancellationToken);

    private async Task<bool> CanManageReportsAsync(long actorId, CancellationToken cancellationToken) =>
        await permissionService.HasPermissionAsync(actorId, "settings.manage", cancellationToken);

    private static bool IsSlaBreached(RequestEntity item)
    {
        if (item.SlaTracking?.IsBreached == true)
        {
            return true;
        }

        if (item.ClosedAt.HasValue || item.Status is "completed" or "closed" or "rejected" or "cancelled")
        {
            return false;
        }

        var dueAt = item.SlaTracking?.ResolutionDueAt ?? item.SlaResolutionDueAt;
        return dueAt.HasValue && dueAt.Value < DateTimeOffset.UtcNow;
    }

    private static void ValidateDateRange(ReportFilters filters)
    {
        if (filters.DateFrom.HasValue && filters.DateTo.HasValue && filters.DateFrom.Value > filters.DateTo.Value)
        {
            throw new ApiException("تاريخ البداية يجب أن يكون قبل تاريخ النهاية");
        }
    }

    private static string NormalizeReportType(string? value)
    {
        var normalized = string.IsNullOrWhiteSpace(value) ? "requests" : value.Trim().ToLowerInvariant();
        return normalized is "requests" or "approvals" or "sla" or "messaging" or "users-permissions" or "attachments" or "audit" ? normalized : "requests";
    }

    private async Task<string> BuildAuditExcelAsync(ReportFilters filters, User actor, CancellationToken cancellationToken)
    {
        if (!await CanSeeAuditAsync(actor.Id, cancellationToken))
        {
            throw new ApiException("لا تملك صلاحية تصدير تقرير التدقيق", StatusCodes.Status403Forbidden);
        }

        var query = db.AuditLogs.Include(x => x.User).AsNoTracking();
        if (filters.DateFrom.HasValue)
        {
            query = query.Where(x => x.CreatedAt >= filters.DateFrom.Value);
        }

        if (filters.DateTo.HasValue)
        {
            query = query.Where(x => x.CreatedAt <= filters.DateTo.Value);
        }

        if (!string.IsNullOrWhiteSpace(filters.AuditAction))
        {
            query = query.Where(x => x.Action == filters.AuditAction.Trim());
        }

        var rows = await query
            .OrderByDescending(x => x.CreatedAt)
            .Take(1000)
            .Select(x => new AuditReportRowDto(x.Id, x.Action, x.EntityType, x.EntityId, x.User!.Username, x.IpAddress, x.Result, x.CreatedAt, x.OldValueJson, x.NewValueJson))
            .ToListAsync(cancellationToken);

        return BuildHtmlWorkbook(
            "تقرير التدقيق",
            actor.NameAr,
            ["الإجراء", "الكيان", "رقم الكيان", "المستخدم", "IP", "النتيجة", "التاريخ"],
            rows.Select(x => new[] { x.Action, x.EntityType, x.EntityId ?? "-", x.Username ?? "-", x.IpAddress ?? "-", x.Result, x.CreatedAt.ToString("yyyy/MM/dd HH:mm") }));
    }

    private static string BuildRequestsExcel(IEnumerable<RequestReportRowDto> rows, string generatedBy) =>
        BuildHtmlWorkbook(
            "تقرير الطلبات",
            generatedBy,
            ["رقم الطلب", "نوع الطلب", "مقدم الطلب", "الإدارة", "القسم المختص", "الموظف المنفذ", "الحالة", "الأولوية", "تاريخ الإنشاء", "تاريخ الإغلاق", "مدة الإنجاز", "SLA"],
            rows.Select(x => new[]
            {
                x.RequestNumber,
                x.RequestTypeNameAr ?? "-",
                x.RequesterNameAr ?? "-",
                x.DepartmentNameAr ?? "-",
                x.SpecializedSectionNameAr ?? "-",
                x.AssignedToNameAr ?? "-",
                x.Status,
                x.Priority,
                x.CreatedAt.ToString("yyyy/MM/dd HH:mm"),
                x.ClosedAt?.ToString("yyyy/MM/dd HH:mm") ?? "-",
                x.CompletionHours?.ToString() ?? "-",
                x.SlaStatus
            }));

    private static string BuildMessagingExcel(IEnumerable<MessagingReportRowDto> rows, string generatedBy) =>
        BuildHtmlWorkbook(
            "تقرير المراسلات",
            generatedBy,
            ["الموضوع", "نوع الرسالة", "المرسل", "المستلمون", "الطلب المرتبط", "التصنيف", "الأولوية", "تاريخ الإرسال", "حالة القراءة"],
            rows.Select(x => new[]
            {
                x.Subject,
                x.MessageTypeNameAr ?? "-",
                x.SenderNameAr ?? "-",
                x.Recipients,
                x.RelatedRequestNumber ?? "-",
                x.ClassificationNameAr ?? "-",
                x.Priority,
                x.SentAt.ToString("yyyy/MM/dd HH:mm"),
                x.ReadStatus
            }));

    private static string BuildHtmlWorkbook(string title, string generatedBy, IReadOnlyCollection<string> headers, IEnumerable<IReadOnlyCollection<string>> rows)
    {
        var builder = new StringBuilder();
        builder.AppendLine("<html><head><meta charset=\"utf-8\"></head><body dir=\"rtl\">");
        builder.Append("<h2>").Append(WebUtility.HtmlEncode(title)).AppendLine("</h2>");
        builder.Append("<p>أنشئ بواسطة: ").Append(WebUtility.HtmlEncode(generatedBy)).Append(" | التاريخ: ").Append(DateTimeOffset.UtcNow.ToString("yyyy/MM/dd HH:mm")).AppendLine("</p>");
        builder.AppendLine("<table border=\"1\" style=\"border-collapse:collapse; font-family:Arial; direction:rtl\">");
        builder.AppendLine("<thead><tr>");
        foreach (var header in headers)
        {
            builder.Append("<th style=\"background:#0f5132;color:white;padding:6px\">").Append(WebUtility.HtmlEncode(header)).AppendLine("</th>");
        }
        builder.AppendLine("</tr></thead><tbody>");
        foreach (var row in rows)
        {
            builder.AppendLine("<tr>");
            foreach (var cell in row)
            {
                builder.Append("<td style=\"padding:6px\">").Append(WebUtility.HtmlEncode(cell)).AppendLine("</td>");
            }
            builder.AppendLine("</tr>");
        }
        builder.AppendLine("</tbody></table></body></html>");
        return builder.ToString();
    }

    private ReportFilters NormalizeFiltersFromQuery(ReportFilters filters)
    {
        filters.DateFrom ??= QueryDate("date_from", "dateFrom");
        filters.DateTo ??= QueryDate("date_to", "dateTo");
        filters.DepartmentId ??= QueryLong("department_id", "departmentId");
        filters.RequestTypeId ??= QueryLong("request_type_id", "requestTypeId");
        filters.SpecializedSectionId ??= QueryLong("specialized_section_id", "specializedSectionId");
        filters.RequesterId ??= QueryLong("requester_id", "requesterId");
        filters.AssignedUserId ??= QueryLong("assigned_user_id", "assignedUserId");
        filters.Status ??= QueryString("status");
        filters.Priority ??= QueryString("priority");
        filters.ApprovalStep ??= QueryString("approval_step", "approvalStep");
        filters.SlaStatus ??= QueryString("sla_status", "slaStatus");
        filters.MessageType ??= QueryString("message_type", "messageType");
        filters.AuditAction ??= QueryString("audit_action", "auditAction");
        filters.ReportType ??= QueryString("report_type", "reportType");
        return filters;
    }

    private (int Page, int PageSize) GetPagination()
    {
        var page = QueryInt("page") ?? 1;
        var pageSize = QueryInt("page_size", "pageSize") ?? 15;
        return (Math.Max(1, page), Math.Clamp(pageSize, 1, 100));
    }

    private string? QueryString(params string[] names)
    {
        foreach (var name in names)
        {
            if (Request.Query.TryGetValue(name, out var value) && !string.IsNullOrWhiteSpace(value.ToString()))
            {
                return value.ToString().Trim();
            }
        }
        return null;
    }

    private long? QueryLong(params string[] names) =>
        long.TryParse(QueryString(names), out var value) ? value : null;

    private int? QueryInt(params string[] names) =>
        int.TryParse(QueryString(names), out var value) ? value : null;

    private DateTimeOffset? QueryDate(params string[] names) =>
        DateTimeOffset.TryParse(QueryString(names), out var value) ? value : null;

    private static object BuildReportResponse(
        IReadOnlyDictionary<string, object?> summary,
        IReadOnlyDictionary<string, IReadOnlyCollection<object>> charts,
        IReadOnlyCollection<object> items,
        int total,
        int page,
        int pageSize) => new
        {
            summary,
            cards = summary,
            charts,
            items,
            pagination = new { page, page_size = pageSize, total }
        };

    private static IReadOnlyCollection<object> BuildChart(IEnumerable<(string Key, string Label, decimal Count)> rows) =>
        rows
            .OrderByDescending(x => x.Count)
            .Select(x => new { key = x.Key, label = x.Label, count = x.Count })
            .Cast<object>()
            .ToList();

    private async Task<IActionResult> RunReportAsync(string reportType, ReportFilters filters, CancellationToken cancellationToken)
    {
        return NormalizeReportType(reportType) switch
        {
            "approvals" => await Approvals(filters, cancellationToken),
            "sla" => await Sla(filters, cancellationToken),
            "messaging" => await Messaging(filters, cancellationToken),
            "users-permissions" => await UsersPermissions(filters, cancellationToken),
            "attachments" => await Attachments(filters, cancellationToken),
            "audit" => await Audit(filters, cancellationToken),
            _ => await Requests(filters, cancellationToken)
        };
    }

    private async Task<List<T>> ReadSettingListAsync<T>(string key, CancellationToken cancellationToken)
    {
        var raw = await db.SystemSettings
            .AsNoTracking()
            .Where(item => item.Key == key)
            .Select(item => item.Value)
            .FirstOrDefaultAsync(cancellationToken);
        if (string.IsNullOrWhiteSpace(raw))
        {
            return [];
        }

        try
        {
            return JsonSerializer.Deserialize<List<T>>(raw, JsonOptions) ?? [];
        }
        catch
        {
            return [];
        }
    }

    private async Task WriteSettingListAsync<T>(string key, IReadOnlyCollection<T> value, CancellationToken cancellationToken)
    {
        var setting = await db.SystemSettings.FirstOrDefaultAsync(item => item.Key == key, cancellationToken);
        if (setting is null)
        {
            setting = new SystemSetting
            {
                Key = key,
                Group = "reports",
                DataType = "json",
                DescriptionAr = "إعدادات مركز التقارير"
            };
            db.SystemSettings.Add(setting);
        }

        setting.Value = JsonSerializer.Serialize(value, JsonOptions);
        setting.UpdatedByUserId = currentUser.UserId;
        await db.SaveChangesAsync(cancellationToken);
    }

    private async Task ImportLegacyReportSettingsIfNeededAsync(CancellationToken cancellationToken)
    {
        if (!await db.SavedReports.AnyAsync(cancellationToken))
        {
            var legacySavedReports = await ReadSettingListAsync<SavedReportRecord>("reports.saved", cancellationToken);
            foreach (var item in legacySavedReports)
            {
                if (!await db.Users.AnyAsync(user => user.Id == item.CreatedBy, cancellationToken))
                {
                    continue;
                }

                db.SavedReports.Add(new SavedReport
                {
                    Name = item.Name,
                    Description = item.Description,
                    ReportType = NormalizeReportType(item.ReportType),
                    FiltersJson = item.FiltersJson.ValueKind == JsonValueKind.Undefined ? "{}" : item.FiltersJson.GetRawText(),
                    IsFavorite = item.IsFavorite,
                    CreatedByUserId = item.CreatedBy,
                    CreatedAt = item.CreatedAt,
                    UpdatedAt = item.UpdatedAt
                });
            }
        }

        if (!await db.ReportTemplates.AnyAsync(cancellationToken))
        {
            var legacyTemplates = await ReadSettingListAsync<ReportTemplateRecord>("reports.templates", cancellationToken);
            foreach (var item in legacyTemplates)
            {
                if (await db.ReportTemplates.AnyAsync(template => template.Code == item.Code, cancellationToken))
                {
                    continue;
                }

                db.ReportTemplates.Add(new ReportTemplate
                {
                    NameAr = item.NameAr,
                    Code = item.Code,
                    ReportType = NormalizeReportType(item.ReportType),
                    Description = item.Description,
                    DefaultFiltersJson = item.DefaultFiltersJson.ValueKind == JsonValueKind.Undefined ? "{}" : item.DefaultFiltersJson.GetRawText(),
                    DefaultColumnsJson = item.DefaultColumnsJson.ValueKind == JsonValueKind.Undefined ? "[]" : item.DefaultColumnsJson.GetRawText(),
                    IsActive = item.IsActive,
                    CreatedByUserId = await db.Users.AnyAsync(user => user.Id == item.CreatedBy, cancellationToken) ? item.CreatedBy : null,
                    CreatedAt = item.CreatedAt,
                    UpdatedAt = item.UpdatedAt
                });
            }
        }

        if (!await db.ScheduledReports.AnyAsync(cancellationToken))
        {
            var legacyScheduledReports = await ReadSettingListAsync<ScheduledReportRecord>("reports.scheduled", cancellationToken);
            foreach (var item in legacyScheduledReports)
            {
                if (!await db.Users.AnyAsync(user => user.Id == item.CreatedBy, cancellationToken))
                {
                    continue;
                }

                var templateId = item.ReportTemplateId.HasValue && await db.ReportTemplates.AnyAsync(template => template.Id == item.ReportTemplateId.Value, cancellationToken)
                    ? item.ReportTemplateId.Value
                    : (long?)null;
                db.ScheduledReports.Add(new ScheduledReport
                {
                    Name = item.Name,
                    ReportTemplateId = templateId,
                    Frequency = item.Frequency,
                    RunTime = ParseRunTime(item.RunTime),
                    RecipientsJson = item.RecipientsJson.ValueKind == JsonValueKind.Undefined ? "[]" : item.RecipientsJson.GetRawText(),
                    ExportFormat = item.ExportFormat,
                    IsActive = item.IsActive,
                    LastRunAt = item.LastRunAt,
                    NextRunAt = item.NextRunAt,
                    CreatedByUserId = item.CreatedBy,
                    CreatedAt = item.CreatedAt,
                    UpdatedAt = item.UpdatedAt
                });
            }
        }

        await db.SaveChangesAsync(cancellationToken);
    }

    private async Task LogReportExportAsync(string reportType, string exportFormat, ReportFilters filters, User actor, string fileName, CancellationToken cancellationToken)
    {
        db.ReportExportLogs.Add(new ReportExportLog
        {
            ReportType = NormalizeReportType(reportType),
            ExportFormat = exportFormat,
            FiltersJson = JsonSerializer.Serialize(filters, JsonOptions),
            FilePath = fileName,
            ExportedByUserId = actor.Id,
            IpAddress = currentUser.IpAddress,
            ExportedAt = DateTimeOffset.UtcNow
        });
        await db.SaveChangesAsync(cancellationToken);
    }

    private static object MapSavedReport(SavedReport item) => new
    {
        id = item.Id,
        name = item.Name,
        description = item.Description,
        report_type = item.ReportType,
        filters_json = ParseJsonElement(item.FiltersJson),
        is_favorite = item.IsFavorite,
        created_by = item.CreatedByUserId,
        created_at = item.CreatedAt,
        updated_at = item.UpdatedAt
    };

    private static object MapTemplate(ReportTemplate item) => new
    {
        id = item.Id,
        name_ar = item.NameAr,
        code = item.Code,
        report_type = item.ReportType,
        description = item.Description,
        default_filters_json = ParseJsonElement(item.DefaultFiltersJson),
        default_columns_json = ParseJsonElement(item.DefaultColumnsJson, "[]"),
        is_active = item.IsActive,
        created_by = item.CreatedByUserId,
        created_at = item.CreatedAt,
        updated_at = item.UpdatedAt
    };

    private static object MapScheduledReport(ScheduledReport item) => new
    {
        id = item.Id,
        name = item.Name,
        report_template_id = item.ReportTemplateId,
        template_name = item.ReportTemplate?.NameAr,
        frequency = item.Frequency,
        run_time = item.RunTime.ToString("HH:mm"),
        recipients_json = ParseJsonElement(item.RecipientsJson, "[]"),
        export_format = item.ExportFormat,
        is_active = item.IsActive,
        last_run_at = item.LastRunAt,
        next_run_at = item.NextRunAt,
        created_by = item.CreatedByUserId,
        created_at = item.CreatedAt,
        updated_at = item.UpdatedAt
    };

    private static object MapSavedReport(SavedReportRecord item) => new
    {
        id = item.Id,
        name = item.Name,
        description = item.Description,
        report_type = item.ReportType,
        filters_json = item.FiltersJson,
        is_favorite = item.IsFavorite,
        created_by = item.CreatedBy,
        created_at = item.CreatedAt,
        updated_at = item.UpdatedAt
    };

    private static object MapTemplate(ReportTemplateRecord item) => new
    {
        id = item.Id,
        name_ar = item.NameAr,
        code = item.Code,
        report_type = item.ReportType,
        description = item.Description,
        default_filters_json = item.DefaultFiltersJson,
        default_columns_json = item.DefaultColumnsJson,
        is_active = item.IsActive,
        created_by = item.CreatedBy,
        created_at = item.CreatedAt,
        updated_at = item.UpdatedAt
    };

    private static object MapScheduledReport(ScheduledReportRecord item) => new
    {
        id = item.Id,
        name = item.Name,
        report_template_id = item.ReportTemplateId,
        frequency = item.Frequency,
        run_time = item.RunTime,
        recipients_json = item.RecipientsJson,
        export_format = item.ExportFormat,
        is_active = item.IsActive,
        last_run_at = item.LastRunAt,
        next_run_at = item.NextRunAt,
        created_by = item.CreatedBy,
        created_at = item.CreatedAt,
        updated_at = item.UpdatedAt
    };

    private static JsonElement ParseJsonElement(string? raw, string defaultJson = "{}")
    {
        try
        {
            return JsonDocument.Parse(string.IsNullOrWhiteSpace(raw) ? defaultJson : raw).RootElement.Clone();
        }
        catch
        {
            return JsonDocument.Parse(defaultJson).RootElement.Clone();
        }
    }

    private static ReportFilters DeserializeFilters(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw))
        {
            return new ReportFilters();
        }

        try
        {
            using var document = JsonDocument.Parse(raw);
            var filters = JsonSerializer.Deserialize<ReportFilters>(raw, JsonOptions) ?? new ReportFilters();
            var root = document.RootElement;
            filters.DateFrom ??= DateProp(root, "date_from", "dateFrom");
            filters.DateTo ??= DateProp(root, "date_to", "dateTo");
            filters.DepartmentId ??= LongProp(root, "department_id", "departmentId");
            filters.RequestTypeId ??= LongProp(root, "request_type_id", "requestTypeId");
            filters.SpecializedSectionId ??= LongProp(root, "specialized_section_id", "specializedSectionId");
            filters.RequesterId ??= LongProp(root, "requester_id", "requesterId");
            filters.AssignedUserId ??= LongProp(root, "assigned_user_id", "assignedUserId");
            filters.ApprovalStep ??= StringProp(root, "approval_step", "approvalStep");
            filters.MessageType ??= StringProp(root, "message_type", "messageType");
            filters.Status ??= StringProp(root, "status");
            filters.Priority ??= StringProp(root, "priority");
            filters.SlaStatus ??= StringProp(root, "sla_status", "slaStatus");
            filters.AuditAction ??= StringProp(root, "audit_action", "auditAction");
            filters.ReportType ??= StringProp(root, "report_type", "reportType");
            return filters;
        }
        catch
        {
            return new ReportFilters();
        }
    }

    private static ReportFilters DeserializeFilters(JsonElement element)
    {
        try
        {
            return JsonSerializer.Deserialize<ReportFilters>(element.GetRawText(), JsonOptions) ?? new ReportFilters();
        }
        catch
        {
            return new ReportFilters();
        }
    }

    private static DateTimeOffset? DateProp(JsonElement json, params string[] names)
    {
        var value = StringProp(json, names);
        return DateTimeOffset.TryParse(value, out var parsed) ? parsed : null;
    }

    private static TimeOnly ParseRunTime(string? value)
    {
        if (TimeOnly.TryParse(value, out var parsed))
        {
            return parsed;
        }
        return new TimeOnly(8, 0);
    }

    private static JsonElement JsonProp(JsonElement json, string name, string? alternateName = null, string defaultJson = "{}")
    {
        if (json.ValueKind == JsonValueKind.Object)
        {
            if (json.TryGetProperty(name, out var value))
            {
                return value.Clone();
            }
            if (alternateName is not null && json.TryGetProperty(alternateName, out value))
            {
                return value.Clone();
            }
        }
        return JsonDocument.Parse(defaultJson).RootElement.Clone();
    }

    private static string RequiredString(JsonElement json, params string[] names)
    {
        var value = StringProp(json, names);
        if (string.IsNullOrWhiteSpace(value))
        {
            throw new ApiException("يرجى تعبئة الحقول المطلوبة");
        }
        return value.Trim();
    }

    private static string? StringProp(JsonElement json, params string[] names)
    {
        if (json.ValueKind != JsonValueKind.Object)
        {
            return null;
        }
        foreach (var name in names)
        {
            if (json.TryGetProperty(name, out var value) && value.ValueKind != JsonValueKind.Null)
            {
                return value.ValueKind == JsonValueKind.String ? value.GetString() : value.ToString();
            }
        }
        return null;
    }

    private static bool BoolProp(JsonElement json, bool defaultValue, params string[] names)
    {
        if (json.ValueKind != JsonValueKind.Object)
        {
            return defaultValue;
        }
        foreach (var name in names)
        {
            if (!json.TryGetProperty(name, out var value) || value.ValueKind == JsonValueKind.Null)
            {
                continue;
            }
            if (value.ValueKind is JsonValueKind.True or JsonValueKind.False)
            {
                return value.GetBoolean();
            }
            if (bool.TryParse(value.ToString(), out var parsed))
            {
                return parsed;
            }
        }
        return defaultValue;
    }

    private static long? LongProp(JsonElement json, params string[] names)
    {
        if (json.ValueKind != JsonValueKind.Object)
        {
            return null;
        }
        foreach (var name in names)
        {
            if (!json.TryGetProperty(name, out var value) || value.ValueKind == JsonValueKind.Null)
            {
                continue;
            }
            if (value.ValueKind == JsonValueKind.Number && value.TryGetInt64(out var number))
            {
                return number;
            }
            if (long.TryParse(value.ToString(), out number))
            {
                return number;
            }
        }
        return null;
    }

    private static long NewRecordId() => DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();

    private static DateTimeOffset CalculateNextRun(DateTimeOffset now, string frequency, TimeOnly? runTime = null)
    {
        var nextDate = frequency switch
        {
            "daily" => now.AddDays(1).Date,
            "weekly" => now.AddDays(7).Date,
            _ => now.AddMonths(1).Date
        };
        var time = runTime ?? new TimeOnly(8, 0);
        return new DateTimeOffset(nextDate.Add(time.ToTimeSpan()), now.Offset);
    }

    private sealed record SavedReportRecord(
        [property: JsonPropertyName("id")] long Id,
        [property: JsonPropertyName("name")] string Name,
        [property: JsonPropertyName("description")] string? Description,
        [property: JsonPropertyName("report_type")] string ReportType,
        [property: JsonPropertyName("filters_json")] JsonElement FiltersJson,
        [property: JsonPropertyName("is_favorite")] bool IsFavorite,
        [property: JsonPropertyName("created_by")] long CreatedBy,
        [property: JsonPropertyName("created_at")] DateTimeOffset CreatedAt,
        [property: JsonPropertyName("updated_at")] DateTimeOffset UpdatedAt);

    private sealed record ReportTemplateRecord(
        [property: JsonPropertyName("id")] long Id,
        [property: JsonPropertyName("name_ar")] string NameAr,
        [property: JsonPropertyName("code")] string Code,
        [property: JsonPropertyName("report_type")] string ReportType,
        [property: JsonPropertyName("description")] string? Description,
        [property: JsonPropertyName("default_filters_json")] JsonElement DefaultFiltersJson,
        [property: JsonPropertyName("default_columns_json")] JsonElement DefaultColumnsJson,
        [property: JsonPropertyName("is_active")] bool IsActive,
        [property: JsonPropertyName("created_by")] long CreatedBy,
        [property: JsonPropertyName("created_at")] DateTimeOffset CreatedAt,
        [property: JsonPropertyName("updated_at")] DateTimeOffset UpdatedAt);

    private sealed record ScheduledReportRecord(
        [property: JsonPropertyName("id")] long Id,
        [property: JsonPropertyName("name")] string Name,
        [property: JsonPropertyName("report_template_id")] long? ReportTemplateId,
        [property: JsonPropertyName("frequency")] string Frequency,
        [property: JsonPropertyName("run_time")] string RunTime,
        [property: JsonPropertyName("recipients_json")] JsonElement RecipientsJson,
        [property: JsonPropertyName("export_format")] string ExportFormat,
        [property: JsonPropertyName("is_active")] bool IsActive,
        [property: JsonPropertyName("last_run_at")] DateTimeOffset? LastRunAt,
        [property: JsonPropertyName("next_run_at")] DateTimeOffset NextRunAt,
        [property: JsonPropertyName("created_by")] long CreatedBy,
        [property: JsonPropertyName("created_at")] DateTimeOffset CreatedAt,
        [property: JsonPropertyName("updated_at")] DateTimeOffset UpdatedAt);

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
        _ => status
    };

    private static string PriorityLabel(string priority) => priority switch
    {
        "low" => "منخفضة",
        "normal" => "عادية",
        "high" => "مرتفعة",
        "urgent" => "عاجلة",
        "critical" => "حرجة",
        _ => priority
    };
}
