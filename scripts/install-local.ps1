$ErrorActionPreference = "Stop"

$RootDir = Resolve-Path (Join-Path $PSScriptRoot "..")
$BackendDir = Join-Path $RootDir "backend"
$FrontendDir = Join-Path $RootDir "frontend"
$BackendPort = if ($env:BACKEND_PORT) { $env:BACKEND_PORT } else { "8000" }
$FrontendPort = if ($env:FRONTEND_PORT) { $env:FRONTEND_PORT } else { "5173" }

function Write-Step($Message) {
  Write-Host $Message -ForegroundColor Cyan
}

function Write-Ok($Message) {
  Write-Host $Message -ForegroundColor Green
}

function Require-Command($Command) {
  if (-not (Get-Command $Command -ErrorAction SilentlyContinue)) {
    Write-Host "الأمر '$Command' غير مثبت. يرجى تثبيته ثم أعد التشغيل." -ForegroundColor Red
    exit 1
  }
}

function Pick-Python {
  if ($env:PYTHON_BIN) {
    return $env:PYTHON_BIN
  }
  if (Get-Command py -ErrorAction SilentlyContinue) {
    return "py -3.12"
  }
  if (Get-Command python -ErrorAction SilentlyContinue) {
    return "python"
  }
  if (Get-Command python3 -ErrorAction SilentlyContinue) {
    return "python3"
  }
  Write-Host "لم يتم العثور على Python. يفضل Python 3.12 لتشغيل النظام محلياً." -ForegroundColor Red
  exit 1
}

function Invoke-Python($PythonCommand, $Arguments) {
  $parts = $PythonCommand -split " "
  if ($parts.Length -eq 1) {
    & $parts[0] @Arguments
  } else {
    & $parts[0] @($parts[1..($parts.Length - 1)]) @Arguments
  }
}

function Ensure-EnvFiles {
  $BackendEnv = Join-Path $BackendDir ".env"
  $FrontendEnv = Join-Path $FrontendDir ".env"

  if (-not (Test-Path $BackendEnv)) {
    Write-Step "إنشاء backend/.env للتشغيل المحلي..."
    @"
DATABASE_URL=sqlite:///./qib_local.db
SECRET_KEY=local-development-secret
CORS_ORIGINS=http://localhost:$FrontendPort,http://127.0.0.1:$FrontendPort
SEED_ADMIN_EMAIL=admin@qib.internal-bank.qa
SEED_ADMIN_PASSWORD=Admin@12345
"@ | Set-Content -Encoding UTF8 $BackendEnv
  }

  if (-not (Test-Path $FrontendEnv)) {
    Write-Step "إنشاء frontend/.env للتشغيل المحلي..."
    "VITE_API_BASE_URL=http://localhost:$BackendPort/api/v1" | Set-Content -Encoding UTF8 $FrontendEnv
  }
}

function Install-Backend($PythonCommand) {
  Write-Step "تجهيز بيئة Python..."
  Invoke-Python $PythonCommand @("-m", "venv", (Join-Path $BackendDir ".venv-local"))
  $VenvPython = Join-Path $BackendDir ".venv-local\Scripts\python.exe"
  & $VenvPython -m pip install --upgrade pip
  & $VenvPython -m pip install -r (Join-Path $BackendDir "requirements.txt")
}

function Install-Frontend {
  Write-Step "تثبيت اعتماديات الواجهة..."
  Require-Command "npm"
  Push-Location $FrontendDir
  & npm install
  Pop-Location
}

function Start-Services {
  Write-Step "تشغيل الخلفية على http://localhost:$BackendPort"
  $BackendPython = Join-Path $BackendDir ".venv-local\Scripts\uvicorn.exe"
  $BackendProcess = Start-Process -FilePath $BackendPython -ArgumentList "app.main:app", "--host", "0.0.0.0", "--port", $BackendPort -WorkingDirectory $BackendDir -PassThru

  Write-Step "تشغيل الواجهة على http://localhost:$FrontendPort"
  $NpmCommand = (Get-Command npm).Source
  $FrontendProcess = Start-Process -FilePath $NpmCommand -ArgumentList "run", "dev", "--", "--host", "0.0.0.0", "--port", $FrontendPort -WorkingDirectory $FrontendDir -PassThru

  Write-Ok "تم التشغيل."
  Write-Host ""
  Write-Host "الواجهة:  http://localhost:$FrontendPort"
  Write-Host "الخلفية:  http://localhost:$BackendPort"
  Write-Host "توثيق API: http://localhost:$BackendPort/docs"
  Write-Host ""
  Write-Host "الحساب الافتراضي:"
  Write-Host "Email:    admin@qib.internal-bank.qa"
  Write-Host "Password: Admin@12345"
  Write-Host ""
  Write-Host "لإيقاف النظام أغلق هذه النافذة أو اضغط Ctrl+C ثم أوقف العمليات عند الحاجة."

  try {
    Wait-Process -Id $BackendProcess.Id, $FrontendProcess.Id
  } finally {
    Stop-Process -Id $BackendProcess.Id, $FrontendProcess.Id -ErrorAction SilentlyContinue
  }
}

Write-Host ""
Write-Ok "نظام إدارة طلبات الخدمات التقنية - التثبيت المحلي"
Write-Host "================================================="

Require-Command "node"
Require-Command "npm"

$PythonCommand = Pick-Python
Write-Step "استخدام Python: $PythonCommand"

Ensure-EnvFiles
Install-Backend $PythonCommand
Install-Frontend
Start-Services
