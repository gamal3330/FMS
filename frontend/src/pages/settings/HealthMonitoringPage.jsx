import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  Archive,
  Bell,
  CheckCircle2,
  Clock,
  Database,
  ExternalLink,
  FileText,
  HardDrive,
  History,
  ListChecks,
  LogIn,
  PackageCheck,
  RefreshCw,
  Server,
  Settings2,
  ShieldAlert,
  UploadCloud,
  Wrench,
  XCircle
} from "lucide-react";
import { api, getErrorMessage } from "../../lib/axios";
import { formatSystemDateTime } from "../../lib/datetime";
import { Button } from "../../components/ui/button";
import { Pagination } from "../../components/ui/Pagination";

const tabs = [
  ["overview", "نظرة عامة", Activity],
  ["services", "الخدمات الداخلية", Server],
  ["database", "قاعدة البيانات", Database],
  ["storage", "التخزين والمرفقات", HardDrive],
  ["backups", "النسخ الاحتياطية", Archive],
  ["errors", "الأخطاء والسجلات", ShieldAlert],
  ["jobs", "العمليات والمهام", ListChecks],
  ["updates", "التحديثات", PackageCheck],
  ["alerts", "التنبيهات", Bell],
  ["settings", "الإعدادات", Settings2]
];

const tabEndpoint = {
  services: "/health/services",
  database: "/health/database",
  storage: "/health/storage",
  backups: "/health/backups",
  errors: "/health/errors",
  jobs: "/health/jobs",
  updates: "/health/updates",
  alerts: "/health/alerts",
  settings: "/health/settings"
};

const statusLabels = {
  healthy: "سليم",
  warning: "تحذير",
  critical: "حرج",
  success: "ناجح",
  failed: "فشل",
  error: "خطأ",
  pending: "قيد الانتظار",
  running: "قيد التشغيل",
  cancelled: "ملغي",
  imported: "مكتمل",
  confirmed: "مكتمل"
};

const severityClasses = {
  healthy: "border-emerald-200 bg-emerald-50 text-emerald-800",
  success: "border-emerald-200 bg-emerald-50 text-emerald-800",
  warning: "border-amber-200 bg-amber-50 text-amber-800",
  pending: "border-amber-200 bg-amber-50 text-amber-800",
  running: "border-blue-200 bg-blue-50 text-blue-800",
  critical: "border-red-200 bg-red-50 text-red-800",
  failed: "border-red-200 bg-red-50 text-red-800",
  error: "border-red-200 bg-red-50 text-red-800",
  cancelled: "border-slate-200 bg-slate-50 text-slate-700",
  info: "border-blue-200 bg-blue-50 text-blue-800"
};

const cardIconClasses = {
  healthy: "bg-emerald-100 text-emerald-700",
  success: "bg-emerald-100 text-emerald-700",
  warning: "bg-amber-100 text-amber-700",
  running: "bg-blue-100 text-blue-700",
  critical: "bg-red-100 text-red-700",
  failed: "bg-red-100 text-red-700",
  error: "bg-red-100 text-red-700",
  info: "bg-blue-100 text-blue-700"
};

const loginActionLabels = {
  login_success: "دخول ناجح",
  login_failed: "محاولة فاشلة",
  login_blocked: "حساب غير نشط",
  login_blocked_locked: "حساب مقفل",
  login_locked_after_failures: "قفل بعد محاولات فاشلة",
  login_password_expired: "كلمة مرور منتهية",
  logout: "خروج"
};

const loginActivityPageSize = 15;

