# تثبيت النظام محلياً

هذه الصفحة مخصصة لتثبيت وتشغيل نظام إدارة طلبات الخدمات التقنية على جهاز تطوير محلي بأمر واحد.

## الأمر المختصر

من مجلد المشروع الرئيسي شغّل:

```bash
bash scripts/install-local.sh
```

يقوم الأمر تلقائياً بـ:

- إنشاء بيئة Python محلية داخل `backend/.venv-local`.
- تثبيت اعتماديات الخلفية من `backend/requirements.txt`.
- إنشاء ملفات البيئة المحلية إذا لم تكن موجودة.
- تثبيت اعتماديات الواجهة عبر `npm install`.
- تشغيل الخلفية على `http://localhost:8000`.
- تشغيل الواجهة على `http://localhost:5173`.

## المتطلبات

- Python 3.12 مفضل.
- Node.js و npm.
- اتصال إنترنت عند أول تشغيل لتحميل الاعتماديات.

على macOS، إذا واجهت مشكلة في حزمة Python أو PDF العربي، استخدم Python 3.12:

```bash
brew install python@3.12 expat
```

ثم أعد تشغيل أمر التثبيت.

## روابط التشغيل

- الواجهة: `http://localhost:5173`
- الخلفية: `http://localhost:8000`
- توثيق API: `http://localhost:8000/docs`
- فحص الصحة: `http://localhost:8000/health`

## الحساب الافتراضي

```text
Email: admin@qib.internal-bank.qa
Password: Admin@12345
```

> يجب تغيير كلمة المرور الافتراضية و `SECRET_KEY` قبل أي تشغيل رسمي.

## تخصيص المنافذ

يمكن تغيير المنافذ قبل تشغيل الأمر:

```bash
BACKEND_PORT=8010 FRONTEND_PORT=5180 bash scripts/install-local.sh
```

## تشغيل متقدم

إذا أردت تحديد Python يدوياً:

```bash
PYTHON_BIN=/opt/homebrew/bin/python3.12 bash scripts/install-local.sh
```

## إيقاف النظام

اضغط:

```text
Ctrl+C
```

سيوقف السكربت الخلفية والواجهة معاً.
