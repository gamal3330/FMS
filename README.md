# نظام إدارة طلبات الخدمات التقنية

نظام داخلي لإدارة طلبات الخدمات التقنية داخل المؤسسة، يدعم اللغة العربية واتجاه RTL، ويغطي دورة الطلب كاملة: إنشاء الطلب، رفع المرفقات، الموافقات، الإرجاع للتعديل، التنفيذ، الطباعة، التقارير، وإدارة إعدادات النظام.

## التثبيت السريع

للتثبيت والتشغيل المحلي بأمر واحد على macOS أو Linux:

```bash
bash scripts/install-local.sh
```

وعلى Windows PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/install-local.ps1
```

للتفاصيل وخيارات التشغيل راجع [INSTALL.md](INSTALL.md).

## التقنيات المستخدمة

### الواجهة الأمامية

- React
- TypeScript
- Vite
- Tailwind CSS
- React Router
- Fetch / Axios
- Lucide Icons

### الخلفية

- FastAPI
- Uvicorn
- SQLAlchemy
- Pydantic
- JWT Authentication
- Passlib / bcrypt لتشفير كلمات المرور
- python-multipart لرفع الملفات
- ReportLab لتصدير PDF
- arabic-reshaper و python-bidi لدعم العربية في PDF
- OpenPyXL لاستيراد وتصدير ملفات Excel

### قاعدة البيانات

- SQLite للتطوير المحلي.
- PostgreSQL للتشغيل عبر Docker أو بيئات النشر.

## الخصائص الرئيسية

### تسجيل الدخول والأمان

- تسجيل الدخول بالبريد الإلكتروني وكلمة المرور.
- حماية الجلسات باستخدام JWT Token.
- تشفير كلمات المرور.
- تغيير كلمة المرور من داخل النظام.
- سياسة أمان قابلة للإعداد.
- دعم قفل الحساب بعد محاولات دخول فاشلة.
- عرض حالة المستخدم المعطل أو المقفل مؤقتاً في شاشة المستخدمين والصلاحيات.
- صلاحيات وصول للشاشات حسب المستخدم.

### إدارة المستخدمين والصلاحيات

- إضافة وتعديل وتعطيل المستخدمين.
- إعادة تعيين كلمة المرور.
- ربط المستخدم بإدارة.
- ربط الموظف بمدير مباشر.
- تحديد دور المستخدم، مثل:
  - موظف
  - مدير مباشر
  - موظف تقنية معلومات
  - مدير تقنية معلومات
  - أمن المعلومات
  - الإدارة التنفيذية
  - مدير النظام
- تحديد القسم المختص لموظف تقنية المعلومات.
- استيراد المستخدمين دفعة واحدة من ملف Excel.
- تحميل نموذج Excel لإضافة المستخدمين بشكل جماعي.
- تحديد الشاشات المسموح للمستخدم بالوصول إليها.

### الطلبات

- إنشاء طلب جديد من شاشة الطلبات.
- دعم أنواع طلبات ثابتة وأنواع طلبات معرفة من شاشة إدارة أنواع الطلبات.
- دعم الحقول الديناميكية لكل نوع طلب.
- تحديد أولوية الطلب.
- إدخال مبرر العمل.
- توجيه الطلب تلقائياً للقسم المختص.
- رفع المرفقات عند تفعيل خيار أن نوع الطلب يتطلب مرفقاً.
- السماح برفع ملفات PDF أو صور فقط.
- عرض آخر الطلبات وحالتها.
- منع إرسال طلب من موظف غير مرتبط بمدير مباشر عند الحاجة لذلك.

### الموافقات وسير العمل

- عرض الطلبات التي تحتاج موافقة أو تنفيذ.
- عرض بطاقة بيانات الطلب كاملة.
- عرض مسار الموافقات بشكل مرئي.
- إظهار اسم من قام بالموافقة أو الرفض أو الإرجاع، مع التاريخ والوقت.
- دعم قرارات:
  - موافقة
  - رفض
  - إرجاع للتعديل
- يظهر زر **إرجاع للتعديل** فقط إذا كانت خطوة الموافقة مفعلاً فيها خيار **يسمح بالإرجاع للتعديل**.
- عند إرجاع الطلب للتعديل تصبح حالة الطلب **معاد للتعديل**.
- يظهر لصاحب الطلب زر **تعديل وإعادة إرسال**.
- عند إعادة الإرسال يتم تصفير خطوات الموافقات وإرجاع الطلب إلى أول خطوة في المسار.
- موظف تقنية المعلومات يرى طلبات القسم المختص به فقط، مع معالجة الحالات التي لا يوجد فيها موظف مخصص للقسم.

### إدارة أنواع الطلبات

- إضافة وتعديل وتعطيل وحذف أنواع الطلبات.
- تحديد القسم المختص لكل نوع طلب.
- تحديد هل نوع الطلب يتطلب مرفقاً.
- بناء الحقول الديناميكية لكل نوع طلب.
- بناء مسار موافقات مخصص.
- تحديد هل خطوة الموافقة تسمح بالرفض.
- تحديد هل خطوة الموافقة تسمح بالإرجاع للتعديل.
- ترتيب خطوات الموافقات.
- معاينة مسار الموافقات.

### الطباعة والتقارير

- طباعة الطلب من شاشة الموافقات بصيغة PDF.
- يحتوي PDF على:
  - شعار النظام عند توفره.
  - رقم الطلب.
  - تاريخ الطباعة حسب التوقيت المحدد في الإعدادات العامة.
  - اسم المستخدم الذي قام بالطباعة.
  - مسار الموافقات بشكل دوائر ملوّنة.
  - مبرر العمل.
  - بيانات الطلب كاملة.
- تقارير حسب الفترة.
- تقارير حسب الموظف.
- تقارير حسب نوع الطلب.
- تصدير Excel.
- تصدير PDF مع دعم العربية.

### الإحصائيات

- عدد الطلبات المفتوحة.
- عدد الطلبات بانتظار الموافقة.
- عدد الطلبات المكتملة.
- إحصائيات شهرية.
- الطلبات حسب الإدارة.
- مؤشرات حسب صلاحيات المستخدم.

### الإعدادات العامة

- تغيير اسم النظام.
- تغيير لون الهوية باستخدام HEX.
- رفع شعار النظام.
- تحديد توقيت النظام المستخدم في عرض التواريخ والطباعة.
- إعداد اللغة وحجم الملفات المسموح.
- عرض الاسم والشعار في شاشة الدخول وداخل النظام.

### إعدادات قاعدة البيانات

- عرض حالة قاعدة البيانات.
- إنشاء نسخة احتياطية.
- تحميل النسخة الاحتياطية.
- استرداد نسخة احتياطية.
- معاينة الجداول التي سيتم حذفها قبل إعادة ضبط البيانات.
- إعادة ضبط بيانات النظام وإعادة إنشاء بيانات البداية.

### مراقبة صحة النظام والسجلات

- فحص حالة النظام.
- عرض حالة قاعدة البيانات والخدمات.
- عرض سجلات وأخطاء النظام في بطاقة السجلات.
- تسجيل العمليات المهمة في Audit Log.

## هيكل المشروع

```text
backend/
  app/
    api/v1/        واجهات API
    core/          الإعدادات والأمان
    db/            الاتصال بقاعدة البيانات وتهيئة البيانات
    models/        نماذج SQLAlchemy
    schemas/       مخططات Pydantic
    services/      خدمات سير العمل والتدقيق
    utils/         أدوات مساعدة
  qib_local.db     قاعدة SQLite المحلية

