# الخلفية الجديدة ASP.NET Core لخدمة QIB Service Portal

هذا المشروع هو خلفية مستقلة تعمل بالتوازي مع النظام الحالي ولا تستبدله أثناء التطوير.

## الهدف

بناء واجهة API جديدة باستخدام ASP.NET Core و PostgreSQL مع الحفاظ على النظام الحالي كما هو. تستخدم النسخة الجديدة المسار:

```text
/api/dotnet/v1
```

ولا تستخدم `/api/v1` حتى لا تتعارض مع الخلفية الحالية.

## مكان المشروع

```text
Qib.ServicePortal.Api/
```

## البنية

```text
Qib.ServicePortal.Api/
  Controllers/
  Application/
    DTOs/
    Services/
    Interfaces/
    Validators/
  Domain/
    Entities/
    Enums/
    ValueObjects/
  Infrastructure/
    Data/
    Repositories/
    Security/
    Logging/
    Files/
    Pdf/
    Jobs/
  Common/
    Middleware/
    Exceptions/
    Authorization/
    Helpers/
```

## المرحلة الأولى المنفذة

تشمل المرحلة الأولى:

- تسجيل الدخول باستخدام JWT.
- Refresh Tokens مع تدوير الرمز.
- تسجيل الخروج.
- تغيير كلمة المرور.
- المستخدمون.
- الأدوار.
- الصلاحيات.
- الإدارات.
- الإعدادات العامة.
- سجل التدقيق.
- فحص صحة النظام وقاعدة البيانات.

## المرحلة الثانية المنفذة كبداية

تمت إضافة أساس إدارة الطلبات في الخلفية المستقلة:

- أنواع الطلبات.
- النسخ والإصدارات.
- الحقول الديناميكية.
- مسارات الموافقات.
- إعدادات نوع الطلب.
- قواعد المرفقات الأساسية.
- الأولويات.
- الأقسام المختصة.
- التحقق قبل تفعيل نسخة نوع الطلب.

هذه المرحلة لا تنشئ الطلبات الفعلية بعد. الهدف منها تجهيز مصدر الحقيقة الذي ستعتمد عليه شاشة الطلبات في المرحلة الثالثة.

## المرحلة الثالثة المنفذة كبداية

تمت إضافة دورة حياة الطلبات الفعلية:

- إنشاء طلب من نوع طلب منشور.
- التحقق من بيانات النموذج حسب نسخة نوع الطلب النشطة.
- حفظ بيانات النموذج كـ snapshots داخل الطلب.
- حفظ مسار الموافقات كـ snapshots داخل الطلب.
- جعل أول مرحلة في المسار بحالة `pending` وباقي المراحل `waiting`.
- إنشاء سجل حالة عند تقديم الطلب.
- تتبع SLA الأساسي حسب إعدادات نوع الطلب أو أولوية الطلب.
- تعديل الطلب إذا كان معاداً للتعديل أو يسمح نوع الطلب بالتعديل قبل الموافقة.
- إلغاء الطلب.
- إعادة إرسال الطلب المعاد للتعديل.
- إعادة فتح الطلب إذا كان نوع الطلب يسمح بذلك.
- رفع واستعراض المرفقات الخاصة بالطلب.
- عرض تفاصيل الطلب، السجل الزمني، وسجل الحالة.

مبدأ مهم: الطلبات المقدمة تعتمد على snapshots محفوظة، ولا تعتمد على إعدادات نوع الطلب الحية بعد التقديم.

## المرحلة الرابعة المنفذة كبداية

تمت إضافة أساس الموافقات والتنفيذ:

- ملخص الموافقات.
- قائمة طلبات الموافقة والتنفيذ.
- تفاصيل طلب الموافقة.
- تنفيذ إجراءات الموافقة: موافقة، رفض، إرجاع للتعديل، تنفيذ، إغلاق.
- فحص صلاحية المستخدم على المرحلة الحالية من سنابشوت المسار.
- منع تكرار معالجة نفس المرحلة.
- تحريك الطلب للمرحلة التالية أو إغلاق المسار عند اكتماله.
- سجل تاريخ الموافقات.
- إرجاع سنابشوت مسار الطلب كما كان وقت التقديم.
- تسجيل إجراءات الموافقات في سجل التدقيق.

