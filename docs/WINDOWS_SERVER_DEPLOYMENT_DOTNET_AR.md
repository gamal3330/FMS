# دليل نشر QIB Service Portal على Windows Server

هذا الدليل يشرح نشر النظام على **Windows Server** باستخدام:

- IIS للواجهة و ASP.NET Core API.
- PostgreSQL كقاعدة بيانات.
- React Frontend مبني كملفات Static.
- ASP.NET Core API مستقل على `/api/dotnet/v1`.

> هذا الدليل خاص بنسخة .NET المستقلة داخل `Qib.ServicePortal.Api/`. لا يغير نسخة FastAPI الحالية ولا يرحل قاعدة الإنتاج تلقائياً.

---

## 1. المتطلبات

### نظام التشغيل

- Windows Server 2019 أو Windows Server 2022.
- صلاحية Administrator على الخادم.

### البرامج المطلوبة

- IIS.
- .NET 8 SDK إذا كان السيرفر سيبني النظام من المصدر.
- ASP.NET Core Hosting Bundle for .NET 8 لتشغيل API داخل IIS.
- PostgreSQL 16 أو إصدار حديث مدعوم.
- Node.js LTS لبناء الواجهة.
- Git إذا كان السحب من مستودع Git. إذا لم يتوفر Git يمكن نقل حزمة ZIP من جهاز التطوير.
- IIS URL Rewrite.
- IIS Application Request Routing إذا أردت تمرير `/api/dotnet/v1` من نفس دومين الواجهة إلى API داخلي.

روابط Microsoft المهمة:

- .NET Hosting Bundle: ابحث عن **.NET 8 Hosting Bundle** من موقع Microsoft الرسمي.
- IIS URL Rewrite: ابحث عن **IIS URL Rewrite Module**.
- ARR: ابحث عن **IIS Application Request Routing**.

---

## 2. الشكل المقترح للنشر

```text
C:\QIB\ServicePortal\
  api\        ملفات ASP.NET Core المنشورة
  frontend\   ملفات React بعد build
  uploads\    المرفقات
  backups\    النسخ الاحتياطية
  logs\       سجلات التشغيل
```

المنافذ المقترحة:

```text
Frontend public site: https://portal.example.com
Internal API site:    http://127.0.0.1:8088
Public API route:     https://portal.example.com/api/dotnet/v1
PostgreSQL:           localhost:5432
```

الفكرة:

- المستخدم يدخل على الواجهة من IIS.
- الواجهة تستدعي `/api/dotnet/v1`.
- IIS يمرر هذا المسار إلى API الداخلي على `127.0.0.1:8088`.

---

## 3. تثبيت IIS

افتح PowerShell كمسؤول ونفذ:

```powershell
Install-WindowsFeature Web-Server, Web-WebServer, Web-Common-Http, Web-Static-Content, Web-Default-Doc, Web-Http-Errors, Web-Http-Redirect, Web-Filtering, Web-Stat-Compression, Web-Mgmt-Console
```

بعد تثبيت .NET Hosting Bundle، أعد تشغيل IIS:

```powershell
iisreset
```

تأكد من وجود ASP.NET Core Module:

```powershell
Get-WebGlobalModule | Where-Object { $_.Name -like "*AspNetCore*" }
```

---

## 4. إعداد PostgreSQL

افتح `psql` كمستخدم postgres، ثم نفذ:

```sql
CREATE USER qib_dotnet WITH PASSWORD 'CHANGE_THIS_STRONG_PASSWORD';
CREATE DATABASE qib_service_portal_dotnet OWNER qib_dotnet;
GRANT ALL PRIVILEGES ON DATABASE qib_service_portal_dotnet TO qib_dotnet;
```

اختبار الاتصال:

```powershell
psql -h localhost -p 5432 -U qib_dotnet -d qib_service_portal_dotnet
```

ملاحظات مهمة:

- لا تستخدم كلمة مرور التطوير الافتراضية في الإنتاج.
- اجعل PostgreSQL يستمع محلياً فقط إذا كان على نفس الخادم.
- خذ نسخة احتياطية قبل أي تحديث.

