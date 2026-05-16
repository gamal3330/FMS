# دليل مجلدات النظام والتثبيت على Windows

هذا الدليل يشرح بنية مشروع **QIB Service Portal** وطريقة تثبيته وتشغيله على بيئة Windows للتطوير أو الاختبار الداخلي.

النظام يحتوي حالياً على مسارين للخلفية:

- **FastAPI**: الخلفية الحالية/الأصلية داخل `backend/` وتعمل على `/api/v1`.
- **ASP.NET Core**: خلفية مستقلة جديدة داخل `Qib.ServicePortal.Api/` وتعمل على `/api/dotnet/v1`.

> مهم: لا تشغل الواجهة على الخلفيتين بنفس الوقت إلا إذا كنت تعرف أي API تستخدمه. الواجهة تعتمد على قيمة `VITE_API_BASE_URL`.

---

## 1. نظرة عامة على مجلدات النظام

```text
FMS/
  README.md
  INSTALL.md
  DEPLOYMENT.md
  docker-compose.yml
  docker-compose.https.yml
  .env.docker.example
  version.txt
  update-manifest.json

  backend/
  frontend/
  Qib.ServicePortal.Api/
  docs/
  scripts/
  deploy/
  updates/
  uploads/
  backups/
```

### ملفات الجذر

| الملف | الغرض |
|---|---|
| `README.md` | وصف عام للنظام والخصائص الأساسية. |
| `INSTALL.md` | تعليمات التثبيت المحلي الأساسية. |
| `DEPLOYMENT.md` | تعليمات النشر على الخادم. |
| `docker-compose.yml` | تشغيل النظام الحالي عبر Docker. |
| `docker-compose.https.yml` | إعدادات HTTPS/Nginx عند النشر. |
| `.env.docker.example` | نموذج متغيرات البيئة للنشر عبر Docker. |
| `version.txt` | رقم نسخة النظام. |
| `update-manifest.json` | معلومات حزم التحديث المحلي. |

---

## 2. مجلد الخلفية الحالية FastAPI

المسار:

```text
backend/
```

البنية المهمة:

```text
backend/
  app/
    api/v1/       مسارات API
    core/         إعدادات النظام والأمان
    db/           الاتصال بقاعدة البيانات وتهيئة البيانات
    features/     خصائص/وحدات مساعدة
    models/       نماذج SQLAlchemy
    schemas/      مخططات Pydantic
    services/     منطق الأعمال والخدمات
  alembic/        ترحيلات قاعدة البيانات إن وجدت
  scripts/        سكربتات خاصة بالخلفية
  tests/          اختبارات الخلفية
  uploads/        ملفات مرفوعة محلياً
  backups/        نسخ احتياطية محلية
  requirements.txt
```

### أهم ملفات FastAPI

| الملف/المجلد | الغرض |
|---|---|
| `backend/app/main.py` | نقطة تشغيل FastAPI. |
| `backend/app/api/v1/` | جميع Endpoints الحالية مثل الطلبات، المراسلات، التقارير، الإعدادات. |
| `backend/app/models/` | جداول قاعدة البيانات الحالية. |
| `backend/app/schemas/` | نماذج الطلب والاستجابة. |
| `backend/app/services/` | منطق الموافقات، المراسلات، PDF، الإعدادات، التحديثات. |
| `backend/.env` | إعدادات التشغيل المحلي مثل قاعدة البيانات و CORS. |

### منافذ FastAPI الافتراضية

```text
Backend: http://localhost:8000
API:     http://localhost:8000/api/v1
Swagger: http://localhost:8000/docs
Health:  http://localhost:8000/health
```

---

## 3. مجلد الواجهة الأمامية React

المسار:

```text
frontend/
```

البنية المهمة:

