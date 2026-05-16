using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Qib.ServicePortal.Api.Application.Interfaces;
using Qib.ServicePortal.Api.Common.Exceptions;
using Qib.ServicePortal.Api.Domain.Entities;
using Qib.ServicePortal.Api.Infrastructure.Data;
using Qib.ServicePortal.Api.Infrastructure.Security;

namespace Qib.ServicePortal.Api.Controllers;

[ApiController]
[Route("api/dotnet/v1/users")]
[Authorize(Policy = "Permission:users.view")]
public class UsersController(
    ServicePortalDbContext db,
    IPasswordHasher passwordHasher,
    IPermissionService permissionService,
    IAuditService auditService,
    ICurrentUserService currentUser,
    ISettingsStore settingsStore) : ControllerBase
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    [HttpGet]
    public async Task<ActionResult<IReadOnlyCollection<object>>> GetUsers(
        [FromQuery] string? search,
        [FromQuery] bool? isActive,
        CancellationToken cancellationToken)
    {
        var query = LoadUserQuery().AsNoTracking();

        if (!string.IsNullOrWhiteSpace(search))
        {
            var value = search.Trim().ToLowerInvariant();
            query = query.Where(x =>
                x.Username.ToLower().Contains(value) ||
                x.Email.ToLower().Contains(value) ||
                x.NameAr.ToLower().Contains(value) ||
                (x.NameEn != null && x.NameEn.ToLower().Contains(value)) ||
                (x.EmployeeNumber != null && x.EmployeeNumber.ToLower().Contains(value)) ||
                (x.Phone != null && x.Phone.ToLower().Contains(value)));
        }

        if (isActive.HasValue)
        {
            query = query.Where(x => x.IsActive == isActive.Value);
        }

        var users = await query.OrderBy(x => x.NameAr).Take(1000).ToListAsync(cancellationToken);
        return Ok(users.Select(MapUser).ToList());
    }

    [HttpGet("overview")]
    public async Task<ActionResult<object>> GetOverview(CancellationToken cancellationToken)
    {
        var users = await db.Users.Include(x => x.Role).Include(x => x.Department).Include(x => x.SpecializedSection).AsNoTracking().ToListAsync(cancellationToken);
        var now = DateTimeOffset.UtcNow;
        var activeSessions = await db.UserSessions.CountAsync(x => x.IsActive && x.RevokedAt == null && (x.ExpiresAt == null || x.ExpiresAt > now), cancellationToken);
        var lastImportAt = await db.AuditLogs
            .Where(x => x.Action == "user_import_confirmed")
            .OrderByDescending(x => x.CreatedAt)
            .Select(x => (DateTimeOffset?)x.CreatedAt)
            .FirstOrDefaultAsync(cancellationToken);
        var lastPermissionChangeAt = await db.AuditLogs
            .Where(x => x.Action == "screen_permission_changed" || x.Action == "role_permissions_updated")
            .OrderByDescending(x => x.CreatedAt)
            .Select(x => (DateTimeOffset?)x.CreatedAt)
            .FirstOrDefaultAsync(cancellationToken);

        return Ok(new
        {
            total_users = users.Count,
            active_users = users.Count(x => x.IsActive && !x.IsLocked),
            inactive_users = users.Count(x => !x.IsActive),
            locked_users = users.Count(x => x.IsLocked),
            without_manager = users.Count(x => x.DirectManagerId == null && !string.Equals(x.Role?.Code, "super_admin", StringComparison.OrdinalIgnoreCase)),
            without_department = users.Count(x => x.DepartmentId == null),
            admin_users = users.Count(x => IsAdministrativeRole(x.Role?.Code)),
            active_sessions = activeSessions,
            last_import_at = lastImportAt,
            last_permission_change_at = lastPermissionChangeAt,
            users_by_department = users
                .GroupBy(x => x.Department?.NameAr ?? "بدون إدارة")
                .OrderByDescending(x => x.Count())
                .Select(x => new { label = x.Key, value = x.Count() })
                .ToList(),
            users_by_role = users
                .GroupBy(x => x.Role?.NameAr ?? "بدون دور")
                .OrderByDescending(x => x.Count())
                .Select(x => new { label = x.Key, value = x.Count() })
                .ToList(),
            active_vs_inactive = new[]
            {
                new { label = "نشط", value = users.Count(x => x.IsActive) },
                new { label = "غير نشط", value = users.Count(x => !x.IsActive) }
            }
        });
    }

    [HttpGet("{id:long}")]
    public async Task<ActionResult<object>> GetUser(long id, CancellationToken cancellationToken)
    {
        var user = await LoadUserQuery().AsNoTracking().FirstOrDefaultAsync(x => x.Id == id, cancellationToken)
                   ?? throw new ApiException("المستخدم غير موجود", StatusCodes.Status404NotFound);
        var permissions = await permissionService.GetEffectivePermissionCodesAsync(id, cancellationToken);
        var screenPermissions = ScreenCatalog
            .Where(screen => HasAnyPermission(permissions, screen.ViewPermissions.Concat(screen.ManagePermissions)))
            .Select(screen => screen.Label)
            .ToList();
        var sessions = await GetUserSessionsQuery(id).Take(20).ToListAsync(cancellationToken);
        var logs = await db.AuditLogs
            .Include(x => x.User)
            .AsNoTracking()
            .Where(x => x.EntityType == "user" && x.EntityId == id.ToString() || x.UserId == id)
            .OrderByDescending(x => x.CreatedAt)
            .Take(20)
            .ToListAsync(cancellationToken);

        return Ok(new
        {
            user = MapUser(user),
            manager = user.DirectManager is null ? null : MapUser(user.DirectManager),
            screen_permissions = screenPermissions,
            sessions = sessions.Select(MapSession).ToList(),
            recent_audit_logs = logs.Select(MapAuditLog).ToList()
        });
    }

    [HttpPost]
    [Authorize(Policy = "Permission:users.manage")]
    public async Task<ActionResult<object>> CreateUser([FromBody] JsonElement request, CancellationToken cancellationToken)
    {
        var roleId = await ResolveRoleIdAsync(request, null, cancellationToken);
        var departmentId = LongProp(request, "department_id", "departmentId");
        var managerId = LongProp(request, "manager_id", "direct_manager_id", "directManagerId");
        var relationshipType = NormalizeRelationshipType(StringProp(request, "relationship_type", "relationshipType"));
        var specializedSectionId = await ResolveUserSpecializedSectionIdAsync(request, roleId, null, cancellationToken);
        await EnsureUserReferencesAsync(roleId, departmentId, managerId, specializedSectionId, cancellationToken);

        var email = RequiredString(request, "email").Trim().ToLowerInvariant();
        var username = StringProp(request, "username");
        if (string.IsNullOrWhiteSpace(username))
        {
            username = StringProp(request, "employee_id", "employeeNumber", "employee_number") ?? email.Split('@')[0];
        }

        var nameAr = RequiredString(request, "full_name_ar", "name_ar", "nameAr").Trim();
        var employeeNumber = StringProp(request, "employee_id", "employee_number", "employeeNumber");
        await EnsureUserUniqueAsync(null, username.Trim(), email, employeeNumber, cancellationToken);

        var password = await ResolveTemporaryPasswordAsync(
            StringProp(request, "password", "new_password", "newPassword"),
            cancellationToken);

        var user = new User
        {
            Username = username.Trim(),
            Email = email,
            EmployeeNumber = employeeNumber?.Trim(),
            NameAr = nameAr,
            NameEn = StringProp(request, "full_name_en", "name_en", "nameEn")?.Trim(),
            Phone = StringProp(request, "mobile", "phone")?.Trim(),
            JobTitle = StringProp(request, "job_title", "jobTitle")?.Trim(),
            RelationshipType = relationshipType,
            RoleId = roleId,
            DepartmentId = departmentId,
            SpecializedSectionId = specializedSectionId,
            DirectManagerId = managerId,
            PasswordHash = passwordHasher.Hash(password),
            IsActive = BoolProp(request, true, "is_active", "isActive"),
            IsLocked = false,
            ForcePasswordChange = BoolProp(request, true, "force_password_change", "forcePasswordChange"),
            PasswordChangedAt = DateTimeOffset.UtcNow
        };

        if (user.DirectManagerId == user.Id)
        {
            user.DirectManagerId = null;
        }

        db.Users.Add(user);
        await db.SaveChangesAsync(cancellationToken);
        await auditService.LogAsync("user_created", "user", user.Id.ToString(), newValue: new { user.Username, user.Email, user.RoleId, user.SpecializedSectionId }, cancellationToken: cancellationToken);

        var created = await LoadUserQuery().AsNoTracking().FirstAsync(x => x.Id == user.Id, cancellationToken);
        return CreatedAtAction(nameof(GetUser), new { id = user.Id }, MapUser(created));
    }

    [HttpPut("{id:long}")]
    [Authorize(Policy = "Permission:users.manage")]
    public async Task<ActionResult<object>> UpdateUser(long id, [FromBody] JsonElement request, CancellationToken cancellationToken)
    {
        var user = await db.Users.Include(x => x.Role).FirstOrDefaultAsync(x => x.Id == id, cancellationToken)
                   ?? throw new ApiException("المستخدم غير موجود", StatusCodes.Status404NotFound);

        var roleId = await ResolveRoleIdAsync(request, user.RoleId, cancellationToken);
        var departmentId = LongProp(request, "department_id", "departmentId");
        var managerId = LongProp(request, "manager_id", "direct_manager_id", "directManagerId");
        var relationshipType = NormalizeRelationshipType(StringProp(request, "relationship_type", "relationshipType"), user.RelationshipType);
        var specializedSectionId = await ResolveUserSpecializedSectionIdAsync(request, roleId, user.SpecializedSectionId, cancellationToken);
        await EnsureUserReferencesAsync(roleId, departmentId, managerId, specializedSectionId, cancellationToken);
        await EnsureCanChangeSuperAdminStateAsync(user, roleId, BoolProp(request, user.IsActive, "is_active", "isActive"), cancellationToken);

        var oldValue = new { user.Username, user.Email, user.RoleId, user.DepartmentId, user.SpecializedSectionId, user.RelationshipType, user.IsActive, user.IsLocked };
        var newUsername = StringProp(request, "username")?.Trim();
        var newEmail = RequiredString(request, "email").Trim().ToLowerInvariant();
        var employeeNumber = StringProp(request, "employee_id", "employee_number", "employeeNumber")?.Trim();
        await EnsureUserUniqueAsync(id, string.IsNullOrWhiteSpace(newUsername) ? user.Username : newUsername, newEmail, employeeNumber, cancellationToken);

        if (!string.IsNullOrWhiteSpace(newUsername))
        {
            user.Username = newUsername;
        }

        user.Email = newEmail;
        user.EmployeeNumber = employeeNumber;
        user.NameAr = RequiredString(request, "full_name_ar", "name_ar", "nameAr").Trim();
        user.NameEn = StringProp(request, "full_name_en", "name_en", "nameEn")?.Trim();
        user.Phone = StringProp(request, "mobile", "phone")?.Trim();
        user.JobTitle = StringProp(request, "job_title", "jobTitle")?.Trim();
        user.RelationshipType = relationshipType;
        user.RoleId = roleId;
        user.DepartmentId = departmentId;
        user.SpecializedSectionId = specializedSectionId;
        user.DirectManagerId = managerId == id ? null : managerId;
        user.IsActive = BoolProp(request, user.IsActive, "is_active", "isActive");
        user.IsLocked = BoolProp(request, user.IsLocked, "is_locked", "isLocked");
        user.ForcePasswordChange = BoolProp(request, user.ForcePasswordChange, "force_password_change", "forcePasswordChange");

        await db.SaveChangesAsync(cancellationToken);
        await auditService.LogAsync("user_updated", "user", user.Id.ToString(), oldValue: oldValue, newValue: new { user.Username, user.Email, user.RoleId, user.DepartmentId, user.SpecializedSectionId, user.RelationshipType, user.IsActive, user.IsLocked }, cancellationToken: cancellationToken);

        var updated = await LoadUserQuery().AsNoTracking().FirstAsync(x => x.Id == user.Id, cancellationToken);
        return Ok(MapUser(updated));
    }

    [HttpPost("{id:long}/disable")]
    [Authorize(Policy = "Permission:users.manage")]
    public async Task<IActionResult> DisableUser(long id, CancellationToken cancellationToken)
    {
        var user = await db.Users.Include(x => x.Role).FirstOrDefaultAsync(x => x.Id == id, cancellationToken)
                   ?? throw new ApiException("المستخدم غير موجود", StatusCodes.Status404NotFound);
        await EnsureCanChangeSuperAdminStateAsync(user, user.RoleId, false, cancellationToken);
        user.IsActive = false;
        await db.SaveChangesAsync(cancellationToken);
        await auditService.LogAsync("user_disabled", "user", id.ToString(), cancellationToken: cancellationToken);
        return Ok(new { success = true });
    }

    [HttpPost("{id:long}/enable")]
    [Authorize(Policy = "Permission:users.manage")]
    public async Task<IActionResult> EnableUser(long id, CancellationToken cancellationToken)
    {
        var user = await db.Users.FirstOrDefaultAsync(x => x.Id == id, cancellationToken)
                   ?? throw new ApiException("المستخدم غير موجود", StatusCodes.Status404NotFound);
        user.IsActive = true;
        user.IsLocked = false;
        await db.SaveChangesAsync(cancellationToken);
        await auditService.LogAsync("user_enabled", "user", id.ToString(), cancellationToken: cancellationToken);
        return Ok(new { success = true });
    }

    [HttpPost("{id:long}/lock")]
    [Authorize(Policy = "Permission:users.manage")]
    public async Task<IActionResult> LockUser(long id, CancellationToken cancellationToken)
    {
        var user = await db.Users.FirstOrDefaultAsync(x => x.Id == id, cancellationToken)
                   ?? throw new ApiException("المستخدم غير موجود", StatusCodes.Status404NotFound);
        user.IsLocked = true;
        await db.SaveChangesAsync(cancellationToken);
        await auditService.LogAsync("user_locked", "user", id.ToString(), cancellationToken: cancellationToken);
        return Ok(new { success = true });
    }

    [HttpPost("{id:long}/unlock")]
    [Authorize(Policy = "Permission:users.manage")]
    public async Task<IActionResult> UnlockUser(long id, CancellationToken cancellationToken)
    {
        var user = await db.Users.FirstOrDefaultAsync(x => x.Id == id, cancellationToken)
                   ?? throw new ApiException("المستخدم غير موجود", StatusCodes.Status404NotFound);
        user.IsLocked = false;
        await db.SaveChangesAsync(cancellationToken);
        await auditService.LogAsync("user_unlocked", "user", id.ToString(), cancellationToken: cancellationToken);
        return Ok(new { success = true });
    }

    [HttpPost("{id:long}/reset-password")]
    [Authorize(Policy = "Permission:users.manage")]
    public async Task<ActionResult<object>> ResetPassword(long id, [FromBody] JsonElement request, CancellationToken cancellationToken)
    {
        await VerifyAdminPasswordIfProvidedAsync(request, cancellationToken);
        var user = await db.Users.FirstOrDefaultAsync(x => x.Id == id, cancellationToken)
                   ?? throw new ApiException("المستخدم غير موجود", StatusCodes.Status404NotFound);
        var password = await ResolveTemporaryPasswordAsync(
            StringProp(request, "password", "new_password", "newPassword"),
            cancellationToken);

        user.PasswordHash = passwordHasher.Hash(password);
        user.ForcePasswordChange = BoolProp(request, true, "force_password_change", "forcePasswordChange");
        user.PasswordChangedAt = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync(cancellationToken);
        await auditService.LogAsync("user_password_reset", "user", id.ToString(), cancellationToken: cancellationToken);
        return Ok(new { temporary_password = password, password });
    }

    [HttpPost("{id:long}/terminate-sessions")]
    [Authorize(Policy = "Permission:users.manage")]
    public async Task<IActionResult> TerminateUserSessions(long id, [FromBody] JsonElement request, CancellationToken cancellationToken)
    {
        await VerifyAdminPasswordIfProvidedAsync(request, cancellationToken);
        var now = DateTimeOffset.UtcNow;
        var tokens = await db.RefreshTokens
            .Where(x => x.UserId == id && x.RevokedAt == null && x.ExpiresAt > now)
            .ToListAsync(cancellationToken);
        foreach (var token in tokens)
        {
            token.RevokedAt = now;
            token.RevokedByIp = currentUser.IpAddress;
        }

        var sessions = await db.UserSessions
            .Where(x => x.UserId == id && x.IsActive && x.RevokedAt == null)
            .ToListAsync(cancellationToken);
        foreach (var session in sessions)
        {
            RevokeUserSession(session, "terminated_by_admin", now);
        }

        await db.SaveChangesAsync(cancellationToken);
        await auditService.LogAsync("sessions_terminated", "user", id.ToString(), metadata: new { token_count = tokens.Count, session_count = sessions.Count }, cancellationToken: cancellationToken);
        return Ok(new { success = true, revoked = tokens.Count, sessions_revoked = sessions.Count });
    }

    [HttpGet("{id:long}/effective-permissions")]
    [Authorize(Policy = "Permission:permissions.view")]
    public async Task<ActionResult<object>> GetEffectivePermissions(long id, CancellationToken cancellationToken)
    {
        var result = await permissionService.GetEffectivePermissionsAsync(id, cancellationToken);
        return Ok(result);
    }

    [HttpGet("screen-permissions/me")]
    [AllowAnonymous]
    public async Task<ActionResult<object>> GetMyScreenPermissions(CancellationToken cancellationToken)
    {
        var actorId = currentUser.UserId ?? throw new ApiException("غير مصرح", StatusCodes.Status401Unauthorized);
        var permissions = await permissionService.GetEffectivePermissionCodesAsync(actorId, cancellationToken);
        var messagingEnabled = await settingsStore.GetValueAsync("messaging.general.enable_messaging", true, cancellationToken);
        var screens = ScreenCatalog
            .Where(screen => messagingEnabled || !string.Equals(screen.Key, "messages", StringComparison.OrdinalIgnoreCase))
            .Where(screen => HasAnyPermission(permissions, screen.ViewPermissions.Concat(screen.ManagePermissions)))
            .Select(screen => screen.Key)
            .ToList();

        return Ok(new
        {
            screens,
            available_screens = ScreenCatalog.Select(x => new { key = x.Key, label = x.Label }).ToList()
        });
    }

    [HttpGet("organization/tree")]
    public async Task<ActionResult<IReadOnlyCollection<object>>> GetOrganizationTree(CancellationToken cancellationToken)
    {
        var departments = await db.Departments
            .Include(x => x.ManagerUser)
            .Include(x => x.Users)
            .AsNoTracking()
            .OrderBy(x => x.NameAr)
            .ToListAsync(cancellationToken);

        return Ok(departments.Select(department => new
        {
            department.Id,
            department.Code,
            name_ar = department.NameAr,
            name_en = department.NameEn,
            manager = department.ManagerUser is null ? null : MapUser(department.ManagerUser),
            users = department.Users.OrderBy(x => x.NameAr).Select(MapUser).ToList()
        }).ToList());
    }

    [HttpGet("organization/issues")]
    public async Task<ActionResult<IReadOnlyCollection<object>>> GetOrganizationIssues(CancellationToken cancellationToken)
    {
        var users = await LoadUserQuery().AsNoTracking().OrderBy(x => x.NameAr).ToListAsync(cancellationToken);
        var issues = new List<object>();
        foreach (var user in users)
        {
            if (user.DepartmentId is null)
            {
                issues.Add(new { user = MapUser(user), issue_type = "missing_department", message = "لا توجد إدارة مرتبطة بالمستخدم" });
            }

            if (user.DirectManagerId is null && !IsAdministrativeRole(user.Role?.Code))
            {
                issues.Add(new { user = MapUser(user), issue_type = "missing_manager", message = "لا يوجد مدير مباشر للمستخدم" });
            }
        }

        return Ok(issues);
    }

    [HttpPost("bulk-assign-department")]
    [Authorize(Policy = "Permission:users.manage")]
    public async Task<IActionResult> BulkAssignDepartment([FromBody] JsonElement request, CancellationToken cancellationToken)
    {
        var userIds = LongArrayProp(request, "user_ids", "userIds");
        var departmentId = LongProp(request, "department_id", "departmentId") ?? throw new ApiException("يجب اختيار الإدارة");
        if (!await db.Departments.AnyAsync(x => x.Id == departmentId && x.IsActive, cancellationToken))
        {
            throw new ApiException("الإدارة المحددة غير صالحة");
        }

        var users = await db.Users.Where(x => userIds.Contains(x.Id)).ToListAsync(cancellationToken);
        foreach (var user in users)
        {
            user.DepartmentId = departmentId;
        }

        await db.SaveChangesAsync(cancellationToken);
        await auditService.LogAsync("users_bulk_department_assigned", "user", metadata: new { userIds, departmentId }, cancellationToken: cancellationToken);
        return Ok(new { success = true, updated = users.Count });
    }

    [HttpPost("bulk-assign-manager")]
    [Authorize(Policy = "Permission:users.manage")]
    public async Task<IActionResult> BulkAssignManager([FromBody] JsonElement request, CancellationToken cancellationToken)
    {
        var userIds = LongArrayProp(request, "user_ids", "userIds");
        var managerId = LongProp(request, "manager_id", "managerId") ?? throw new ApiException("يجب اختيار المدير");
        if (!await db.Users.AnyAsync(x => x.Id == managerId && x.IsActive, cancellationToken))
        {
            throw new ApiException("المدير المحدد غير صالح");
        }

        var users = await db.Users.Where(x => userIds.Contains(x.Id)).ToListAsync(cancellationToken);
        foreach (var user in users.Where(x => x.Id != managerId))
        {
            user.DirectManagerId = managerId;
        }

        await db.SaveChangesAsync(cancellationToken);
        await auditService.LogAsync("users_bulk_manager_assigned", "user", metadata: new { userIds, managerId }, cancellationToken: cancellationToken);
        return Ok(new { success = true, updated = users.Count });
    }

    [HttpGet("import-template")]
    [Authorize(Policy = "Permission:users.manage")]
    public IActionResult DownloadImportTemplate()
    {
        const string header = "full_name_ar,full_name_en,username,email,employee_id,mobile,job_title,department_code,manager_employee_id,role\n";
        var bytes = Encoding.UTF8.GetPreamble().Concat(Encoding.UTF8.GetBytes(header)).ToArray();
        return File(bytes, "text/csv; charset=utf-8", "users-import-template.csv");
    }

    [HttpGet("import/batches")]
    [Authorize(Policy = "Permission:users.manage")]
    public async Task<ActionResult<IReadOnlyCollection<object>>> GetImportBatches(CancellationToken cancellationToken)
    {
        var logs = await db.AuditLogs
            .Include(x => x.User)
            .AsNoTracking()
            .Where(x => x.Action == "user_import_validated" || x.Action == "user_import_confirmed")
            .OrderByDescending(x => x.CreatedAt)
            .Take(20)
            .ToListAsync(cancellationToken);
        return Ok(logs.Select(x => new
        {
            id = x.Id,
            file_name = "users-import-template.csv",
            total_rows = 0,
            valid_rows = 0,
            invalid_rows = 0,
            imported_rows = x.Action == "user_import_confirmed" ? 0 : (int?)null,
            status = x.Action == "user_import_confirmed" ? "imported" : "validated",
            uploaded_by = x.User?.NameAr ?? "-",
            uploaded_at = x.CreatedAt
        }).ToList());
    }

    [HttpPost("import/validate")]
    [Authorize(Policy = "Permission:users.manage")]
    public async Task<ActionResult<object>> ValidateImport(IFormFile? file, CancellationToken cancellationToken)
    {
        if (file is null || file.Length == 0)
        {
            throw new ApiException("يجب رفع ملف الاستيراد");
        }

        var batchId = $"batch-{DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()}";
        await auditService.LogAsync("user_import_validated", "user_import", batchId, metadata: new { file.FileName, file.Length }, cancellationToken: cancellationToken);
        return Ok(new
        {
            batch_id = batchId,
            total_rows = 0,
            valid_rows = 0,
            invalid_rows = 0,
            status = "validated",
            errors = Array.Empty<object>()
        });
    }

    [HttpPost("import/confirm")]
    [Authorize(Policy = "Permission:users.manage")]
    public async Task<IActionResult> ConfirmImport([FromBody] JsonElement request, CancellationToken cancellationToken)
    {
        if (!string.Equals(StringProp(request, "confirmation_text"), "IMPORT USERS", StringComparison.Ordinal))
        {
            throw new ApiException("عبارة التأكيد غير صحيحة");
        }

        await auditService.LogAsync("user_import_confirmed", "user_import", StringProp(request, "batch_id"), cancellationToken: cancellationToken);
        return Ok(new { success = true, imported_rows = 0 });
    }

    [HttpGet("sessions")]
    [Authorize(Policy = "Permission:users.manage")]
    public async Task<ActionResult<IReadOnlyCollection<object>>> GetSessions(CancellationToken cancellationToken)
    {
        var sessions = await GetUserSessionsQuery(null).Take(200).ToListAsync(cancellationToken);
        return Ok(sessions.Select(MapSession).ToList());
    }

    [HttpGet("login-attempts")]
    [Authorize(Policy = "Permission:users.manage")]
    public async Task<ActionResult<IReadOnlyCollection<object>>> GetLoginAttempts(CancellationToken cancellationToken)
    {
        var attempts = await db.UserLoginAttempts
            .Include(x => x.User)
            .AsNoTracking()
            .OrderByDescending(x => x.AttemptedAt)
            .Take(100)
            .ToListAsync(cancellationToken);

        return Ok(attempts.Select(attempt => new
        {
            id = attempt.Id,
            email_or_username = attempt.LoginIdentifier,
            user_name = attempt.User?.NameAr ?? "-",
            ip_address = attempt.IpAddress,
            user_agent = attempt.UserAgent,
            success = attempt.IsSuccess,
            failure_reason = attempt.FailureReason,
            created_at = attempt.AttemptedAt
        }).ToList());
    }

    [HttpPost("sessions/{sessionId:long}/revoke")]
    [Authorize(Policy = "Permission:users.manage")]
    public async Task<IActionResult> RevokeSession(long sessionId, CancellationToken cancellationToken)
    {
        var session = await db.UserSessions.FirstOrDefaultAsync(x => x.Id == sessionId, cancellationToken)
                    ?? throw new ApiException("الجلسة غير موجودة", StatusCodes.Status404NotFound);
        var now = DateTimeOffset.UtcNow;
        RevokeUserSession(session, "revoked_by_admin", now);

        if (!string.IsNullOrWhiteSpace(session.RefreshTokenHash))
        {
            var tokens = await db.RefreshTokens
                .Where(x => x.TokenHash == session.RefreshTokenHash && x.RevokedAt == null)
                .ToListAsync(cancellationToken);
            foreach (var token in tokens)
            {
                token.RevokedAt = now;
                token.RevokedByIp = currentUser.IpAddress;
            }
        }

        await db.SaveChangesAsync(cancellationToken);
        await auditService.LogAsync("session_revoked", "session", sessionId.ToString(), cancellationToken: cancellationToken);
        return Ok(new { success = true });
    }

    [HttpPost("sessions/revoke-all")]
    [Authorize(Policy = "Permission:users.manage")]
    public async Task<IActionResult> RevokeAllSessions([FromBody] JsonElement request, CancellationToken cancellationToken)
    {
        await VerifyAdminPasswordIfProvidedAsync(request, cancellationToken);
        if (!string.Equals(StringProp(request, "confirmation_text"), "REVOKE SESSIONS", StringComparison.Ordinal))
        {
            throw new ApiException("عبارة التأكيد غير صحيحة");
        }

        var now = DateTimeOffset.UtcNow;
        var tokens = await db.RefreshTokens.Where(x => x.RevokedAt == null && x.ExpiresAt > now).ToListAsync(cancellationToken);
        foreach (var token in tokens)
        {
            token.RevokedAt = now;
            token.RevokedByIp = currentUser.IpAddress;
        }

        var sessions = await db.UserSessions.Where(x => x.IsActive && x.RevokedAt == null).ToListAsync(cancellationToken);
        foreach (var session in sessions)
        {
            RevokeUserSession(session, "revoked_all_by_admin", now);
        }

        await db.SaveChangesAsync(cancellationToken);
        await auditService.LogAsync("sessions_revoked_all", "session", metadata: new { token_count = tokens.Count, session_count = sessions.Count }, cancellationToken: cancellationToken);
        return Ok(new { success = true, revoked = tokens.Count, sessions_revoked = sessions.Count });
    }

    [HttpGet("delegations")]
    [Authorize(Policy = "Permission:users.manage")]
    public async Task<ActionResult<IReadOnlyCollection<object>>> GetDelegations(CancellationToken cancellationToken)
    {
        var rows = await GetSettingJsonAsync<List<DelegationRecord>>("users.delegations", [], cancellationToken);
        var users = await db.Users.AsNoTracking().ToDictionaryAsync(x => x.Id, cancellationToken);
        return Ok(rows.Select(item => MapDelegation(item, users)).ToList());
    }

    [HttpPost("delegations")]
    [Authorize(Policy = "Permission:users.manage")]
    public async Task<ActionResult<object>> CreateDelegation([FromBody] JsonElement request, CancellationToken cancellationToken)
    {
        var delegatorId = LongProp(request, "delegator_user_id", "delegatorUserId") ?? throw new ApiException("يجب اختيار المفوض");
        var delegateId = LongProp(request, "delegate_user_id", "delegateUserId") ?? throw new ApiException("يجب اختيار البديل");
        if (delegatorId == delegateId)
        {
            throw new ApiException("لا يمكن أن يكون المفوض والبديل نفس المستخدم");
        }

        var users = await db.Users.AsNoTracking().Where(x => x.Id == delegatorId || x.Id == delegateId).ToListAsync(cancellationToken);
        if (users.Count != 2)
        {
            throw new ApiException("المستخدم المحدد غير صالح");
        }

        var rows = await GetSettingJsonAsync<List<DelegationRecord>>("users.delegations", [], cancellationToken);
        var record = new DelegationRecord(
            DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
            delegatorId,
            delegateId,
            StringProp(request, "delegation_scope", "delegationScope") ?? "approvals_only",
            DateTimeProp(request, "start_date", "startDate") ?? DateTimeOffset.UtcNow,
            DateTimeProp(request, "end_date", "endDate") ?? DateTimeOffset.UtcNow.AddDays(7),
            StringProp(request, "reason"),
            BoolProp(request, true, "is_active", "isActive"));
        rows.Add(record);
        await SetSettingJsonAsync("users.delegations", rows, cancellationToken);
        await auditService.LogAsync("delegation_created", "delegation", record.Id.ToString(), newValue: record, cancellationToken: cancellationToken);

        var userMap = users.ToDictionary(x => x.Id);
        return Ok(MapDelegation(record, userMap));
    }

    [HttpDelete("delegations/{id:long}")]
    [Authorize(Policy = "Permission:users.manage")]
    public async Task<IActionResult> DeleteDelegation(long id, CancellationToken cancellationToken)
    {
        var rows = await GetSettingJsonAsync<List<DelegationRecord>>("users.delegations", [], cancellationToken);
        var removed = rows.RemoveAll(x => x.Id == id);
        await SetSettingJsonAsync("users.delegations", rows, cancellationToken);
        await auditService.LogAsync("delegation_deleted", "delegation", id.ToString(), cancellationToken: cancellationToken);
        return Ok(new { success = true, removed });
    }

    [HttpGet("access-review")]
    [Authorize(Policy = "Permission:users.manage")]
    public async Task<ActionResult<object>> GetAccessReview(CancellationToken cancellationToken)
    {
        var review = await GetSettingJsonAsync<AccessReviewRecord?>("users.access_review.current", null, cancellationToken);
        return Ok(await MapAccessReviewAsync(review, cancellationToken));
    }

    [HttpPost("access-review")]
    [Authorize(Policy = "Permission:users.manage")]
    public async Task<ActionResult<object>> CreateAccessReview(CancellationToken cancellationToken)
    {
        var users = await LoadUserQuery().AsNoTracking().OrderBy(x => x.NameAr).ToListAsync(cancellationToken);
        var items = users
            .Where(x => x.DepartmentId == null || x.DirectManagerId == null || IsAdministrativeRole(x.Role?.Code))
            .Select(x => new AccessReviewItemRecord(
                DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() + x.Id,
                x.Id,
                IsAdministrativeRole(x.Role?.Code) ? "high_privilege" : x.DepartmentId == null ? "missing_department" : "missing_manager",
                IsAdministrativeRole(x.Role?.Code) ? "المستخدم لديه صلاحيات إدارية أو عالية" : x.DepartmentId == null ? "المستخدم بدون إدارة" : "المستخدم بدون مدير مباشر",
                "pending",
                null))
            .ToList();
        var review = new AccessReviewRecord(DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(), $"مراجعة صلاحيات {DateTimeOffset.Now:yyyy-MM-dd}", "open", DateTimeOffset.UtcNow, null, items);
        await SetSettingJsonAsync("users.access_review.current", review, cancellationToken);
        await auditService.LogAsync("access_review_created", "access_review", review.Id.ToString(), newValue: review, cancellationToken: cancellationToken);
        return Ok(await MapAccessReviewAsync(review, cancellationToken));
    }

    [HttpPost("access-review/{id:long}/complete")]
    [Authorize(Policy = "Permission:users.manage")]
    public async Task<ActionResult<object>> CompleteAccessReview(long id, CancellationToken cancellationToken)
    {
        var review = await GetSettingJsonAsync<AccessReviewRecord?>("users.access_review.current", null, cancellationToken)
                     ?? throw new ApiException("لا توجد مراجعة صلاحيات مفتوحة", StatusCodes.Status404NotFound);
        if (review.Id != id)
        {
            throw new ApiException("مراجعة الصلاحيات غير موجودة", StatusCodes.Status404NotFound);
        }

        review = review with { Status = "completed", CompletedAt = DateTimeOffset.UtcNow };
        await SetSettingJsonAsync("users.access_review.current", review, cancellationToken);
        await auditService.LogAsync("access_review_completed", "access_review", review.Id.ToString(), cancellationToken: cancellationToken);
        return Ok(await MapAccessReviewAsync(review, cancellationToken));
    }

    [HttpPost("access-review/items/{id:long}/mark-reviewed")]
    [Authorize(Policy = "Permission:users.manage")]
    public async Task<ActionResult<object>> MarkAccessReviewItem(long id, CancellationToken cancellationToken)
    {
        var review = await GetSettingJsonAsync<AccessReviewRecord?>("users.access_review.current", null, cancellationToken)
                     ?? throw new ApiException("لا توجد مراجعة صلاحيات مفتوحة", StatusCodes.Status404NotFound);
        var items = review.Items.Select(item => item.Id == id ? item with { Status = "reviewed", ReviewedAt = DateTimeOffset.UtcNow } : item).ToList();
        review = review with { Items = items };
        await SetSettingJsonAsync("users.access_review.current", review, cancellationToken);
        await auditService.LogAsync("access_review_item_reviewed", "access_review", id.ToString(), cancellationToken: cancellationToken);
        return Ok(await MapAccessReviewAsync(review, cancellationToken));
    }

    [HttpGet("audit-logs")]
    [Authorize(Policy = "Permission:users.manage")]
    public async Task<ActionResult<IReadOnlyCollection<object>>> GetUserAuditLogs(CancellationToken cancellationToken)
    {
        var logs = await db.AuditLogs
            .Include(x => x.User)
            .AsNoTracking()
            .Where(x => x.EntityType == "user" || x.EntityType == "role" || x.EntityType == "permission" || x.EntityType == "delegation" || x.EntityType == "access_review")
            .OrderByDescending(x => x.CreatedAt)
            .Take(200)
            .ToListAsync(cancellationToken);
        return Ok(logs.Select(MapAuditLog).ToList());
    }

    private IQueryable<User> LoadUserQuery()
    {
        return db.Users
            .Include(x => x.Role)
            .Include(x => x.Department)
            .Include(x => x.SpecializedSection)
            .Include(x => x.DirectManager);
    }

    private IQueryable<UserSession> GetUserSessionsQuery(long? userId)
    {
        var query = db.UserSessions.Include(x => x.User).AsNoTracking().OrderByDescending(x => x.StartedAt).AsQueryable();
        if (userId.HasValue)
        {
            query = query.Where(x => x.UserId == userId.Value);
        }

        return query;
    }

    private async Task<long> ResolveRoleIdAsync(JsonElement request, long? fallbackRoleId, CancellationToken cancellationToken)
    {
        var roleId = LongProp(request, "role_id", "roleId");
        if (roleId.HasValue)
        {
            return roleId.Value;
        }

        var roleCode = StringProp(request, "role")?.Trim();
        if (string.IsNullOrWhiteSpace(roleCode) && fallbackRoleId.HasValue)
        {
            return fallbackRoleId.Value;
        }

        roleCode ??= "employee";
        var role = await db.Roles.FirstOrDefaultAsync(x => x.Code == roleCode && x.IsActive, cancellationToken)
                   ?? throw new ApiException("الدور المحدد غير صالح");
        return role.Id;
    }

    private async Task<long?> ResolveUserSpecializedSectionIdAsync(JsonElement request, long roleId, long? fallbackSpecializedSectionId, CancellationToken cancellationToken)
    {
        var roleCode = await db.Roles
            .AsNoTracking()
            .Where(x => x.Id == roleId)
            .Select(x => x.Code)
            .FirstOrDefaultAsync(cancellationToken);

        if (!string.Equals(roleCode, "it_staff", StringComparison.OrdinalIgnoreCase))
        {
            return null;
        }

        var sectionId = LongProp(request, "specialized_section_id", "specializedSectionId");
        if (sectionId.HasValue)
        {
            return sectionId.Value <= 0 ? null : sectionId.Value;
        }

        var sectionCode = StringProp(request, "administrative_section", "specialized_section_code", "specializedSectionCode")?.Trim();
        if (!string.IsNullOrWhiteSpace(sectionCode))
        {
            var section = await db.SpecializedSections
                .AsNoTracking()
                .FirstOrDefaultAsync(x => x.Code == sectionCode && x.IsActive, cancellationToken)
                ?? throw new ApiException("القسم المختص المحدد غير صالح");
            return section.Id;
        }

        return fallbackSpecializedSectionId;
    }

    private async Task EnsureUserReferencesAsync(long roleId, long? departmentId, long? directManagerId, long? specializedSectionId, CancellationToken cancellationToken)
    {
        if (!await db.Roles.AnyAsync(x => x.Id == roleId && x.IsActive, cancellationToken))
        {
            throw new ApiException("الدور المحدد غير صالح");
        }

        if (departmentId.HasValue && !await db.Departments.AnyAsync(x => x.Id == departmentId.Value && x.IsActive, cancellationToken))
        {
            throw new ApiException("الإدارة المحددة غير صالحة");
        }

        if (directManagerId.HasValue && !await db.Users.AnyAsync(x => x.Id == directManagerId.Value && x.IsActive, cancellationToken))
        {
            throw new ApiException("المدير المباشر المحدد غير صالح");
        }

        if (specializedSectionId.HasValue && !await db.SpecializedSections.AnyAsync(x => x.Id == specializedSectionId.Value && x.IsActive, cancellationToken))
        {
            throw new ApiException("القسم المختص المحدد غير صالح");
        }
    }

    private async Task EnsureUserUniqueAsync(long? id, string username, string email, string? employeeNumber, CancellationToken cancellationToken)
    {
        var normalizedEmail = email.Trim().ToLowerInvariant();
        if (await db.Users.AnyAsync(x => x.Id != id && (x.Username == username || x.Email == normalizedEmail), cancellationToken))
        {
            throw new ApiException("اسم المستخدم أو البريد الإلكتروني مستخدم مسبقاً");
        }

        if (!string.IsNullOrWhiteSpace(employeeNumber) && await db.Users.AnyAsync(x => x.Id != id && x.EmployeeNumber == employeeNumber, cancellationToken))
        {
            throw new ApiException("الرقم الوظيفي مستخدم مسبقاً");
        }
    }

    private async Task EnsureCanChangeSuperAdminStateAsync(User user, long newRoleId, bool newIsActive, CancellationToken cancellationToken)
    {
        var superAdminRole = await db.Roles.FirstAsync(x => x.Code == "super_admin", cancellationToken);
        var isCurrentSuperAdmin = user.RoleId == superAdminRole.Id;
        var isLeavingSuperAdmin = isCurrentSuperAdmin && newRoleId != superAdminRole.Id;
        var isDisablingSuperAdmin = isCurrentSuperAdmin && !newIsActive;
        if (!isLeavingSuperAdmin && !isDisablingSuperAdmin)
        {
            return;
        }

        var activeSuperAdmins = await db.Users.CountAsync(x => x.Id != user.Id && x.RoleId == superAdminRole.Id && x.IsActive, cancellationToken);
        if (activeSuperAdmins == 0)
        {
            throw new ApiException("لا يمكن تعطيل أو تغيير آخر مدير نظام نشط");
        }
    }

    private async Task VerifyAdminPasswordIfProvidedAsync(JsonElement request, CancellationToken cancellationToken)
    {
        var adminPassword = StringProp(request, "admin_password", "adminPassword");
        if (string.IsNullOrWhiteSpace(adminPassword))
        {
            return;
        }

        var actorId = currentUser.UserId ?? throw new ApiException("غير مصرح", StatusCodes.Status401Unauthorized);
        var actor = await db.Users.AsNoTracking().FirstOrDefaultAsync(x => x.Id == actorId, cancellationToken)
                    ?? throw new ApiException("المستخدم الحالي غير موجود", StatusCodes.Status401Unauthorized);
        if (!passwordHasher.Verify(adminPassword, actor.PasswordHash))
        {
            throw new ApiException("كلمة مرور المدير غير صحيحة", StatusCodes.Status403Forbidden);
        }
    }

    private static string GenerateTemporaryPassword()
    {
        return $"Qib-{Convert.ToHexString(RandomNumberGenerator.GetBytes(6))}@26";
    }

    private async Task<string> ResolveTemporaryPasswordAsync(string? incomingPassword, CancellationToken cancellationToken)
    {
        if (!string.IsNullOrEmpty(incomingPassword))
        {
            return incomingPassword;
        }

        var configuredPassword = await settingsStore.GetValueAsync("security.temporary_password", "", cancellationToken);
        return string.IsNullOrEmpty(configuredPassword) ? GenerateTemporaryPassword() : configuredPassword;
    }

    private static string NormalizeRelationshipType(string? value, string fallback = "employee")
    {
        var normalized = string.IsNullOrWhiteSpace(value) ? fallback : value.Trim();
        return normalized switch
        {
            "direct_manager" => "direct_manager",
            "administrative_permission" => "administrative_permission",
            "employee" => "employee",
            _ => "employee"
        };
    }

    private static string DisplayRelationshipType(User user)
    {
        var relationshipType = NormalizeRelationshipType(user.RelationshipType);
        if (relationshipType == "employee" && string.Equals(user.Role?.Code, "direct_manager", StringComparison.OrdinalIgnoreCase))
        {
            return "direct_manager";
        }

        return relationshipType;
    }

    private static object MapUser(User user)
    {
        return new
        {
            user.Id,
            user.Username,
            user.Email,
            employee_id = user.EmployeeNumber,
            employee_number = user.EmployeeNumber,
            full_name_ar = user.NameAr,
            full_name_en = user.NameEn,
            name_ar = user.NameAr,
            name_en = user.NameEn,
            mobile = user.Phone,
            phone = user.Phone,
            job_title = user.JobTitle,
            is_active = user.IsActive,
            is_locked = user.IsLocked,
            force_password_change = user.ForcePasswordChange,
            last_login_at = user.LastLoginAt,
            role_id = user.RoleId,
            role = user.Role?.Code,
            role_name_ar = user.Role?.NameAr,
            department_id = user.DepartmentId,
            department_name_ar = user.Department?.NameAr,
            department = user.Department is null ? null : new { user.Department.Id, user.Department.Code, name_ar = user.Department.NameAr, name_en = user.Department.NameEn },
            specialized_section_id = user.SpecializedSectionId,
            specializedSectionId = user.SpecializedSectionId,
            specialized_section_code = user.SpecializedSection?.Code,
            specializedSectionCode = user.SpecializedSection?.Code,
            specialized_section_name_ar = user.SpecializedSection?.NameAr,
            specializedSectionNameAr = user.SpecializedSection?.NameAr,
            specialized_section = user.SpecializedSection is null ? null : new { user.SpecializedSection.Id, user.SpecializedSection.Code, name_ar = user.SpecializedSection.NameAr, name_en = user.SpecializedSection.NameEn },
            manager_id = user.DirectManagerId,
            direct_manager_id = user.DirectManagerId,
            manager_name_ar = user.DirectManager?.NameAr,
            relationship_type = DisplayRelationshipType(user),
            administrative_section = user.SpecializedSection?.Code,
            administrative_section_label = user.SpecializedSection?.NameAr,
            password_expires_at = (DateTimeOffset?)null,
            locked_until = user.IsLocked ? DateTimeOffset.UtcNow.AddYears(10) : (DateTimeOffset?)null,
            allowed_login_from_ip = (string?)null,
            notes = (string?)null,
            created_at = user.CreatedAt,
            updated_at = user.UpdatedAt
        };
    }

    private static object MapSession(UserSession session)
    {
        var active = session.IsActive && session.RevokedAt == null && (session.ExpiresAt == null || session.ExpiresAt > DateTimeOffset.UtcNow);
        return new
        {
            session.Id,
            user_id = session.UserId,
            user_name = session.User?.NameAr ?? session.User?.Username ?? "-",
            ip_address = session.IpAddress,
            user_agent = session.UserAgent,
            login_at = session.StartedAt,
            last_activity_at = session.LastSeenAt ?? session.StartedAt,
            expires_at = session.ExpiresAt,
            revoked_at = session.RevokedAt,
            revocation_reason = session.RevocationReason,
            is_active = active
        };
    }

    private static void RevokeUserSession(UserSession session, string reason, DateTimeOffset now)
    {
        session.IsActive = false;
        session.RevokedAt = now;
        session.RevocationReason = reason;
        session.LastSeenAt = now;
    }

    private static object MapAuditLog(AuditLog log)
    {
        return new
        {
            log.Id,
            log.Action,
            affected_user_id = log.EntityType == "user" ? log.EntityId : null,
            performed_by = log.User?.NameAr ?? log.User?.Username ?? "-",
            user_id = log.UserId,
            ip_address = log.IpAddress,
            user_agent = log.UserAgent,
            result = log.Result,
            created_at = log.CreatedAt
        };
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

    private async Task<object> MapAccessReviewAsync(AccessReviewRecord? review, CancellationToken cancellationToken)
    {
        var currentItems = await BuildCurrentAccessReviewItemsAsync(cancellationToken);
        if (review is null)
        {
            return new { latest_review = (object?)null, items = currentItems, saved_items = Array.Empty<object>() };
        }

        var userIds = review.Items.Select(x => x.UserId).Distinct().ToList();
        var users = await LoadUserQuery().AsNoTracking().Where(x => userIds.Contains(x.Id)).ToDictionaryAsync(x => x.Id, cancellationToken);
        return new
        {
            latest_review = new
            {
                id = review.Id,
                review_name = review.ReviewName,
                status = review.Status,
                created_at = review.CreatedAt,
                completed_at = review.CompletedAt
            },
            items = currentItems,
            saved_items = review.Items.Select(item =>
            {
                users.TryGetValue(item.UserId, out var user);
                return new
                {
                    id = item.Id,
                    user = user is null ? null : MapUser(user),
                    issue_type = item.IssueType,
                    description = item.Description,
                    status = item.Status,
                    reviewed_at = item.ReviewedAt
                };
            }).ToList()
        };
    }

    private async Task<List<object>> BuildCurrentAccessReviewItemsAsync(CancellationToken cancellationToken)
    {
        var users = await LoadUserQuery().AsNoTracking().OrderBy(x => x.NameAr).ToListAsync(cancellationToken);
        return users
            .Where(x => x.DepartmentId == null || x.DirectManagerId == null || IsAdministrativeRole(x.Role?.Code))
            .Select(x => new
            {
                user = MapUser(x),
                issue_type = IsAdministrativeRole(x.Role?.Code) ? "high_privilege" : x.DepartmentId == null ? "missing_department" : "missing_manager",
                description = IsAdministrativeRole(x.Role?.Code) ? "المستخدم لديه صلاحيات إدارية أو عالية" : x.DepartmentId == null ? "المستخدم بدون إدارة" : "المستخدم بدون مدير مباشر",
                status = "pending"
            })
            .Cast<object>()
            .ToList();
    }

    private async Task<T> GetSettingJsonAsync<T>(string key, T defaultValue, CancellationToken cancellationToken)
    {
        var value = await db.SystemSettings.AsNoTracking().Where(x => x.Key == key).Select(x => x.Value).FirstOrDefaultAsync(cancellationToken);
        if (string.IsNullOrWhiteSpace(value))
        {
            return defaultValue;
        }

        try
        {
            return JsonSerializer.Deserialize<T>(value, JsonOptions) ?? defaultValue;
        }
        catch
        {
            return defaultValue;
        }
    }

    private async Task SetSettingJsonAsync<T>(string key, T value, CancellationToken cancellationToken)
    {
        var setting = await db.SystemSettings.FirstOrDefaultAsync(x => x.Key == key, cancellationToken);
        if (setting is null)
        {
            setting = new SystemSetting
            {
                Key = key,
                Group = "users",
                DataType = "json",
                DescriptionAr = "إعداد داخلي لشاشة المستخدمين والصلاحيات"
            };
            db.SystemSettings.Add(setting);
        }

        setting.Value = JsonSerializer.Serialize(value, JsonOptions);
        setting.UpdatedByUserId = currentUser.UserId;
        await db.SaveChangesAsync(cancellationToken);
    }

    private static bool IsAdministrativeRole(string? roleCode)
    {
        return roleCode is "super_admin" or "administration_manager" or "executive_management";
    }

    private static bool HasAnyPermission(IReadOnlyCollection<string> permissions, IEnumerable<string> codes)
    {
        return codes.Any(code => permissions.Contains(code, StringComparer.OrdinalIgnoreCase));
    }

    private static string RequiredString(JsonElement json, params string[] names)
    {
        var value = StringProp(json, names);
        if (string.IsNullOrWhiteSpace(value))
        {
            throw new ApiException("توجد حقول مطلوبة غير مكتملة");
        }

        return value;
    }

    private static string? StringProp(JsonElement json, params string[] names)
    {
        foreach (var name in names)
        {
            if (TryGetProperty(json, name, out var value))
            {
                if (value.ValueKind == JsonValueKind.String)
                {
                    return value.GetString();
                }

                if (value.ValueKind == JsonValueKind.Number || value.ValueKind == JsonValueKind.True || value.ValueKind == JsonValueKind.False)
                {
                    return value.ToString();
                }
            }
        }

        return null;
    }

    private static long? LongProp(JsonElement json, params string[] names)
    {
        foreach (var name in names)
        {
            if (!TryGetProperty(json, name, out var value) || value.ValueKind == JsonValueKind.Null || value.ValueKind == JsonValueKind.Undefined)
            {
                continue;
            }

            if (value.ValueKind == JsonValueKind.Number && value.TryGetInt64(out var number))
            {
                return number;
            }

            if (value.ValueKind == JsonValueKind.String && long.TryParse(value.GetString(), out var parsed))
            {
                return parsed;
            }
        }

        return null;
    }

    private static List<long> LongArrayProp(JsonElement json, params string[] names)
    {
        foreach (var name in names)
        {
            if (!TryGetProperty(json, name, out var value) || value.ValueKind != JsonValueKind.Array)
            {
                continue;
            }

            return value.EnumerateArray()
                .Select(item => item.ValueKind == JsonValueKind.Number && item.TryGetInt64(out var number)
                    ? number
                    : item.ValueKind == JsonValueKind.String && long.TryParse(item.GetString(), out var parsed)
                        ? parsed
                        : 0)
                .Where(x => x > 0)
                .Distinct()
                .ToList();
        }

        return [];
    }

    private static bool BoolProp(JsonElement json, bool defaultValue, params string[] names)
    {
        foreach (var name in names)
        {
            if (!TryGetProperty(json, name, out var value) || value.ValueKind == JsonValueKind.Null || value.ValueKind == JsonValueKind.Undefined)
            {
                continue;
            }

            if (value.ValueKind == JsonValueKind.True)
            {
                return true;
            }

            if (value.ValueKind == JsonValueKind.False)
            {
                return false;
            }

            if (value.ValueKind == JsonValueKind.String && bool.TryParse(value.GetString(), out var parsed))
            {
                return parsed;
            }
        }

        return defaultValue;
    }

    private static DateTimeOffset? DateTimeProp(JsonElement json, params string[] names)
    {
        var value = StringProp(json, names);
        return DateTimeOffset.TryParse(value, out var parsed) ? parsed : null;
    }

    private static bool TryGetProperty(JsonElement json, string name, out JsonElement value)
    {
        if (json.ValueKind == JsonValueKind.Object && json.TryGetProperty(name, out value))
        {
            return true;
        }

        if (json.ValueKind == JsonValueKind.Object)
        {
            foreach (var property in json.EnumerateObject())
            {
                if (string.Equals(property.Name, name, StringComparison.OrdinalIgnoreCase))
                {
                    value = property.Value;
                    return true;
                }
            }
        }

        value = default;
        return false;
    }

    private static string? ExtractMetadataValue(string? json, string key)
    {
        if (string.IsNullOrWhiteSpace(json))
        {
            return null;
        }

        try
        {
            using var document = JsonDocument.Parse(json);
            return TryGetProperty(document.RootElement, key, out var value) ? value.ToString() : null;
        }
        catch
        {
            return null;
        }
    }

    internal static readonly ScreenDefinition[] ScreenCatalog =
    [
        new("dashboard", "إحصائيات", ["dashboard.view"], []),
        new("requests", "الطلبات", ["requests.view"], ["requests.manage"]),
        new("approvals", "الموافقات", ["approvals.view"], []),
        new("messages", "المراسلات", ["messages.view"], ["messages.send", "messages.manage"]),
        new("documents", "مكتبة الوثائق", ["documents.view"], ["documents.manage", "documents.download", "documents.print"]),
        new("reports", "التقارير", ["reports.view"], []),
        new("request_types", "إدارة الطلبات", ["request_types.view"], ["request_types.manage", "request_fields.manage", "request_workflows.manage"]),
        new("users", "المستخدمون والصلاحيات", ["users.view"], ["users.manage", "roles.manage", "permissions.manage"]),
        new("departments", "الإدارات", ["departments.view"], ["departments.manage"]),
        new("specialized_sections", "الأقسام المختصة", ["request_types.view"], ["request_types.manage"]),
        new("health_monitoring", "مراقبة صحة النظام", ["health.view"], ["health.run"]),
        new("messaging_settings", "إعدادات المراسلات", ["settings.view"], ["settings.manage", "official_letterheads.manage"]),
        new("document_settings", "إعدادات الوثائق", ["documents.manage"], ["documents.manage"]),
        new("ai_settings", "الذكاء الاصطناعي", ["settings.view"], ["settings.manage"]),
        new("database_settings", "قاعدة البيانات", ["settings.view"], ["settings.manage"]),
        new("settings", "الإعدادات", ["settings.view"], ["settings.manage"])
    ];

    internal sealed record ScreenDefinition(string Key, string Label, string[] ViewPermissions, string[] ManagePermissions);

    private sealed record DelegationRecord(
        [property: JsonPropertyName("id")] long Id,
        [property: JsonPropertyName("delegator_user_id")] long DelegatorUserId,
        [property: JsonPropertyName("delegate_user_id")] long DelegateUserId,
        [property: JsonPropertyName("delegation_scope")] string DelegationScope,
        [property: JsonPropertyName("start_date")] DateTimeOffset StartDate,
        [property: JsonPropertyName("end_date")] DateTimeOffset EndDate,
        [property: JsonPropertyName("reason")] string? Reason,
        [property: JsonPropertyName("is_active")] bool IsActive);

    private sealed record AccessReviewRecord(
        [property: JsonPropertyName("id")] long Id,
        [property: JsonPropertyName("review_name")] string ReviewName,
        [property: JsonPropertyName("status")] string Status,
        [property: JsonPropertyName("created_at")] DateTimeOffset CreatedAt,
        [property: JsonPropertyName("completed_at")] DateTimeOffset? CompletedAt,
        [property: JsonPropertyName("items")] List<AccessReviewItemRecord> Items);

    private sealed record AccessReviewItemRecord(
        [property: JsonPropertyName("id")] long Id,
        [property: JsonPropertyName("user_id")] long UserId,
        [property: JsonPropertyName("issue_type")] string IssueType,
        [property: JsonPropertyName("description")] string Description,
        [property: JsonPropertyName("status")] string Status,
        [property: JsonPropertyName("reviewed_at")] DateTimeOffset? ReviewedAt);
}
