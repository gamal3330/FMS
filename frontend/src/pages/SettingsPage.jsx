import { useEffect, useState } from "react";
import { AlertTriangle, Download, Info, LockKeyhole, Mail, RefreshCw, Settings2 } from "lucide-react";
import { api, getErrorMessage } from "../lib/axios";
import { Card } from "../components/ui/card";
import { Button } from "../components/ui/button";
import FeedbackDialog from "../components/ui/FeedbackDialog";
import { Input } from "../components/ui/input";
import GeneralSettings from "../components/settings/GeneralSettings";
import { formatSystemDateTime } from "../lib/datetime";

const tabs = [
  ["general", "الإعدادات العامة", Settings2],
  ["email", "البريد SMTP", Mail],
  ["security", "إعدادات الأمان", LockKeyhole],
  ["about", "حول", Info]
];

export default function SettingsPage({ initialTab = "general" }) {
  const [active, setActive] = useState(isVisibleSettingsTab(initialTab) ? initialTab : "general");
  const [dialog, setDialog] = useState({ type: "success", message: "" });

  useEffect(() => {
    setActive(isVisibleSettingsTab(initialTab) ? initialTab : "general");
  }, [initialTab]);

  function notify(message, type = "success") {
    setDialog({ type, message });
  }

  return (
    <section className="min-w-0 max-w-full space-y-6" dir="rtl">
      <FeedbackDialog open={Boolean(dialog.message)} type={dialog.type} message={dialog.message} onClose={() => setDialog({ ...dialog, message: "" })} />
      <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <p className="text-sm font-semibold text-bank-700">لوحة الإدارة</p>
        <h2 className="mt-2 text-2xl font-bold text-slate-950">إعدادات النظام</h2>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">إدارة إعدادات النظام والصلاحيات وسير العمل</p>
      </div>

      <div className="grid min-w-0 gap-5 xl:grid-cols-[300px_minmax(0,1fr)]">
        <Card className="min-w-0 p-3">
          <nav className="space-y-1">
            {tabs.map(([key, label, Icon]) => (
              <button key={key} onClick={() => setActive(key)} className={`flex h-11 w-full items-center gap-3 rounded-md px-3 text-right text-sm font-semibold ${active === key ? "bg-bank-50 text-bank-700" : "text-slate-600 hover:bg-slate-50"}`}>
                <Icon className="h-4 w-4" />
                {label}
              </button>
            ))}
          </nav>
        </Card>
        <Card className="min-w-0 overflow-hidden p-5">
          {active === "general" && <Panel title="الإعدادات العامة"><GeneralSettings notify={notify} /></Panel>}
          {active === "email" && <Panel title="إعدادات البريد SMTP"><EmailSettings notify={notify} /></Panel>}
          {active === "security" && <Panel title="إعدادات الأمان"><SecuritySettings notify={notify} /></Panel>}
          {active === "about" && <Panel title="حول النظام"><AboutSystemPanel /></Panel>}
        </Card>
      </div>
    </section>
  );
}

function isVisibleSettingsTab(tab) {
  return tabs.some(([key]) => key === tab);
}

function Panel({ title, children }) {
  return <div className="min-w-0"><h3 className="mb-5 text-xl font-bold text-slate-950">{title}</h3>{children}</div>;
}

function AboutSystemPanel() {
  const systemYear = new Intl.NumberFormat("ar", { useGrouping: false }).format(new Date().getFullYear());

  return (
    <div className="space-y-5 text-right" dir="rtl">
      <div className="rounded-lg border border-bank-100 bg-bank-50/70 p-5">
        <div className="flex items-start gap-4">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md bg-white text-bank-700">
            <Info className="h-6 w-6" />
          </span>
          <div>
            <p className="text-lg font-black text-slate-950">بوابة خدمات بنك القطيبي الإسلامي</p>
            <p className="mt-2 max-w-3xl text-sm leading-7 text-slate-600">
              منصة داخلية موحدة لاستقبال الطلبات، تتبع مراحل الاعتماد، إدارة المراسلات والوثائق، مراقبة مؤشرات الخدمة، وتوثيق الأثر التشغيلي داخل بيئة عمل مصرفية منظمة وآمنة.
            </p>
          </div>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <AboutItem title="إدارة الطلبات والموافقات" text="إنشاء الطلبات، بناء مسارات الموافقة، متابعة حالة التنفيذ، وتوثيق سجل الحالة لكل طلب." />
        <AboutItem title="المراسلات والوثائق" text="مراسلات داخلية مرتبطة بالطلبات، ومكتبة وثائق PDF للسياسات والتعاميم والنماذج مع صلاحيات وإقرارات اطلاع." />
        <AboutItem title="الحوكمة والصلاحيات" text="إدارة المستخدمين، الأدوار، صلاحيات الشاشات، التفويضات، وسجلات التدقيق الحساسة." />
        <AboutItem title="التشغيل والمراقبة" text="تقارير، نسخ احتياطي، مراقبة صحة النظام، وإعدادات تشغيل تساعد فرق الإدارة والدعم على المتابعة." />
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-5">
        <p className="text-sm font-bold text-slate-500">الإصدار المؤسسي الداخلي</p>
        <p className="mt-2 text-2xl font-black text-slate-950">بنك القطيبي الإسلامي {systemYear}</p>
      </div>
    </div>
  );
}

