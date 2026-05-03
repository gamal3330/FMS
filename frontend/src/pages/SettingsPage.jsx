import { useEffect, useState } from "react";
import { AlertTriangle, Database, Download, LockKeyhole, Mail, RefreshCw, RotateCcw, Settings2, Upload } from "lucide-react";
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
  ["database", "قاعدة البيانات", Database],
  ["localUpdates", "التحديث المحلي", Upload]
];

export default function SettingsPage() {
  const [active, setActive] = useState("general");
  const [dialog, setDialog] = useState({ type: "success", message: "" });

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
          {active === "requestTypes" && <Panel title="أنواع الطلبات"><RequestTypesSettings notify={notify} /></Panel>}
          {active === "security" && <Panel title="إعدادات الأمان"><SecuritySettings notify={notify} /></Panel>}
          {active === "database" && <Panel title="قاعدة البيانات والنسخ الاحتياطي"><DatabaseSettings notify={notify} /></Panel>}
          {active === "localUpdates" && <Panel title="التحديث المحلي للنظام"><LocalUpdateSettings notify={notify} /></Panel>}
        </Card>
      </div>
    </section>
  );
}

function Panel({ title, children }) {
  return <div className="min-w-0"><h3 className="mb-5 text-xl font-bold text-slate-950">{title}</h3>{children}</div>;
}

function RequestTypesSettings({ notify }) {
  const [items, setItems] = useState([]);
  const [form, setForm] = useState({ request_type: "email", label_ar: "طلب بريد إلكتروني", is_enabled: true, require_attachment: false });
  const [error, setError] = useState("");

  async function load() {
    try { setItems((await api.get("/request-types")).data); } catch (error) { notify(getErrorMessage(error), "error"); }
  }
  useEffect(() => { load(); }, []);
  async function save(event) {
    event.preventDefault();
    try { await api.post("/request-types", form); notify("تم حفظ نوع الطلب"); await load(); } catch (error) { notify(getErrorMessage(error), "error"); }
  }
  return <div className="space-y-4"><form onSubmit={save} className="grid gap-3 md:grid-cols-4"><Input value={form.request_type} onChange={(e) => setForm({ ...form, request_type: e.target.value })} required /><Input value={form.label_ar} onChange={(e) => setForm({ ...form, label_ar: e.target.value })} required /><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.is_enabled} onChange={(e) => setForm({ ...form, is_enabled: e.target.checked })} /> Enabled</label><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.require_attachment} onChange={(e) => setForm({ ...form, require_attachment: e.target.checked })} /> Require Attachment</label><Button type="submit">حفظ</Button></form><SimpleError error={error} /><SimpleTable headers={["Type", "Arabic Label", "Enabled", "Attachment"]} rows={items.map((i) => [i.request_type, i.label_ar, i.is_enabled ? "Yes" : "No", i.require_attachment ? "Yes" : "No"])} /></div>;
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
      require_special_chars: Boolean(form.require_special_chars)
    };
    try { setForm((await api.put("/settings/security", payload)).data); notify("تم حفظ سياسة الأمان"); } catch (e) { notify(getErrorMessage(e), "error"); }
  }
  const toggles = [
    ["require_uppercase", "اشتراط حرف كبير"],
    ["require_numbers", "اشتراط أرقام"],
    ["require_special_chars", "اشتراط رموز خاصة"]
  ];
  return <form onSubmit={save} className="grid gap-4 md:grid-cols-2">
    <LabeledInput label="الحد الأدنى لطول كلمة المرور" type="number" value={form.password_min_length || ""} onChange={(e) => setForm({ ...form, password_min_length: e.target.value })} />
    <LabeledInput label="قفل الحساب بعد عدد محاولات فاشلة" type="number" value={form.lock_after_failed_attempts || ""} onChange={(e) => setForm({ ...form, lock_after_failed_attempts: e.target.value })} />
    <LabeledInput label="مدة صلاحية كلمة المرور بالأيام" type="number" value={form.password_expiry_days || ""} onChange={(e) => setForm({ ...form, password_expiry_days: e.target.value })} />
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

