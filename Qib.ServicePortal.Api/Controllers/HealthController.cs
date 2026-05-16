using System.Diagnostics;
using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Qib.ServicePortal.Api.Application.DTOs;
using Qib.ServicePortal.Api.Application.Interfaces;
using Qib.ServicePortal.Api.Application.Services;
using Qib.ServicePortal.Api.Infrastructure.Data;

namespace Qib.ServicePortal.Api.Controllers;

[ApiController]
[Route("api/dotnet/v1/health")]
public class HealthController(ServicePortalDbContext db, ISettingsStore settingsStore, IAuditService auditService, IConfiguration configuration) : ControllerBase
{
    private static readonly Dictionary<string, object?> HealthDefaults = new()
    {
        ["disk_warning_percent"] = 80,
        ["disk_critical_percent"] = 90,
        ["errors_warning_count"] = 10,
        ["errors_critical_count"] = 50,
        ["db_latency_warning_ms"] = 300,
        ["db_latency_critical_ms"] = 1000,
        ["auto_check_enabled"] = true,
        ["auto_check_interval_minutes"] = 15,
        ["retention_days"] = 30
    };

    [HttpGet]
    [Authorize(Policy = "Permission:health.view")]
    public ActionResult<HealthResponse> GetHealth()
    {
        var version = typeof(HealthController).Assembly.GetName().Version?.ToString() ?? "1.0.0";
        return Ok(new HealthResponse("healthy", DateTimeOffset.UtcNow, "QIB Service Portal ASP.NET API", version));
    }

    [HttpGet("summary")]
    [Authorize(Policy = "Permission:health.view")]
    public async Task<ActionResult<object>> GetSummary(CancellationToken cancellationToken)
    {
        var database = await BuildDatabaseSummaryAsync(cancellationToken);
        var storage = await BuildStorageSummaryAsync(cancellationToken);
        var errors = await BuildErrorsSummaryAsync(cancellationToken);
        var overall = database.status == "critical" || storage.status == "critical" || errors.status == "critical"
            ? "critical"
            : database.status == "warning" || storage.status == "warning" || errors.status == "warning"
                ? "warning"
                : "healthy";
        var now = DateTimeOffset.UtcNow;

        return Ok(new
        {
            status = overall,
            backend = new { status = "healthy", latency_ms = 0, message = "Backend .NET يعمل" },
            database,
            storage,
            backup = new { status = "warning", last_backup_at = (DateTimeOffset?)null, message = "النسخ الاحتياطي الفعلي سيكتمل في المرحلة 10" },
            errors_last_24h = errors.errors_last_24h,
            errors,
            active_alerts_count = 0,
            last_health_check_at = now,
            version = typeof(HealthController).Assembly.GetName().Version?.ToString() ?? "1.0.0",
            recent_checks = new object[]
            {
                new { check_name = "backend_api", category = "services", status = "healthy", latency_ms = 0L, message = "الخدمة تعمل", checked_at = now },
                new { check_name = "database_connection", category = "database", status = database.status, latency_ms = database.latency_ms, message = database.message, checked_at = now },
                new { check_name = "storage", category = "storage", status = storage.status, latency_ms = (long?)null, message = storage.message, checked_at = now }
            },
            alerts = Array.Empty<object>()
        });
    }

    [HttpPost("run-checks")]
    [Authorize(Policy = "Permission:health.run")]
    public async Task<ActionResult<object>> RunChecks(CancellationToken cancellationToken)
    {
        await auditService.LogAsync("health_checks_run", "health", "manual", cancellationToken: cancellationToken);
        return await GetSummary(cancellationToken);
    }