```text
frontend/
  src/
    components/           مكونات عامة
    components/ai/        مكونات الذكاء الاصطناعي
    components/documents/ مكونات مكتبة الوثائق
    components/settings/  مكونات الإعدادات
    components/ui/        مكونات واجهة مشتركة
    lib/                  الاتصال بالـ API وأدوات مساعدة
    pages/                صفحات النظام
    pages/documents/      صفحات مكتبة الوثائق
    pages/settings/       صفحات الإعدادات
  package.json
  vite.config.ts
  tailwind.config.js
```

### أهم ملفات الواجهة

| الملف/المجلد | الغرض |
|---|---|
| `frontend/src/App.tsx` | تعريف المسارات الرئيسية وحماية الدخول. |
| `frontend/src/lib/api.ts` | عميل API المستخدم في أغلب صفحات TypeScript. |
| `frontend/src/lib/axios.js` | عميل Axios للصفحات القديمة/JSX. |
| `frontend/src/components/Layout.tsx` | التخطيط العام والقائمة الجانبية. |
| `frontend/src/pages/Requests.tsx` | شاشة الطلبات. |
| `frontend/src/pages/Approvals.tsx` | شاشة الموافقات والتنفيذ. |
| `frontend/src/pages/MessagesPage.tsx` | شاشة المراسلات. |
| `frontend/src/pages/ReportsPage.tsx` | شاشة التقارير. |
| `frontend/src/pages/settings/` | صفحات الإعدادات. |

### ملفات البيئة الخاصة بالواجهة

```text
frontend/.env
frontend/.env.dotnet
```

مثال FastAPI:

```env
VITE_API_BASE_URL=http://127.0.0.1:8000/api/v1
```

مثال .NET:

```env
VITE_API_BASE_URL=http://localhost:8088/api/dotnet/v1
```

---

## 4. مجلد الخلفية الجديدة ASP.NET Core

المسار:

```text
Qib.ServicePortal.Api/
```

البنية:

```text
Qib.ServicePortal.Api/
  Controllers/        Endpoints
  Application/
    DTOs/             نماذج الطلب والاستجابة
    Interfaces/       واجهات الخدمات
    Services/         خدمات التطبيق
    Validators/       FluentValidation
  Domain/
    Entities/         الجداول والكيانات
    Enums/            القيم الثابتة
    ValueObjects/     كائنات قيمة
  Infrastructure/
    Data/             DbContext والتهيئة
    Files/            التخزين والملفات
    Jobs/             المهام الخلفية
    Logging/          التسجيل
    Pdf/              توليد PDF
    Repositories/     مستودعات البيانات
    Security/         JWT وتشفير كلمات المرور
  Common/
    Authorization/    صلاحيات وسياسات
    Exceptions/       أخطاء مخصصة
    Helpers/          أدوات مساعدة
    Middleware/       Middleware
    OpenApi/          إعداد Swagger/OpenAPI
  Program.cs
  appsettings.json
  Dockerfile
  docker-compose.yml
```

### منافذ .NET الافتراضية

```text
API:      http://localhost:8088/api/dotnet/v1
Swagger:  http://localhost:8088/api/dotnet/v1/docs
OpenAPI:  http://localhost:8088/api/dotnet/v1/openapi.json
Health:   http://localhost:8088/api/dotnet/v1/health/live
Postgres: localhost:55432
```

---

## 5. مجلد السكربتات

المسار:

```text
scripts/
```

| السكربت | الغرض |
|---|---|
| `install-local.ps1` | تثبيت وتشغيل FastAPI + React على Windows. |
| `install-local.sh` | تثبيت وتشغيل FastAPI + React على macOS/Linux. |
| `start-fastapi-api.sh` | تشغيل FastAPI فقط. |
| `start-dotnet-api.sh` | تشغيل .NET API المستقل عبر Docker. |
| `start-frontend-dotnet.sh` | تشغيل الواجهة وربطها بـ .NET API. |
| `run-scenario-tests.sh` | تشغيل اختبارات السيناريوهات. |
| `reset-dotnet-admin-password.sh` | إعادة تعيين كلمة مرور مدير النظام في .NET. |
| `deploy-docker.sh` | نشر النظام الحالي عبر Docker. |
| `deploy-release.sh` | نشر إصدار جاهز. |
| `create-release-package.sh` | إنشاء حزمة إصدار. |