function AboutItem({ title, text }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <p className="font-black text-slate-950">{title}</p>
      <p className="mt-2 text-sm leading-6 text-slate-600">{text}</p>
    </div>
  );
}


const emailDefaults = {
  smtp_host: "",
  smtp_port: 587,
  smtp_from_email: "",
  smtp_from_name: "",
  smtp_username: "",
  smtp_password: "",
  smtp_tls: true,
  email_approvals: true,
  email_rejections: true,
  request_completed: true,
  daily_summary: false
};

function EmailSettings({ notify }) {
  const [form, setForm] = useState(emailDefaults);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setLoading(true);
    api.get("/settings/notifications")
      .then(({ data }) => setForm({ ...emailDefaults, ...data, smtp_password: data.smtp_password || "" }))
      .catch((error) => {
        const message = getErrorMessage(error);
        setError(message);
        notify(message, "error");
      })
      .finally(() => setLoading(false));
  }, []);

  function update(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function save(event) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const payload = {
        ...form,
        smtp_port: Number(form.smtp_port || 587),
        smtp_host: form.smtp_host || null,
        smtp_from_email: form.smtp_from_email || null,
        smtp_from_name: form.smtp_from_name || null,
        smtp_username: form.smtp_username || null,
        smtp_password: form.smtp_password || null
      };
      const { data } = await api.put("/settings/notifications", payload);
      setForm({ ...emailDefaults, ...data, smtp_password: data.smtp_password || "" });
      notify("تم حفظ إعدادات البريد SMTP");
    } catch (error) {
      const message = getErrorMessage(error);
      setError(message);
      notify(message, "error");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <div className="rounded-md border border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">جاري تحميل إعدادات البريد...</div>;
  }

  return (
    <form onSubmit={save} className="space-y-5 text-right" dir="rtl">
      <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-bank-50 text-bank-700">
            <Mail className="h-5 w-5" />
          </span>
          <div>
            <p className="font-bold text-slate-950">ربط البريد الإلكتروني SMTP</p>
            <p className="mt-1 text-sm leading-6 text-slate-500">تستخدم هذه البيانات لإرسال إشعارات الموافقات والرفض واكتمال الطلبات من بريد رسمي.</p>
          </div>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <EmailField label="خادم SMTP" value={form.smtp_host || ""} onChange={(value) => update("smtp_host", value)} />
        <EmailField label="منفذ SMTP" type="number" value={form.smtp_port} onChange={(value) => update("smtp_port", value)} />
        <EmailField label="بريد الإرسال" type="email" value={form.smtp_from_email || ""} onChange={(value) => update("smtp_from_email", value)} />
        <EmailField label="اسم المرسل" value={form.smtp_from_name || ""} onChange={(value) => update("smtp_from_name", value)} />
        <EmailField label="اسم مستخدم SMTP" value={form.smtp_username || ""} onChange={(value) => update("smtp_username", value)} />
        <EmailField label="كلمة مرور SMTP" type="password" value={form.smtp_password || ""} onChange={(value) => update("smtp_password", value)} />
      </div>

      <div className="grid gap-3 rounded-lg border border-slate-200 bg-white p-4 md:grid-cols-2">
        <Toggle label="استخدام TLS" checked={Boolean(form.smtp_tls)} onChange={(value) => update("smtp_tls", value)} />
        <Toggle label="إرسال إشعار عند الموافقة" checked={Boolean(form.email_approvals)} onChange={(value) => update("email_approvals", value)} />
        <Toggle label="إرسال إشعار عند الرفض" checked={Boolean(form.email_rejections)} onChange={(value) => update("email_rejections", value)} />
        <Toggle label="إرسال إشعار عند اكتمال الطلب" checked={Boolean(form.request_completed)} onChange={(value) => update("request_completed", value)} />
        <Toggle label="إرسال ملخص يومي" checked={Boolean(form.daily_summary)} onChange={(value) => update("daily_summary", value)} />
      </div>

      {error && <p className="rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</p>}

      <div className="flex flex-wrap gap-3">
        <Button type="submit" disabled={saving}>{saving ? "جاري الحفظ..." : "حفظ إعدادات البريد"}</Button>
        <button type="button" onClick={() => setForm(emailDefaults)} className="h-10 rounded-md border border-slate-300 px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50">تفريغ الإعدادات</button>
      </div>
    </form>
  );
}

