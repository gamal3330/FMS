import { useEffect, useState } from "react";
import { AlertTriangle, Database, Download, LockKeyhole, RefreshCw, RotateCcw, Settings2, Upload } from "lucide-react";
import { api, getErrorMessage } from "../lib/axios";
import { Card } from "../components/ui/card";
import { Button } from "../components/ui/button";
import FeedbackDialog from "../components/ui/FeedbackDialog";
import { Input } from "../components/ui/input";
import GeneralSettings from "../components/settings/GeneralSettings";

const tabs = [
  ["general", "الإعدادات العامة", Settings2],
  ["security", "إعدادات الأمان", LockKeyhole],
  ["database", "قاعدة البيانات", Database]
];

export default function SettingsPage() {
  const [active, setActive] = useState("general");
  const [dialog, setDialog] = useState({ type: "success", message: "" });

  function notify(message, type = "success") {
    setDialog({ type, message });
  }

  return (
    <section className="space-y-6" dir="rtl">
      <FeedbackDialog open={Boolean(dialog.message)} type={dialog.type} message={dialog.message} onClose={() => setDialog({ ...dialog, message: "" })} />
      <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <p className="text-sm font-semibold text-bank-700">لوحة الإدارة</p>
        <h2 className="mt-2 text-2xl font-bold text-slate-950">إعدادات النظام</h2>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">إدارة إعدادات النظام والصلاحيات وسير العمل</p>
      </div>

      <div className="grid gap-5 xl:grid-cols-[300px_1fr]">
        <Card className="p-3">
          <nav className="space-y-1">
            {tabs.map(([key, label, Icon]) => (
              <button key={key} onClick={() => setActive(key)} className={`flex h-11 w-full items-center gap-3 rounded-md px-3 text-right text-sm font-semibold ${active === key ? "bg-bank-50 text-bank-700" : "text-slate-600 hover:bg-slate-50"}`}>
                <Icon className="h-4 w-4" />
                {label}
              </button>
            ))}
          </nav>
        </Card>
        <Card className="p-5">
          {active === "general" && <Panel title="الإعدادات العامة"><GeneralSettings notify={notify} /></Panel>}
          {active === "requestTypes" && <Panel title="أنواع الطلبات"><RequestTypesSettings notify={notify} /></Panel>}
          {active === "security" && <Panel title="إعدادات الأمان"><SecuritySettings notify={notify} /></Panel>}
          {active === "database" && <Panel title="قاعدة البيانات والنسخ الاحتياطي"><DatabaseSettings notify={notify} /></Panel>}
        </Card>
      </div>
    </section>
  );
}

function Panel({ title, children }) {
  return <div><h3 className="mb-5 text-xl font-bold text-slate-950">{title}</h3>{children}</div>;
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

  useEffect(() => {
    loadStatus();
    loadBackupSettings();
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
    if (!window.confirm("سيتم حذف جميع بيانات النظام وإعادة إنشاء بيانات البداية فقط. هل تريد المتابعة؟")) return;
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

function SimpleError({ error }) { return error ? <p className="rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</p> : null; }
function SimpleTable({ headers, rows }) { return <div className="overflow-x-auto rounded-md border"><table className="w-full min-w-[680px] text-sm"><thead className="bg-slate-50"><tr>{headers.map((h) => <th key={h} className="p-3 text-right">{h}</th>)}</tr></thead><tbody className="divide-y">{rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} className="p-3">{c}</td>)}</tr>)}</tbody></table></div>; }
function LabeledInput({ label, ...props }) { return <label className="block space-y-2 text-sm font-medium text-slate-700">{label}<Input {...props} /></label>; }
function MetricBox({ label, value }) { return <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm"><p className="text-xs font-bold text-slate-500">{label}</p><p className="mt-2 break-words text-lg font-black text-slate-950">{value}</p></div>; }
function formatBytes(value) { if (!value) return "0 B"; const units = ["B", "KB", "MB", "GB"]; const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1); return `${(value / Math.pow(1024, index)).toFixed(index ? 1 : 0)} ${units[index]}`; }
function formatDateTime(value) { return value ? new Date(value).toLocaleString("ar-QA") : "-"; }