export default function HealthMonitoringPage() {
  const [activeTab, setActiveTab] = useState("overview");
  const [summary, setSummary] = useState(null);
  const [tabData, setTabData] = useState({});
  const [settingsDraft, setSettingsDraft] = useState(null);
  const [loginActivity, setLoginActivity] = useState([]);
  const [loginActivityPage, setLoginActivityPage] = useState(1);
  const [loadingSummary, setLoadingSummary] = useState(true);
  const [loadingTab, setLoadingTab] = useState("");
  const [runningChecks, setRunningChecks] = useState(false);
  const [busyAction, setBusyAction] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function loadSummary() {
    setError("");
    setLoadingSummary(true);
    try {
      const { data } = await api.get("/health/summary");
      setSummary(data);
    } catch (error) {
      setError(getErrorMessage(error));
    } finally {
      setLoadingSummary(false);
    }
  }

  async function loadTab(tab = activeTab) {
    if (tab === "overview") return;
    const endpoint = tabEndpoint[tab];
    if (!endpoint) return;
    setLoadingTab(tab);
    setError("");
    try {
      const { data } = await api.get(endpoint);
      setTabData((current) => ({ ...current, [tab]: data }));
      if (tab === "settings") setSettingsDraft(data);
      if (tab === "errors") {
        try {
          const activity = await api.get("/audit-logs/login-activity?limit=300");
          setLoginActivity(activity.data || []);
          setLoginActivityPage(1);
        } catch {
          setLoginActivity([]);
        }
      }
    } catch (error) {
      setError(getErrorMessage(error));
    } finally {
      setLoadingTab("");
    }
  }

  async function reloadCurrent() {
    await loadSummary();
    await loadTab(activeTab);
  }

  async function runChecks() {
    setRunningChecks(true);
    setError("");
    setNotice("");
    try {
      const { data } = await api.post("/health/run-checks");
      setSummary(data);
      setNotice("تم تشغيل فحص صحة النظام وتحديث النتائج.");
      await loadTab(activeTab);
    } catch (error) {
      setError(getErrorMessage(error));
    } finally {
      setRunningChecks(false);
    }
  }

  async function runDatabaseAction(action, message) {
    setBusyAction(action);
    setError("");
    setNotice("");
    try {
      await api.post(`/settings/database/maintenance/${action}`);
      setNotice(message);
      await reloadCurrent();
    } catch (error) {
      setError(getErrorMessage(error));
    } finally {
      setBusyAction("");
    }
  }

  async function createBackup() {
    setBusyAction("create-backup");
    setError("");
    setNotice("");
    try {
      await api.post("/settings/database/backup", { backup_type: "full_backup" });
      setNotice("تم إنشاء نسخة احتياطية كاملة.");
      await reloadCurrent();
    } catch (error) {
      setError(getErrorMessage(error));
    } finally {
      setBusyAction("");
    }
  }

  async function resolveAlert(alert) {
    setBusyAction(`resolve-${alert.id}`);
    setError("");
    setNotice("");
    try {
      await api.post(`/health/alerts/${alert.id}/resolve`);
      setNotice("تم تعليم التنبيه كمحلول.");
      await reloadCurrent();
    } catch (error) {
      setError(getErrorMessage(error));
    } finally {
      setBusyAction("");
    }
  }

  async function clearLogs() {
    if (!window.confirm("هل تريد محو السجلات المعروضة من ملفات التشغيل وسجلات الأخطاء؟")) return;
    setBusyAction("clear-logs");
    setError("");
    setNotice("");
    try {
      const { data } = await api.post("/health/clear-logs");
      setSummary(data);
      setNotice("تم محو السجلات المعروضة.");
      await loadTab("errors");
    } catch (error) {
      setError(getErrorMessage(error));
    } finally {
      setBusyAction("");
    }
  }

  async function saveSettings() {
    setBusyAction("settings");
    setError("");
    setNotice("");
    try {
      const { data } = await api.put("/health/settings", settingsDraft);
      setTabData((current) => ({ ...current, settings: data }));
      setSettingsDraft(data);
      setNotice("تم حفظ إعدادات مراقبة الصحة.");
      await loadSummary();
    } catch (error) {
      setError(getErrorMessage(error));
    } finally {
      setBusyAction("");
    }
  }

  useEffect(() => {
    loadSummary();
  }, []);

  useEffect(() => {
    loadTab(activeTab);
  }, [activeTab]);

  const runningJobs = useMemo(() => {
    const jobs = tabData.jobs?.jobs || summary?.jobs?.jobs || [];
    return jobs.filter((job) => ["pending", "running"].includes(job.status));
  }, [summary, tabData.jobs]);

  useEffect(() => {
    if (!runningJobs.length) return undefined;
    const timer = window.setInterval(() => {
      loadSummary();
      if (activeTab === "jobs") loadTab("jobs");
    }, 4000);
    return () => window.clearInterval(timer);
  }, [runningJobs.length, activeTab]);

  const paginatedLoginActivity = useMemo(() => {
    const start = (loginActivityPage - 1) * loginActivityPageSize;
    return loginActivity.slice(start, start + loginActivityPageSize);
  }, [loginActivity, loginActivityPage]);

  const summaryCards = useMemo(() => buildSummaryCards(summary), [summary]);

  return (
    <section className="space-y-6 text-right" dir="rtl">
      <Header onRefresh={reloadCurrent} onRunChecks={runChecks} running={runningChecks || loadingSummary} />

      {error && <AlertBox type="critical">{error}</AlertBox>}
      {notice && <AlertBox type="healthy">{notice}</AlertBox>}

      <div className="grid gap-5 xl:grid-cols-[300px_minmax(0,1fr)]">
        <TabsNav active={activeTab} onChange={setActiveTab} summary={summary} />

        <div className="min-w-0 space-y-5">
          {loadingSummary && !summary ? (
            <Panel title="مراقبة صحة النظام">
              <Empty text="جاري تحميل بيانات صحة النظام..." />
            </Panel>
          ) : (
            <>
              {activeTab === "overview" && <OverviewTab summary={summary} cards={summaryCards} onRunChecks={runChecks} running={runningChecks} />}
              {activeTab === "services" && <ServicesTab data={tabData.services} loading={loadingTab === "services"} />}
              {activeTab === "database" && (
                <DatabaseTab
                  data={tabData.database}
                  loading={loadingTab === "database"}
                  busyAction={busyAction}
                  onTest={() => runDatabaseAction("test-connection", "تم اختبار اتصال قاعدة البيانات.")}
                  onIntegrity={() => runDatabaseAction("check-integrity", "تم تشغيل فحص سلامة قاعدة البيانات.")}
                />
              )}
              {activeTab === "storage" && (
                <StorageTab
                  data={tabData.storage}
                  loading={loadingTab === "storage"}
                  busyAction={busyAction}
                  onScan={() => runDatabaseAction("check-orphan-attachments", "تم فحص المرفقات المفقودة والملفات اليتيمة.")}
                />
              )}
              {activeTab === "backups" && (
                <BackupsTab data={tabData.backups} loading={loadingTab === "backups"} busyAction={busyAction} onBackup={createBackup} />
              )}
              {activeTab === "errors" && (
                <ErrorsTab
                  data={tabData.errors}
                  loading={loadingTab === "errors"}
                  busyAction={busyAction}
                  onClearLogs={clearLogs}
                  loginActivity={paginatedLoginActivity}
                  loginActivityTotal={loginActivity.length}
                  loginActivityPage={loginActivityPage}
                  onLoginActivityPageChange={setLoginActivityPage}
                />
              )}
              {activeTab === "jobs" && <JobsTab data={tabData.jobs} loading={loadingTab === "jobs"} />}
              {activeTab === "updates" && <UpdatesTab data={tabData.updates} loading={loadingTab === "updates"} />}
              {activeTab === "alerts" && (
                <AlertsTab data={tabData.alerts} loading={loadingTab === "alerts"} busyAction={busyAction} onResolve={resolveAlert} />
              )}
              {activeTab === "settings" && (
                <SettingsTab
                  data={settingsDraft}
                  loading={loadingTab === "settings"}
                  busyAction={busyAction}
                  onChange={setSettingsDraft}
                  onSave={saveSettings}
                />
              )}
            </>
          )}
        </div>
      </div>
    </section>
  );
}