هذه المرحلة تعتمد على `request_workflow_snapshots` ولا تستخدم قالب المسار الحي عند معالجة طلب قائم.

## المرحلة الخامسة المنفذة كبداية

تمت إضافة أساس المراسلات الداخلية:

- صندوق الوارد.
- الصادر.
- المؤرشفة.
- غير المقروءة.
- المراسلات المرتبطة بالطلبات.
- إنشاء مراسلة جديدة.
- الرد على مراسلة.
- تعليم كمقروء أو غير مقروء.
- أرشفة المراسلة للمستخدم الحالي فقط.
- رفع وتنزيل مرفقات المراسلات عبر API محمي.
- أنواع الرسائل من قاعدة البيانات، مثل: مراسلة داخلية، مراسلة رسمية، طلب استيضاح، ملاحظة تنفيذ، تعميم.
- تصنيفات السرية من قاعدة البيانات.
- قوالب رسائل أولية.
- تسجيل عمليات الإرسال والقراءة والأرشفة والمرفقات في سجل التدقيق.

ملاحظة: المراسلات الرسمية بترويسة البنك وتوليد PDF الرسمي ستأتي في المرحلة السادسة.

## المرحلة السادسة المنفذة كبداية

تمت إضافة أساس المراسلات الرسمية بترويسة البنك:

- إعدادات عامة لتفعيل أو تعطيل خدمة الخطابات الرسمية.
- قالب ترويسة رسمي افتراضي للبنك.
- إدارة قوالب الترويسة الرسمية.
- تعيين قالب افتراضي.
- معاينة قالب الترويسة كملف PDF.
- معاينة خطاب رسمي قبل إرسال الرسالة أو من بيانات مباشرة.
- توليد PDF رسمي لمراسلة من نوع `مراسلة رسمية`.
- حفظ ملف PDF الرسمي في التخزين الداخلي.
- تنزيل أو معاينة PDF الرسمي عبر API محمي.
- ربط وثيقة PDF الرسمية بسجل الرسالة.
- تسجيل عمليات المعاينة والتوليد والتنزيل في سجل التدقيق.

تم تأجيل التوقيع والختم إلى مرحلة لاحقة حتى لا تتعقد تجربة المستخدم قبل اعتماد نموذج الخطاب الرسمي.

## قاعدة البيانات

هذه الخلفية تستخدم قاعدة بيانات مستقلة:

```text
qib_service_portal_dotnet
```

لا يتم الاتصال بقاعدة بيانات الإنتاج الحالية ولا يتم ترحيل بيانات النظام الحالي تلقائياً.

## التشغيل عبر Docker

من داخل مجلد المشروع:

```bash
cd Qib.ServicePortal.Api
docker compose up -d --build
```

العنوان الافتراضي:

```text
http://localhost:8088/api/dotnet/v1
```

Swagger في وضع التطوير:

```text
http://localhost:8088/swagger
```

## بيانات الدخول الافتراضية

يتم إنشاء مدير نظام افتراضي من متغيرات البيئة:

```text
SeedAdmin__Email=admin@qib.internal-bank.qa
SeedAdmin__Username=admin
SeedAdmin__Password=ChangeMe@12345
```

يجب تغيير كلمة المرور بعد أول دخول.

## أهم المسارات

### المصادقة

```text
POST /api/dotnet/v1/auth/login
POST /api/dotnet/v1/auth/refresh-token
POST /api/dotnet/v1/auth/logout
GET  /api/dotnet/v1/auth/me
POST /api/dotnet/v1/auth/change-password
```

### المستخدمون

```text
GET  /api/dotnet/v1/users
GET  /api/dotnet/v1/users/{id}
POST /api/dotnet/v1/users
PUT  /api/dotnet/v1/users/{id}
POST /api/dotnet/v1/users/{id}/disable
POST /api/dotnet/v1/users/{id}/enable
POST /api/dotnet/v1/users/{id}/reset-password
GET  /api/dotnet/v1/users/{id}/effective-permissions
```

### الأدوار والصلاحيات

```text
GET /api/dotnet/v1/roles
POST /api/dotnet/v1/roles
PUT /api/dotnet/v1/roles/{id}
PUT /api/dotnet/v1/roles/{id}/permissions
GET /api/dotnet/v1/permissions
```

### الإدارات

