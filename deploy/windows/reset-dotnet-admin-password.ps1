[CmdletBinding()]
param(
    [Parameter()]
    [ValidateNotNullOrEmpty()]
    [string]$Identifier = "admin@qib.internal-bank.qa",

    [Parameter()]
    [ValidateNotNullOrEmpty()]
    [string]$DatabaseHost = "localhost",

    [Parameter()]
    [ValidateRange(1, 65535)]
    [int]$DatabasePort = 5432,

    [Parameter()]
    [ValidateNotNullOrEmpty()]
    [string]$DatabaseName = "qib_service_portal_dotnet",

    [Parameter()]
    [ValidateNotNullOrEmpty()]
    [string]$DatabaseUser = "qib_dotnet",

    [Parameter()]
    [string]$PsqlPath,

    [Parameter()]
    [System.Security.SecureString]$DatabasePassword,

    [Parameter()]
    [System.Security.SecureString]$NewPassword,

    [Parameter()]
    [bool]$ForcePasswordChange = $true,

    [Parameter()]
    [switch]$KeepExistingSessions
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function ConvertTo-PlainText {
    param(
        [Parameter(Mandatory = $true)]
        [System.Security.SecureString]$SecureValue
    )

    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($SecureValue)
    try {
        return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
    }
    finally {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
    }
}

function Resolve-PsqlPath {
    param([string]$RequestedPath)

    if (-not [string]::IsNullOrWhiteSpace($RequestedPath)) {
        if (-not (Test-Path -LiteralPath $RequestedPath -PathType Leaf)) {
            throw "psql.exe was not found at: $RequestedPath"
        }

        return (Resolve-Path -LiteralPath $RequestedPath).Path
    }

    $command = Get-Command psql.exe -ErrorAction SilentlyContinue
    if ($null -ne $command) {
        return $command.Source
    }

    $searchRoots = @()
    if ($env:ProgramFiles) {
        $searchRoots += (Join-Path $env:ProgramFiles "PostgreSQL\*\bin\psql.exe")
    }
    if (${env:ProgramFiles(x86)}) {
        $searchRoots += (Join-Path ${env:ProgramFiles(x86)} "PostgreSQL\*\bin\psql.exe")
    }

    $candidates = @(
        $searchRoots |
            ForEach-Object { Get-ChildItem -Path $_ -File -ErrorAction SilentlyContinue } |
            Sort-Object {
                $version = 0
                [void][int]::TryParse($_.Directory.Parent.Name, [ref]$version)
                $version
            } -Descending
    )

    if ($candidates.Count -eq 0) {
        throw "psql.exe was not found. Install PostgreSQL client tools or pass -PsqlPath."
    }

    return $candidates[0].FullName
}

function New-ServicePortalPasswordHash {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Password
    )

    $iterations = 100000
    $salt = New-Object byte[] 16
    $generator = [Security.Cryptography.RandomNumberGenerator]::Create()
    try {
        $generator.GetBytes($salt)
    }
    finally {
        $generator.Dispose()
    }

    $passwordBytes = [Text.Encoding]::UTF8.GetBytes($Password)
    $deriver = [Security.Cryptography.Rfc2898DeriveBytes]::new(
        $passwordBytes,
        $salt,
        $iterations,
        [Security.Cryptography.HashAlgorithmName]::SHA256
    )

    try {
        $key = $deriver.GetBytes(32)
    }
    finally {
        $deriver.Dispose()
        [Array]::Clear($passwordBytes, 0, $passwordBytes.Length)
    }

    $saltBase64 = [Convert]::ToBase64String($salt)
    $keyBase64 = [Convert]::ToBase64String($key)
    return ('PBKDF2${0}${1}${2}' -f $iterations, $saltBase64, $keyBase64)
}

$psql = Resolve-PsqlPath -RequestedPath $PsqlPath
$databasePasswordText = $null
$newPasswordText = $null
$passwordHash = $null
$previousPgPassword = $env:PGPASSWORD

