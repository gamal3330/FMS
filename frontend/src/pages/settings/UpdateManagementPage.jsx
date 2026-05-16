import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArchiveRestore, ClipboardCheck, FileText, History, ListChecks, PackageCheck, RefreshCw, RotateCcw, Settings2 } from "lucide-react";
import { api, getErrorMessage } from "../../lib/axios";
import { formatSystemDateTime } from "../../lib/datetime";
import FeedbackDialog from "../../components/ui/FeedbackDialog";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Pagination } from "../../components/ui/Pagination";
import { useAutoPagination } from "../../components/ui/useAutoPagination";

const tabs = [
  ["overview", "نظرة عامة", PackageCheck],
  ["versions", "الإصدارات", FileText],
  ["precheck", "الفحص قبل التحديث", ClipboardCheck],
  ["jobs", "سجل عمليات التحديث", History],
  ["rollback", "نقاط الاسترجاع", ArchiveRestore],
  ["notes", "سجل التغييرات", ListChecks],
  ["settings", "إعدادات التحديث", Settings2]
];

export default function UpdateManagementPage() {
  const [active, setActive] = useState("overview");
  const [dialog, setDialog] = useState({ type: "success", message: "" });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [currentUser, setCurrentUser] = useState(null);
  const [data, setData] = useState({ status: null, versions: [], jobs: [], rollbacks: [], notes: [], audit: [], settings: null, precheck: null });
  const runningJob = useMemo(() => (data.jobs || []).find((job) => ["pending", "running"].includes(job.status)), [data.jobs]);
  const canEdit = currentUser?.role === "super_admin";

  function notify(message, type = "success") {
    setDialog({ type, message });
  }

  async function load() {
    setLoading(true);
    try {
      const [me, status, versions, jobs, rollbacks, notes, settings, audit] = await Promise.all([
        api.get("/auth/me"),
        api.get("/settings/updates/status"),
        api.get("/settings/updates/versions"),
        api.get("/settings/updates/jobs"),
        api.get("/settings/updates/rollback-points"),
        api.get("/settings/updates/release-notes"),
        api.get("/settings/updates/settings"),
        api.get("/settings/updates/audit-logs")
      ]);
      setCurrentUser(me.data);
      setData((current) => ({ ...current, status: status.data, versions: versions.data, jobs: jobs.data, rollbacks: rollbacks.data, notes: notes.data, settings: settings.data, audit: audit.data }));
    } catch (error) {
      notify(getErrorMessage(error), "error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    if (!runningJob) return undefined;
    const timer = window.setInterval(load, 4000);
    return () => window.clearInterval(timer);
  }, [runningJob?.id]);

  async function runPrecheck() {
    setBusy("precheck");
    try {
      const { data: result } = await api.post("/settings/updates/precheck");
      setData((current) => ({ ...current, precheck: result }));
      setActive("precheck");
      notify(result.ready ? "الفحص قبل التحديث ناجح" : "يوجد فشل يمنع التحديث", result.ready ? "success" : "error");
    } catch (error) {
      notify(getErrorMessage(error), "error");
    } finally {
      setBusy("");
    }
  }

  async function saveSettings() {
    setBusy("settings");
    try {
      const { data: result } = await api.put("/settings/updates/settings", data.settings);
      setData((current) => ({ ...current, settings: result }));
      notify("تم حفظ إعدادات التحديث");
    } catch (error) {
      notify(getErrorMessage(error), "error");
    } finally {
      setBusy("");
    }
  }

  async function rollback(point) {
    if (!canEdit) {
      notify("الاسترجاع متاح لمدير النظام فقط", "error");
      return;
    }
    const admin_password = window.prompt("أدخل كلمة مرور مدير النظام للتأكيد");
    if (!admin_password) return;
    const confirmation_text = window.prompt("اكتب عبارة التأكيد: ROLLBACK UPDATE");
    if (confirmation_text !== "ROLLBACK UPDATE") {
      notify("عبارة التأكيد غير صحيحة", "error");
      return;
    }
    setBusy(`rollback-${point.id}`);
    try {
      await api.post(`/settings/updates/rollback/${point.id}`, { admin_password, confirmation_text });
      notify("تم تنفيذ الاسترجاع. قد تحتاج إلى إعادة تشغيل الخدمات.");
      await load();
    } catch (error) {
      notify(getErrorMessage(error), "error");
    } finally {
      setBusy("");
    }
  }

  if (loading) return <div className="rounded-md border border-slate-200 bg-slate-50 p-4 text-sm text-slate-500" dir="rtl">جاري تحميل إدارة التحديثات...</div>;

  return (
    <section className="space-y-6" dir="rtl">
      <FeedbackDialog open={Boolean(dialog.message)} type={dialog.type} message={dialog.message} onClose={() => setDialog({ ...dialog, message: "" })} />
      <Header />
      {!canEdit && <AlertBox type="warning">يمكنك عرض إدارة التحديثات فقط. تطبيق الإعدادات والاسترجاع متاحان لمدير النظام.</AlertBox>}
      <div className="grid gap-5 xl:grid-cols-[290px_minmax(0,1fr)]">
        <nav className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
          {tabs.map(([key, label, Icon]) => (
            <button key={key} onClick={() => setActive(key)} className={`mb-1 flex h-11 w-full items-center gap-3 rounded-md px-3 text-sm font-bold ${active === key ? "bg-bank-50 text-bank-800" : "text-slate-600 hover:bg-slate-50"}`}>
              <Icon className="h-4 w-4" />
              {label}
            </button>
          ))}
        </nav>
        <div className="min-w-0 space-y-5">
          {active === "overview" && (
            <Panel title="نظرة عامة" description="ملخص حالة النظام قبل أي تحديث.">
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <Metric label="الإصدار الحالي" value={data.status?.current_version} />
                <Metric label="رقم البناء" value={data.status?.build_number} />
                <Metric label="بيئة التشغيل" value={environmentLabel(data.status?.environment)} />
                <Metric label="حالة الخلفية" value={statusLabel(data.status?.backend_status)} />
                <Metric label="حالة الواجهة" value={statusLabel(data.status?.frontend_status)} />
                <Metric label="حالة قاعدة البيانات" value={statusLabel(data.status?.database_status)} />
                <Metric label="آخر نسخة احتياطية" value={formatSystemDateTime(data.status?.last_backup_at)} />
                <Metric label="ترحيلات معلقة" value={data.status?.pending_migrations ?? 0} />
              </div>
              {data.status?.active_job && <JobBanner job={data.status.active_job} />}
              <div className="flex flex-wrap gap-2">
                <Button type="button" onClick={load} className="gap-2 border border-slate-300 bg-white text-slate-700 hover:bg-slate-50"><RefreshCw className="h-4 w-4" />تحديث البيانات</Button>
                <Button type="button" onClick={runPrecheck} disabled={busy === "precheck"} className="gap-2"><ClipboardCheck className="h-4 w-4" />تشغيل فحص قبل التحديث</Button>
              </div>
            </Panel>
          )}

          {active === "versions" && (
            <Panel title="الإصدارات" description="الإصدارات المثبتة أو المسجلة في النظام.">
              <Table headers={["الإصدار", "البناء", "تاريخ الإصدار", "مثبت بواسطة", "الحالة", "ملاحظات"]} rows={data.versions.map((item) => [item.version, item.build_number, formatSystemDateTime(item.installed_at), item.installed_by_name || "-", versionStatus(item.status), item.notes || "-"])} />
            </Panel>
          )}

          {active === "precheck" && (
            <Panel title="الفحص قبل التحديث" description="لا تسمح بتطبيق تحديث إذا فشل فحص حرج.">
              <Button type="button" onClick={runPrecheck} disabled={busy === "precheck"} className="gap-2"><ClipboardCheck className="h-4 w-4" />تشغيل فحص قبل التحديث</Button>
              {data.precheck ? (
                <div className="space-y-3">
                  <AlertBox type={data.precheck.ready ? "success" : "warning"}>{data.precheck.summary}</AlertBox>
                  <Table headers={["البند", "الحالة", "الرسالة", "حرج؟"]} rows={data.precheck.checks.map((item) => [item.label, precheckBadge(item.status), item.message, item.critical ? "نعم" : "لا"])} />
                </div>
              ) : <Empty text="لم يتم تشغيل الفحص بعد." />}
            </Panel>
          )}

          {active === "jobs" && (
            <Panel title="سجل عمليات التحديث" description="كل عملية تحديث أو استرجاع تظهر هنا مع التقدم والحالة.">
              <Table headers={["ID", "النوع", "من", "إلى", "بواسطة", "بدأت", "اكتملت", "الحالة", "التقدم", "الرسالة"]} rows={data.jobs.map((job) => [job.id, job.job_type, job.from_version || "-", job.to_version || "-", job.started_by_name || "-", formatSystemDateTime(job.started_at), formatSystemDateTime(job.completed_at), jobStatus(job.status), <Progress value={job.progress} />, job.message || "-"])} />
            </Panel>
          )}

          {active === "rollback" && (
            <Panel title="نقاط الاسترجاع" description="استرجاع التحديث يحتاج مدير النظام وكلمة مرور وعبارة تأكيد.">
              <AlertBox type="warning">سيتم إنشاء نسخة احتياطية جديدة قبل الاسترجاع. لا يتم حذف Docker volumes أو uploads تلقائياً.</AlertBox>
              <Table headers={["الإصدار", "نسخة قاعدة البيانات", "نسخة الإعدادات", "أنشأها", "التاريخ", "الحالة", "الإجراء"]} rows={data.rollbacks.map((item) => [item.version, item.database_backup_id || "-", item.config_backup_path ? "موجودة" : "-", item.created_by_name || "-", formatSystemDateTime(item.created_at), item.status, <Button type="button" onClick={() => rollback(item)} disabled={Boolean(busy) || !canEdit} className="h-8 gap-2 bg-amber-600 px-3 text-xs hover:bg-amber-500"><RotateCcw className="h-3.5 w-3.5" />استرجاع</Button>])} />
            </Panel>
          )}

          {active === "notes" && (
            <Panel title="سجل التغييرات" description="ملاحظات الإصدارات المرفوعة محلياً.">
              {data.notes.length ? data.notes.map((item, index) => <ReleaseNote key={`${item.version}-${index}`} item={item} />) : <Empty text="لا توجد ملاحظات إصدار محفوظة بعد." />}
            </Panel>
          )}

          {active === "settings" && data.settings && (
            <Panel title="إعدادات التحديث" description="إعدادات الأمان والسلوك أثناء التحديث.">
              <div className="grid gap-3 md:grid-cols-2">
                {Object.entries(data.settings).filter(([key]) => !["id", "updated_at"].includes(key)).map(([key, value]) => typeof value === "boolean" ? (
                  <Toggle key={key} label={settingLabel(key)} checked={value} disabled={!canEdit} onChange={(next) => setData((current) => ({ ...current, settings: { ...current.settings, [key]: next } }))} />
                ) : (
                  <Field key={key} label={settingLabel(key)} value={value} type="number" disabled={!canEdit} onChange={(next) => setData((current) => ({ ...current, settings: { ...current.settings, [key]: Number(next) } }))} />
                ))}
              </div>
              <Button type="button" onClick={saveSettings} disabled={busy === "settings" || !canEdit} className="gap-2"><Settings2 className="h-4 w-4" />حفظ إعدادات التحديث</Button>
            </Panel>
          )}
        </div>
      </div>
    </section>
  );
}

function Header() {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
      <p className="text-sm font-bold text-bank-700">لوحة الإدارة</p>
      <h2 className="mt-2 text-2xl font-black text-slate-950">إدارة التحديثات</h2>
      <p className="mt-2 max-w-4xl text-sm leading-6 text-slate-500">مركز متابعة الإصدارات، الفحص قبل التحديث، الوظائف، نقاط الاسترجاع، وسجل التغييرات.</p>
    </div>
  );
}