---

## 5. إعداد مجلدات النظام

```powershell
New-Item -ItemType Directory -Force C:\QIB\ServicePortal\api
New-Item -ItemType Directory -Force C:\QIB\ServicePortal\frontend
New-Item -ItemType Directory -Force C:\QIB\ServicePortal\uploads
New-Item -ItemType Directory -Force C:\QIB\ServicePortal\backups
New-Item -ItemType Directory -Force C:\QIB\ServicePortal\logs
```

امنح App Pool صلاحية على المجلدات بعد إنشاء App Pools:

```powershell
icacls C:\QIB\ServicePortal\uploads /grant "IIS AppPool\QIB Service Portal API:(OI)(CI)M"
icacls C:\QIB\ServicePortal\backups /grant "IIS AppPool\QIB Service Portal API:(OI)(CI)M"
icacls C:\QIB\ServicePortal\logs /grant "IIS AppPool\QIB Service Portal API:(OI)(CI)M"
```

---

## 6. نقل ملفات النظام إلى السيرفر

لديك خياران:

### الخيار الأول: Git

```powershell
New-Item -ItemType Directory -Force C:\QIB\Source
cd C:\QIB\Source
git clone <رابط_المستودع> FMS
cd FMS
```

### الخيار الثاني: حزمة ZIP

من جهاز التطوير أنشئ حزمة Windows:

```bash
scripts/create-windows-deployment-package.sh
```

سينتج ملف داخل:

```text
.deploy/windows/
```

انسخ الملف إلى السيرفر، ثم فك الضغط:

```powershell
New-Item -ItemType Directory -Force C:\QIB\Source\FMS
Expand-Archive C:\Temp\qib-service-portal-windows-*.zip C:\QIB\Source\FMS -Force
cd C:\QIB\Source\FMS
```

> ملاحظة: الحزمة لا تحتوي `node_modules` ولا ملفات `bin/obj` ولا أسرار الإنتاج.

---

## 7. أوامر publish للـ API

من جذر المشروع:

```powershell
cd Qib.ServicePortal.Api
dotnet restore
dotnet publish -c Release -o C:\QIB\ServicePortal\api
```

انسخ قالب API web.config:

```powershell
copy ..\deploy\windows\api.web.config C:\QIB\ServicePortal\api\web.config
```

---

## 8. ملف appsettings.Production.json

أنشئ الملف:

```text
C:\QIB\ServicePortal\api\appsettings.Production.json
```

مثال:

```json
{
  "ConnectionStrings": {
    "DefaultConnection": "Host=localhost;Port=5432;Database=qib_service_portal_dotnet;Username=qib_dotnet;Password=CHANGE_THIS_STRONG_PASSWORD"
  },
  "Jwt": {
    "Issuer": "Qib.ServicePortal.DotNet",
    "Audience": "Qib.ServicePortal",
    "Secret": "CHANGE_THIS_TO_A_LONG_RANDOM_SECRET_AT_LEAST_32_CHARS",
    "AccessTokenMinutes": 30,
    "RefreshTokenDays": 14
  },
  "SeedAdmin": {
    "Email": "admin@qib.internal-bank.qa",
    "Username": "admin",
    "Password": "CHANGE_THIS_INITIAL_PASSWORD"
  },
  "Cors": {
    "Origins": [
      "https://portal.example.com"
    ]
  },
  "Storage": {
    "UploadsPath": "C:\\QIB\\ServicePortal\\uploads",
    "BackupsPath": "C:\\QIB\\ServicePortal\\backups"
  },
  "Swagger": {
    "Enabled": false
  },
  "ApplyMigrationsOnStartup": false,
  "EnableDangerousDatabaseOperations": false
}
```

ملاحظات:

- `Jwt:Secret` يجب ألا يقل عن 32 حرفاً.
- لا تضع أسرار الإنتاج داخل Git.
- `EnableDangerousDatabaseOperations` يبقى `false` إلا لحالة صيانة مخططة وبعد نسخة احتياطية.