try {
    if ($null -eq $DatabasePassword) {
        $DatabasePassword = Read-Host "PostgreSQL password for $DatabaseUser" -AsSecureString
    }
    $databasePasswordText = ConvertTo-PlainText -SecureValue $DatabasePassword
    if ([string]::IsNullOrEmpty($databasePasswordText)) {
        throw "The PostgreSQL password cannot be empty."
    }

    if ($null -eq $NewPassword) {
        $NewPassword = Read-Host "New password for $Identifier" -AsSecureString
        $confirmation = Read-Host "Confirm the new password" -AsSecureString
        $newPasswordText = ConvertTo-PlainText -SecureValue $NewPassword
        $confirmationText = ConvertTo-PlainText -SecureValue $confirmation
        try {
            if ($newPasswordText -cne $confirmationText) {
                throw "The new password and confirmation do not match."
            }
        }
        finally {
            $confirmationText = $null
        }
    }
    else {
        $newPasswordText = ConvertTo-PlainText -SecureValue $NewPassword
    }

    if ([string]::IsNullOrEmpty($newPasswordText)) {
        throw "The new password cannot be empty."
    }

    $env:PGPASSWORD = $databasePasswordText

    $connectionArgs = @(
        "-X",
        "-q",
        "-A",
        "-t",
        "-v", "ON_ERROR_STOP=1",
        "-h", $DatabaseHost,
        "-p", $DatabasePort.ToString(),
        "-U", $DatabaseUser,
        "-d", $DatabaseName
    )

    Write-Host "Testing PostgreSQL connection..."
    $null = & $psql @connectionArgs -c "SELECT 1;"
    if ($LASTEXITCODE -ne 0) {
        throw "PostgreSQL connection failed."
    }

    $findUserSql = @'
SELECT "Id"
FROM users
WHERE LOWER("Email") = LOWER(:'identifier')
   OR LOWER("Username") = LOWER(:'identifier')
   OR LOWER(COALESCE("EmployeeNumber", '')) = LOWER(:'identifier')
ORDER BY "Id";
'@

    $rawUserIds = @(
        $findUserSql | & $psql @connectionArgs -v "identifier=$Identifier"
    )
    if ($LASTEXITCODE -ne 0) {
        throw "Unable to query the administrator account."
    }

    $userIds = @(
        $rawUserIds |
            ForEach-Object { $_.ToString().Trim() } |
            Where-Object { $_ -match '^\d+$' } |
            Select-Object -Unique
    )

    if ($userIds.Count -eq 0) {
        throw "No user matched '$Identifier'. Use the email, username, or employee number."
    }
    if ($userIds.Count -gt 1) {
        throw "More than one user matched '$Identifier'. Use a unique identifier."
    }

    $userId = $userIds[0]
    $passwordHash = New-ServicePortalPasswordHash -Password $newPasswordText
    $forceChangeValue = if ($ForcePasswordChange) { "true" } else { "false" }
    $revokeSessionsValue = if ($KeepExistingSessions) { "false" } else { "true" }

    $resetSql = @'
BEGIN;

UPDATE users
SET "PasswordHash" = :'password_hash',
    "IsActive" = TRUE,
    "IsLocked" = FALSE,
    "ForcePasswordChange" = :'force_password_change'::boolean,
    "PasswordChangedAt" = NOW(),
    "UpdatedAt" = NOW()
WHERE "Id" = :'user_id'::bigint;

UPDATE refresh_tokens
SET "RevokedAt" = NOW(),
    "RevokedByIp" = 'windows-emergency-reset'
WHERE :'revoke_sessions'::boolean
  AND "UserId" = :'user_id'::bigint
  AND "RevokedAt" IS NULL;

UPDATE user_sessions
SET "IsActive" = FALSE,
    "RevokedAt" = NOW(),
    "RevocationReason" = 'password_reset_windows_emergency',
    "UpdatedAt" = NOW()
WHERE :'revoke_sessions'::boolean
  AND "UserId" = :'user_id'::bigint
  AND "IsActive" = TRUE
  AND "RevokedAt" IS NULL;

INSERT INTO audit_logs
    ("UserId", "Action", "EntityType", "EntityId", "Result", "IpAddress", "UserAgent", "MetadataJson", "CreatedAt")
VALUES
    (NULL,
     'emergency_admin_password_reset',
     'user',
     :'user_id',
     'success',
     'localhost',
     'deploy/windows/reset-dotnet-admin-password.ps1',
     json_build_object(
         'identifier', :'identifier',
         'force_password_change', :'force_password_change'::boolean,
         'sessions_revoked', :'revoke_sessions'::boolean
     )::text,
     NOW());

COMMIT;

SELECT "Id", "Username", "Email", COALESCE("EmployeeNumber", ''), "IsActive", "IsLocked", "ForcePasswordChange"
FROM users
WHERE "Id" = :'user_id'::bigint;
'@

    Write-Host "Resetting password and unlocking account..."
    $result = $resetSql | & $psql @connectionArgs `
        -v "user_id=$userId" `
        -v "identifier=$Identifier" `
        -v "password_hash=$passwordHash" `
        -v "force_password_change=$forceChangeValue" `
        -v "revoke_sessions=$revokeSessionsValue"

    if ($LASTEXITCODE -ne 0) {
        throw "The password reset transaction failed. No partial change was committed."
    }

    Write-Host "Password reset completed successfully."
    Write-Host "Account identifier: $Identifier"
    Write-Host "User ID: $userId"
    Write-Host "Force password change: $ForcePasswordChange"
    Write-Host "Existing sessions revoked: $(-not $KeepExistingSessions.IsPresent)"
    if ($result) {
        Write-Host "Account status: $($result -join ' ')"
    }
}
finally {
    if ($null -eq $previousPgPassword) {
        Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
    }
    else {
        $env:PGPASSWORD = $previousPgPassword
    }

    $databasePasswordText = $null
    $newPasswordText = $null
    $passwordHash = $null
}