```text
GET  /api/dotnet/v1/departments
POST /api/dotnet/v1/departments
PUT  /api/dotnet/v1/departments/{id}
```

### التدقيق والصحة

```text
GET /api/dotnet/v1/audit-logs
GET /api/dotnet/v1/health
GET /api/dotnet/v1/health/database
GET /api/dotnet/v1/health/live
```

### إدارة أنواع الطلبات

```text
GET   /api/dotnet/v1/request-types
GET   /api/dotnet/v1/request-types/active
GET   /api/dotnet/v1/request-types/{id}
POST  /api/dotnet/v1/request-types
PUT   /api/dotnet/v1/request-types/{id}
PATCH /api/dotnet/v1/request-types/{id}/status

GET  /api/dotnet/v1/request-types/{id}/versions
POST /api/dotnet/v1/request-types/{id}/versions/clone-current
POST /api/dotnet/v1/request-type-versions/{versionId}/activate
POST /api/dotnet/v1/request-type-versions/{versionId}/validate

GET    /api/dotnet/v1/request-type-versions/{versionId}/fields
POST   /api/dotnet/v1/request-type-versions/{versionId}/fields
PUT    /api/dotnet/v1/request-fields/{fieldId}
DELETE /api/dotnet/v1/request-fields/{fieldId}

GET    /api/dotnet/v1/request-type-versions/{versionId}/workflow
POST   /api/dotnet/v1/request-type-versions/{versionId}/workflow/steps
PUT    /api/dotnet/v1/workflow-steps/{stepId}
DELETE /api/dotnet/v1/workflow-steps/{stepId}

GET /api/dotnet/v1/request-types/{id}/form-schema
GET /api/dotnet/v1/specialized-sections
GET /api/dotnet/v1/priority-settings
```

### الطلبات

```text
GET  /api/dotnet/v1/requests
POST /api/dotnet/v1/requests
GET  /api/dotnet/v1/requests/{id}
PUT  /api/dotnet/v1/requests/{id}
POST /api/dotnet/v1/requests/{id}/cancel
POST /api/dotnet/v1/requests/{id}/resubmit
POST /api/dotnet/v1/requests/{id}/reopen
POST /api/dotnet/v1/requests/{id}/attachments
GET  /api/dotnet/v1/requests/{id}/attachments
GET  /api/dotnet/v1/requests/{id}/timeline
GET  /api/dotnet/v1/requests/{id}/status-history
```

### الموافقات

```text
GET  /api/dotnet/v1/approvals/summary
GET  /api/dotnet/v1/approvals
GET  /api/dotnet/v1/approvals/{requestId}
POST /api/dotnet/v1/requests/{requestId}/approval
GET  /api/dotnet/v1/requests/{requestId}/approval-history
GET  /api/dotnet/v1/requests/{requestId}/workflow-snapshot
```

### المراسلات

```text
GET  /api/dotnet/v1/messages/inbox
GET  /api/dotnet/v1/messages/sent
GET  /api/dotnet/v1/messages/archived
GET  /api/dotnet/v1/messages/unread
GET  /api/dotnet/v1/messages/request-linked
GET  /api/dotnet/v1/messages/{id}
POST /api/dotnet/v1/messages
POST /api/dotnet/v1/messages/{id}/reply
POST /api/dotnet/v1/messages/{id}/archive
POST /api/dotnet/v1/messages/{id}/mark-read
POST /api/dotnet/v1/messages/{id}/mark-unread
POST /api/dotnet/v1/messages/{id}/attachments
GET  /api/dotnet/v1/messages/{messageId}/attachments/{attachmentId}/download
GET  /api/dotnet/v1/requests/{requestId}/messages
GET  /api/dotnet/v1/settings/messaging/message-types
GET  /api/dotnet/v1/settings/messaging/classifications
GET  /api/dotnet/v1/settings/messaging/templates
GET  /api/dotnet/v1/settings/messaging/attachments
```

### المراسلات الرسمية و PDF