### استعادة كلمة مرور مدير النظام عند نسيانها

يحتوي المشروع على سكربت Windows مخصص يعيد تعيين كلمة المرور مباشرة في قاعدة .NET المستقلة، ويفك قفل الحساب، ويلغي الجلسات القديمة، ويسجل العملية في سجل التدقيق:

```text
deploy\windows\reset-dotnet-admin-password.ps1
```

شغله من **جذر المشروع** في PowerShell:

```powershell
Set-Location C:\QIB\Source\FMS

.\deploy\windows\reset-dotnet-admin-password.ps1 `
  -Identifier "admin@qib.internal-bank.qa"
```

سيطلب السكربت بصورة مخفية:

1. كلمة مرور مستخدم PostgreSQL `qib_dotnet`.
2. كلمة المرور الجديدة لمدير النظام.
3. تأكيد كلمة المرور الجديدة.

إذا كنت داخل مجلد `scripts` فاستخدم المسار التالي:

```powershell
..\deploy\windows\reset-dotnet-admin-password.ps1 `
  -Identifier "admin@qib.internal-bank.qa"
```

يمكن استخدام اسم المستخدم أو الرقم الوظيفي بدلاً من البريد. افتراضياً يُطلب من مدير النظام تغيير كلمة المرور بعد أول دخول، ويمكن تعطيل ذلك في حالة الطوارئ:

```powershell
.\deploy\windows\reset-dotnet-admin-password.ps1 `
  -Identifier "admin@qib.internal-bank.qa" `
  -ForcePasswordChange:$false
```

إذا لم يعثر السكربت تلقائياً على PostgreSQL 18، مرر مسار `psql.exe`:

```powershell
.\deploy\windows\reset-dotnet-admin-password.ps1 `
  -Identifier "admin@qib.internal-bank.qa" `
  -PsqlPath "C:\Program Files\PostgreSQL\18\bin\psql.exe"
```

> لا تمرر كلمات المرور كنص صريح في سطر الأوامر. السكربت يطلبها عبر `SecureString` ولا يطبعها أو يطبع قيمة التشفير.

---

## 9. ملف web.config للـ API

القالب موجود في:

```text
deploy/windows/api.web.config
```

محتواه الأساسي:

```xml
<?xml version="1.0" encoding="utf-8"?>
<configuration>
  <location path="." inheritInChildApplications="false">
    <system.webServer>
      <handlers>
        <add name="aspNetCore" path="*" verb="*" modules="AspNetCoreModuleV2" resourceType="Unspecified" />
      </handlers>
      <aspNetCore processPath="dotnet"
                  arguments=".\Qib.ServicePortal.Api.dll"
                  stdoutLogEnabled="true"
                  stdoutLogFile=".\logs\stdout"
                  hostingModel="inprocess">
        <environmentVariables>
          <environmentVariable name="ASPNETCORE_ENVIRONMENT" value="Production" />
        </environmentVariables>
      </aspNetCore>
    </system.webServer>
  </location>
</configuration>
```

---

## 10. أوامر بناء الواجهة

إذا أردت الواجهة تستخدم نفس الدومين مع Proxy:

```powershell
cd frontend
npm install
$env:VITE_API_BASE_URL="/api/dotnet/v1"
npm run build
Copy-Item .\dist\* C:\QIB\ServicePortal\frontend -Recurse -Force
copy ..\deploy\windows\frontend.web.config C:\QIB\ServicePortal\frontend\web.config
```

إذا كان API على دومين منفصل:

```powershell
$env:VITE_API_BASE_URL="https://api.example.com/api/dotnet/v1"
npm run build
```

---

## 10. ملف web.config للواجهة

القالب موجود في:

```text
deploy/windows/frontend.web.config
```

وظائفه:

- تعريف MIME لبعض الملفات مثل JSON وSVG.
- تمرير `/api/dotnet/v1` إلى API الداخلي على `127.0.0.1:8088`.
- دعم React Router بإرجاع `index.html` للمسارات الداخلية.