> على Windows، سكربتات `.sh` تعمل عبر Git Bash أو WSL. أما `install-local.ps1` فيعمل مباشرة من PowerShell.

---

## 6. مجلدات البيانات والملفات

| المجلد | الغرض |
|---|---|
| `uploads/` | ملفات مرفوعة على مستوى المشروع. |
| `backend/uploads/` | ملفات FastAPI المحلية. |
| `backups/` | نسخ احتياطية عامة. |
| `backend/backups/` | نسخ FastAPI الاحتياطية. |
| `updates/` | حزم وترحيلات التحديث المحلي. |
| `frontend/dist/` | ناتج بناء الواجهة. |
| `frontend/node_modules/` | اعتماديات Node محلية. |
| `backend/.venv*` | بيئات Python محلية. |
| `Qib.ServicePortal.Api/bin` و `obj` | مخرجات بناء .NET. |

هذه المجلدات غالباً لا يجب رفع محتواها إلى Git، خصوصاً:

```text
node_modules/
dist/
.venv/
uploads/
backups/
bin/
obj/
```

---

## 7. متطلبات Windows

ثبت الأدوات التالية:

1. **Git for Windows**
   - مهم للحصول على Git Bash إذا احتجت تشغيل سكربتات `.sh`.

2. **Node.js LTS**
   - يشمل `node` و `npm`.

3. **Python 3.12**
   - مطلوب لتشغيل FastAPI محلياً.
   - فعّل خيار `Add python.exe to PATH` أثناء التثبيت.

4. **Docker Desktop**
   - مطلوب لتشغيل PostgreSQL ونسخة .NET بسهولة.
   - فعّل WSL2 backend من إعدادات Docker Desktop.

5. **.NET SDK 8**
   - اختياري إذا أردت تشغيل .NET بدون Docker.
   - Docker يكفي للتشغيل المعتاد.

6. **PowerShell**
   - PowerShell المدمج في Windows يكفي.
   - PowerShell 7 أفضل لكنه ليس إلزامياً.

### التحقق من التثبيت

افتح PowerShell واكتب:

```powershell
git --version
node --version
npm --version
python --version
docker --version
docker compose version
```

إذا أردت التأكد من .NET SDK:

```powershell
dotnet --version
```

---

## 8. تشغيل النظام الحالي FastAPI على Windows

هذه الطريقة تشغل النظام الحالي كما كان قبل نسخة .NET.

### الخطوة 1: فتح PowerShell داخل مجلد المشروع

```powershell
cd C:\Path\To\FMS
```

### الخطوة 2: تشغيل سكربت التثبيت المحلي

```powershell
powershell -ExecutionPolicy Bypass -File scripts/install-local.ps1
```

يقوم السكربت بـ:

- إنشاء `backend/.venv-local`.
- تثبيت حزم Python.
- إنشاء `backend/.env` إن لم يكن موجوداً.
- إنشاء `frontend/.env` إن لم يكن موجوداً.
- تثبيت حزم الواجهة.
- تشغيل FastAPI على `8000`.
- تشغيل React على `5173`.

### روابط FastAPI

```text
Frontend: http://localhost:5173
API:      http://localhost:8000/api/v1
Swagger:  http://localhost:8000/docs
Health:   http://localhost:8000/health
```

### الحساب الافتراضي

```text
Email:    admin@qib.internal-bank.qa
Password: Admin@12345
```

### تغيير المنافذ

```powershell
$env:BACKEND_PORT="8010"
$env:FRONTEND_PORT="5180"
powershell -ExecutionPolicy Bypass -File scripts/install-local.ps1
```

---

## 9. تشغيل نسخة .NET المستقلة على Windows

هذه الطريقة تشغل الخلفية الجديدة المستقلة مع PostgreSQL منفصل داخل Docker.

### الخطوة 1: تأكد أن Docker Desktop يعمل