```text
GET   /api/dotnet/v1/settings/official-letterheads
POST  /api/dotnet/v1/settings/official-letterheads
PUT   /api/dotnet/v1/settings/official-letterheads/{id}
PATCH /api/dotnet/v1/settings/official-letterheads/{id}/status
POST  /api/dotnet/v1/settings/official-letterheads/{id}/set-default
POST  /api/dotnet/v1/settings/official-letterheads/{id}/preview

GET /api/dotnet/v1/settings/official-messages
PUT /api/dotnet/v1/settings/official-messages

POST /api/dotnet/v1/messages/official/preview-pdf
POST /api/dotnet/v1/messages/{messageId}/official/generate-pdf
GET  /api/dotnet/v1/messages/{messageId}/official/pdf/preview
GET  /api/dotnet/v1/messages/{messageId}/official/pdf/download
```

### مكتبة الوثائق

مكتبة الوثائق في نسخة .NET مستقلة وتقبل ملفات PDF فقط. تدعم التصنيفات الافتراضية، رفع الوثائق، الإصدارات، المعاينة المحمية، التحميل والطباعة بصلاحيات منفصلة، الإقرار بالاطلاع، وسجلات الوصول.

```text
GET    /api/dotnet/v1/documents/categories
POST   /api/dotnet/v1/documents/categories
PUT    /api/dotnet/v1/documents/categories/{id}
PATCH  /api/dotnet/v1/documents/categories/{id}/status

GET    /api/dotnet/v1/documents
GET    /api/dotnet/v1/documents/search?q=...
GET    /api/dotnet/v1/documents/categories/{categoryCode}/documents
GET    /api/dotnet/v1/documents/{id}
POST   /api/dotnet/v1/documents
PUT    /api/dotnet/v1/documents/{id}
PATCH  /api/dotnet/v1/documents/{id}/status

GET    /api/dotnet/v1/documents/{documentId}/versions
POST   /api/dotnet/v1/documents/{documentId}/versions
POST   /api/dotnet/v1/documents/{documentId}/versions/{versionId}/set-current

GET    /api/dotnet/v1/documents/{documentId}/preview
GET    /api/dotnet/v1/documents/{documentId}/download
GET    /api/dotnet/v1/documents/{documentId}/print

POST   /api/dotnet/v1/documents/{documentId}/acknowledge
GET    /api/dotnet/v1/documents/{documentId}/acknowledgements
GET    /api/dotnet/v1/documents/{documentId}/access-logs

GET    /api/dotnet/v1/documents/permissions
POST   /api/dotnet/v1/documents/permissions
DELETE /api/dotnet/v1/documents/permissions/{id}
```

## المرحلة الثامنة: التقارير والتحليلات

تمت إضافة نواة مركز التقارير في Backend .NET المستقل على المسار:

```text
GET /api/dotnet/v1/reports/summary
GET /api/dotnet/v1/reports/requests
GET /api/dotnet/v1/reports/approvals
GET /api/dotnet/v1/reports/sla
GET /api/dotnet/v1/reports/messaging
GET /api/dotnet/v1/reports/audit
GET /api/dotnet/v1/reports/export/excel
GET /api/dotnet/v1/reports/export/pdf
```

الخصائص الحالية:

- فلاتر موحدة للتاريخ، الإدارة، نوع الطلب، الحالة، الأولوية، القسم المختص، المستخدم، وحالة SLA.
- نطاق بيانات حسب صلاحيات المستخدم؛ مدير النظام يرى الكل، وباقي المستخدمين يرون ما يخصهم أو ما يملكون صلاحية الوصول له.
- تصدير Excel بصيغة متوافقة مع Excel وبعناوين عربية واتجاه RTL.
- تصدير PDF لتقرير الطلبات باستخدام QuestPDF وخط عربي.
- تسجيل عمليات تصدير التقارير في سجل التدقيق.

## المرحلة التاسعة: الإعدادات

تمت إضافة طبقة إعدادات موحدة في Backend .NET المستقل، بحيث تكون الإعدادات محفوظة في قاعدة البيانات عبر `system_settings` وتقرأها الوحدات الفعلية بدلاً من الاعتماد على قيم ثابتة داخل الواجهة.

مسارات الإعدادات الرئيسية:

```text
GET /api/dotnet/v1/settings/public-profile
GET /api/dotnet/v1/settings/general-profile
GET /api/dotnet/v1/settings/general
PUT /api/dotnet/v1/settings/general

GET /api/dotnet/v1/settings/security
PUT /api/dotnet/v1/settings/security

GET /api/dotnet/v1/settings/attachments
PUT /api/dotnet/v1/settings/attachments

GET /api/dotnet/v1/settings/notifications
PUT /api/dotnet/v1/settings/notifications

GET /api/dotnet/v1/settings/messaging
PUT /api/dotnet/v1/settings/messaging
GET /api/dotnet/v1/settings/messaging/request-integration
PUT /api/dotnet/v1/settings/messaging/request-integration
GET /api/dotnet/v1/settings/messaging/recipients
PUT /api/dotnet/v1/settings/messaging/recipients
GET /api/dotnet/v1/settings/messaging/notifications
PUT /api/dotnet/v1/settings/messaging/notifications
GET /api/dotnet/v1/settings/messaging/attachments
PUT /api/dotnet/v1/settings/messaging/attachments
GET /api/dotnet/v1/settings/messaging/retention
PUT /api/dotnet/v1/settings/messaging/retention
GET /api/dotnet/v1/settings/messaging/security
PUT /api/dotnet/v1/settings/messaging/security
GET /api/dotnet/v1/settings/messaging/ai
PUT /api/dotnet/v1/settings/messaging/ai

GET /api/dotnet/v1/settings/ai
PUT /api/dotnet/v1/settings/ai

GET /api/dotnet/v1/settings/database
PUT /api/dotnet/v1/settings/database
GET /api/dotnet/v1/settings/database/status
GET /api/dotnet/v1/settings/database/tables
GET /api/dotnet/v1/settings/database/backup-settings
PUT /api/dotnet/v1/settings/database/backup-settings
POST /api/dotnet/v1/settings/database/maintenance/test-connection
POST /api/dotnet/v1/settings/database/maintenance/check-integrity

GET /api/dotnet/v1/settings/health
PUT /api/dotnet/v1/settings/health
GET /api/dotnet/v1/health/summary
POST /api/dotnet/v1/health/run-checks

GET /api/dotnet/v1/settings/updates/settings
PUT /api/dotnet/v1/settings/updates/settings
```

قواعد التحقق المهمة:

- حد المرفقات العام يطبق على الطلبات، المراسلات، ومكتبة الوثائق.
- إذا كان الحد العام للمرفقات `is_hard_limit = true` فلا يمكن لأي وحدة رفع حد أعلى منه.
- الامتدادات الخطرة مثل `exe`, `bat`, `cmd`, `ps1`, `sh`, `js`, `vbs`, `msi` مرفوضة.
- إعدادات الذكاء الاصطناعي تمنع `max_input_chars` أقل من 500.
- حدود الصحة يجب أن تكون منطقية: حد التحذير أقل من حد الخطر.
- تغييرات الإعدادات تسجل في `audit_logs` مع القيم القديمة والجديدة.

## المرحلة العاشرة: قاعدة البيانات والتحديثات

تمت إضافة أدوات تشغيلية آمنة لقاعدة البيانات والتحديثات في Backend .NET المستقل. هذه الأدوات تعمل على قاعدة .NET المستقلة فقط، ولا تلمس قاعدة النظام الحالي.

مسارات قاعدة البيانات:

```text
GET  /api/dotnet/v1/settings/database/backups
GET  /api/dotnet/v1/settings/database/jobs
POST /api/dotnet/v1/settings/database/backup
GET  /api/dotnet/v1/settings/database/backups/{backupId}/download
POST /api/dotnet/v1/settings/database/backups/{backupId}/decrypt-download
POST /api/dotnet/v1/settings/database/backups/{backupId}/verify
DELETE /api/dotnet/v1/settings/database/backups/{backupId}

POST /api/dotnet/v1/settings/database/restore/validate
POST /api/dotnet/v1/settings/database/restore/confirm
GET  /api/dotnet/v1/settings/database/reset-preview?scope=clear_requests_only
POST /api/dotnet/v1/settings/database/reset
POST /api/dotnet/v1/settings/database/migrations/run

POST /api/dotnet/v1/settings/database/maintenance/test-connection
POST /api/dotnet/v1/settings/database/maintenance/check-integrity
POST /api/dotnet/v1/settings/database/maintenance/optimize
POST /api/dotnet/v1/settings/database/maintenance/analyze
POST /api/dotnet/v1/settings/database/maintenance/check-orphan-attachments
```

مسارات التحديث المحلي:

```text
GET  /api/dotnet/v1/settings/updates/status
GET  /api/dotnet/v1/settings/updates/jobs
GET  /api/dotnet/v1/settings/updates/rollback-points
GET  /api/dotnet/v1/settings/updates/release-notes
GET  /api/dotnet/v1/settings/updates/audit-logs
GET  /api/dotnet/v1/settings/updates/packages
POST /api/dotnet/v1/settings/updates/precheck
POST /api/dotnet/v1/settings/updates/local/upload
POST /api/dotnet/v1/settings/updates/local/validate
POST /api/dotnet/v1/settings/updates/local/preview
POST /api/dotnet/v1/settings/updates/local/apply
POST /api/dotnet/v1/settings/updates/rollback/{rollbackId}
```

قواعد الحماية:

- إنشاء النسخة الاحتياطية والتحقق منها وتنزيلها تعمل فعلياً.
- النسخة تحتوي على metadata، إعدادات النظام، وعدّادات الجداول، ويمكن تضمين ملفات الرفع عند الطلب.
- الاستعادة حالياً تمر بمرحلة تحقق ومعاينة آمنة، ولا تستبدل البيانات مباشرة إلا بعد بناء أداة ترحيل/استعادة مخصصة لكل جدول.
- إعادة الضبط، تشغيل الترحيلات، تطبيق التحديث، والرجوع لتحديث سابق عمليات محمية.
- العمليات الخطرة تتطلب مدير نظام، كلمة المرور الحالية، وعبارة تأكيد مثل `RESET DATABASE` أو `APPLY UPDATE`.
- حتى مع صحة كلمة المرور، تبقى العمليات الخطرة معطلة افتراضياً ما لم يتم تفعيل متغير البيئة `EnableDangerousDatabaseOperations=true`.
- عند التشغيل عبر السكربت يمكن تفعيلها مؤقتاً لبيئة التطوير فقط:

```bash
ENABLE_DANGEROUS_DATABASE_OPERATIONS=true ./scripts/start-dotnet-api.sh
```

- تشغيل `optimize` و`analyze` يستخدم `ANALYZE` الآمن في PostgreSQL.
- فحص المرفقات يتحقق من الملفات المفقودة والملفات اليتيمة بدون حذف تلقائي.
- كل العمليات المهمة تسجل في `audit_logs`.

الصلاحيات المرتبطة:

```text
documents.view
documents.manage
documents.download
documents.print
documents.acknowledge
documents.versions.view
documents.logs.view
```

## الأمان

- كل المسارات الإدارية تتطلب JWT.
- الصلاحيات تطبق من الخلفية عبر سياسات `Permission:<code>`.
- مدير النظام `super_admin` يحصل على كل الصلاحيات النشطة.
- يتم تسجيل العمليات المهمة في `audit_logs`.
- لا يتم تسجيل الأسرار في الاستجابة؛ الإعدادات الحساسة ترجع بدون قيمة.

## متغيرات البيئة المهمة

```text
ConnectionStrings__DefaultConnection
DATABASE_URL
Jwt__Issuer
Jwt__Audience
Jwt__Secret
SeedAdmin__Email
SeedAdmin__Username
SeedAdmin__Password
Cors__Origins__0
Storage__UploadsPath
Storage__BackupsPath
Documents__MaxFileSizeMb
EnableDangerousDatabaseOperations
```

## الترحيل لاحقاً

الترحيل من النظام الحالي غير مفعل تلقائياً. سيتم لاحقاً بناء أدوات منفصلة للاستيراد:

- المستخدمون.
- الإدارات.
- أنواع الطلبات.
- الطلبات.
- سجل الموافقات.
- المراسلات.
- بيانات المرفقات.
- سجلات التدقيق عند الحاجة.

## المراحل القادمة

1. بناء أداة استعادة/استيراد تفصيلية لكل جدول قبل السماح باستعادة الإنتاج.
2. ربط مكتبة الوثائق بأنواع الطلبات عند الحاجة.
3. تحسينات إضافية على التقارير مثل التقارير المحفوظة والجدولة عند الحاجة.
4. خط نشر تحديثات فعلي خاص بالخادم بعد اعتماد طريقة التشغيل النهائية.

كل مرحلة يجب اختبارها مستقلة قبل التفكير في أي ربط مع الواجهة الحالية أو ترحيل بيانات.
