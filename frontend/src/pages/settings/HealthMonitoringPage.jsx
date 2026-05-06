import { useEffect, useMemo, useState } from "react";
import { Activity, AlertTriangle, CheckCircle2, Clock, Database, HardDrive, LogIn, RefreshCw, Server, Trash2, XCircle } from "lucide-react";
import { api, getErrorMessage } from "../../lib/axios";
import { formatSystemDateTime } from "../../lib/datetime";
import { Card } from "../../components/ui/card";
import { Button } from "../../components/ui/button";
import { Pagination } from "../../components/ui/Pagination";

const statusLabels = {
  healthy: "سليم",
  warning: "تحذير",
  critical: "حرج"
};

const checkLabels = {
  backend: "الخادم الخلفي",
  database: "قاعدة البيانات",
  storage: "التخزين",
  backup: "النسخ الاحتياطي",
  errors: "الأخطاء"
};

const severityClasses = {
  healthy: "border-emerald-200 bg-emerald-50 text-emerald-800",
  warning: "border-amber-200 bg-amber-50 text-amber-800",
  critical: "border-red-200 bg-red-50 text-red-800"
};

const iconClasses = {
  healthy: "bg-emerald-100 text-emerald-700",
  warning: "bg-amber-100 text-amber-700",
  critical: "bg-red-100 text-red-700"
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
  const [summary, setSummary] = useState(null);
  const [loginActivity, setLoginActivity] = useState([]);
  const [loginActivityError, setLoginActivityError] = useState("");
  const [loginActivityPage, setLoginActivityPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [clearingLogs, setClearingLogs] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function load() {
    setError("");
    setNotice("");
    setLoginActivityError("");
    setLoading(true);
    try {
      const { data } = await api.get("/health/summary");
      setSummary(data);
      try {
        const activity = await api.get("/audit-logs/login-activity?limit=300");
        setLoginActivity(activity.data || []);
        setLoginActivityPage(1);
      } catch (error) {
        setLoginActivity([]);
        setLoginActivityError(getErrorMessage(error));
      }
    } catch (error) {
      setError(getErrorMessage(error));
    } finally {
      setLoading(false);
    }
  }

  async function runChecks() {
    setError("");
    setNotice("");
    setRunning(true);
    try {
      const { data } = await api.post("/health/run-checks");
      setSummary(data);
    } catch (error) {
      setError(getErrorMessage(error));
    } finally {
      setRunning(false);
    }
  }

  async function clearLogs() {
    if (!window.confirm("هل تريد محو السجلات المعروضة؟")) return;
    setError("");
    setNotice("");
    setClearingLogs(true);
    try {
      const { data } = await api.post("/health/clear-logs");
      setSummary(data);
      setNotice("تم محو السجلات بنجاح.");
    } catch (error) {
      setError(getErrorMessage(error));
    } finally {
      setClearingLogs(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const cards = useMemo(() => {
    if (!summary) return [];
    return [
      {
        key: "backend",
        title: "Backend",
        icon: Server,
        status: summary.backend?.status,
        lines: [
          ["زمن الاستجابة", formatMs(summary.backend?.latency_ms)],
          ["الحالة", summary.backend?.message || "-"]
        ]
      },
      {
        key: "database",
        title: "Database",
        icon: Database,
        status: summary.database?.status,
        lines: [
          ["زمن الاتصال", formatMs(summary.database?.latency_ms)],
          ["الحالة", summary.database?.message || "-"]
        ]
      },
      {
        key: "storage",
        title: "Storage",
        icon: HardDrive,
        status: summary.storage?.status,
        lines: [
          ["استخدام القرص", formatPercent(summary.storage?.disk_used_percent)],
          ["حجم المرفقات", summary.storage?.attachments_size_label || "0 B"]
        ]
      },
      {
        key: "backup",
        title: "Backup",
        icon: Clock,
        status: summary.backup?.status,
        lines: [
          ["آخر نسخة", summary.backup?.last_backup_at ? formatSystemDateTime(summary.backup.last_backup_at) : "لا توجد نسخة"],
          ["الحالة", summary.backup?.message || "-"]
        ]
      },
      {
        key: "errors",
        title: "Errors",
        icon: AlertTriangle,
        status: summary.errors?.status || (summary.errors_last_24h > 10 ? "warning" : "healthy"),
        lines: [
          ["آخر 24 ساعة", String(summary.errors_last_24h ?? 0)],
          ["الحالة", summary.errors?.message || "عدد الأخطاء خلال آخر 24 ساعة"]
        ]
      }
    ];
  }, [summary]);

  const paginatedLoginActivity = useMemo(() => {
    const start = (loginActivityPage - 1) * loginActivityPageSize;
    return loginActivity.slice(start, start + loginActivityPageSize);
  }, [loginActivity, loginActivityPage]);

  useEffect(() => {
    const totalPages = Math.max(1, Math.ceil(loginActivity.length / loginActivityPageSize));
    if (loginActivityPage > totalPages) setLoginActivityPage(totalPages);
  }, [loginActivity.length, loginActivityPage]);

  return (
    <section className="space-y-6 text-right" dir="rtl">
      <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-sm font-semibold text-bank-700">الإعدادات</p>
            <h2 className="mt-2 text-2xl font-bold text-slate-950">مراقبة صحة النظام</h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
              متابعة حالة الخادم وقاعدة البيانات والتخزين والنسخ الاحتياطي والسجلات من داخل النظام فقط.
            </p>
          </div>
          <Button type="button" onClick={runChecks} disabled={running || loading} className="gap-2 self-start">
            <RefreshCw className={`h-4 w-4 ${running ? "animate-spin" : ""}`} />
            {running ? "جاري الفحص..." : "إعادة الفحص الآن"}
          </Button>
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700">
          {error}
        </div>
      )}
      {notice && (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 p-4 text-sm font-semibold text-emerald-800">
          {notice}
        </div>
      )}

      {loading ? (
        <div className="rounded-lg border border-slate-200 bg-white p-8 text-center text-sm text-slate-600">جاري تحميل بيانات صحة النظام...</div>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
            {cards.map((card) => (
              <HealthCard key={card.key} {...card} />
            ))}
          </div>

          <div className="grid gap-5 xl:grid-cols-[1.2fr_.8fr]">
            <Card className="overflow-hidden">
              <div className="border-b border-slate-200 p-4">
                <h3 className="font-bold text-slate-950">آخر الفحوصات</h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] text-sm">
                  <thead className="bg-slate-50">
                    <tr>
                      <th className="p-3 text-right">الفحص</th>
                      <th className="p-3 text-right">الحالة</th>
                      <th className="p-3 text-right">زمن الاستجابة</th>
                      <th className="p-3 text-right">الرسالة</th>
                      <th className="p-3 text-right">وقت الفحص</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {(summary?.recent_checks || []).map((check) => (
                      <tr key={check.id} className="hover:bg-slate-50">
                        <td className="p-3 font-semibold">{checkLabels[check.check_name] || check.check_name}</td>
                        <td className="p-3"><StatusBadge status={check.status} /></td>
                        <td className="p-3">{formatMs(check.latency_ms)}</td>
                        <td className="p-3">{check.message || "-"}</td>
                        <td className="p-3">{formatSystemDateTime(check.checked_at)}</td>
                      </tr>
                    ))}
                    {!summary?.recent_checks?.length && (
                      <tr><td colSpan="5" className="p-6 text-center text-slate-500">لا توجد فحوصات مسجلة.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </Card>

            <Card className="overflow-hidden">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 p-4">
                <h3 className="font-bold text-slate-950">السجلات</h3>
                <button
                  type="button"
                  onClick={clearLogs}
                  disabled={clearingLogs || loading}
                  className="inline-flex h-9 items-center gap-2 rounded-md border border-red-200 px-3 text-xs font-bold text-red-700 transition hover:bg-red-50 disabled:opacity-60"
                >
                  <Trash2 className="h-4 w-4" />
                  {clearingLogs ? "جاري المحو..." : "محو السجلات"}
                </button>
              </div>
              <div className="divide-y divide-slate-100">
                {(summary?.system_logs || []).map((log) => (
                  <div key={log.id} className="p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <StatusBadge status={log.severity} />
                      <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-600">{log.source}</span>
                    </div>
                    <p className="mt-3 whitespace-pre-wrap break-words text-sm font-semibold leading-6 text-slate-900">{log.message}</p>
                    <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-500">
                      <span>الوقت: {formatSystemDateTime(log.occurred_at)}</span>
                      <span>المرجع: {log.reference || "-"}</span>
                    </div>
                  </div>
                ))}
                {!summary?.system_logs?.length && (
                  <div className="p-6 text-center text-sm text-slate-500">لا توجد أخطاء مسجلة حالياً.</div>
                )}
              </div>
            </Card>
          </div>

          <Card className="overflow-hidden">
            <div className="flex flex-col gap-2 border-b border-slate-200 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h3 className="font-bold text-slate-950">سجل دخول المستخدمين</h3>
                <p className="mt-1 text-sm text-slate-500">آخر محاولات الدخول الناجحة والفاشلة مع عنوان الشبكة والمتصفح.</p>
              </div>
              <div className="rounded-md bg-bank-50 p-2 text-bank-700">
                <LogIn className="h-5 w-5" />
              </div>
            </div>
            <div className="overflow-x-auto">
              {loginActivityError && (
                <div className="border-b border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-800">
                  تعذر تحميل سجل الدخول: {loginActivityError}
                </div>
              )}
              <table className="w-full min-w-[920px] text-sm">
                <thead className="bg-slate-50 text-xs font-bold text-slate-600">
                  <tr>
                    <th className="p-3 text-right">النتيجة</th>
                    <th className="p-3 text-right">المستخدم</th>
                    <th className="p-3 text-right">المعرّف المستخدم</th>
                    <th className="p-3 text-right">IP</th>
                    <th className="p-3 text-right">المحاولات</th>
                    <th className="p-3 text-right">المتصفح</th>
                    <th className="p-3 text-right">الوقت</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {paginatedLoginActivity.map((log) => (
                    <tr key={log.id} className="hover:bg-slate-50">
                      <td className="p-3"><LoginActionBadge action={log.action} /></td>
                      <td className="p-3">
                        <p className="font-bold text-slate-950">{log.actor_name || "-"}</p>
                        <p className="mt-1 text-xs text-slate-500">{log.actor_email || ""}</p>
                      </td>
                      <td className="p-3 text-slate-700">{log.identifier || "-"}</td>
                      <td className="p-3 text-slate-700">{log.ip_address || "-"}</td>
                      <td className="p-3 text-slate-700">{log.failed_login_attempts ?? "-"}</td>
                      <td className="max-w-[260px] truncate p-3 text-xs text-slate-500" title={log.user_agent || ""}>{log.user_agent || "-"}</td>
                      <td className="p-3 text-slate-600">{formatSystemDateTime(log.created_at)}</td>
                    </tr>
                  ))}
                  {!loginActivity.length && (
                    <tr><td colSpan="7" className="p-6 text-center text-slate-500">لا توجد محاولات دخول مسجلة.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
            <Pagination
              page={loginActivityPage}
              totalItems={loginActivity.length}
              pageSize={loginActivityPageSize}
              onPageChange={setLoginActivityPage}
            />
          </Card>
        </>
      )}
    </section>
  );
}

function HealthCard({ title, icon: Icon, status = "warning", lines }) {
  return (
    <Card className={`border p-4 ${severityClasses[status] || severityClasses.warning}`}>
      <div className="flex items-start justify-between gap-3">
        <div className={`flex h-10 w-10 items-center justify-center rounded-md ${iconClasses[status] || iconClasses.warning}`}>
          <Icon className="h-5 w-5" />
        </div>
        <StatusIcon status={status} />
      </div>
      <h3 className="mt-4 text-lg font-black">{title}</h3>
      <div className="mt-3 space-y-2">
        {lines.map(([label, value]) => (
          <div key={label} className="flex items-start justify-between gap-3 text-sm">
            <span className="font-semibold opacity-80">{label}</span>
            <span className="text-left font-bold">{value}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}

function StatusBadge({ status = "warning" }) {
  return (
    <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-bold ${severityClasses[status] || severityClasses.warning}`}>
      {statusLabels[status] || status}
    </span>
  );
}

function StatusIcon({ status }) {
  if (status === "healthy") return <CheckCircle2 className="h-5 w-5 text-emerald-700" />;
  if (status === "critical") return <XCircle className="h-5 w-5 text-red-700" />;
  return <Activity className="h-5 w-5 text-amber-700" />;
}

function LoginActionBadge({ action }) {
  const isSuccess = action === "login_success" || action === "logout";
  const className = isSuccess ? severityClasses.healthy : action === "login_failed" ? severityClasses.warning : severityClasses.critical;
  return (
    <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-bold ${className}`}>
      {loginActionLabels[action] || action}
    </span>
  );
}

function formatMs(value) {
  return value === null || value === undefined ? "-" : `${value} ms`;
}

function formatPercent(value) {
  return value === null || value === undefined ? "-" : `${value}%`;
}