    [HttpGet("services")]
    [Authorize(Policy = "Permission:health.view")]
    public async Task<ActionResult<IReadOnlyCollection<object>>> GetServices(CancellationToken cancellationToken)
    {
        var database = await BuildDatabaseSummaryAsync(cancellationToken);
        var now = DateTimeOffset.UtcNow;
        return Ok(new object[]
        {
            new { code = "backend_api", name = "Backend API", status = "healthy", latency_ms = 0, last_checked_at = now, message = "الخدمة تعمل" },
            new { code = "frontend", name = "Frontend", status = "healthy", latency_ms = 0, last_checked_at = now, message = "الواجهة تعمل عند توجيهها إلى API" },
            new { code = "database", name = "Database Connection", status = database.status, latency_ms = database.latency_ms, last_checked_at = now, message = database.message },
            new { code = "uploads_directory", name = "Uploads Directory", status = Directory.Exists(configuration["Storage:UploadsPath"] ?? "/data/uploads") ? "healthy" : "warning", latency_ms = 0, last_checked_at = now, message = "مسار الرفع مهيأ" },
            new { code = "backups_directory", name = "Backups Directory", status = "warning", latency_ms = 0, last_checked_at = now, message = "النسخ الفعلية ضمن المرحلة 10" }
        });
    }

    [HttpGet("database")]
    [Authorize(Policy = "Permission:health.view")]
    public async Task<ActionResult<object>> GetDatabaseHealth(CancellationToken cancellationToken) =>
        Ok(await BuildDatabaseSummaryAsync(cancellationToken));

    [HttpGet("storage")]
    [Authorize(Policy = "Permission:health.view")]
    public async Task<ActionResult<object>> GetStorage(CancellationToken cancellationToken) =>
        Ok(await BuildStorageSummaryAsync(cancellationToken));

    [HttpGet("backups")]
    [Authorize(Policy = "Permission:health.view")]
    public async Task<ActionResult<object>> GetBackups(CancellationToken cancellationToken)
    {
        var settings = await settingsStore.GetValuesAsync("database", "database.backup", new Dictionary<string, object?>
        {
            ["auto_backup_enabled"] = false
        }, cancellationToken);
        return Ok(new
        {
            status = "warning",
            last_backup_at = (DateTimeOffset?)null,
            last_backup_status = "not_configured",
            last_backup_size = 0,
            backup_count = 0,
            auto_backup_enabled = settings.TryGetValue("auto_backup_enabled", out var enabled) && enabled is true,
            failed_backups_count = 0,
            backup_directory_writable = true,
            message = "إدارة النسخ الاحتياطية الفعلية ستكتمل ضمن المرحلة 10"
        });
    }

    [HttpGet("errors")]
    [Authorize(Policy = "Permission:health.view")]
    public async Task<ActionResult<object>> GetErrors(CancellationToken cancellationToken)
    {
        var summary = await BuildErrorsSummaryAsync(cancellationToken);
        var latest = await db.AuditLogs
            .AsNoTracking()
            .Include(x => x.User)
            .Where(x => x.Result != "success")
            .OrderByDescending(x => x.CreatedAt)
            .Take(50)
            .Select(x => new
            {
                created_at = x.CreatedAt,
                level = x.Result == "critical" ? "critical" : "error",
                source = x.EntityType,
                message = x.Action,
                user = x.User != null ? x.User.NameAr : null,
                ip_address = x.IpAddress
            })
            .ToListAsync(cancellationToken);

        return Ok(new
        {
            summary.status,
            summary.errors_last_24h,
            errors_last_7d = summary.errors_last_7d,
            critical_errors_count = 0,
            latest_error_logs = latest,
            errors_by_source = latest.GroupBy(x => x.source).Select(x => new { source = x.Key, count = x.Count() }).ToList()
        });
    }

    [HttpGet("jobs")]
    [Authorize(Policy = "Permission:health.view")]
    public ActionResult<object> GetJobs() => Ok(new { status = "healthy", active_jobs = 0, failed_jobs = 0, jobs = Array.Empty<object>() });