function Panel({ title, description, children }) {
  return <div className="space-y-4 rounded-lg border border-slate-200 bg-white p-4 shadow-sm"><div><h3 className="text-lg font-black text-slate-950">{title}</h3>{description && <p className="mt-1 text-sm leading-6 text-slate-500">{description}</p>}</div>{children}</div>;
}

function Metric({ label, value }) {
  return <div className="rounded-lg border border-slate-200 bg-slate-50 p-4"><p className="text-xs font-bold text-slate-500">{label}</p><p className="mt-2 text-xl font-black text-slate-950">{value ?? "-"}</p></div>;
}

function Table({ headers, rows, pageSize = 10 }) {
  const { page, setPage, visibleRows, showPagination, totalItems } = useAutoPagination(rows || [], pageSize);
  if (!rows?.length) return <Empty text="لا توجد بيانات حالياً." />;
  return (
    <div className="overflow-hidden rounded-lg border border-slate-200">
      <div className="overflow-x-auto">
        <table className="min-w-full text-right text-sm">
          <thead className="bg-slate-50"><tr>{headers.map((header) => <th key={header} className="whitespace-nowrap px-3 py-3 font-black text-slate-700">{header}</th>)}</tr></thead>
          <tbody className="divide-y divide-slate-100 bg-white">
            {visibleRows.map((row, rowIndex) => <tr key={`${page}-${rowIndex}`}>{row.map((cell, index) => <td key={index} className="max-w-md px-3 py-3 text-slate-700">{cell}</td>)}</tr>)}
          </tbody>
        </table>
      </div>
      {showPagination && <Pagination page={page} totalItems={totalItems} pageSize={pageSize} onPageChange={setPage} />}
    </div>
  );
}

