param(
    [string]$ProjectRoot = (Resolve-Path "$PSScriptRoot\..\..").Path,
    [string]$InstallRoot = "C:\QIB\ServicePortal",
    [string]$FrontendSiteName = "QIB Service Portal",
    [string]$ApiSiteName = "QIB Service Portal API",
    [string]$FrontendHostName = "",
    [int]$FrontendPort = 80,
    [int]$ApiPort = 8088,
    [string]$ApiBaseUrl = "/api/dotnet/v1",
    [string]$DatabaseHost = "localhost",
    [int]$DatabasePort = 5432,
    [string]$DatabaseName = "qib_service_portal_dotnet",
    [string]$DatabaseUser = "qib_dotnet",
    [Parameter(Mandatory = $true)]
    [string]$DatabasePassword,
    [Parameter(Mandatory = $true)]
    [string]$JwtSecret,
    [string]$SeedAdminEmail = "admin@qib.internal-bank.qa",
    [string]$SeedAdminPassword = "ChangeMe@12345",
    [switch]$SkipBuild,
    [switch]$ConfigureIis
)

$ErrorActionPreference = "Stop"

function Write-Step {
    param([string]$Message)
    Write-Host ""
    Write-Host "==> $Message" -ForegroundColor Cyan
}

function Ensure-Directory {
    param([string]$Path)
    if (-not (Test-Path $Path)) {
        New-Item -ItemType Directory -Path $Path | Out-Null
    }
}

if ($JwtSecret.Length -lt 32) {
    throw "JwtSecret must be at least 32 characters."
}

$apiSource = Join-Path $ProjectRoot "Qib.ServicePortal.Api"
$frontendSource = Join-Path $ProjectRoot "frontend"
$windowsDeploy = Join-Path $ProjectRoot "deploy\windows"

$apiPublishTemp = Join-Path $ProjectRoot ".deploy\dotnet-api"
$frontendBuildDir = Join-Path $frontendSource "dist"

$apiTarget = Join-Path $InstallRoot "api"
$frontendTarget = Join-Path $InstallRoot "frontend"
$uploadsPath = Join-Path $InstallRoot "uploads"
$backupsPath = Join-Path $InstallRoot "backups"
$logsPath = Join-Path $InstallRoot "logs"

Write-Step "Preparing folders"
Ensure-Directory $InstallRoot
Ensure-Directory $apiTarget
Ensure-Directory $frontendTarget
Ensure-Directory $uploadsPath
Ensure-Directory $backupsPath
Ensure-Directory $logsPath
Ensure-Directory $apiPublishTemp

if (-not $SkipBuild) {
    Write-Step "Publishing ASP.NET Core API"
    Push-Location $apiSource
    dotnet restore
    dotnet publish -c Release -o $apiPublishTemp
    Pop-Location

    Write-Step "Building React frontend"
    Push-Location $frontendSource
    if (Test-Path "package-lock.json") {
        npm ci
    } else {
        npm install
    }
    $env:VITE_API_BASE_URL = $ApiBaseUrl
    npm run build
    Pop-Location
}

Write-Step "Copying API publish output"
Remove-Item "$apiTarget\*" -Recurse -Force -ErrorAction SilentlyContinue
Copy-Item "$apiPublishTemp\*" $apiTarget -Recurse -Force
Ensure-Directory (Join-Path $apiTarget "logs")
Copy-Item (Join-Path $windowsDeploy "api.web.config") (Join-Path $apiTarget "web.config") -Force

