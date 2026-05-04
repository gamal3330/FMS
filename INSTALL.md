# تثبيت النظام

## التشغيل على خادم باستخدام Docker

هذه هي الطريقة المفضلة عند نقل النظام إلى خادم جديد مثل AWS EC2، لأنها تشغل قاعدة البيانات والباكند والواجهة بنفس البيئة بدون تثبيت Python و Node يدوياً داخل الخادم.

### المتطلبات على الخادم

- Docker
- Docker Compose Plugin
- Git

على Ubuntu:

```bash
sudo apt update
sudo apt install -y git docker.io docker-compose-plugin
sudo systemctl enable docker
sudo systemctl start docker
sudo usermod -aG docker $USER
```

بعد الأمر الأخير، اخرج من SSH وادخل مرة أخرى حتى تعمل صلاحية Docker بدون `sudo`.

### تنزيل وتشغيل النظام

```bash
git clone رابط_المستودع FMS
cd FMS
bash scripts/deploy-docker.sh
```

في أول تشغيل سيقوم السكربت بإنشاء ملف `.env` من `.env.docker.example` ثم يتوقف حتى تراجع كلمات المرور. عدّل الملف:

```bash
nano .env
```

غيّر خصوصاً:

```env
POSTGRES_PASSWORD=change-this-postgres-password
SECRET_KEY=change-this-to-a-long-random-secret
CORS_ORIGINS=http://SERVER_IP
FRONTEND_PORT=80
```

ثم شغّل:

```bash
bash scripts/deploy-docker.sh
```

افتح النظام:

```text
http://SERVER_IP
```

### أوامر مفيدة

```bash
docker compose ps
docker compose logs -f
docker compose restart
docker compose down
docker compose up -d --build
```

### تحديث النظام على الخادم

```bash
cd ~/FMS
git pull
docker compose up -d --build
```

### النسخ الاحتياطي لقاعدة PostgreSQL

```bash
docker compose exec postgres pg_dump -U qib qib_it_portal > backup.sql
```

استرجاع نسخة:

```bash
cat backup.sql | docker compose exec -T postgres psql -U qib qib_it_portal
```

---

# تثبيت النظام محلياً للتطوير

هذه الصفحة مخصصة لتثبيت وتشغيل نظام إدارة طلبات الخدمات التقنية على جهاز تطوير محلي بأمر واحد على macOS أو Linux أو Windows.

## الأمر المختصر حسب نظام التشغيل

### macOS / Linux

```bash
bash scripts/install-local.sh
```

### Windows PowerShell

```powershell
powershell -ExecutionPolicy Bypass -File scripts/install-local.ps1
```

يقوم الأمر تلقائياً بـ:

- إنشاء بيئة Python محلية داخل `backend/.venv-local`.
- تثبيت اعتماديات الخلفية من `backend/requirements.txt`.
- إنشاء ملفات البيئة المحلية إذا لم تكن موجودة.
- تثبيت اعتماديات الواجهة عبر `npm install`.
- تشغيل الخلفية على `http://localhost:8000`.
- تشغيل الواجهة على `http://localhost:5173`.

## المتطلبات

- Python 3.12 مفضل، ويعمل غالباً مع Python 3.11 أيضاً.
- Node.js و npm.
- اتصال إنترنت عند أول تشغيل لتحميل الاعتماديات.

## تثبيت المتطلبات

### macOS

```bash
brew install python@3.12 node expat
```

### Ubuntu / Debian Linux

```bash
sudo apt update
sudo apt install -y python3 python3-venv python3-pip nodejs npm
```

إذا كانت نسخة Node.js قديمة في مستودعات النظام، استخدم نسخة LTS من موقع Node.js أو من NodeSource.

### Windows

ثبت:

- Python 3.12 من `https://www.python.org/downloads/`
- Node.js LTS من `https://nodejs.org/`

ثم افتح PowerShell داخل مجلد المشروع وشغّل أمر Windows أعلاه.

## ملاحظات خاصة بـ macOS

إذا واجهت مشكلة في حزمة Python أو PDF العربي، استخدم Python 3.12 و `expat`:

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

### macOS / Linux

```bash
PYTHON_BIN=/opt/homebrew/bin/python3.12 bash scripts/install-local.sh
```

### Windows PowerShell

```powershell
$env:PYTHON_BIN="python"
powershell -ExecutionPolicy Bypass -File scripts/install-local.ps1
```

## إيقاف النظام

اضغط:

```text
Ctrl+C
```

سيوقف السكربت الخلفية والواجهة معاً.
