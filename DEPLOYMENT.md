# نشر وتحديث نظام إدارة النماذج

هذا الملف يشرح طريقة نقل الإصدارات الجديدة إلى السيرفر الرئيسي بطريقة منظمة وآمنة.

## نظام الإصدارات

استخدم صيغة SemVer:

- `v1.0.0` إصدار أساسي.
- `v1.1.0` إضافة ميزة جديدة.
- `v1.1.1` إصلاح صغير.

رقم الإصدار الحالي يوجد في:

- `version.txt`
- `update-manifest.json`

## ملفات التحديث

المجلدات المهمة:

- `updates/migrations/`: تحديثات قاعدة البيانات.
- `updates/releases/`: ملفات مساعدة للإصدارات والنسخ الاحتياطية.
- `scripts/deploy-release.sh`: سكربت نشر سريع للسيرفر.

## إضافة تحديث قاعدة بيانات جديد

1. ارفع رقم الإصدار في `version.txt` و `update-manifest.json`.
2. أنشئ ملفًا جديدًا داخل `updates/migrations/` باسم مثل:

```text
v1_2_0__add_new_feature_indexes.py
```

3. ضع داخله دالة `upgrade(connection)`:

```python
from sqlalchemy import text


def upgrade(connection):
    connection.execute(text('CREATE INDEX IF NOT EXISTS "idx_example" ON "table_name" (column_name)'))
```

سيتم تسجيل كل migration في جدول `applied_migrations`، لذلك لن يتم تنفيذ نفس التحديث مرتين.

## المسار الأول: السيرفر الرئيسي عبر Git + Docker

على السيرفر الرئيسي:

```bash
cd /opt/fms
git pull origin main
docker compose build
docker compose up -d
```

ثم ادخل إلى لوحة المدير:

```text
الإعدادات > إدارة التحديثات > فحص التحديثات > تنفيذ التحديث
```

أو استخدم السكربت:

```bash
APP_DIR=/opt/fms BRANCH=main ./scripts/deploy-release.sh
```

هذا هو المسار المفضل للإنتاج لأنه يحافظ على سجل Git واضح، ويعيد بناء الحاويات بنفس البيئة، ثم ينفذ migrations عبر مدير التحديثات.

## تشغيل النظام عبر HTTPS

تم تجهيز مسار اختياري لتشغيل الواجهة على HTTPS من داخل Docker بدون تعطيل تشغيل HTTP الحالي.

### 1. شهادة داخلية مؤقتة للتجربة

استخدمها للاختبار الداخلي فقط:

```bash
./scripts/create-self-signed-cert.sh
```

ثم شغل النظام بملف HTTPS الإضافي:

```bash
docker compose -f docker-compose.yml -f docker-compose.https.yml up -d --build
```

سيفتح النظام على:

```text
https://server-ip
```

ملاحظة: لأن الشهادة داخلية `self-signed` سيعرض المتصفح تحذيراً، ويجب الوثوق بالشهادة يدوياً أو استبدالها بشهادة رسمية.

### 2. شهادة رسمية أو شهادة داخلية من المؤسسة

ضع ملفات الشهادة في:

```text
deploy/nginx/certs/fullchain.pem
deploy/nginx/certs/privkey.pem
```

ثم شغل:

```bash
docker compose -f docker-compose.yml -f docker-compose.https.yml up -d --build
```

إذا كان لديك دومين مثل `fms.example.com`، حدّث `.env`:

```env
CORS_ORIGINS=https://fms.example.com
FRONTEND_PORT=80
FRONTEND_HTTPS_PORT=443
```

ملف HTTPS المستخدم:

```text
frontend/nginx.https.conf
```

وهو يدعم:

- تحويل HTTP إلى HTTPS.
- WebSocket على `/api/v1/ws/notifications`.
- رفع ملفات حتى 1GB.

## المسار الثاني: تحديث محلي عبر ZIP

استخدم هذا المسار عندما يكون السيرفر داخليًا أو لا يستطيع الوصول إلى GitHub.

على جهاز التطوير أنشئ حزمة تحديث:

```bash
./scripts/create-release-package.sh
```

سيتم إنشاء ملف داخل:

```text
updates/releases/fms-vX.Y.Z.zip
```

الحزمة تحتوي على:

- `backend/`
- `frontend/`
- `scripts/`
- `updates/`
- `version.txt`
- `update-manifest.json`
- ملفات التوثيق والتشغيل

ولا تحتوي على:

- `.env`
- قواعد البيانات المحلية
- `node_modules`
- `dist`
- `.venv`
- `uploads`
- `__pycache__`

على السيرفر الداخلي:

1. افتح النظام بحساب مدير النظام.
2. اذهب إلى:

```text
الإعدادات > التحديث المحلي
```

3. ارفع ملف ZIP.
4. اضغط `فحص قابلية التطبيق`.
5. اضغط `تطبيق التحديث`.
6. اضغط `إعادة تشغيل الباكند`.
7. بعد رجوع النظام اذهب إلى:

```text
الإعدادات > إدارة التحديثات > فحص التحديثات > تنفيذ التحديث
```

هذه الخطوة الأخيرة مهمة لأنها تنفذ migrations وتسجل الإصدار في قاعدة البيانات.

## قواعد مهمة قبل كل إصدار

1. رقم الإصدار الجديد يجب أن يكون أكبر من الحالي.
2. يجب تحديث الملفين:

```text
version.txt
update-manifest.json
```

3. إذا احتاج التحديث قاعدة البيانات، أضف migration داخل:

```text
updates/migrations/
```

4. لا ترفع بيانات حساسة أو ملفات تشغيل محلية داخل Git أو حزمة ZIP.

## ملاحظات أمان

- لا تضع كلمات المرور داخل الكود.
- استخدم `backend/.env` أو `.env.docker.example` كنموذج للإعدادات.
- احتفظ بنسخة احتياطية من قاعدة البيانات قبل أي تحديث كبير.
- في PostgreSQL استخدم:

```bash
docker compose exec postgres pg_dump -U qib qib_it_portal > backup.sql
```

## تشخيص البطء

تمت إضافة:

- Header باسم `X-Process-Time-Ms` لكل طلب API.
- Logging للطلبات البطيئة حسب `REQUEST_SLOW_MS`.
- فهارس للجداول الأكثر استخدامًا في الطلبات والموافقات والمستخدمين.
- صفحة `إدارة التحديثات` لمراجعة الإصدارات و migrations.
- صفحة مراقبة صحة النظام تعرض حالة قاعدة البيانات والتخزين والذاكرة والإصدار.