function Header({ onRefresh, onRunChecks, running }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-start gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-bank-50 text-bank-700">
            <Activity className="h-6 w-6" />
          </div>
          <div>
            <p className="text-sm font-bold text-bank-700">مركز التشغيل</p>
            <h2 className="mt-2 text-2xl font-black text-slate-950">مراقبة صحة النظام</h2>
            <p className="mt-2 max-w-4xl text-sm leading-6 text-slate-500">
              متابعة حالة الخادم، قاعدة البيانات، التخزين، النسخ الاحتياطية، الأخطاء، المهام، والتنبيهات من مكان واحد.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" onClick={onRefresh} className="gap-2 border border-slate-300 bg-white text-slate-700 hover:bg-slate-50">
            <RefreshCw className="h-4 w-4" />
            تحديث
          </Button>
          <Button type="button" onClick={onRunChecks} disabled={running} className="gap-2">
            <RefreshCw className={`h-4 w-4 ${running ? "animate-spin" : ""}`} />
            {running ? "جاري الفحص..." : "إعادة الفحص الآن"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function TabsNav({ active, onChange, summary }) {
  return (
    <nav className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
      {tabs.map(([key, label, Icon]) => {
        const count = key === "alerts" ? summary?.active_alerts_count : key === "errors" ? summary?.errors_last_24h : null;
        return (
          <button
            key={key}
            type="button"
            onClick={() => onChange(key)}
            className={`mb-1 flex min-h-11 w-full items-center justify-between gap-3 rounded-md px-3 py-2 text-sm font-bold transition ${
              active === key ? "bg-bank-50 text-bank-800" : "text-slate-600 hover:bg-slate-50"
            }`}
          >
            <span className="flex items-center gap-3">
              <Icon className="h-4 w-4" />
              {label}
            </span>
            {count ? <span className="rounded-full bg-slate-100 px-2 py-1 text-xs text-slate-700">{count}</span> : null}
          </button>
        );
      })}
    </nav>
  );
}

function OverviewTab({ summary, cards, onRunChecks, running }) {
  return (
    <div className="space-y-5">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {cards.map((card) => (
          <SummaryCard key={card.key} {...card} />
        ))}
      </div>

      <Panel title="آخر الفحوصات" description="آخر النتائج المسجلة بعد تشغيل الفحص اليدوي أو تحميل الملخص.">
        <div className="flex flex-wrap gap-2">
          <Button type="button" onClick={onRunChecks} disabled={running} className="gap-2">
            <RefreshCw className={`h-4 w-4 ${running ? "animate-spin" : ""}`} />
            تشغيل فحص شامل
          </Button>
        </div>
        <DataTable
          headers={["الفحص", "التصنيف", "الحالة", "زمن الاستجابة", "الرسالة", "وقت الفحص"]}
          rows={(summary?.recent_checks || []).map((item) => [
            checkLabel(item.check_name),
            categoryLabel(item.category),
            <StatusBadge status={item.status} />,
            formatMs(item.latency_ms),
            item.message || "-",
            formatSystemDateTime(item.checked_at)
          ])}
          empty="لا توجد فحوصات مسجلة."
        />
      </Panel>

      <Panel title="التنبيهات النشطة" description="أي حالة تحذير أو خطر يتم تسجيلها هنا حتى يتم حلها.">
        <DataTable
          headers={["الخطورة", "العنوان", "الرسالة", "الإجراء المقترح", "الحالة"]}
          rows={(summary?.alerts || [])
            .filter((alert) => !alert.is_resolved)
            .map((alert) => [
              <StatusBadge status={alert.severity} />,
              alert.title,
              alert.message,
              alert.recommended_action || "-",
              alert.is_resolved ? "محلول" : "نشط"
            ])}
          empty="لا توجد تنبيهات نشطة."
        />
      </Panel>
    </div>
  );
}

function ServicesTab({ data, loading }) {
  if (loading || !data) return <LoadingPanel title="الخدمات الداخلية" />;
  return (
    <Panel title="الخدمات الداخلية" description="فحص الخدمات الداخلية فقط دون SMTP أو WhatsApp أو LDAP.">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {(data || []).map((service) => (
          <InfoCard
            key={service.code}
            title={serviceLabel(service.code, service.name)}
            value={<StatusBadge status={service.status} />}
            icon={serviceIcon(service.code)}
            lines={[
              ["زمن الاستجابة", formatMs(service.latency_ms)],
              ["آخر فحص", formatSystemDateTime(service.last_checked_at)],
              ["الرسالة", service.message || "-"]
            ]}
          />
        ))}
      </div>
    </Panel>
  );
}

function DatabaseTab({ data, loading, busyAction, onTest, onIntegrity }) {
  if (loading || !data) return <LoadingPanel title="قاعدة البيانات" />;
  return (
    <Panel title="قاعدة البيانات" description="معلومات آمنة عن قاعدة البيانات دون كشف كلمة المرور أو رابط الاتصال الكامل.">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <Metric label="الحالة" value={<StatusBadge status={data.status} />} />
        <Metric label="نوع قاعدة البيانات" value={data.database_type || data.safe_database_type || "-"} />
        <Metric label="اسم قاعدة البيانات" value={data.database_name || data.safe_database_name || "-"} />
        <Metric label="زمن الاستجابة" value={formatMs(data.latency_ms)} />
        <Metric label="حجم قاعدة البيانات" value={data.size_mb ? `${data.size_mb} MB` : "-"} />
        <Metric label="عدد الجداول" value={data.tables_count ?? "-"} />
        <Metric label="عدد السجلات" value={data.records_count ?? "-"} />
        <Metric label="ترحيلات معلقة" value={data.pending_migrations ?? 0} />
        <Metric label="آخر فحص سلامة" value={formatSystemDateTime(data.last_integrity_check_at)} />
        <Metric label="آخر صيانة" value={formatSystemDateTime(data.last_maintenance_at)} />
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={onTest} disabled={busyAction === "test-connection"} className="gap-2">
          <Database className="h-4 w-4" />
          اختبار الاتصال
        </Button>
        <Button type="button" onClick={onIntegrity} disabled={busyAction === "check-integrity"} className="gap-2 border border-slate-300 bg-white text-slate-700 hover:bg-slate-50">
          <Wrench className="h-4 w-4" />
          فحص سلامة قاعدة البيانات
        </Button>
        <LinkButton href="/settings/database">فتح إعدادات قاعدة البيانات</LinkButton>
      </div>
    </Panel>
  );
}

function StorageTab({ data, loading, busyAction, onScan }) {
  if (loading || !data) return <LoadingPanel title="التخزين والمرفقات" />;
  return (
    <Panel title="التخزين والمرفقات" description="متابعة مساحة القرص وحالة مجلد الرفع والمرفقات المفقودة أو اليتيمة.">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <Metric label="الحالة" value={<StatusBadge status={data.status} />} />
        <Metric label="استخدام القرص" value={`${data.disk_used_percent ?? 0}%`} />
        <Metric label="المساحة الإجمالية" value={data.disk_total_label || formatBytes(data.disk_total_size)} />
        <Metric label="المساحة المستخدمة" value={data.disk_used_label || formatBytes(data.disk_used_size)} />
        <Metric label="المساحة الحرة" value={data.disk_free_label || formatBytes(data.disk_free_size)} />
        <Metric label="حجم uploads" value={data.uploads_folder_size_label || formatBytes(data.uploads_folder_size)} />
        <Metric label="حجم backups" value={data.backups_folder_size_label || formatBytes(data.backups_folder_size)} />
        <Metric label="عدد المرفقات" value={data.attachments_count ?? 0} />
        <Metric label="مرفقات مفقودة" value={data.missing_attachment_files_count ?? 0} />
        <Metric label="ملفات يتيمة" value={data.orphan_files_count ?? 0} />
        <Metric label="مجلد الرفع" value={data.uploads_directory_writable ? "قابل للكتابة" : "غير قابل للكتابة"} />
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={onScan} disabled={busyAction === "check-orphan-attachments"} className="gap-2">
          <UploadCloud className="h-4 w-4" />
          فحص المرفقات المفقودة واليتيمة
        </Button>
        <LinkButton href="/settings">فتح إعدادات المرفقات</LinkButton>
      </div>
    </Panel>
  );
}

function BackupsTab({ data, loading, busyAction, onBackup }) {
  if (loading || !data) return <LoadingPanel title="النسخ الاحتياطية" />;
  return (
    <Panel title="النسخ الاحتياطية" description="متابعة آخر نسخة احتياطية وحالة مجلد النسخ.">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <Metric label="الحالة" value={<StatusBadge status={data.status} />} />
        <Metric label="آخر نسخة" value={formatSystemDateTime(data.last_backup_at) || "لا توجد"} />
        <Metric label="حالة آخر نسخة" value={data.last_backup_status || "-"} />
        <Metric label="حجم آخر نسخة" value={data.last_backup_size_label || formatBytes(data.last_backup_size)} />
        <Metric label="عدد النسخ" value={data.backup_count ?? 0} />
        <Metric label="النسخ التلقائي" value={data.auto_backup_enabled ? "مفعل" : "غير مفعل"} />
        <Metric label="نسخ فاشلة" value={data.failed_backups_count ?? 0} />
        <Metric label="مجلد النسخ" value={data.backup_directory_writable ? "قابل للكتابة" : "غير قابل للكتابة"} />
      </div>
      <AlertBox type={data.status}>{data.message}</AlertBox>
      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={onBackup} disabled={busyAction === "create-backup"} className="gap-2">
          <Archive className="h-4 w-4" />
          إنشاء نسخة احتياطية الآن
        </Button>
        <LinkButton href="/settings/database">فتح إدارة قاعدة البيانات</LinkButton>
      </div>
    </Panel>
  );
}

function ErrorsTab({ data, loading, busyAction, onClearLogs, loginActivity, loginActivityTotal, loginActivityPage, onLoginActivityPageChange }) {
  if (loading || !data) return <LoadingPanel title="الأخطاء والسجلات" />;
  return (
    <div className="space-y-5">
      <Panel title="الأخطاء والسجلات" description="مؤشرات الأخطاء من ملفات تشغيل الخادم وسجلات التدقيق.">
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" onClick={onClearLogs} disabled={busyAction === "clear-logs"} className="gap-2 bg-red-700 hover:bg-red-600">
            <XCircle className="h-4 w-4" />
            محو السجلات المعروضة
          </Button>
        </div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <Metric label="الحالة" value={<StatusBadge status={data.status} />} />
          <Metric label="أخطاء آخر 24 ساعة" value={data.errors_last_24h ?? 0} />
          <Metric label="أخطاء آخر 7 أيام" value={data.errors_last_7d ?? 0} />
          <Metric label="أخطاء حرجة" value={data.critical_errors_count ?? 0} />
        </div>
        <DataTable
          headers={["التاريخ", "المستوى", "المصدر", "الرسالة", "المستخدم", "IP Address"]}
          rows={(data.latest_error_logs || []).map((log) => [
            formatSystemDateTime(log.created_at),
            <StatusBadge status={log.level} />,
            log.source || "-",
            <span className="block max-w-[520px] whitespace-pre-wrap break-words">{log.message}</span>,
            log.user || "-",
            log.ip_address || "-"
          ])}
          empty="لا توجد أخطاء مسجلة حالياً."
        />
      </Panel>

      <Panel title="مصادر الأخطاء" description="تجميع سريع لآخر الأخطاء حسب المصدر.">
        <DataTable
          headers={["المصدر", "العدد"]}
          rows={(data.errors_by_source || []).map((item) => [item.source, item.count])}
          empty="لا توجد مصادر أخطاء."
        />
      </Panel>

      <Panel title="سجل دخول المستخدمين" description="ميزة موجودة مسبقاً وتم الاحتفاظ بها ضمن مركز الصحة.">
        <DataTable
          headers={["النتيجة", "المستخدم", "المعرّف المستخدم", "IP", "المحاولات", "المتصفح", "الوقت"]}
          rows={(loginActivity || []).map((log) => [
            <LoginActionBadge action={log.action} />,
            <div>
              <p className="font-bold text-slate-950">{log.actor_name || "-"}</p>
              <p className="mt-1 text-xs text-slate-500">{log.actor_email || ""}</p>
            </div>,
            log.identifier || "-",
            log.ip_address || "-",
            log.failed_login_attempts ?? "-",
            <span className="block max-w-[260px] truncate" title={log.user_agent || ""}>{log.user_agent || "-"}</span>,
            formatSystemDateTime(log.created_at)
          ])}
          empty="لا توجد محاولات دخول مسجلة."
        />
        <Pagination page={loginActivityPage} totalItems={loginActivityTotal} pageSize={loginActivityPageSize} onPageChange={onLoginActivityPageChange} />
      </Panel>
    </div>
  );
}

function JobsTab({ data, loading }) {
  if (loading || !data) return <LoadingPanel title="العمليات والمهام" />;
  return (
    <Panel title="العمليات والمهام" description="الوظائف الطويلة مثل النسخ، الاستعادة، الاستيراد، الصيانة، والتحديثات.">
      <div className="grid gap-3 md:grid-cols-3">
        <Metric label="مهام نشطة" value={data.active_jobs ?? 0} />
        <Metric label="مهام فاشلة" value={data.failed_jobs ?? 0} />
        <Metric label="الحالة" value={<StatusBadge status={data.status} />} />
      </div>
      <DataTable
        headers={["نوع العملية", "الحالة", "النسبة", "بدأت بواسطة", "وقت البداية", "وقت النهاية", "النتيجة"]}
        rows={(data.jobs || []).map((job) => [
          jobTypeLabel(job.job_type),
          <StatusBadge status={job.status} />,
          <Progress value={job.progress} />,
          job.started_by_name || "-",
          formatSystemDateTime(job.started_at),
          formatSystemDateTime(job.completed_at),
          job.message || "-"
        ])}
        empty="لا توجد مهام مسجلة."
      />
    </Panel>
  );
}

function UpdatesTab({ data, loading }) {
  if (loading || !data) return <LoadingPanel title="التحديثات" />;
  return (
    <Panel title="التحديثات" description="مؤشرات صحة التحديثات والترحيلات ونقاط الاسترجاع.">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <Metric label="الحالة" value={<StatusBadge status={data.status} />} />
        <Metric label="الإصدار الحالي" value={data.current_version || "-"} />
        <Metric label="آخر تحديث" value={formatSystemDateTime(data.last_update_time) || "-"} />
        <Metric label="حالة آخر تحديث" value={statusLabels[data.last_update_status] || data.last_update_status || "-"} />
        <Metric label="آخر فحص بعد التحديث" value={formatSystemDateTime(data.last_post_update_health_check) || "-"} />
        <Metric label="ترحيلات معلقة" value={data.pending_migrations ?? 0} />
        <Metric label="نقطة استرجاع" value={data.rollback_point_exists ? "موجودة" : "غير موجودة"} />
      </div>
      {data.active_update_job ? (
        <AlertBox type="warning">
          توجد عملية تحديث نشطة: {data.active_update_job.message || data.active_update_job.status} - {data.active_update_job.progress ?? 0}%
        </AlertBox>
      ) : (
        <AlertBox type={data.status}>لا توجد عملية تحديث نشطة حالياً.</AlertBox>
      )}
    </Panel>
  );
}

function AlertsTab({ data, loading, busyAction, onResolve }) {
  if (loading || !data) return <LoadingPanel title="التنبيهات" />;
  return (
    <Panel title="التنبيهات" description="التنبيهات النشطة والمحلولة مع الإجراء المقترح لكل تنبيه.">
      <DataTable
        headers={["النوع", "الخطورة", "العنوان", "الرسالة", "الإجراء المقترح", "تاريخ الإنشاء", "الحالة", "الإجراءات"]}
        rows={(data || []).map((alert) => [
          alertTypeLabel(alert.alert_type),
          <StatusBadge status={alert.severity} />,
          alert.title,
          alert.message,
          alert.recommended_action || "-",
          formatSystemDateTime(alert.created_at),
          alert.is_resolved ? "محلول" : "نشط",
          <div className="flex flex-wrap gap-2">
            {!alert.is_resolved && (
              <Button
                type="button"
                onClick={() => onResolve(alert)}
                disabled={busyAction === `resolve-${alert.id}`}
                className="h-8 gap-2 px-3 text-xs"
              >
                <CheckCircle2 className="h-3.5 w-3.5" />
                تعليم كمحلول
              </Button>
            )}
            {alert.related_route && <LinkButton href={alert.related_route} small>فتح الشاشة المرتبطة</LinkButton>}
          </div>
        ])}
        empty="لا توجد تنبيهات."
      />
    </Panel>
  );
}

function SettingsTab({ data, loading, busyAction, onChange, onSave }) {
  if (loading || !data) return <LoadingPanel title="إعدادات مراقبة الصحة" />;
  return (
    <Panel title="إعدادات مراقبة الصحة" description="هذه الحدود تتحكم في تحويل المؤشرات إلى سليم أو تحذير أو حرج.">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        <NumberField label="حد تحذير مساحة التخزين" value={data.disk_warning_percent} suffix="%" onChange={(value) => onChange({ ...data, disk_warning_percent: value })} />
        <NumberField label="حد خطر مساحة التخزين" value={data.disk_critical_percent} suffix="%" onChange={(value) => onChange({ ...data, disk_critical_percent: value })} />
        <NumberField label="حد تحذير الأخطاء خلال 24 ساعة" value={data.errors_warning_count} onChange={(value) => onChange({ ...data, errors_warning_count: value })} />
        <NumberField label="حد خطر الأخطاء خلال 24 ساعة" value={data.errors_critical_count} onChange={(value) => onChange({ ...data, errors_critical_count: value })} />
        <NumberField label="حد تحذير بطء قاعدة البيانات" value={data.db_latency_warning_ms} suffix="ms" onChange={(value) => onChange({ ...data, db_latency_warning_ms: value })} />
        <NumberField label="حد خطر بطء قاعدة البيانات" value={data.db_latency_critical_ms} suffix="ms" onChange={(value) => onChange({ ...data, db_latency_critical_ms: value })} />
        <NumberField label="تكرار الفحص التلقائي بالدقائق" value={data.auto_check_interval_minutes} onChange={(value) => onChange({ ...data, auto_check_interval_minutes: value })} />
        <NumberField label="مدة الاحتفاظ بسجلات الفحص" value={data.retention_days} suffix="يوم" onChange={(value) => onChange({ ...data, retention_days: value })} />
        <ToggleCard label="تفعيل الفحص التلقائي" checked={data.auto_check_enabled} onChange={(checked) => onChange({ ...data, auto_check_enabled: checked })} />
      </div>
      <div className="flex justify-end">
        <Button type="button" onClick={onSave} disabled={busyAction === "settings"} className="gap-2">
          <Settings2 className="h-4 w-4" />
          حفظ الإعدادات
        </Button>
      </div>
    </Panel>
  );
}

function LoadingPanel({ title }) {
  return (
    <Panel title={title}>
      <Empty text="جاري تحميل البيانات..." />
    </Panel>
  );
}

function Panel({ title, description, children }) {
  return (
    <div className="space-y-4 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div>
        <h3 className="text-lg font-black text-slate-950">{title}</h3>
        {description && <p className="mt-1 text-sm leading-6 text-slate-500">{description}</p>}
      </div>
      {children}
    </div>
  );
}

function SummaryCard({ title, value, detail, status, icon: Icon }) {
  return (
    <div className={`rounded-lg border p-4 shadow-sm ${severityClasses[status] || severityClasses.info}`}>
      <div className="flex items-start justify-between gap-3">
        <div className={`flex h-10 w-10 items-center justify-center rounded-md ${cardIconClasses[status] || cardIconClasses.info}`}>
          <Icon className="h-5 w-5" />
        </div>
        <StatusIcon status={status} />
      </div>
      <p className="mt-4 text-sm font-bold opacity-80">{title}</p>
      <div className="mt-1 text-2xl font-black">{value}</div>
      {detail && <p className="mt-2 text-xs font-semibold leading-5 opacity-75">{detail}</p>}
    </div>
  );
}

function InfoCard({ title, value, icon: Icon, lines }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-bold text-slate-600">{title}</p>
          <div className="mt-2 text-lg font-black text-slate-950">{value}</div>
        </div>
        {Icon && (
          <div className="flex h-10 w-10 items-center justify-center rounded-md bg-bank-50 text-bank-700">
            <Icon className="h-5 w-5" />
          </div>
        )}
      </div>
      {lines?.length ? (
        <div className="mt-4 space-y-2">
          {lines.map(([label, lineValue]) => (
            <div key={label} className="flex items-start justify-between gap-3 text-sm">
              <span className="font-semibold text-slate-500">{label}</span>
              <span className="max-w-[65%] text-left font-bold text-slate-800">{lineValue || "-"}</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function Metric({ label, value }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
      <p className="text-sm font-bold text-slate-500">{label}</p>
      <div className="mt-2 text-lg font-black text-slate-950">{value ?? "-"}</div>
    </div>
  );
}

function NumberField({ label, value, suffix, onChange }) {
  return (
    <label className="block rounded-lg border border-slate-200 bg-slate-50 p-4">
      <span className="text-sm font-bold text-slate-700">{label}</span>
      <div className="mt-2 flex items-center gap-2">
        <input
          type="number"
          value={value ?? ""}
          onChange={(event) => onChange(Number(event.target.value))}
          className="h-11 min-w-0 flex-1 rounded-md border border-slate-300 bg-white px-3 text-sm font-bold text-slate-900"
        />
        {suffix && <span className="text-sm font-bold text-slate-500">{suffix}</span>}
      </div>
    </label>
  );
}

function ToggleCard({ label, checked, onChange }) {
  return (
    <label className={`flex min-h-[92px] cursor-pointer items-center justify-between gap-3 rounded-lg border p-4 ${checked ? "border-emerald-200 bg-emerald-50" : "border-slate-200 bg-slate-50"}`}>
      <span className="text-sm font-black text-slate-800">{label}</span>
      <input type="checkbox" checked={Boolean(checked)} onChange={(event) => onChange(event.target.checked)} className="h-5 w-5 accent-bank-700" />
    </label>
  );
}

function DataTable({ headers, rows, empty }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200">
      <table className="w-full min-w-[760px] text-sm">
        <thead className="bg-slate-50 text-xs font-black text-slate-600">
          <tr>
            {headers.map((header) => (
              <th key={header} className="p-3 text-right">{header}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 bg-white">
          {rows.length ? (
            rows.map((row, index) => (
              <tr key={index} className="hover:bg-slate-50">
                {row.map((cell, cellIndex) => (
                  <td key={cellIndex} className="p-3 align-top text-slate-700">{cell}</td>
                ))}
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={headers.length} className="p-6 text-center text-sm font-semibold text-slate-500">{empty}</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function StatusBadge({ status = "warning", children }) {
  return (
    <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-black ${severityClasses[status] || severityClasses.warning}`}>
      {children || statusLabels[status] || status}
    </span>
  );
}

function StatusIcon({ status }) {
  if (status === "healthy" || status === "success") return <CheckCircle2 className="h-5 w-5 text-emerald-700" />;
  if (status === "critical" || status === "failed" || status === "error") return <XCircle className="h-5 w-5 text-red-700" />;
  if (status === "warning") return <AlertTriangle className="h-5 w-5 text-amber-700" />;
  return <Activity className="h-5 w-5 text-blue-700" />;
}

function AlertBox({ type = "info", children }) {
  return (
    <div className={`rounded-lg border p-4 text-sm font-bold leading-6 ${severityClasses[type] || severityClasses.info}`}>
      {children}
    </div>
  );
}

function Empty({ text }) {
  return <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-8 text-center text-sm font-semibold text-slate-500">{text}</div>;
}

function Progress({ value }) {
  const safeValue = Math.max(0, Math.min(100, Number(value || 0)));
  return (
    <div className="min-w-[140px]">
      <div className="h-2 rounded-full bg-slate-200">
        <div className="h-2 rounded-full bg-bank-700" style={{ width: `${safeValue}%` }} />
      </div>
      <p className="mt-1 text-xs font-bold text-slate-500">{safeValue}%</p>
    </div>
  );
}

function LinkButton({ href, children, small = false }) {
  return (
    <a
      href={href}
      className={`inline-flex items-center justify-center gap-2 rounded-md border border-slate-300 bg-white font-bold text-slate-700 transition hover:bg-slate-50 ${
        small ? "h-8 px-3 text-xs" : "h-10 px-4 text-sm"
      }`}
    >
      {children}
      <ExternalLink className={small ? "h-3.5 w-3.5" : "h-4 w-4"} />
    </a>
  );
}

function LoginActionBadge({ action }) {
  const status = action === "login_success" || action === "logout" ? "healthy" : action === "login_failed" ? "warning" : "critical";
  return <StatusBadge status={statusLabels[action] ? status : "warning"}>{loginActionLabels[action] || action}</StatusBadge>;
}

function buildSummaryCards(summary) {
  if (!summary) return [];
  return [
    {
      key: "overall",
      title: "حالة النظام العامة",
      value: statusLabels[summary.status] || summary.status || "-",
      detail: `آخر فحص: ${formatSystemDateTime(summary.last_health_check_at) || "-"}`,
      status: summary.status || "warning",
      icon: Activity
    },
    {
      key: "backend",
      title: "حالة Backend",
      value: statusLabels[summary.backend?.status] || "-",
      detail: `زمن الاستجابة: ${formatMs(summary.backend?.latency_ms)}`,
      status: summary.backend?.status || "warning",
      icon: Server
    },
    {
      key: "database",
      title: "حالة قاعدة البيانات",
      value: statusLabels[summary.database?.status] || "-",
      detail: `زمن الاتصال: ${formatMs(summary.database?.latency_ms)}`,
      status: summary.database?.status || "warning",
      icon: Database
    },
    {
      key: "storage",
      title: "حالة التخزين",
      value: `${summary.storage?.disk_used_percent ?? "-"}%`,
      detail: `المرفقات: ${summary.storage?.attachments_count ?? 0}`,
      status: summary.storage?.status || "warning",
      icon: HardDrive
    },
    {
      key: "backup",
      title: "آخر نسخة احتياطية",
      value: summary.backup?.last_backup_at ? formatSystemDateTime(summary.backup.last_backup_at) : "لا توجد",
      detail: summary.backup?.message || "-",
      status: summary.backup?.status || "warning",
      icon: Archive
    },
    {
      key: "errors",
      title: "أخطاء آخر 24 ساعة",
      value: summary.errors_last_24h ?? 0,
      detail: summary.errors?.message || "-",
      status: summary.errors?.status || "healthy",
      icon: ShieldAlert
    },
    {
      key: "checks",
      title: "آخر فحص صحة",
      value: formatSystemDateTime(summary.last_health_check_at) || "-",
      detail: `الإصدار: ${summary.version || "-"}`,
      status: "info",
      icon: Clock
    },
    {
      key: "alerts",
      title: "تنبيهات نشطة",
      value: summary.active_alerts_count ?? 0,
      detail: "تنبيهات تحتاج متابعة",
      status: summary.active_alerts_count ? "warning" : "healthy",
      icon: Bell
    }
  ];
}

function formatMs(value) {
  return value === null || value === undefined ? "-" : `${value} ms`;
}

function formatBytes(value) {
  if (!value) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = Number(value);
  let index = 0;
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index += 1;
  }
  return index === 0 ? `${size} ${units[index]}` : `${size.toFixed(1)} ${units[index]}`;
}

function checkLabel(value) {
  return {
    backend: "الخادم الخلفي",
    database: "قاعدة البيانات",
    storage: "التخزين",
    backups: "النسخ الاحتياطية",
    backup: "النسخ الاحتياطي",
    errors: "الأخطاء",
    jobs: "المهام",
    updates: "التحديثات"
  }[value] || value || "-";
}

function categoryLabel(value) {
  return {
    backend: "الخدمات الداخلية",
    database: "قاعدة البيانات",
    storage: "التخزين",
    backups: "النسخ الاحتياطية",
    errors: "الأخطاء والسجلات",
    jobs: "العمليات والمهام",
    updates: "التحديثات"
  }[value] || value || "-";
}

function serviceLabel(code, fallback) {
  return {
    backend: "Backend API",
    frontend: "Frontend",
    database: "اتصال قاعدة البيانات",
    uploads: "مجلد الرفع",
    backups: "مجلد النسخ الاحتياطية"
  }[code] || fallback || code;
}

function serviceIcon(code) {
  return {
    backend: Server,
    frontend: FileText,
    database: Database,
    uploads: UploadCloud,
    backups: Archive
  }[code] || Server;
}

function jobTypeLabel(value) {
  return {
    backup: "نسخ احتياطي",
    restore: "استعادة",
    reset: "إعادة ضبط",
    maintenance: "صيانة",
    migration: "ترحيل",
    user_import: "استيراد مستخدمين",
    update: "تحديث",
    rollback: "استرجاع"
  }[value] || value || "-";
}

function alertTypeLabel(value) {
  return {
    database: "قاعدة البيانات",
    storage: "التخزين",
    backups: "النسخ الاحتياطية",
    errors: "الأخطاء",
    updates: "التحديثات"
  }[value] || value || "-";
}
