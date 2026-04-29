# نظام إدارة النماذج 

نظام داخلي لإدارة طلبات الخدمات التقنية داخل المؤسسة، يدعم اللغة العربية واتجاه RTL، ويغطي دورة الطلب كاملة من رفع الطلب، الموافقات، التوجيه للقسم المختص، التنفيذ، التقارير، وإدارة إعدادات النظام.

## التقنيات المستخدمة

### الواجهة الأمامي

- React
- TypeScript
- Vite
- Tailwind CSS
- React Router
- Axios / Fetch
- Lucide Icons



### الخلفية

- FastAPI
- Uvicorn
- SQLAlchemy
- Pydantic Settings
- JWT Authentication
- Passlib / bcrypt لتشفير كلمات المرور
- python-multipart لرفع الملفات
- ReportLab لتصدير PDF
- arabic-reshaper و python-bidi لدعم العربية في PDF
- OpenPyXL لتصدير Excel

### قاعدة البيانات

- SQLite للتطوير المحلي.
- PostgreSQL للنشر داخل الشبكة أو بيئة الإنتاج.

### التشغيل والنشر

- Docker Compose لتشغيل الواجهة والخلفية وقاعدة PostgreSQL.
- Nginx داخل صورة الواجهة عند تشغيل Docker.

## خصائص النظام

### تسجيل الدخول والأمان

- تسجيل دخول باستخدام البريد الإلكتروني وكلمة المرور.
- JWT Token لحماية جلسات المستخدمين.
- تشفير كلمات المرور.
- تغيير كلمة المرور من داخل النظام.
- سياسة أمان قابلة للإعداد.
- دعم قفل الحساب وسياسات كلمة المرور من الخلفية.

### إدارة المستخدمين والصلاحيات

- إضافة مستخدم جديد.
- تعديل بيانات المستخدم.
- تعطيل المستخدم.
- إعادة تعيين كلمة المرور.
- ربط المستخدم بإدارة.
- ربط الموظف بمدير مباشر.
- تحديد صلاحية النظام للمستخدم، مثل:
  - موظف
  - مدير مباشر
  - موظف تقنية معلومات
  - مدير تقنية المعلومات
  - أمن المعلومات
  - الإدارة التنفيذية
  - مدير النظام
- تحديد القسم المختص لموظف تقنية المعلومات.
- تحديد صلاحيات الوصول للشاشات لكل مستخدم عبر CheckBox لكل شاشة.
- إخفاء الشاشات غير المسموحة من القائمة الجانبية.
- منع الوصول المباشر للمسارات غير المسموحة.

### الشاشات الرئيسية

- إحصائيات
- الطلبات
- الموافقات
- التقارير
- إدارة أنواع الطلبات
- المستخدمون والصلاحيات
- الإدارات
- الأقسام المختصة
- الإعدادات

### إدارة الطلبات

- رفع طلب جديد من شاشة الطلبات.
- عرض آخر الطلبات.
- ربط كل طلب بنوع طلب محدد.
- توجيه الطلب تلقائياً إلى القسم المختص.
- دعم الأقسام المختصة مثل:
  - قسم السيرفرات
  - قسم الشبكات
  - قسم الدعم الفني
  - وحدة تطوير البرامج
  - أي قسم جديد يتم إضافته من شاشة الأقسام المختصة
- دعم الحقول الديناميكية لكل نوع طلب.
- دعم تحديد أولوية الطلب.
- دعم مبرر العمل.
- دعم المرفقات عند تفعيل خيار "يتطلب مرفقاً".
- السماح برفع ملفات PDF أو صور فقط.
- عرض المرفقات داخل شاشة الموافقات.

### إدارة أنواع الطلبات

- شاشة مستقلة لإدارة أنواع الطلبات.
- إضافة نوع طلب.
- تعديل نوع طلب.
- تعطيل أو تفعيل نوع طلب.
- حذف نوع طلب.
- تحديد القسم المختص باستقبال الطلب.
- تحديد هل نوع الطلب يتطلب مرفقاً.
- بناء الحقول الديناميكية لكل نوع طلب.
- إضافة مراحل موافقات مخصصة.
- تعديل مراحل الموافقات.
- حذف مراحل الموافقات.
- معاينة مسار الموافقات.

### الموافقات

- عرض الطلبات التي تحتاج موافقة أو تنفيذ.
- فلترة الطلبات حسب الحالة.
- عرض بيانات مقدم الطلب وإدارته.
- عرض بيانات الطلب داخل بطاقة واحدة.
- عرض القسم المختص.
- عرض مسار الموافقات.
- قبول أو رفض الطلب مع ملاحظة.
- دعم مراحل مثل:
  - المدير المباشر
  - أمن المعلومات
  - مدير تقنية المعلومات
  - التنفيذ
  - الإدارة التنفيذية
- موظف تقنية المعلومات يرى طلبات قسمه المختص فقط.

### الإشعارات

- جرس إشعارات أعلى الشاشة.
- يظهر لموظف تقنية المعلومات.
- يفحص الطلبات الجديدة دورياً.
- عند وصول طلب تنفيذ جديد تظهر رسالة: "لديك طلب جديد".
- يظهر عداد على الجرس بعدد الطلبات الجديدة أو القابلة للتنفيذ.

### الإحصائيات

- عرض إحصائية الطلبات التي قام المستخدم برفعها.
- عدد الطلبات المفتوحة.
- عدد الطلبات بانتظار الموافقة.
- عدد الطلبات المكتملة.
- إحصائيات شهرية.
- الطلبات حسب الإدارة.
- إحصائية معالجة الطلبات حسب موظف تقنية المعلومات للمدراء المخولين.
- فلترة إحصائيات موظف التقنية حسب القسم المختص حتى لا تظهر له طلبات أقسام أخرى.