function DatabaseSettings({ notify }) {
  const [status, setStatus] = useState(null);
  const [backupSettings, setBackupSettings] = useState({
    auto_backup_enabled: false,
    backup_time: "02:00",
    retention_count: 7,
    backup_path: "backups",
    notify_on_failure: true
  });
  const [file, setFile] = useState(null);
  const [restoreConfirmation, setRestoreConfirmation] = useState("");
  const [resetConfirmation, setResetConfirmation] = useState("");
  const [resetPreview, setResetPreview] = useState(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  async function loadStatus() {
    setError("");
    try {
      setStatus((await api.get("/settings/database/status")).data);
    } catch (error) {
      notify(getErrorMessage(error), "error");
    }
  }

  async function loadBackupSettings() {
    try {
      setBackupSettings((await api.get("/settings/database/backup-settings")).data);
    } catch (error) {
      notify(getErrorMessage(error), "error");
    }
  }

  async function loadResetPreview() {
    try {
      setResetPreview((await api.get("/settings/database/reset-preview")).data);
    } catch (error) {
      notify(getErrorMessage(error), "error");
    }
  }

  useEffect(() => {
    loadStatus();
    loadBackupSettings();
    loadResetPreview();
  }, []);

  async function saveBackupSettings(event) {
    event.preventDefault();
    setBusy("backup-settings");
    try {
      const payload = {
        ...backupSettings,
        retention_count: Number(backupSettings.retention_count)
      };
      setBackupSettings((await api.put("/settings/database/backup-settings", payload)).data);
      notify("تم حفظ إعدادات النسخ الاحتياطي");
    } catch (error) {
      notify(getErrorMessage(error), "error");
    } finally {
      setBusy("");
    }
  }

  async function downloadBackup() {
    setBusy("backup");
    setError("");
    try {
      const response = await api.get("/settings/database/backup", { responseType: "blob" });
      const disposition = response.headers["content-disposition"] || "";
      const filename = disposition.match(/filename="?([^"]+)"?/)?.[1] || "qib-database-backup.db";
      const url = URL.createObjectURL(response.data);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      link.click();
      URL.revokeObjectURL(url);
      notify("تم تجهيز النسخة الاحتياطية للتنزيل");
      await loadStatus();
    } catch (error) {
      notify(getErrorMessage(error), "error");
    } finally {
      setBusy("");
    }
  }

  async function restoreBackup(event) {
    event.preventDefault();
    if (!file) {
      notify("اختر ملف النسخة الاحتياطية أولًا.", "error");
      return;
    }
    setBusy("restore");
    setError("");
    try {
      const body = new FormData();
      body.append("file", file);
      body.append("confirmation", restoreConfirmation);
      await api.post("/settings/database/restore", body, { headers: { "Content-Type": "multipart/form-data" } });
      setFile(null);
      setRestoreConfirmation("");
      notify("تم استرداد النسخة الاحتياطية بنجاح");
      await loadStatus();
    } catch (error) {
      notify(getErrorMessage(error), "error");
    } finally {
      setBusy("");
    }
  }

  async function resetDatabase(event) {
    event.preventDefault();
    const tableCount = resetPreview?.table_count ?? 0;
    const totalRows = resetPreview?.total_rows ?? 0;
    if (!window.confirm(`سيتم حذف بيانات ${tableCount} جدول بإجمالي ${totalRows} سجل، ثم إعادة إنشاء بيانات البداية فقط. هل تريد المتابعة؟`)) return;
    setBusy("reset");
    setError("");
    try {
      await api.post("/settings/database/reset", { confirmation: resetConfirmation });
      setResetConfirmation("");
      notify("تمت إعادة ضبط قاعدة البيانات");
      localStorage.removeItem("qib_token");
      window.location.href = "/login";
    } catch (error) {
      notify(getErrorMessage(error), "error");
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="space-y-5">
      <div className="grid gap-3 md:grid-cols-3">
        <MetricBox label="نوع القاعدة" value={status?.engine || "-"} />
        <MetricBox label="حجم الملف" value={formatBytes(status?.size_bytes || 0)} />
        <MetricBox label="آخر تحديث" value={formatDateTime(status?.updated_at)} />
      </div>

      <form onSubmit={saveBackupSettings} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-4 flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h4 className="font-bold text-slate-950">إعدادات النسخ الاحتياطي</h4>
            <p className="mt-1 text-sm leading-6 text-slate-500">اضبط النسخ الاحتياطي التلقائي ووقت التنفيذ ومكان الاحتفاظ بالنسخ.</p>
          </div>
          <label className="flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-700">
            <input type="checkbox" checked={Boolean(backupSettings.auto_backup_enabled)} onChange={(event) => setBackupSettings({ ...backupSettings, auto_backup_enabled: event.target.checked })} />
            تفعيل النسخ الاحتياطي التلقائي
          </label>
        </div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <LabeledInput label="وقت النسخ الاحتياطي" type="time" value={backupSettings.backup_time || "02:00"} onChange={(event) => setBackupSettings({ ...backupSettings, backup_time: event.target.value })} />
          <LabeledInput label="عدد النسخ المحتفظ بها" type="number" min="1" max="365" value={backupSettings.retention_count || 7} onChange={(event) => setBackupSettings({ ...backupSettings, retention_count: event.target.value })} />
          <LabeledInput label="مسار حفظ النسخ" value={backupSettings.backup_path || ""} onChange={(event) => setBackupSettings({ ...backupSettings, backup_path: event.target.value })} placeholder="مثال: backups أو D:\\QIB\\backups" />
          <label className="flex h-10 items-center gap-2 self-end rounded-md border border-slate-200 bg-slate-50 px-3 text-sm font-semibold text-slate-700">
            <input type="checkbox" checked={Boolean(backupSettings.notify_on_failure)} onChange={(event) => setBackupSettings({ ...backupSettings, notify_on_failure: event.target.checked })} />
            إشعار عند فشل النسخ الاحتياطي
          </label>
        </div>
        <div className="mt-4 flex justify-end">
          <Button type="submit" disabled={busy === "backup-settings"}>
            {busy === "backup-settings" ? "جاري الحفظ..." : "حفظ إعدادات النسخ الاحتياطي"}
          </Button>
        </div>
      </form>

      <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h4 className="font-bold text-slate-950">تصدير نسخة احتياطية</h4>
            <p className="mt-1 text-sm leading-6 text-slate-500">يتم إنشاء ملف نسخة من قاعدة البيانات الحالية وتنزيله مباشرة.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={loadStatus} disabled={Boolean(busy)} className="gap-2 border border-slate-300 bg-white text-slate-700 hover:bg-slate-50">
              <RefreshCw className="h-4 w-4" /> تحديث
            </Button>
            <Button type="button" onClick={downloadBackup} disabled={Boolean(busy)} className="gap-2">
              <Download className="h-4 w-4" /> تنزيل نسخة
            </Button>
          </div>
        </div>
      </div>

      <form onSubmit={restoreBackup} className="rounded-lg border border-amber-200 bg-amber-50/60 p-4">
        <div className="mb-4 flex items-start gap-3">
          <AlertTriangle className="mt-1 h-5 w-5 shrink-0 text-amber-700" />
          <div>
            <h4 className="font-bold text-slate-950">استرداد نسخة احتياطية</h4>
            <p className="mt-1 text-sm leading-6 text-slate-600">سيتم استبدال قاعدة البيانات الحالية بالملف المرفوع بعد التحقق من سلامته.</p>
          </div>
        </div>
        <div className="grid gap-3 lg:grid-cols-[1fr_220px_auto]">
          <input type="file" accept=".db,.sqlite,.sqlite3" onChange={(event) => setFile(event.target.files?.[0] || null)} className="h-10 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm" />
          <Input placeholder="اكتب: استرداد النسخة" value={restoreConfirmation} onChange={(event) => setRestoreConfirmation(event.target.value)} />
          <Button type="submit" disabled={busy === "restore"} className="gap-2 bg-amber-700 hover:bg-amber-800">
            <Upload className="h-4 w-4" /> استرداد
          </Button>
        </div>
      </form>

      <form onSubmit={resetDatabase} className="rounded-lg border border-red-200 bg-red-50 p-4">
        <div className="mb-4 flex items-start gap-3">
          <AlertTriangle className="mt-1 h-5 w-5 shrink-0 text-red-700" />
          <div>
            <h4 className="font-bold text-red-900">إعادة ضبط جميع بيانات النظام</h4>
            <p className="mt-1 text-sm leading-6 text-red-700">هذه العملية تحذف بيانات قاعدة البيانات وتعيد إنشاء حساب المدير والبيانات الأساسية فقط.</p>
          </div>
        </div>
        <div className="mb-4 rounded-md border border-red-200 bg-white p-3">
          <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-bold text-red-900">الجداول التي سيتم حذف بياناتها</p>
              <p className="mt-1 text-xs text-red-700">
                {resetPreview ? `${resetPreview.table_count} جدول - ${resetPreview.total_rows} سجل حالي` : "جار تحميل قائمة الجداول..."}
              </p>
            </div>
            <button type="button" onClick={loadResetPreview} disabled={Boolean(busy)} className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-red-200 bg-white px-3 text-xs font-bold text-red-700 hover:bg-red-50 disabled:opacity-60">
              <RefreshCw className="h-3.5 w-3.5" /> تحديث القائمة
            </button>
          </div>
          <div className="max-h-56 overflow-auto rounded-md border border-red-100">
            <table className="w-full min-w-[420px] text-sm">
              <thead className="bg-red-50 text-xs font-bold text-red-700">
                <tr>
                  <th className="p-2 text-right">الجدول</th>
                  <th className="p-2 text-right">عدد السجلات الحالية</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-red-50">
                {(resetPreview?.tables || []).map((item) => (
                  <tr key={item.table}>
                    <td className="p-2 font-mono text-xs text-slate-700">{item.table}</td>
                    <td className="p-2 font-semibold text-slate-700">{item.rows}</td>
                  </tr>
                ))}
                {resetPreview && resetPreview.tables.length === 0 && (
                  <tr><td colSpan="2" className="p-3 text-center text-sm text-slate-500">لا توجد جداول ضمن خطة الحذف</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
        <div className="grid gap-3 lg:grid-cols-[1fr_auto]">
          <Input placeholder="اكتب: حذف جميع البيانات" value={resetConfirmation} onChange={(event) => setResetConfirmation(event.target.value)} />
          <button type="submit" disabled={busy === "reset"} className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-red-700 px-4 text-sm font-semibold text-white hover:bg-red-800 disabled:opacity-60">
            <RotateCcw className="h-4 w-4" /> إعادة الضبط
          </button>
        </div>
      </form>

    </div>
  );
}

function LocalUpdateSettings({ notify }) {
  const [status, setStatus] = useState(null);
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [preflightBusy, setPreflightBusy] = useState("");
  const [applyBusy, setApplyBusy] = useState("");
  const [restartBusy, setRestartBusy] = useState(false);
  const [preflightResult, setPreflightResult] = useState(null);
  const [applyResult, setApplyResult] = useState(null);

  async function loadStatus() {
    try {
      setStatus((await api.get("/settings/local-updates/status")).data);
    } catch (error) {
      notify(getErrorMessage(error), "error");
    }
  }

  useEffect(() => {
    loadStatus();
  }, []);

  async function uploadPackage(event) {
    event.preventDefault();
    if (!file) {
      notify("اختر ملف التحديث أولًا.", "error");
      return;
    }

    setBusy(true);
    try {
      const body = new FormData();
      body.append("file", file);
      const { data } = await api.post("/settings/local-updates/upload", body, { headers: { "Content-Type": "multipart/form-data" } });
      setFile(null);
      notify(`تم رفع حزمة التحديث وفحصها بنجاح. النسخة: ${data.version || "غير محدد"}`);
      await loadStatus();
    } catch (error) {
      notify(getErrorMessage(error), "error");
    } finally {
      setBusy(false);
    }
  }

  async function runPreflight(item) {
    setPreflightBusy(item.id);
    setPreflightResult(null);
    try {
      const { data } = await api.post(`/settings/local-updates/${item.id}/preflight`);
      setPreflightResult(data);
      notify(data.ready ? "الحزمة جاهزة للتطبيق" : data.summary, data.ready ? "success" : "error");
      await loadStatus();
    } catch (error) {
      notify(getErrorMessage(error), "error");
    } finally {
      setPreflightBusy("");
    }
  }

  async function applyPackage(item) {
    if (!window.confirm("سيتم تطبيق ملفات التحديث بدون إعادة تشغيل تلقائي. تم حفظ نسخة احتياطية؟")) return;
    setApplyBusy(item.id);
    setApplyResult(null);
    try {
      const { data } = await api.post(`/settings/local-updates/${item.id}/apply`);
      setApplyResult(data);
      notify("تم تطبيق ملفات التحديث. أعد تشغيل النظام يدويًا لتفعيل التغييرات.");
      await loadStatus();
    } catch (error) {
      notify(getErrorMessage(error), "error");
    } finally {
      setApplyBusy("");
    }
  }

  async function restartBackend() {
    if (!window.confirm("سيتم إعادة تشغيل خدمة الباكند الآن. قد يتوقف النظام لعدة ثوان. هل تريد المتابعة؟")) return;
    setRestartBusy(true);
    try {
      const { data } = await api.post("/settings/local-updates/restart");
      notify(data.message || "تم إرسال أمر إعادة التشغيل");
      window.setTimeout(() => {
        window.location.reload();
      }, 6000);
    } catch (error) {
      notify(getErrorMessage(error), "error");
      setRestartBusy(false);
    }
  }

  const packages = status?.packages || [];
  const needsRestart = packages.some((item) => String(item.status || "").includes("بانتظار إعادة التشغيل")) || Boolean(applyResult?.restart_required);

  return (
    <div className="min-w-0 space-y-5">
      <div className="min-w-0 rounded-lg border border-bank-100 bg-bank-50/70 p-4">
        <h4 className="font-bold text-slate-950">رفع حزمة تحديث محلية</h4>
        <p className="mt-1 text-sm leading-6 text-slate-600">
          هذه المرحلة ترفع ملف ZIP وتفحص بنيته فقط، ولا تستبدل ملفات النظام أو تعيد تشغيل الخدمة.
        </p>
        <div className="mt-3 grid min-w-0 gap-3 md:grid-cols-3">
          <MetricBox label="الصيغة المطلوبة" value="ZIP" />
          <MetricBox label="الحجم الأقصى" value={formatBytes(status?.max_size_bytes || 0)} />
          <MetricBox label="المجلدات المطلوبة" value={(status?.required_roots || ["backend", "frontend", "scripts"]).join(" / ")} />
        </div>
      </div>

      <form onSubmit={uploadPackage} className="min-w-0 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <div className="grid min-w-0 gap-3 lg:grid-cols-[minmax(0,1fr)_auto_auto]">
          <input
            type="file"
            accept=".zip,application/zip"
            onChange={(event) => setFile(event.target.files?.[0] || null)}
            className="h-10 min-w-0 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
          />
          <Button type="button" onClick={loadStatus} disabled={busy} className="gap-2 border border-slate-300 bg-white text-slate-700 hover:bg-slate-50">
            <RefreshCw className="h-4 w-4" /> تحديث القائمة
          </Button>
          <Button type="submit" disabled={busy} className="gap-2">
            <Upload className="h-4 w-4" /> {busy ? "جاري الرفع..." : "رفع وفحص"}
          </Button>
        </div>
      </form>

      <div className="rounded-lg border border-amber-200 bg-amber-50/60 p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-start gap-3">
          <AlertTriangle className="mt-1 h-5 w-5 shrink-0 text-amber-700" />
          <div>
            <h4 className="font-bold text-slate-950">ملاحظة مهمة</h4>
            <p className="mt-1 text-sm leading-6 text-slate-600">
              تطبيق التحديث يستبدل الملفات فقط ولا يعيد تشغيل النظام تلقائيًا. أعد تشغيل الخدمة يدويًا بعد نجاح التطبيق.
            </p>
          </div>
          </div>
          <Button type="button" onClick={restartBackend} disabled={restartBusy || !needsRestart} className="gap-2 bg-slate-900 hover:bg-slate-800 disabled:opacity-50">
            <RefreshCw className={`h-4 w-4 ${restartBusy ? "animate-spin" : ""}`} />
            {restartBusy ? "جاري إعادة التشغيل..." : "إعادة تشغيل الباكند"}
          </Button>
        </div>
      </div>

      <div className="max-w-full overflow-x-auto rounded-lg border border-slate-200">
        <table className="w-full min-w-[900px] text-sm">
          <thead className="bg-slate-50 text-xs font-bold text-slate-600">
            <tr>
              <th className="p-3 text-right">الملف</th>
              <th className="p-3 text-right">النسخة</th>
              <th className="p-3 text-right">وقت الرفع</th>
              <th className="p-3 text-right">الحجم</th>
              <th className="p-3 text-right">عدد الملفات</th>
              <th className="p-3 text-right">الحالة</th>
              <th className="p-3 text-right">الإجراء</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 bg-white">
            {packages.map((item) => (
              <tr key={item.id}>
                <td className="p-3 font-semibold text-slate-900">{item.original_filename}</td>
                <td className="p-3 text-slate-700">{item.version || "غير محدد"}</td>
                <td className="p-3 text-slate-600">{formatDateTime(item.uploaded_at)}</td>
                <td className="p-3 text-slate-600">{formatBytes(item.compressed_size_bytes || 0)}</td>
                <td className="p-3 text-slate-600">{item.files_count || 0}</td>
                <td className="p-3"><span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700">{item.status || "جاهز"}</span></td>
                <td className="p-3">
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" onClick={() => runPreflight(item)} disabled={Boolean(preflightBusy) || Boolean(applyBusy)} className="h-9 gap-2 border border-slate-300 bg-white px-3 text-xs text-slate-700 hover:bg-slate-50">
                      <RefreshCw className={`h-3.5 w-3.5 ${preflightBusy === item.id ? "animate-spin" : ""}`} />
                      {preflightBusy === item.id ? "جاري الفحص..." : "فحص قابلية التطبيق"}
                    </Button>
                    <Button type="button" onClick={() => applyPackage(item)} disabled={Boolean(preflightBusy) || Boolean(applyBusy) || !item.last_preflight?.ready} className="h-9 gap-2 bg-amber-700 px-3 text-xs hover:bg-amber-800 disabled:opacity-50">
                      <Upload className="h-3.5 w-3.5" />
                      {applyBusy === item.id ? "جاري التطبيق..." : "تطبيق التحديث"}
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
            {packages.length === 0 && (
              <tr>
                <td colSpan="7" className="p-5 text-center text-sm text-slate-500">لا توجد حزم تحديث مرفوعة حتى الآن.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {preflightResult && (
        <div className={`rounded-lg border p-4 ${preflightResult.ready ? "border-emerald-200 bg-emerald-50/70" : "border-red-200 bg-red-50/70"}`}>
          <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <h4 className={`font-bold ${preflightResult.ready ? "text-emerald-900" : "text-red-900"}`}>{preflightResult.summary}</h4>
              <p className="mt-1 text-sm leading-6 text-slate-600">
                النسخة: {preflightResult.version || "غير محدد"} - الملفات: {preflightResult.files_count || 0} - الحجم بعد الفك: {formatBytes(preflightResult.uncompressed_size_bytes || 0)}
              </p>
            </div>
            <span className={`rounded-full px-3 py-1 text-xs font-bold ${preflightResult.ready ? "bg-emerald-100 text-emerald-800" : "bg-red-100 text-red-800"}`}>
              {preflightResult.ready ? "جاهزة" : "غير جاهزة"}
            </span>
          </div>
          <div className="mt-4 grid gap-2 md:grid-cols-2">
            {(preflightResult.checks || []).map((check) => (
              <div key={check.name} className="rounded-md border border-white/80 bg-white p-3">
                <p className={`text-sm font-bold ${check.passed ? "text-emerald-800" : "text-red-800"}`}>{check.passed ? "نجح" : "لم ينجح"} - {check.name}</p>
                <p className="mt-1 text-xs leading-5 text-slate-600">{check.message}</p>
              </div>
            ))}
          </div>
          {(preflightResult.warnings || []).length > 0 && (
            <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
              {preflightResult.warnings.join(" ")}
            </div>
          )}
        </div>
      )}

      {applyResult && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50/70 p-4">
          <h4 className="font-bold text-emerald-900">تم تطبيق التحديث بدون إعادة تشغيل تلقائي</h4>
          <p className="mt-1 text-sm leading-6 text-slate-600">{applyResult.message}</p>
          <div className="mt-3 grid gap-3 md:grid-cols-3">
            <MetricBox label="النسخة" value={applyResult.version || "غير محدد"} />
            <MetricBox label="مسار rollback" value={applyResult.rollback_path || "-"} />
            <MetricBox label="نسخة قاعدة البيانات" value={applyResult.database_backup || "-"} />
          </div>
          <div className="mt-4 flex justify-end">
            <Button type="button" onClick={restartBackend} disabled={restartBusy} className="gap-2 bg-slate-900 hover:bg-slate-800">
              <RefreshCw className={`h-4 w-4 ${restartBusy ? "animate-spin" : ""}`} />
              {restartBusy ? "جاري إعادة التشغيل..." : "إعادة تشغيل الباكند الآن"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function SimpleError({ error }) { return error ? <p className="rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</p> : null; }
function SimpleTable({ headers, rows }) { return <div className="overflow-x-auto rounded-md border"><table className="w-full min-w-[680px] text-sm"><thead className="bg-slate-50"><tr>{headers.map((h) => <th key={h} className="p-3 text-right">{h}</th>)}</tr></thead><tbody className="divide-y">{rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} className="p-3">{c}</td>)}</tr>)}</tbody></table></div>; }
function EmailField({ label, value, onChange, type = "text" }) { return <label className="block space-y-2 text-sm font-medium text-slate-700">{label}<Input type={type} value={value ?? ""} onChange={(event) => onChange(event.target.value)} /></label>; }
function Toggle({ label, checked, onChange }) { return <label className="flex min-h-11 items-center justify-between gap-3 rounded-md border border-slate-200 bg-slate-50 px-3 text-sm font-semibold text-slate-700"><span>{label}</span><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="h-4 w-4 accent-bank-700" /></label>; }
function LabeledInput({ label, ...props }) { return <label className="block space-y-2 text-sm font-medium text-slate-700">{label}<Input {...props} /></label>; }
function MetricBox({ label, value }) { return <div className="min-w-0 rounded-lg border border-slate-200 bg-white p-4 shadow-sm"><p className="text-xs font-bold text-slate-500">{label}</p><p className="mt-2 break-words text-lg font-black text-slate-950">{value}</p></div>; }
function formatBytes(value) { if (!value) return "0 B"; const units = ["B", "KB", "MB", "GB"]; const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1); return `${(value / Math.pow(1024, index)).toFixed(index ? 1 : 0)} ${units[index]}`; }
function formatDateTime(value) { return formatSystemDateTime(value); }