افتح Docker Desktop وانتظر حتى تظهر حالة التشغيل.

### الخطوة 2: تشغيل .NET API

من PowerShell:

```powershell
cd C:\Path\To\FMS\Qib.ServicePortal.Api
docker compose up -d --build
```

### الخطوة 3: التأكد من التشغيل

```powershell
docker compose ps
```

ثم افتح:

```text
http://localhost:8088/api/dotnet/v1/health/live
```

### روابط .NET

```text
API:      http://localhost:8088/api/dotnet/v1
Swagger:  http://localhost:8088/api/dotnet/v1/docs
OpenAPI:  http://localhost:8088/api/dotnet/v1/openapi.json
Postgres: localhost:55432
```

### الحساب الافتراضي

```text
Email:    admin@qib.internal-bank.qa
Username: admin
Password: ChangeMe@12345
```

يجب تغيير كلمة المرور بعد أول دخول.

---

## 10. تشغيل الواجهة وربطها بـ .NET API على Windows

بعد تشغيل .NET API:

```powershell
cd C:\Path\To\FMS\frontend
npm install
npm run dev -- --mode dotnet --host 0.0.0.0 --port 5174 --strictPort
```

افتح:

```text
http://localhost:5174
```

تأكد أن الملف التالي موجود:

```text
frontend/.env.dotnet
```

ويحتوي:

```env
VITE_API_BASE_URL=http://localhost:8088/api/dotnet/v1
```

---

## 11. تشغيل الواجهة وربطها بـ FastAPI على Windows

إذا أردت تشغيل الواجهة مع FastAPI:

```powershell
cd C:\Path\To\FMS\frontend
npm install
npm run dev -- --host 0.0.0.0 --port 5173 --strictPort
```

تأكد أن `frontend/.env` يحتوي:

```env
VITE_API_BASE_URL=http://127.0.0.1:8000/api/v1
```

---

## 12. أوامر Docker المهمة لنسخة .NET

من داخل:

```powershell
cd C:\Path\To\FMS\Qib.ServicePortal.Api
```

### عرض الحالة

```powershell
docker compose ps
```

### عرض السجلات

```powershell
docker compose logs -f qib-dotnet-api
```

### إعادة التشغيل

```powershell
docker compose restart qib-dotnet-api
```

### إيقاف الخدمات

```powershell
docker compose down
```

### إعادة بناء كاملة

```powershell
docker compose up -d --build
```

### حذف قاعدة .NET المحلية بالكامل

> تنبيه: هذا يحذف بيانات PostgreSQL الخاصة بنسخة .NET المحلية.

```powershell
docker compose down -v
docker compose up -d --build
```

---

## 13. أوامر الواجهة الأمامية

من داخل:

```powershell
cd C:\Path\To\FMS\frontend
```

### تثبيت الاعتماديات

```powershell
npm install
```

### تشغيل التطوير

```powershell
npm run dev
```

### بناء نسخة إنتاج

```powershell
npm run build
```

### معاينة البناء

```powershell
npm run preview
```

---

## 14. الاختبارات والتحقق

### اختبار بناء الواجهة

```powershell
cd C:\Path\To\FMS\frontend
npm run build
```

### اختبار صحة .NET API

```powershell
curl http://localhost:8088/api/dotnet/v1/health/live
```

### اختبار Swagger .NET

```text
http://localhost:8088/api/dotnet/v1/docs
```

### اختبار FastAPI

```powershell
curl http://localhost:8000/health
```

### تشغيل اختبارات السيناريوهات

على Windows استخدم Git Bash أو WSL:

```bash
bash scripts/run-scenario-tests.sh
```

---

## 15. إعدادات مهمة قبل الإنتاج

لا تستخدم القيم الافتراضية في الإنتاج.

غيّر:

- `SECRET_KEY` في FastAPI.
- `Jwt__Secret` في .NET.
- كلمات مرور PostgreSQL.
- كلمة مرور مدير النظام الافتراضي.
- روابط CORS.
- إعدادات الملفات والمرفقات.
- إعدادات النسخ الاحتياطي.