function SecuritySettings({ notify }) {
  const [form, setForm] = useState({});
  const [error, setError] = useState("");
  useEffect(() => { api.get("/settings/security").then(({ data }) => setForm(data)).catch((e) => notify(getErrorMessage(e), "error")); }, []);
  async function save(event) {
    event.preventDefault();
    const numeric = { password_min_length: Number(form.password_min_length), lock_after_failed_attempts: Number(form.lock_after_failed_attempts), password_expiry_days: Number(form.password_expiry_days) };
    const payload = {
      password_min_length: numeric.password_min_length,
      lock_after_failed_attempts: numeric.lock_after_failed_attempts,
      password_expiry_days: numeric.password_expiry_days,
      require_uppercase: Boolean(form.require_uppercase),
      require_numbers: Boolean(form.require_numbers),
      require_special_chars: Boolean(form.require_special_chars),
      mfa_enabled: Boolean(form.mfa_enabled),
      login_identifier_mode: form.login_identifier_mode || "email_or_employee_id",
      temporary_password: form.temporary_password || "Change@12345"
    };
    try { setForm((await api.put("/settings/security", payload)).data); notify("تم حفظ سياسة الأمان"); } catch (e) { notify(getErrorMessage(e), "error"); }
  }
  const toggles = [
    ["require_uppercase", "اشتراط حرف كبير"],
    ["require_numbers", "اشتراط أرقام"],
    ["require_special_chars", "اشتراط رموز خاصة"]
  ];
  return <form onSubmit={save} className="grid gap-4 md:grid-cols-2">
    <label className="block space-y-2 text-sm font-medium text-slate-700 md:col-span-2">
      طريقة تسجيل الدخول
      <select value={form.login_identifier_mode || "email_or_employee_id"} onChange={(e) => setForm({ ...form, login_identifier_mode: e.target.value })} className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm outline-none focus:border-bank-600 focus:ring-2 focus:ring-bank-100">
        <option value="email_or_employee_id">البريد الإلكتروني أو الرقم الوظيفي</option>
        <option value="email">البريد الإلكتروني فقط</option>
        <option value="employee_id">الرقم الوظيفي فقط</option>
      </select>
      <span className="block text-xs font-normal text-slate-500">يتم تطبيق هذا الخيار على شاشة تسجيل الدخول فقط، ولا يغير بيانات المستخدمين.</span>
    </label>
    <LabeledInput label="الحد الأدنى لطول كلمة المرور" type="number" min="1" value={form.password_min_length || ""} onChange={(e) => setForm({ ...form, password_min_length: e.target.value })} />
    <LabeledInput label="قفل الحساب بعد عدد محاولات فاشلة" type="number" value={form.lock_after_failed_attempts || ""} onChange={(e) => setForm({ ...form, lock_after_failed_attempts: e.target.value })} />
    <LabeledInput label="مدة صلاحية كلمة المرور بالأيام" type="number" value={form.password_expiry_days || ""} onChange={(e) => setForm({ ...form, password_expiry_days: e.target.value })} />
    <label className="block space-y-2 text-sm font-medium text-slate-700 md:col-span-2">
      كلمة المرور المؤقتة الافتراضية
      <Input type="text" value={form.temporary_password || ""} onChange={(e) => setForm({ ...form, temporary_password: e.target.value })} placeholder="مثال: Change@12345" required />
      <span className="block text-xs font-normal text-slate-500">تستخدم عند إنشاء مستخدم جديد بدون كلمة مرور، وعند إعادة تعيين كلمة مرور المستخدم، وعند استيراد المستخدمين من Excel إذا ترك الحقل فارغاً.</span>
    </label>
    <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
      <p className="mb-3 text-sm font-bold text-slate-700">قواعد كلمة المرور والدخول</p>
      <div className="space-y-3">
        {toggles.map(([key, label]) => <label key={key} className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={Boolean(form[key])} onChange={(e) => setForm({ ...form, [key]: e.target.checked })} /> {label}</label>)}
      </div>
    </div>
    <SimpleError error={error} />
    <Button type="submit">حفظ سياسة الأمان</Button>
  </form>;
}

