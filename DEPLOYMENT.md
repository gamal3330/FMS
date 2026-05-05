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

## النشر عبر Docker

على السيرفر الرئيسي:

```bash
cd /opt/fms
git pull
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