> قاعدة الـ Proxy تحتاج IIS URL Rewrite و ARR. إذا لم تستخدم Proxy، اجعل `VITE_API_BASE_URL` يشير مباشرة إلى رابط API.

---

## 11. إعداد IIS يدوياً

### API Site

1. افتح IIS Manager.
2. أنشئ App Pool باسم:

```text
QIB Service Portal API
```

3. اجعل:

```text
.NET CLR Version: No Managed Code
Pipeline: Integrated
```

4. أنشئ Site باسم:

```text
QIB Service Portal API
```

5. الإعدادات:

```text
Physical path: C:\QIB\ServicePortal\api
Binding: http / 127.0.0.1 / 8088
```

### Frontend Site

1. أنشئ App Pool باسم:

```text
QIB Service Portal
```

2. أنشئ Site باسم:

```text
QIB Service Portal
```

3. الإعدادات:

```text
Physical path: C:\QIB\ServicePortal\frontend
Binding: https / portal.example.com / 443
```

4. اربط شهادة SSL.

---

## 12. سكربت تشغيل ونشر النظام

تم تجهيز سكربت:

```text
deploy/windows/deploy-qib-service-portal.ps1
```

مثال تشغيل من PowerShell كمسؤول:

```powershell
$dbPassword = Read-Host "PostgreSQL password for qib_dotnet" -AsSecureString
$jwtSecret = Read-Host "JWT secret (at least 32 characters)" -AsSecureString
$adminPassword = Read-Host "Initial system administrator password" -AsSecureString

.\deploy\windows\deploy-qib-service-portal.ps1 `
  -DatabasePassword $dbPassword `
  -JwtSecret $jwtSecret `
  -SeedAdminPassword $adminPassword `
  -FrontendHostName "portal.example.com" `
  -ConfigureIis
```

يقبل السكربت قيم `SecureString` مباشرة، ولا يحولها إلى النص
`System.Security.SecureString`. كما يبني سلسلة اتصال PostgreSQL بطريقة آمنة عند
احتواء كلمة المرور على فواصل منقوطة أو رموز خاصة.

ماذا يفعل السكربت؟

- ينشر ASP.NET Core API إلى `C:\QIB\ServicePortal\api`.
- يبني React Frontend وينسخه إلى `C:\QIB\ServicePortal\frontend`.
- يكتب `appsettings.Production.json`.
- ينسخ ملفات `web.config`.
- ينشئ IIS Sites وApp Pools عند استخدام `-ConfigureIis`.
- يجهز مجلدات uploads وbackups وlogs.

تشغيل بدون تعديل IIS:

```powershell
.\deploy\windows\deploy-qib-service-portal.ps1 `
  -DatabasePassword $dbPassword `
  -JwtSecret $jwtSecret `
  -SkipBuild
```

---

## 13. اختبار التشغيل

اختبار API:

```powershell
Invoke-WebRequest http://127.0.0.1:8088/api/dotnet/v1/health/live
```

اختبار من المتصفح:

```text
https://portal.example.com
```

إذا كان Swagger مفعل داخلياً:

```text
http://127.0.0.1:8088/api/dotnet/v1/docs
```

---

## 14. تحديث النظام لاحقاً

1. خذ نسخة احتياطية من PostgreSQL.
2. خذ نسخة من `C:\QIB\ServicePortal\uploads`.
3. أوقف مواقع IIS أو ضع صفحة صيانة.
4. شغل سكربت النشر.
5. اختبر Health.
6. اختبر تسجيل الدخول وطلب تجريبي.
7. أعد فتح النظام للمستخدمين.

---

## 15. ملاحظات أمنية مهمة

- لا تستخدم كلمات مرور التطوير.
- لا تفعّل Swagger للعامة في الإنتاج.
- لا تجعل API الداخلي متاحاً من الإنترنت إذا كنت تستخدم Proxy عبر الواجهة.
- استخدم HTTPS دائماً.
- راقب سجلات IIS وسجلات النظام.
- اضبط صلاحيات NTFS للمجلدات.
- لا تفعّل العمليات الخطرة إلا لفترة صيانة محدودة وبعد نسخة احتياطية.