export function DatabaseSettings({ notify }) {
  const dbTabs = [
    ["overview", "نظرة عامة"],
    ["backups", "النسخ الاحتياطية"],
    ["restore", "الاستعادة"],
    ["reset", "إعادة الضبط"],
    ["maintenance", "الصيانة"],
    ["tables", "الجداول"],
    ["activity", "سجل العمليات"],
    ["settings", "الإعدادات"]
  ];
  const backupTypeLabels = { database_only: "قاعدة البيانات فقط", attachments_only: "المرفقات فقط", full_backup: "نسخة كاملة" };
  const resetScopeLabels = {
    clear_requests_only: "حذف الطلبات فقط",
    clear_messages_only: "حذف المراسلات فقط",
    clear_attachments_only: "حذف المرفقات فقط",
    clear_users_except_admin: "حذف المستخدمين مع إبقاء مدير النظام",
    clear_audit_logs: "حذف سجلات التدقيق",
    reset_demo_data_only: "حذف بيانات التجربة فقط",
    full_system_reset: "إعادة ضبط كاملة للنظام"
  };
  const [activeTab, setActiveTab] = useState("overview");
  const [status, setStatus] = useState(null);
  const [backups, setBackups] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [tables, setTables] = useState([]);
  const [activity, setActivity] = useState([]);
  const [backupSettings, setBackupSettings] = useState(null);
  const [backupType, setBackupType] = useState("full_backup");
  const [restoreFile, setRestoreFile] = useState(null);
  const [restorePreview, setRestorePreview] = useState(null);
  const [restoreForm, setRestoreForm] = useState({ admin_password: "", confirmation_text: "", restore_uploads: true });
  const [resetScope, setResetScope] = useState("clear_requests_only");
  const [resetPreviewData, setResetPreviewData] = useState(null);
  const [resetForm, setResetForm] = useState({ admin_password: "", confirmation_text: "", delete_upload_files: false, understand_risk: false });
  const [maintenanceResult, setMaintenanceResult] = useState(null);
  const [migrationStatus, setMigrationStatus] = useState(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  async function loadAll() {
    setError("");
    try {
      const [statusRes, backupsRes, jobsRes, tablesRes, activityRes, settingsRes, migrationRes] = await Promise.all([
        api.get("/settings/database/status"),
        api.get("/settings/database/backups"),
        api.get("/settings/database/jobs"),
        api.get("/settings/database/tables"),
        api.get("/settings/database/activity-log"),
        api.get("/settings/database/backup-settings"),
        api.get("/settings/database/migrations/status")
      ]);
      setStatus(statusRes.data);
      setBackups(backupsRes.data || []);
      setJobs(jobsRes.data || []);
      setTables(tablesRes.data || []);
      setActivity(activityRes.data || []);
      setBackupSettings(settingsRes.data);
      setMigrationStatus(migrationRes.data);
    } catch (error) {
      const message = getErrorMessage(error);
      setError(message);
      notify(message, "error");
    }
  }

  useEffect(() => { loadAll(); }, []);

  async function runAction(label, action) {
    setBusy(label);
    setError("");
    try {
      await action();
      await loadAll();
    } catch (error) {
      const message = getErrorMessage(error);
      setError(message);
      notify(message, "error");
    } finally {
      setBusy("");
    }
  }

  async function createManualBackup() {
    await runAction("backup", async () => {
      await api.post("/settings/database/backup", { backup_type: backupType });
      notify("تم إنشاء النسخة الاحتياطية");
    });
  }

  async function downloadBackup(backup) {
    await runAction(`download-${backup.id}`, async () => {
      const response = await api.get(`/settings/database/backups/${backup.id}/download`, { responseType: "blob" });
      const url = URL.createObjectURL(response.data);
      const link = document.createElement("a");
      link.href = url;
      link.download = backup.file_name;
      link.click();
      URL.revokeObjectURL(url);
      notify("تم تنزيل النسخة الاحتياطية");
    });
  }

  async function decryptBackup(backup) {
    const admin_password = window.prompt("أدخل كلمة مرور مدير النظام لفك تشفير النسخة");
    if (!admin_password) return;
    await runAction(`decrypt-${backup.id}`, async () => {
      const response = await api.post(
        `/settings/database/backups/${backup.id}/decrypt-download`,
        { admin_password, confirmation_text: "DECRYPT BACKUP" },
        { responseType: "blob" }
      );
      const fileName = backup.file_name.endsWith(".enc") ? backup.file_name.slice(0, -4) : `${backup.file_name}.zip`;
      const url = URL.createObjectURL(response.data);
      const link = document.createElement("a");
      link.href = url;
      link.download = fileName;
      link.click();
      URL.revokeObjectURL(url);
      notify("تم فك تشفير النسخة وتنزيلها");
    });
  }

  async function verifyBackup(backup) {
    await runAction(`verify-${backup.id}`, async () => {
      await api.post(`/settings/database/backups/${backup.id}/verify`);
      notify("تم التحقق من سلامة النسخة");
    });
  }

  async function deleteBackup(backup) {
    const admin_password = window.prompt("أدخل كلمة مرور مدير النظام لحذف النسخة الاحتياطية");
    if (!admin_password) return;
    const confirmation_text = window.prompt("اكتب DELETE BACKUP للتأكيد");
    if (confirmation_text !== "DELETE BACKUP") return notify("عبارة التأكيد غير صحيحة", "error");
    await runAction(`delete-${backup.id}`, async () => {
      await api.delete(`/settings/database/backups/${backup.id}`, { data: { admin_password, confirmation_text } });
      notify("تم حذف النسخة الاحتياطية");
    });
  }

  async function validateRestore(event) {
    event.preventDefault();
    if (!restoreFile) return notify("اختر ملف النسخة أولاً", "error");
    await runAction("restore-validate", async () => {
      const body = new FormData();
      body.append("file", restoreFile);
      const { data } = await api.post("/settings/database/restore/validate", body, { headers: { "Content-Type": "multipart/form-data" } });
      setRestorePreview(data);
      notify("تم التحقق من النسخة. راجع المعاينة قبل التنفيذ.");
    });
  }

  async function confirmRestore(event) {
    event.preventDefault();
    if (!restorePreview?.restore_token) return notify("يجب التحقق من النسخة قبل الاستعادة", "error");
    await runAction("restore-confirm", async () => {
      await api.post("/settings/database/restore/confirm", { restore_token: restorePreview.restore_token, ...restoreForm });
      notify("تم تنفيذ الاستعادة");
      setRestoreFile(null);
      setRestorePreview(null);
      setRestoreForm({ admin_password: "", confirmation_text: "", restore_uploads: true });
    });
  }

  async function loadResetPreview() {
    await runAction("reset-preview", async () => {
      const { data } = await api.get(`/settings/database/reset-preview?scope=${encodeURIComponent(resetScope)}`);
      setResetPreviewData(data);
    });
  }

  async function executeReset(event) {
    event.preventDefault();
    await runAction("reset", async () => {
      await api.post("/settings/database/reset", { scope: resetScope, ...resetForm });
      notify("تم تنفيذ إعادة الضبط");
      setResetForm({ admin_password: "", confirmation_text: "", delete_upload_files: false, understand_risk: false });
      setResetPreviewData(null);
    });
  }

  async function runMaintenance(path, label) {
    await runAction(path, async () => {
      const { data } = await api.post(`/settings/database/${path}`);
      setMaintenanceResult(data);
      notify(label);
    });
  }

  async function runMigrations() {
    const admin_password = window.prompt("أدخل كلمة مرور مدير النظام لتشغيل الترحيلات");
    if (!admin_password) return;
    const confirmation_text = window.prompt("اكتب RUN MIGRATIONS للتأكيد");
    if (confirmation_text !== "RUN MIGRATIONS") return notify("عبارة التأكيد غير صحيحة", "error");
    await runAction("migrations-run", async () => {
      await api.post("/settings/database/migrations/run", { admin_password, confirmation_text });
      notify("تم فحص وتشغيل الترحيلات المعلقة");
    });
  }

  async function saveBackupSettings(event) {
    event.preventDefault();
    await runAction("backup-settings", async () => {
      const payload = { ...backupSettings, retention_count: Number(backupSettings.retention_count || 7) };
      const { data } = await api.put("/settings/database/backup-settings", payload);
      setBackupSettings(data);
      notify("تم حفظ إعدادات النسخ الاحتياطي");
    });
  }

  const latestJob = jobs[0];

  return (
    <div className="space-y-5" dir="rtl">
      <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h4 className="text-lg font-black text-slate-950">إدارة قاعدة البيانات</h4>
            <p className="mt-1 text-sm leading-6 text-slate-500">مركز تحكم آمن للنسخ الاحتياطية، الاستعادة، الصيانة، الجداول، وسجل العمليات.</p>
          </div>
          <Button type="button" onClick={loadAll} disabled={Boolean(busy)} className="gap-2 border border-slate-300 bg-white text-slate-700 hover:bg-slate-50">
            <RefreshCw className="h-4 w-4" /> تحديث
          </Button>
        </div>
        {latestJob && (
          <div className="mt-4 rounded-md border border-bank-100 bg-bank-50/60 p-3">
            <div className="mb-2 flex items-center justify-between text-sm font-bold text-slate-700">
              <span>آخر مهمة: {databaseJobLabel(latestJob.job_type)} - {databaseStatusLabel(latestJob.status)}</span>
              <span>{latestJob.progress}%</span>
            </div>
            <div className="h-2 rounded-full bg-white"><div className="h-2 rounded-full bg-bank-600" style={{ width: `${Math.min(latestJob.progress || 0, 100)}%` }} /></div>
            {latestJob.message && <p className="mt-2 text-xs text-slate-500">{latestJob.message}</p>}
          </div>
        )}
      </div>

      <div className="flex gap-2 overflow-x-auto rounded-lg border border-slate-200 bg-white p-2">
        {dbTabs.map(([key, label]) => (
          <button key={key} type="button" onClick={() => setActiveTab(key)} className={`h-10 shrink-0 rounded-md px-4 text-sm font-bold ${activeTab === key ? "bg-bank-700 text-white" : "bg-slate-50 text-slate-700 hover:bg-bank-50"}`}>
            {label}
          </button>
        ))}
      </div>

      <SimpleError error={error} />

      {activeTab === "overview" && (
        <div className="space-y-4">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <MetricBox label="حالة الاتصال" value={databaseStatusLabel(status?.status)} />
            <MetricBox label="نوع قاعدة البيانات" value={status?.database_type || "-"} />
            <MetricBox label="اسم قاعدة البيانات" value={status?.database_name || "-"} />
            <MetricBox label="زمن الاستجابة" value={`${status?.latency_ms ?? "-"} ms`} />
            <MetricBox label="حجم قاعدة البيانات" value={`${status?.size_mb ?? 0} MB`} />
            <MetricBox label="عدد الجداول" value={status?.tables_count ?? "-"} />
            <MetricBox label="عدد السجلات" value={status?.records_count ?? "-"} />
            <MetricBox label="آخر نسخة احتياطية" value={formatDateTime(status?.last_backup_at)} />
            <MetricBox label="آخر استعادة" value={formatDateTime(status?.last_restore_at)} />
            <MetricBox label="آخر صيانة" value={formatDateTime(status?.last_maintenance_at)} />
          </div>
          <WarningBox title="بيانات آمنة فقط" text="لا يتم عرض اسم المستخدم أو كلمة المرور أو رابط الاتصال الكامل بقاعدة البيانات في هذه الشاشة." />
        </div>
      )}

      {activeTab === "backups" && (
        <div className="space-y-4">
          <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
              <label className="block space-y-2 text-sm font-bold text-slate-700">
                نوع النسخة
                <select value={backupType} onChange={(event) => setBackupType(event.target.value)} className="h-10 rounded-md border border-slate-300 bg-white px-3">
                  {Object.entries(backupTypeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </label>
              <Button type="button" onClick={createManualBackup} disabled={busy === "backup"} className="gap-2">
                <Download className="h-4 w-4" /> {busy === "backup" ? "جاري النسخ..." : "إنشاء نسخة احتياطية"}
              </Button>
            </div>
          </div>
          <SimpleTable
            headers={["اسم النسخة", "نوع النسخة", "الحجم", "تاريخ الإنشاء", "أنشأها", "الحالة", "تم التحقق؟", "الإجراءات"]}
            rows={backups.map((backup) => [
              backup.file_name,
              backupTypeLabels[backup.backup_type] || backup.backup_type,
              formatBytes(backup.file_size),
              formatDateTime(backup.created_at),
              backup.created_by_name || "-",
              databaseStatusLabel(backup.status),
              backup.verified_at ? formatDateTime(backup.verified_at) : "لا",
              <div key={backup.id} className="flex flex-wrap gap-2">
                <button type="button" onClick={() => downloadBackup(backup)} className="rounded-md border px-2 py-1 text-xs font-bold">تحميل</button>
                {(backup.metadata_json?.encrypted || backup.file_name?.endsWith(".enc")) && (
                  <button type="button" onClick={() => decryptBackup(backup)} className="rounded-md border border-bank-200 px-2 py-1 text-xs font-bold text-bank-800">فك التشفير</button>
                )}
                <button type="button" onClick={() => verifyBackup(backup)} className="rounded-md border px-2 py-1 text-xs font-bold">تحقق</button>
                <button type="button" onClick={() => deleteBackup(backup)} className="rounded-md border border-red-200 px-2 py-1 text-xs font-bold text-red-700">حذف</button>
              </div>
            ])}
          />
        </div>
      )}

      {activeTab === "restore" && (
        <div className="space-y-4">
          <WarningBox title="استعادة آمنة متعددة المراحل" text="لن يتم الاسترداد بمجرد رفع الملف. يجب التحقق من النسخة، مراجعة المعاينة، إدخال كلمة مرور مدير النظام، وكتابة RESTORE DATABASE." />
          <form onSubmit={validateRestore} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <h4 className="mb-3 font-bold text-slate-950">1. رفع النسخة والتحقق منها</h4>
            <div className="grid gap-3 lg:grid-cols-[1fr_auto]">
              <input type="file" accept=".zip,.db,.sqlite,.sqlite3" onChange={(event) => setRestoreFile(event.target.files?.[0] || null)} className="h-10 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm" />
              <Button type="submit" disabled={busy === "restore-validate"}>{busy === "restore-validate" ? "جاري التحقق..." : "تحقق من النسخة"}</Button>
            </div>
          </form>
          {restorePreview && (
            <form onSubmit={confirmRestore} className="rounded-lg border border-amber-200 bg-amber-50/70 p-4">
              <h4 className="font-bold text-slate-950">2. معاينة الاستعادة والتأكيد الأمني</h4>
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                {Object.entries(restorePreview.preview || {}).map(([key, value]) => <MetricBox key={key} label={key} value={typeof value === "boolean" ? (value ? "نعم" : "لا") : String(value ?? "-")} />)}
              </div>
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                <LabeledInput label="كلمة مرور مدير النظام" type="password" value={restoreForm.admin_password} onChange={(event) => setRestoreForm({ ...restoreForm, admin_password: event.target.value })} />
                <LabeledInput label="عبارة التأكيد" value={restoreForm.confirmation_text} onChange={(event) => setRestoreForm({ ...restoreForm, confirmation_text: event.target.value })} placeholder="RESTORE DATABASE" />
                <Toggle label="استعادة المرفقات إن وجدت" checked={Boolean(restoreForm.restore_uploads)} onChange={(value) => setRestoreForm({ ...restoreForm, restore_uploads: value })} />
              </div>
              <Button type="submit" disabled={busy === "restore-confirm"} className="mt-4 bg-amber-700 hover:bg-amber-800">
                {busy === "restore-confirm" ? "جاري الاستعادة..." : "تنفيذ الاستعادة"}
              </Button>
            </form>
          )}
        </div>
      )}

      {activeTab === "reset" && (
        <div className="space-y-4">
          <DangerBox title="إجراء عالي الخطورة" text="سيتم إنشاء نسخة احتياطية كاملة تلقائياً قبل إعادة الضبط. لا يتم حذف ملفات النسخ الاحتياطية أو Docker volumes." />
          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <div className="grid gap-3 md:grid-cols-[1fr_auto]">
              <label className="block space-y-2 text-sm font-bold text-slate-700">
                نطاق إعادة الضبط
                <select value={resetScope} onChange={(event) => setResetScope(event.target.value)} className="h-10 w-full rounded-md border border-slate-300 bg-white px-3">
                  {Object.entries(resetScopeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </label>
              <Button type="button" onClick={loadResetPreview} disabled={busy === "reset-preview"} className="self-end">عرض المعاينة</Button>
            </div>
          </div>
          {resetPreviewData && (
            <form onSubmit={executeReset} className="rounded-lg border border-red-200 bg-red-50/60 p-4">
              <h4 className="font-bold text-slate-950">معاينة التأثير</h4>
              <SimpleTable headers={["الجدول", "عدد السجلات"]} rows={(resetPreviewData.tables || []).map((row) => [row.table_name, row.records_count])} />
              {(resetPreviewData.warnings || []).map((item) => <p key={item} className="mt-2 text-sm font-semibold text-red-700">- {item}</p>)}
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                <LabeledInput label="كلمة مرور مدير النظام" type="password" value={resetForm.admin_password} onChange={(event) => setResetForm({ ...resetForm, admin_password: event.target.value })} />
                <LabeledInput label="عبارة التأكيد" value={resetForm.confirmation_text} onChange={(event) => setResetForm({ ...resetForm, confirmation_text: event.target.value })} placeholder="RESET DATABASE" />
                <Toggle label="أفهم أن هذا الإجراء قد يؤثر على بيانات النظام" checked={Boolean(resetForm.understand_risk)} onChange={(value) => setResetForm({ ...resetForm, understand_risk: value })} />
                <Toggle label="حذف ملفات المرفقات أيضاً" checked={Boolean(resetForm.delete_upload_files)} onChange={(value) => setResetForm({ ...resetForm, delete_upload_files: value })} />
              </div>
              <Button type="submit" disabled={busy === "reset"} className="mt-4 bg-red-700 hover:bg-red-800">{busy === "reset" ? "جاري التنفيذ..." : "تنفيذ إعادة الضبط"}</Button>
            </form>
          )}
        </div>
      )}

      {activeTab === "maintenance" && (
        <div className="space-y-4">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {[
              ["maintenance/test-connection", "اختبار الاتصال"],
              ["maintenance/check-integrity", "فحص سلامة قاعدة البيانات"],
              ["maintenance/optimize", "تحسين قاعدة البيانات"],
              ["maintenance/reindex", "إعادة بناء الفهارس"],
              ["maintenance/analyze", "تحديث إحصائيات قاعدة البيانات"],
              ["maintenance/clean-temp", "تنظيف الملفات المؤقتة"],
              ["maintenance/check-orphan-attachments", "فحص المرفقات اليتيمة"]
            ].map(([path, label]) => <button key={path} type="button" onClick={() => runMaintenance(path, label)} className="rounded-lg border border-slate-200 bg-white p-4 text-right text-sm font-bold shadow-sm hover:bg-bank-50">{label}</button>)}
          </div>
          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <h4 className="font-bold text-slate-950">الترحيلات</h4>
            <p className="mt-2 text-sm text-slate-600">{migrationStatus?.message || "لم يتم تحميل حالة الترحيلات."}</p>
            <Button type="button" onClick={runMigrations} disabled={busy === "migrations-run"} className="mt-3">تشغيل الترحيلات المعلقة</Button>
          </div>
          {maintenanceResult && <pre className="overflow-auto rounded-lg border bg-slate-950 p-4 text-xs leading-6 text-white">{JSON.stringify(maintenanceResult, null, 2)}</pre>}
        </div>
      )}

      {activeTab === "tables" && (
        <SimpleTable headers={["اسم الجدول", "التصنيف", "عدد السجلات", "الحجم", "الوصف"]} rows={tables.map((table) => [table.table_name, table.category, table.records_count, `${table.size_mb || 0} MB`, table.description])} />
      )}

      {activeTab === "activity" && (
        <SimpleTable headers={["الإجراء", "المستخدم", "التاريخ", "عنوان IP", "النتيجة", "التفاصيل"]} rows={activity.map((item) => [databaseActionLabel(item.action), item.user || "-", formatDateTime(item.created_at), item.ip_address || "-", item.result, JSON.stringify(item.details || {})])} />
      )}

      {activeTab === "settings" && backupSettings && (
        <form onSubmit={saveBackupSettings} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            <Toggle label="تفعيل النسخ الاحتياطي التلقائي" checked={Boolean(backupSettings.auto_backup_enabled)} onChange={(value) => setBackupSettings({ ...backupSettings, auto_backup_enabled: value })} />
            <Toggle label="تضمين المرفقات" checked={Boolean(backupSettings.include_uploads)} onChange={(value) => setBackupSettings({ ...backupSettings, include_uploads: value })} />
            <Toggle label="ضغط النسخ" checked={Boolean(backupSettings.compress_backups)} onChange={(value) => setBackupSettings({ ...backupSettings, compress_backups: value })} />
            <Toggle label="تشفير النسخ" checked={Boolean(backupSettings.encrypt_backups)} onChange={(value) => setBackupSettings({ ...backupSettings, encrypt_backups: value })} />
            <Toggle label="إشعار عند فشل النسخ" checked={Boolean(backupSettings.notify_on_failure)} onChange={(value) => setBackupSettings({ ...backupSettings, notify_on_failure: value })} />
            <LabeledInput label="وقت النسخ الاحتياطي" type="time" value={backupSettings.backup_time || "02:00"} onChange={(event) => setBackupSettings({ ...backupSettings, backup_time: event.target.value })} />
            <label className="block space-y-2 text-sm font-medium text-slate-700">
              التكرار
              <select value={backupSettings.frequency || "daily"} onChange={(event) => setBackupSettings({ ...backupSettings, frequency: event.target.value })} className="h-10 w-full rounded-md border border-slate-300 bg-white px-3">
                <option value="daily">يومي</option>
                <option value="weekly">أسبوعي</option>
                <option value="monthly">شهري</option>
              </select>
            </label>
            <LabeledInput label="عدد النسخ المحتفظ بها" type="number" min="1" max="365" value={backupSettings.retention_count || 7} onChange={(event) => setBackupSettings({ ...backupSettings, retention_count: event.target.value })} />
            <LabeledInput label="مسار حفظ النسخ" value={backupSettings.backup_location || "backups"} onChange={(event) => setBackupSettings({ ...backupSettings, backup_location: event.target.value })} />
          </div>
          <Button type="submit" disabled={busy === "backup-settings"} className="mt-4">{busy === "backup-settings" ? "جاري الحفظ..." : "حفظ الإعدادات"}</Button>
        </form>
      )}
    </div>
  );
}

function WarningBox({ title, text }) {
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50/70 p-4">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-1 h-5 w-5 shrink-0 text-amber-700" />
        <div>
          <h4 className="font-bold text-slate-950">{title}</h4>
          <p className="mt-1 text-sm leading-6 text-slate-600">{text}</p>
        </div>
      </div>
    </div>
  );
}

function DangerBox({ title, text }) {
  return (
    <div className="rounded-lg border border-red-200 bg-red-50/70 p-4">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-1 h-5 w-5 shrink-0 text-red-700" />
        <div>
          <h4 className="font-bold text-red-950">{title}</h4>
          <p className="mt-1 text-sm leading-6 text-red-700">{text}</p>
        </div>
      </div>
    </div>
  );
}

function databaseStatusLabel(value) {
  const labels = {
    healthy: "سليمة",
    warning: "تحذير",
    critical: "حرجة",
    ready: "جاهزة",
    corrupted: "تالفة",
    deleted: "محذوفة",
    deleted_by_retention: "محذوفة بسياسة الاحتفاظ",
    success: "ناجحة",
    failed: "فاشلة",
    running: "قيد التنفيذ",
    pending: "بانتظار التنفيذ",
    validated: "تم التحقق"
  };
  return labels[value] || value || "-";
}

function databaseJobLabel(value) {
  const labels = { backup: "نسخ احتياطي", restore: "استعادة", reset: "إعادة ضبط", maintenance: "صيانة", migration: "ترحيلات" };
  return labels[value] || value || "-";
}

function databaseActionLabel(value) {
  const labels = {
    database_status_viewed: "عرض حالة قاعدة البيانات",
    backup_created: "إنشاء نسخة احتياطية",
    backup_downloaded: "تنزيل نسخة احتياطية",
    backup_verified: "التحقق من نسخة احتياطية",
    backup_deleted: "حذف نسخة احتياطية",
    restore_validated: "التحقق من الاستعادة",
    restore_started: "بدء الاستعادة",
    restore_completed: "اكتمال الاستعادة",
    reset_preview_viewed: "عرض معاينة إعادة الضبط",
    reset_completed: "تنفيذ إعادة الضبط",
    maintenance_run: "تنفيذ صيانة",
    migration_run: "تشغيل ترحيلات",
    backup_settings_saved: "حفظ إعدادات النسخ"
  };
  return labels[value] || value || "-";
}


function SimpleError({ error }) { return error ? <p className="rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</p> : null; }
function SimpleTable({ headers, rows }) { return <div className="overflow-x-auto rounded-md border"><table className="w-full min-w-[680px] text-sm"><thead className="bg-slate-50"><tr>{headers.map((h) => <th key={h} className="p-3 text-right">{h}</th>)}</tr></thead><tbody className="divide-y">{rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} className="p-3">{c}</td>)}</tr>)}</tbody></table></div>; }
function EmailField({ label, value, onChange, type = "text" }) { return <label className="block space-y-2 text-sm font-medium text-slate-700">{label}<Input type={type} value={value ?? ""} onChange={(event) => onChange(event.target.value)} /></label>; }
function Toggle({ label, checked, onChange }) { return <label className="flex min-h-11 items-center justify-between gap-3 rounded-md border border-slate-200 bg-slate-50 px-3 text-sm font-semibold text-slate-700"><span>{label}</span><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="h-4 w-4 accent-bank-700" /></label>; }
function LabeledInput({ label, ...props }) { return <label className="block space-y-2 text-sm font-medium text-slate-700">{label}<Input {...props} /></label>; }
function MetricBox({ label, value }) { return <div className="min-w-0 rounded-lg border border-slate-200 bg-white p-4 shadow-sm"><p className="text-xs font-bold text-slate-500">{label}</p><p className="mt-2 break-words text-lg font-black text-slate-950">{value}</p></div>; }
function formatBytes(value) { if (!value) return "0 B"; const units = ["B", "KB", "MB", "GB"]; const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1); return `${(value / Math.pow(1024, index)).toFixed(index ? 1 : 0)} ${units[index]}`; }
function formatDateTime(value) { return formatSystemDateTime(value); }