function Empty({ text }) {
  return <div className="rounded-md border border-dashed border-slate-200 bg-slate-50 p-5 text-center text-sm text-slate-500">{text}</div>;
}

function Progress({ value }) {
  return <div className="h-2 w-28 rounded-full bg-slate-100"><div className="h-2 rounded-full bg-bank-600" style={{ width: `${Math.min(100, Number(value || 0))}%` }} /></div>;
}

function Toggle({ label, checked, onChange, disabled = false }) {
  return <label className={`flex min-h-12 items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm font-bold ${disabled ? "opacity-60" : ""} ${checked ? "border-bank-200 bg-bank-50 text-bank-900" : "border-slate-200 bg-white text-slate-700"}`}><span>{label}</span><input type="checkbox" disabled={disabled} checked={Boolean(checked)} onChange={(event) => onChange(event.target.checked)} className="h-5 w-5 rounded border-slate-300 text-bank-700 focus:ring-bank-600" /></label>;
}

function Field({ label, value, onChange, type = "text", disabled = false }) {
  return <label className="space-y-2 text-sm font-bold text-slate-700">{label}<Input type={type} disabled={disabled} value={value ?? ""} onChange={(event) => onChange(event.target.value)} /></label>;
}

function AlertBox({ type = "warning", children }) {
  const success = type === "success";
  return <div className={`flex items-start gap-3 rounded-lg border p-3 text-sm leading-6 ${success ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-amber-200 bg-amber-50 text-amber-900"}`}><AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />{children}</div>;
}