frontend/
  src/
    components/    مكونات الواجهة
    pages/         صفحات النظام
    lib/           الاتصال بالـ API وأدوات الوقت والهوية

docs/
  database-schema.md
```

## التشغيل المحلي

### تشغيل الخلفية

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

مثال ملف البيئة المحلي:

```env
DATABASE_URL=sqlite:///./qib_local.db
SECRET_KEY=local-development-secret
CORS_ORIGINS=http://localhost:5173,http://127.0.0.1:5173,http://172.16.23.37:5173,http://172.16.23.37
SEED_ADMIN_EMAIL=admin@qib.internal-bank.qa
SEED_ADMIN_PASSWORD=Admin@12345
```

### تشغيل الواجهة

```bash
cd frontend
npm install
npm run dev
```

مثال ملف البيئة للواجهة:

```env
VITE_API_BASE_URL=http://172.16.23.37:8000/api/v1
```

## التشغيل عبر Docker

```bash
docker compose up --build -d
```

الخدمات:

- الواجهة: `http://172.16.23.37:5173`
- الخلفية: `http://172.16.23.37:8000`
- توثيق API: `http://172.16.23.37:8000/docs`
- فحص الصحة: `http://172.16.23.37:8000/health`

## الحساب الافتراضي

```text
Email: admin@qib.internal-bank.qa
Password: Admin@12345
```

يجب تغيير كلمة المرور الافتراضية و `SECRET_KEY` قبل أي تشغيل رسمي.

## أهم واجهات API

### المصادقة

