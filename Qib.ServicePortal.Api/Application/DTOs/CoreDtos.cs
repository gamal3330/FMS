namespace Qib.ServicePortal.Api.Application.DTOs;

public record LoginRequest(string Identifier, string Password);
public record RefreshTokenRequest(string RefreshToken);
public record LogoutRequest(string? RefreshToken);
public record ChangePasswordRequest(string CurrentPassword, string NewPassword);

public record AuthResponse(
    string AccessToken,
    string RefreshToken,
    DateTimeOffset AccessTokenExpiresAt,
    bool ForcePasswordChange,
    CurrentUserDto User);

public record CurrentUserDto(
    long Id,
    string Username,
    string Email,
    string NameAr,
    string? NameEn,
    string? EmployeeNumber,
    string? JobTitle,
    bool IsActive,
    bool ForcePasswordChange,
    RoleDto? Role,
    DepartmentDto? Department,
    long? SpecializedSectionId,
    string? SpecializedSectionCode,
    string? SpecializedSectionNameAr,
    IReadOnlyCollection<string> Permissions);

public record UserDto(
    long Id,
    string Username,
    string Email,
    string? EmployeeNumber,
    string NameAr,
    string? NameEn,
    string? Phone,
    string? JobTitle,
    bool IsActive,
    bool IsLocked,
    bool ForcePasswordChange,
    DateTimeOffset? LastLoginAt,
    long RoleId,
    string? RoleNameAr,
    long? DepartmentId,
    string? DepartmentNameAr,
    long? SpecializedSectionId,
    string? SpecializedSectionCode,
    string? SpecializedSectionNameAr,
    long? DirectManagerId,
    string? DirectManagerNameAr,
    DateTimeOffset CreatedAt,
    DateTimeOffset UpdatedAt);

public record CreateUserRequest(
    string Username,
    string Email,
    string Password,
    string NameAr,
    string? NameEn,
    string? EmployeeNumber,
    string? Phone,
    string? JobTitle,
    long RoleId,
    long? DepartmentId,
    long? DirectManagerId,
    bool ForcePasswordChange);

public record UpdateUserRequest(
    string Email,
    string NameAr,
    string? NameEn,
    string? EmployeeNumber,
    string? Phone,
    string? JobTitle,
    long RoleId,
    long? DepartmentId,
    long? DirectManagerId,
    bool IsActive,
    bool IsLocked,
    bool ForcePasswordChange);

public record ResetPasswordRequest(string? NewPassword, bool ForcePasswordChange = true);
public record TemporaryPasswordResponse(string TemporaryPassword);

public record RoleDto(
    long Id,
    string Code,
    string NameAr,
    string? NameEn,
    string? Description,
    bool IsSystem,
    bool IsActive,
    int UsersCount,
    DateTimeOffset CreatedAt,
    DateTimeOffset UpdatedAt);

public record RoleRequest(
    string Code,
    string NameAr,
    string? NameEn,
    string? Description,
    bool IsActive);

public record UpdateRolePermissionsRequest(IReadOnlyCollection<string> PermissionCodes);

public record PermissionDto(long Id, string Code, string NameAr, string? NameEn, string Module, bool IsActive);

public record EffectivePermissionsDto(
    long UserId,
    string Username,
    string RoleCode,
    IReadOnlyCollection<string> Permissions,
    IReadOnlyCollection<string> ExplicitAllows,
    IReadOnlyCollection<string> ExplicitDenies);

public record DepartmentDto(
    long Id,
    string Code,
    string NameAr,
    string? NameEn,
    string? Description,
    long? ParentDepartmentId,
    long? ManagerUserId,
    string? ManagerNameAr,
    bool IsActive,
    DateTimeOffset CreatedAt,
    DateTimeOffset UpdatedAt);

public record DepartmentRequest(
    string Code,
    string NameAr,
    string? NameEn,
    string? Description,
    long? ParentDepartmentId,
    long? ManagerUserId,
    bool IsActive);

public record AuditLogDto(
    long Id,
    string Action,
    string EntityType,
    string? EntityId,
    string Result,
    long? UserId,
    string? Username,
    string? IpAddress,
    string? UserAgent,
    string? OldValueJson,
    string? NewValueJson,
    string? MetadataJson,
    DateTimeOffset CreatedAt);

public record SystemSettingDto(
    long Id,
    string Key,
    string? Value,
    string Group,
    string DataType,
    bool IsSensitive,
    string? DescriptionAr,
    DateTimeOffset CreatedAt,
    DateTimeOffset UpdatedAt);

public record UpsertSystemSettingRequest(
    string? Value,
    string Group,
    string DataType,
    bool IsSensitive,
    string? DescriptionAr);

public record HealthResponse(string Status, DateTimeOffset CheckedAt, string Service, string Version);

public record DatabaseHealthResponse(
    string Status,
    string Provider,
    long LatencyMs,
    int UsersCount,
    int RolesCount,
    int DepartmentsCount,
    DateTimeOffset CheckedAt);