function JobBanner({ job }) {
  return <div className="rounded-lg border border-blue-200 bg-blue-50 p-4"><p className="font-black text-blue-950">عملية تحديث نشطة: {job.message}</p><div className="mt-3"><Progress value={job.progress} /></div></div>;
}

function ReleaseNote({ item }) {
  return <div className="rounded-lg border border-slate-200 p-4"><h4 className="font-black text-slate-950">{item.version || "إصدار غير محدد"}</h4><p className="mt-2 whitespace-pre-wrap text-sm leading-7 text-slate-600">{item.notes || "لا توجد ملاحظات."}</p></div>;
}

function statusLabel(value) {
  const labels = { healthy: "سليمة", warning: "تحذير", critical: "حرجة", unknown: "غير معروفة" };
  return labels[value] || value || "-";
}

function environmentLabel(value) {
  const labels = { development: "محلي", local: "محلي", test: "اختبار", production: "إنتاج" };
  return labels[value] || value || "-";
}

function jobStatus(value) {
  const labels = { pending: "بانتظار", running: "قيد التنفيذ", success: "ناجح", failed: "فشل", rolled_back: "تم الاسترجاع" };
  return labels[value] || value || "-";
}

function versionStatus(value) {
  const labels = { current: "حالي", installed: "مثبت", rolled_back: "مسترجع" };
  return labels[value] || value || "-";
}

function precheckBadge(value) {
  const labels = { passed: "ناجح", warning: "تحذير", failed: "فشل" };
  return labels[value] || value;
}

function settingLabel(key) {
  const labels = {
    enable_maintenance_mode_during_update: "تفعيل وضع الصيانة أثناء التحديث",
    auto_backup_before_update: "إنشاء نسخة احتياطية تلقائيًا قبل التحديث",
    auto_health_check_after_update: "تشغيل فحص الصحة بعد التحديث",
    auto_rollback_on_failed_health_check: "الاسترجاع التلقائي عند فشل الفحص",
    retain_rollback_points_count: "عدد نقاط الاسترجاع المحتفظ بها",
    block_updates_in_production_without_flag: "منع التحديث في الإنتاج بدون تصريح",
    allow_local_update_upload: "السماح برفع تحديث محلي"
  };
  return labels[key] || key;
}