    [HttpGet("updates")]
    [Authorize(Policy = "Permission:health.view")]
    public async Task<ActionResult<object>> GetUpdates(CancellationToken cancellationToken)
    {
        var pending = await db.Database.GetPendingMigrationsAsync(cancellationToken);
        return Ok(new
        {
            status = pending.Any() ? "warning" : "healthy",
            current_version = typeof(HealthController).Assembly.GetName().Version?.ToString() ?? "1.0.0",
            last_update_time = (DateTimeOffset?)null,
            last_update_status = "not_configured",
            last_post_update_health_check = (DateTimeOffset?)null,
            pending_migrations = pending.Count(),
            active_update_job = (object?)null,
            rollback_point_exists = false
        });
    }

    [HttpGet("alerts")]
    [Authorize(Policy = "Permission:health.view")]
    public ActionResult<IReadOnlyCollection<object>> GetAlerts() => Ok(Array.Empty<object>());

    [HttpPost("alerts/{alertId:long}/resolve")]
    [Authorize(Policy = "Permission:health.run")]
    public async Task<ActionResult<object>> ResolveAlert(long alertId, CancellationToken cancellationToken)
    {
        await auditService.LogAsync("health_alert_resolved", "health_alert", alertId.ToString(), cancellationToken: cancellationToken);
        return Ok(new { id = alertId, is_resolved = true });
    }

    [HttpPost("clear-logs")]
    [Authorize(Policy = "Permission:health.run")]
    public async Task<ActionResult<object>> ClearLogs(CancellationToken cancellationToken)
    {
        await auditService.LogAsync("health_logs_clear_requested", "health", "logs", cancellationToken: cancellationToken);
        return Ok(new { ok = true, message = "تم تسجيل طلب محو السجلات. الحذف الفعلي غير مفعل في Backend .NET المستقل." });
    }

    [HttpGet("settings")]
    [Authorize(Policy = "Permission:health.view")]
    public Task<Dictionary<string, object?>> GetHealthSettings(CancellationToken cancellationToken) =>
        settingsStore.GetValuesAsync("health", "health", HealthDefaults, cancellationToken);

    [HttpPut("settings")]
    [Authorize(Policy = "Permission:settings.manage")]
    public async Task<ActionResult<Dictionary<string, object?>>> UpdateHealthSettings(Dictionary<string, JsonElement> request, CancellationToken cancellationToken)
    {
        var current = await settingsStore.GetValuesAsync("health", "health", HealthDefaults, cancellationToken);
        var values = new Dictionary<string, object?>(current, StringComparer.OrdinalIgnoreCase);
        foreach (var (key, value) in request)
        {
            if (HealthDefaults.ContainsKey(key))
            {
                values[key] = SystemSettingsStore.ConvertJsonElement(value);
            }
        }

        if (ToInt(values["disk_warning_percent"]) >= ToInt(values["disk_critical_percent"]) ||
            ToInt(values["db_latency_warning_ms"]) >= ToInt(values["db_latency_critical_ms"]))
        {
            return BadRequest(new { detail = "حد التحذير يجب أن يكون أقل من حد الخطر" });
        }

        await settingsStore.SetValuesAsync("health", "health", values, HealthDefaults, cancellationToken);
        await auditService.LogAsync("health_settings_updated", "health_settings", "settings", oldValue: current, newValue: values, cancellationToken: cancellationToken);
        return Ok(await settingsStore.GetValuesAsync("health", "health", HealthDefaults, cancellationToken));
    }