Write-Step "Writing appsettings.Production.json"
$connectionString = "Host=$DatabaseHost;Port=$DatabasePort;Database=$DatabaseName;Username=$DatabaseUser;Password=$DatabasePassword"
$productionSettings = [ordered]@{
    ConnectionStrings = @{
        DefaultConnection = $connectionString
    }
    Jwt = @{
        Issuer = "Qib.ServicePortal.DotNet"
        Audience = "Qib.ServicePortal"
        Secret = $JwtSecret
        AccessTokenMinutes = 30
        RefreshTokenDays = 14
    }
    SeedAdmin = @{
        Email = $SeedAdminEmail
        Username = "admin"
        Password = $SeedAdminPassword
    }
    Cors = @{
        Origins = @(
            "http://localhost:$FrontendPort",
            "http://127.0.0.1:$FrontendPort"
        )
    }
    Storage = @{
        UploadsPath = $uploadsPath
        BackupsPath = $backupsPath
    }
    Swagger = @{
        Enabled = $false
    }
    ApplyMigrationsOnStartup = $false
    EnableDangerousDatabaseOperations = $false
}

$productionSettings | ConvertTo-Json -Depth 10 | Set-Content -Path (Join-Path $apiTarget "appsettings.Production.json") -Encoding UTF8

Write-Step "Copying frontend build"
if (-not (Test-Path $frontendBuildDir)) {
    throw "Frontend dist folder not found: $frontendBuildDir. Run without -SkipBuild or build frontend first."
}
Remove-Item "$frontendTarget\*" -Recurse -Force -ErrorAction SilentlyContinue
Copy-Item "$frontendBuildDir\*" $frontendTarget -Recurse -Force
Copy-Item (Join-Path $windowsDeploy "frontend.web.config") (Join-Path $frontendTarget "web.config") -Force

if ($ConfigureIis) {
    Write-Step "Configuring IIS"
    Import-Module WebAdministration

    if (-not (Test-Path "IIS:\AppPools\$ApiSiteName")) {
        New-WebAppPool -Name $ApiSiteName | Out-Null
    }
    Set-ItemProperty "IIS:\AppPools\$ApiSiteName" managedRuntimeVersion ""
    Set-ItemProperty "IIS:\AppPools\$ApiSiteName" processModel.identityType "ApplicationPoolIdentity"

    if (-not (Test-Path "IIS:\AppPools\$FrontendSiteName")) {
        New-WebAppPool -Name $FrontendSiteName | Out-Null
    }
    Set-ItemProperty "IIS:\AppPools\$FrontendSiteName" managedRuntimeVersion ""

    if (Get-Website -Name $ApiSiteName -ErrorAction SilentlyContinue) {
        Set-ItemProperty "IIS:\Sites\$ApiSiteName" -Name physicalPath -Value $apiTarget
    } else {
        New-Website -Name $ApiSiteName -PhysicalPath $apiTarget -Port $ApiPort -IPAddress "127.0.0.1" -ApplicationPool $ApiSiteName | Out-Null
    }

    if (Get-Website -Name $FrontendSiteName -ErrorAction SilentlyContinue) {
        Set-ItemProperty "IIS:\Sites\$FrontendSiteName" -Name physicalPath -Value $frontendTarget
    } else {
        if ([string]::IsNullOrWhiteSpace($FrontendHostName)) {
            New-Website -Name $FrontendSiteName -PhysicalPath $frontendTarget -Port $FrontendPort -ApplicationPool $FrontendSiteName | Out-Null
        } else {
            New-Website -Name $FrontendSiteName -PhysicalPath $frontendTarget -Port $FrontendPort -HostHeader $FrontendHostName -ApplicationPool $FrontendSiteName | Out-Null
        }
    }

    Start-WebAppPool $ApiSiteName
    Start-WebAppPool $FrontendSiteName
    Start-Website $ApiSiteName
    Start-Website $FrontendSiteName
}

Write-Step "Deployment completed"
Write-Host "Frontend path: $frontendTarget"
Write-Host "API path:      $apiTarget"
Write-Host "Uploads path:  $uploadsPath"
Write-Host "Backups path:  $backupsPath"
Write-Host "API health:    http://127.0.0.1:$ApiPort/api/dotnet/v1/health/live"
Write-Host ""
Write-Host "Next steps:"
Write-Host "1. Create PostgreSQL database and user if not already created."
Write-Host "2. Install IIS URL Rewrite and ARR if using same-domain proxy from frontend.web.config."
Write-Host "3. Bind HTTPS certificate in IIS."
Write-Host "4. Change default admin password after first login."