### التقارير

- تقارير حسب المدة.
- تقارير حسب الموظف.
- تقارير حسب نوع الطلب.
- تصدير Excel.
- تصدير PDF مع دعم العربية.

### الإعدادات العامة

- تغيير اسم النظام.
- تغيير لون هوية النظام باستخدام HEX.
- رفع شعار النظام.
- عرض اسم النظام والشعار في شاشة الدخول والنظام.
- قراءة وسم title من اسم النظام.
- إعدادات عامة أخرى مثل اللغة وحجم الملفات.

### إعدادات قاعدة البيانات

- عرض حالة قاعدة البيانات.
- إنشاء نسخة احتياطية.
- تحميل النسخة الاحتياطية.
- استرداد نسخة احتياطية.
- إعادة ضبط النظام وحذف البيانات.

### الأقسام المختصة

- شاشة مستقلة لإدارة الأقسام المختصة.
- إضافة قسم مختص جديد.
- تعديل القسم.
- تعطيل أو تفعيل القسم.
- ربط موظف تقنية المعلومات بالقسم المختص.
- استخدام الأقسام المختصة في توجيه الطلبات.

### التدقيق والسجلات

- تسجيل عمليات مهمة في Audit Log.
- تتبع إنشاء المستخدمين.
- تتبع تحديث المستخدمين.
- تتبع تغيير الإعدادات.
- تتبع إجراءات الطلبات والموافقات.

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
    lib/           الاتصال بالـ API والهوية البصرية

docs/
  database-schema.md
```

## التشغيل المحلي

### تشغيل الخلفية Backend

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

ملف البيئة المحلي:

```env
DATABASE_URL=sqlite:///./qib_local.db
SECRET_KEY=local-development-secret
CORS_ORIGINS=http://localhost:5173,http://127.0.0.1:5173,http://172.16.23.37:5173,http://172.16.23.37
SEED_ADMIN_EMAIL=admin@qib.internal-bank.qa
SEED_ADMIN_PASSWORD=Admin@12345
```

### تشغيل الواجهة Frontend

```bash
cd frontend
npm install
npm run dev
```

ملف البيئة للواجهة:

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
- `POST /api/v1/requests/{request_id}/comments`
- `POST /api/v1/requests/{request_id}/attachments`
- `GET /api/v1/requests/{request_id}/attachments`
- `GET /api/v1/requests/{request_id}/attachments/{attachment_id}/download`

### الإحصائيات

- `GET /api/v1/dashboard/stats`

### التقارير

- `GET /api/v1/reports/requests.xlsx`
- `GET /api/v1/reports/requests.pdf`

### المستخدمون

- `GET /api/v1/users`
- `POST /api/v1/users`
- `PUT /api/v1/users/{user_id}`
- `POST /api/v1/users/{user_id}/disable`
- `POST /api/v1/users/{user_id}/reset-password`
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
- `GET /api/v1/request-types/{request_type_id}/form-schema`

### الإعدادات

- `GET /api/v1/settings/public-profile`
- `GET /api/v1/settings/general-profile`
- `PUT /api/v1/settings/general-profile`
- `POST /api/v1/settings/general-profile/logo`
- `GET /api/v1/settings/security`
- `PUT /api/v1/settings/security`
- `GET /api/v1/settings/database/status`
- `GET /api/v1/settings/database/backup`
- `POST /api/v1/settings/database/restore`
- `POST /api/v1/settings/database/reset`
- `GET /api/v1/settings/specialized-sections`
- `POST /api/v1/settings/specialized-sections`
- `PUT /api/v1/settings/specialized-sections/{section_id}`
- `DELETE /api/v1/settings/specialized-sections/{section_id}`

## اختبار التحميل Load Test

يمكن استخدام Locust لاختبار الضغط على API:

```bash
cd backend
.venv\Scripts\pip install locust
```

مثال تشغيل:

```bash
locust -f locustfile.py --host http://172.16.23.37:8000
```

ثم فتح:

```text
http://localhost:8089
```

اختبار بدون واجهة:

```bash
locust -f locustfile.py --host http://172.16.23.37:8000 --headless -u 100 -r 10 -t 5m
```

## ملاحظات النشر داخل الشبكة

- استخدم PostgreSQL بدلاً من SQLite في بيئة رسمية.
- غيّر `SECRET_KEY`.
- غيّر بيانات الحساب الافتراضي.
- اضبط `CORS_ORIGINS` حسب عنوان الواجهة.
- اضبط `VITE_API_BASE_URL` حسب عنوان الخلفية.
- افتح المنافذ المطلوبة في الجدار الناري:
  - `5173` للواجهة
  - `8000` للخلفية
  - `5432` لقاعدة البيانات إذا كانت تحتاج وصولاً خارجياً
- يفضل استخدام HTTPS عبر Nginx أو Reverse Proxy.
- احتفظ بنسخ احتياطية من PostgreSQL ومجلد المرفقات.
- لا تفعّل إعادة ضبط قاعدة البيانات إلا للمستخدمين المخولين فقط.

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

## ملاحظات أمنية

- لا تستخدم كلمة مرور افتراضية في الإنتاج.
- لا تستخدم `SECRET_KEY` الافتراضي.
- فعّل HTTPS.
- راجع صلاحيات الشاشات لكل مستخدم.
- لا تمنح صلاحيات إدارة النظام إلا للمخولين.
- افحص الملفات المرفوعة بآلية مكافحة فيروسات عند النشر الرسمي.
- راقب سجلات التدقيق بشكل دوري.