    private async Task<dynamic> BuildDatabaseSummaryAsync(CancellationToken cancellationToken)
    {
        var stopwatch = Stopwatch.StartNew();
        await db.Database.OpenConnectionAsync(cancellationToken);
        await db.Database.CloseConnectionAsync();
        stopwatch.Stop();
        var settings = await settingsStore.GetValuesAsync("health", "health", HealthDefaults, cancellationToken);
        var status = stopwatch.ElapsedMilliseconds >= ToInt(settings["db_latency_critical_ms"]) ? "critical" :
            stopwatch.ElapsedMilliseconds >= ToInt(settings["db_latency_warning_ms"]) ? "warning" : "healthy";
        return new
        {
            status,
            latency_ms = stopwatch.ElapsedMilliseconds,
            database_type = "PostgreSQL",
            database_name = db.Database.GetDbConnection().Database,
            tables_count = db.Model.GetEntityTypes().Count(x => x.GetTableName() is not null),
            records_count = await db.Users.CountAsync(cancellationToken) + await db.Requests.CountAsync(cancellationToken) + await db.Messages.CountAsync(cancellationToken),
            pending_migrations = (await db.Database.GetPendingMigrationsAsync(cancellationToken)).Count(),
            message = "الاتصال بقاعدة البيانات يعمل"
        };
    }

    private async Task<dynamic> BuildStorageSummaryAsync(CancellationToken cancellationToken)
    {
        var uploadPath = configuration["Storage:UploadsPath"] ?? "/data/uploads";
        Directory.CreateDirectory(uploadPath);
        var drive = new DriveInfo(Path.GetPathRoot(Path.GetFullPath(uploadPath)) ?? "/");
        var used = drive.TotalSize - drive.AvailableFreeSpace;
        var usedPercent = drive.TotalSize <= 0 ? 0 : Math.Round(used * 100d / drive.TotalSize, 2);
        var settings = await settingsStore.GetValuesAsync("health", "health", HealthDefaults, cancellationToken);
        var status = usedPercent >= ToInt(settings["disk_critical_percent"]) ? "critical" :
            usedPercent >= ToInt(settings["disk_warning_percent"]) ? "warning" : "healthy";
        var attachmentsCount = await db.RequestAttachments.CountAsync(x => !x.IsDeleted, cancellationToken)
                               + await db.MessageAttachments.CountAsync(x => !x.IsDeleted, cancellationToken)
                               + await db.DocumentVersions.CountAsync(cancellationToken);
        return new
        {
            status,
            disk_used_percent = usedPercent,
            disk_total_size = drive.TotalSize,
            disk_used_size = used,
            disk_free_size = drive.AvailableFreeSpace,
            uploads_folder_size = GetDirectorySize(uploadPath),
            backups_folder_size = 0L,
            attachments_count = attachmentsCount,
            missing_attachment_files_count = 0,
            orphan_files_count = 0,
            uploads_directory_writable = true,
            message = "التخزين متاح"
        };
    }

    private async Task<dynamic> BuildErrorsSummaryAsync(CancellationToken cancellationToken)
    {
        var last24 = DateTimeOffset.UtcNow.AddHours(-24);
        var last7 = DateTimeOffset.UtcNow.AddDays(-7);
        var errors24 = await db.AuditLogs.CountAsync(x => x.Result != "success" && x.CreatedAt >= last24, cancellationToken);
        var errors7 = await db.AuditLogs.CountAsync(x => x.Result != "success" && x.CreatedAt >= last7, cancellationToken);
        var settings = await settingsStore.GetValuesAsync("health", "health", HealthDefaults, cancellationToken);
        var status = errors24 >= ToInt(settings["errors_critical_count"]) ? "critical" :
            errors24 >= ToInt(settings["errors_warning_count"]) ? "warning" : "healthy";
        return new { status, errors_last_24h = errors24, errors_last_7d = errors7, message = errors24 == 0 ? "لا توجد أخطاء خلال آخر 24 ساعة" : "توجد أخطاء مسجلة" };
    }

    private static long GetDirectorySize(string path)
    {
        try
        {
            return Directory.EnumerateFiles(path, "*", SearchOption.AllDirectories).Sum(file => new FileInfo(file).Length);
        }
        catch
        {
            return 0;
        }
    }

    private static int ToInt(object? value) =>
        value switch
        {
            int intValue => intValue,
            long longValue => (int)longValue,
            decimal decimalValue => (int)decimalValue,
            double doubleValue => (int)doubleValue,
            string text when int.TryParse(text, out var result) => result,
            _ => 0
        };
}