- `POST /api/v1/auth/login`
- `GET /api/v1/auth/me`
- `POST /api/v1/auth/change-password`

### الطلبات

- `GET /api/v1/requests`
- `POST /api/v1/requests`
- `POST /api/v1/requests/dynamic`
- `GET /api/v1/requests/{request_id}`
- `PATCH /api/v1/requests/{request_id}`
- `POST /api/v1/requests/{request_id}/approval`
- `POST /api/v1/requests/{request_id}/resubmit`
- `GET /api/v1/requests/{request_id}/print.pdf`
- `POST /api/v1/requests/{request_id}/comments`
- `POST /api/v1/requests/{request_id}/attachments`
- `GET /api/v1/requests/{request_id}/attachments`
- `GET /api/v1/requests/{request_id}/attachments/{attachment_id}/download`

### المستخدمون

- `GET /api/v1/users`
- `POST /api/v1/users`
- `PUT /api/v1/users/{user_id}`
- `POST /api/v1/users/{user_id}/disable`
- `POST /api/v1/users/{user_id}/reset-password`
- `GET /api/v1/users/import-template`
- `POST /api/v1/users/import`
- `GET /api/v1/users/screen-permissions/me`
- `GET /api/v1/users/{user_id}/screen-permissions`
- `PUT /api/v1/users/{user_id}/screen-permissions`

### أنواع الطلبات

- `GET /api/v1/request-types`
- `GET /api/v1/request-types/active`
- `POST /api/v1/request-types`
- `PUT /api/v1/request-types/{request_type_id}`
- `DELETE /api/v1/request-types/{request_type_id}`
- `PATCH /api/v1/request-types/{request_type_id}/status`
- `GET /api/v1/request-types/{request_type_id}/fields`
- `POST /api/v1/request-types/{request_type_id}/fields`
- `GET /api/v1/request-types/{request_type_id}/workflow`
- `POST /api/v1/request-types/{request_type_id}/workflow/steps`
- `GET /api/v1/request-types/{request_type_id}/workflow/preview`
- `GET /api/v1/request-types/{request_type_id}/form-schema`

### الإعدادات

- `GET /api/v1/settings/public-profile`
- `GET /api/v1/settings/general-profile`
- `PUT /api/v1/settings/general-profile`
- `POST /api/v1/settings/general-profile/logo`
- `GET /api/v1/settings/security`
- `PUT /api/v1/settings/security`
- `GET /api/v1/settings/database/status`
- `GET /api/v1/settings/database/reset-preview`
- `GET /api/v1/settings/database/backup`
- `POST /api/v1/settings/database/restore`
- `POST /api/v1/settings/database/reset`
- `GET /api/v1/settings/specialized-sections`
- `POST /api/v1/settings/specialized-sections`
- `PUT /api/v1/settings/specialized-sections/{section_id}`
- `DELETE /api/v1/settings/specialized-sections/{section_id}`

### الإحصائيات والتقارير

- `GET /api/v1/dashboard/stats`
- `GET /api/v1/reports/requests.xlsx`
- `GET /api/v1/reports/requests.pdf`

## أوامر مفيدة

بناء الواجهة:

```bash
cd frontend
npm run build
```

فحص الخلفية:

```bash
cd backend
.venv\Scripts\python.exe -m compileall app
```

تشغيل Docker:

```bash
docker compose up --build -d
```

إيقاف Docker:

```bash
docker compose down
```

عرض السجلات:

```bash
docker compose logs -f backend
docker compose logs -f frontend
```

## ملاحظات النشر

- استخدم PostgreSQL بدلاً من SQLite في البيئة الرسمية.
- غيّر `SECRET_KEY`.
- غيّر بيانات الحساب الافتراضي.
- اضبط `CORS_ORIGINS` حسب عنوان الواجهة.
- اضبط `VITE_API_BASE_URL` حسب عنوان الخلفية.
- فعّل HTTPS عبر Nginx أو Reverse Proxy.
- احتفظ بنسخ احتياطية من قاعدة البيانات ومجلد المرفقات.
- لا تفعّل إعادة ضبط قاعدة البيانات إلا للمستخدمين المخولين.

## ملاحظات أمنية

- لا تستخدم كلمة مرور افتراضية في الإنتاج.
- لا تستخدم `SECRET_KEY` الافتراضي.
- راجع صلاحيات الشاشات لكل مستخدم.
- لا تمنح صلاحيات إدارة النظام إلا للمخولين.
- افحص الملفات المرفوعة بآلية مكافحة فيروسات عند النشر الرسمي.
- راقب سجلات التدقيق وسجلات النظام بشكل دوري.