### مثال إعداد CORS لواجهة محلية

FastAPI:

```env
CORS_ORIGINS=http://localhost:5173,http://127.0.0.1:5173
```

.NET عبر Docker Compose:

```yaml
Cors__Origins__0: http://localhost:5174
Cors__Origins__1: http://127.0.0.1:5174
```

---

## 16. مشاكل شائعة في Windows

### PowerShell يمنع تشغيل السكربت

استخدم:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/install-local.ps1
```

### المنفذ مستخدم

تحقق من العمليات:

```powershell
netstat -ano | findstr :8000
netstat -ano | findstr :5173
netstat -ano | findstr :8088
```

أوقف العملية:

```powershell
taskkill /PID رقم_العملية /F
```

### Docker لا يعمل

- افتح Docker Desktop.
- تأكد أن WSL2 مفعل.
- أعد تشغيل Docker Desktop.
- نفذ:

```powershell
docker compose version
```

### الواجهة تتصل بالـ API الخطأ

راجع:

```text
frontend/.env
frontend/.env.dotnet
```

ثم أعد تشغيل Vite بعد تغيير الملف.

### CORS Error

يعني أن الواجهة تعمل من منفذ غير مسموح في الخلفية.

الحل:

- أضف منفذ الواجهة إلى إعدادات CORS.
- أعد تشغيل الخلفية.

### Swagger لا يفتح في .NET

تأكد أن الخدمة تعمل:

```powershell
cd Qib.ServicePortal.Api
docker compose ps
docker compose logs --tail=100 qib-dotnet-api
```

ثم افتح:

```text
http://localhost:8088/api/dotnet/v1/docs
```

---

## 17. أي نسخة أستخدم؟

### استخدم FastAPI إذا:

- تريد تشغيل النظام الحالي كما هو.
- تختبر وظائف قديمة لم تكتمل بعد في .NET.
- تعمل على إصلاحات مرتبطة بالخلفية الأصلية.

### استخدم .NET إذا:

- تختبر النسخة الجديدة المستقلة.
- تعمل على نقل الوظائف من FastAPI إلى ASP.NET Core.
- تريد قاعدة PostgreSQL مستقلة عن النظام الحالي.

### لا تخلط بينهما

لا تجعل الواجهة تشير إلى FastAPI ثم تتوقع أن تظهر بيانات .NET، أو العكس.

القاعدة:

```text
FastAPI frontend  -> http://localhost:8000/api/v1
.NET frontend     -> http://localhost:8088/api/dotnet/v1
```

---

## 18. خريطة تشغيل سريعة

### FastAPI الحالي

```powershell
cd C:\Path\To\FMS
powershell -ExecutionPolicy Bypass -File scripts/install-local.ps1
```

افتح:

```text
http://localhost:5173
```

### .NET الجديد

Terminal 1:

```powershell
cd C:\Path\To\FMS\Qib.ServicePortal.Api
docker compose up -d --build
```

Terminal 2:

```powershell
cd C:\Path\To\FMS\frontend
npm install
npm run dev -- --mode dotnet --host 0.0.0.0 --port 5174 --strictPort
```

افتح:

```text
http://localhost:5174
```

---

## 19. ملاحظات تشغيلية للفريق

- احتفظ بنسخة احتياطية قبل أي عملية قاعدة بيانات خطرة.
- لا تفعل `EnableDangerousDatabaseOperations` إلا في بيئة اختبار وبقرار واضح.
- لا تشارك ملفات `.env` الحقيقية في Git.
- راقب سجلات Docker عند أي خطأ 500.
- عند تعديل `VITE_API_BASE_URL` يجب إعادة تشغيل الواجهة.
- عند تعديل إعدادات Docker يجب إعادة تشغيل الحاوية.
- عند تعديل كود .NET داخل Docker يجب تنفيذ `docker compose up -d --build`.
- عند تعديل كود React يكفي Vite غالباً، أما البناء النهائي فاختبره بـ `npm run build`.
