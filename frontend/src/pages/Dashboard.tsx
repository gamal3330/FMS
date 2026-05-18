import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  BarChart3,
  Building2,
  CheckCircle2,
  Clock3,
  FileClock,
  GripVertical,
  Inbox,
  LayoutGrid,
  MailCheck,
  MessageSquareText,
  RefreshCw,
  Save,
  Send,
  SlidersHorizontal,
  Trash2,
  TrendingUp,
  UserCheck2
} from "lucide-react";
import { apiFetch } from "../lib/api";
import { formatSystemDateTime } from "../lib/datetime";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";

type WidgetSize = "small" | "medium" | "large";
type IconComponent = typeof FileClock;

interface ItStaffStat {
  user_id: number;
  full_name_ar: string;
  email: string;
  department?: string | null;
  processed_requests: number;
  processed_steps: number;
  closed_requests: number;
  last_action_at?: string | null;
}

interface DashboardMessage {
  id: number;
  message_uid?: string | null;
  subject: string;
  message_type_label: string;
  sender_name: string;
  is_read: boolean;
  created_at?: string | null;
}

interface Stats {
  open_requests: number;
  pending_approvals: number;
  completed_requests: number;
  delayed_requests: number;
  monthly_statistics: { month: string; count: number }[];
  requests_by_department: { department: string; count: number }[];
  requests_by_status: { status: string; label: string; count: number }[];
  requests_by_type: { type: string; label: string; count: number }[];
  messages: {
    unread: number;
    inbox_total: number;
    sent_total: number;
    drafts: number;
    linked_messages: number;
    by_type: { type: string; label: string; count: number }[];
    recent: DashboardMessage[];
  };
  recent_requests: { id: number; request_number: string; title: string; status_label: string; requester_name: string; updated_at?: string | null }[];
  attention_items: { tone: string; title: string; description: string }[];
  can_view_it_staff_statistics: boolean;
  it_staff_statistics: ItStaffStat[];
}

interface DashboardWidget {
  code: string;
  title: string;
  description: string;
  type: string;
  icon?: string;
  enabled: boolean;
  sort_order: number;
  size: WidgetSize;
  default_size?: WidgetSize;
}

interface WidgetLayoutResponse {
  widgets: DashboardWidget[];
}

const fallbackStats: Stats = {
  open_requests: 0,
  pending_approvals: 0,
  completed_requests: 0,
  delayed_requests: 0,
  monthly_statistics: [],
  requests_by_department: [],
  requests_by_status: [],
  requests_by_type: [],
  messages: { unread: 0, inbox_total: 0, sent_total: 0, drafts: 0, linked_messages: 0, by_type: [], recent: [] },
  recent_requests: [],
  attention_items: [],
  can_view_it_staff_statistics: false,
  it_staff_statistics: []
};

const defaultWidgetCodes = new Set([
  "open_requests",
  "pending_approvals",
  "completed_requests",
  "message_summary",
  "attention_items",
  "requests_by_status",
  "requests_by_type",
  "recent_messages",
  "recent_requests",
  "monthly_statistics",
  "requests_by_department"
]);

const clientWidgetCatalog: DashboardWidget[] = [
  { code: "open_requests", title: "الطلبات المفتوحة", description: "طلبات قيد المعالجة ضمن نطاق صلاحياتك.", type: "metric", enabled: true, sort_order: 10, size: "small", default_size: "small" },
  { code: "pending_approvals", title: "بانتظار الموافقة", description: "خطوات اعتماد معلقة تحتاج إجراء.", type: "metric", enabled: true, sort_order: 20, size: "small", default_size: "small" },
  { code: "completed_requests", title: "طلبات مكتملة", description: "طلبات تم إغلاقها أو إكمالها.", type: "metric", enabled: true, sort_order: 30, size: "small", default_size: "small" },
  { code: "delayed_requests", title: "طلبات متأخرة", description: "طلبات تجاوزت وقت الإنجاز المتوقع.", type: "metric", enabled: false, sort_order: 40, size: "small", default_size: "small" },
  { code: "message_summary", title: "ملخص المراسلات", description: "الوارد والمرسل والمسودات والرسائل المرتبطة بالطلبات.", type: "summary", enabled: true, sort_order: 50, size: "large", default_size: "large" },
  { code: "attention_items", title: "تحتاج انتباهك", description: "أهم المؤشرات والتنبيهات الحالية.", type: "list", enabled: true, sort_order: 60, size: "medium", default_size: "medium" },
  { code: "requests_by_status", title: "الطلبات حسب الحالة", description: "توزيع الطلبات حسب حالتها الحالية.", type: "chart", enabled: true, sort_order: 70, size: "medium", default_size: "medium" },
  { code: "requests_by_type", title: "أنواع الطلبات الأكثر استخداماً", description: "أعلى أنواع الطلبات إنشاءً.", type: "chart", enabled: true, sort_order: 80, size: "medium", default_size: "medium" },
  { code: "recent_messages", title: "آخر الرسائل الواردة", description: "آخر رسائل وصلت للمستخدم الحالي.", type: "list", enabled: true, sort_order: 90, size: "medium", default_size: "medium" },
  { code: "recent_requests", title: "آخر نشاطات الطلبات", description: "آخر الطلبات التي تم تحديثها.", type: "list", enabled: true, sort_order: 100, size: "medium", default_size: "medium" },
  { code: "monthly_statistics", title: "الإحصائيات الشهرية", description: "حركة إنشاء الطلبات حسب الشهر.", type: "chart", enabled: true, sort_order: 110, size: "medium", default_size: "medium" },
  { code: "requests_by_department", title: "الطلبات حسب الإدارة", description: "توزيع الطلبات حسب الإدارات.", type: "chart", enabled: true, sort_order: 120, size: "medium", default_size: "medium" },
  { code: "messages_by_type", title: "تصنيفات المراسلات", description: "توزيع الرسائل حسب التصنيف.", type: "chart", enabled: false, sort_order: 130, size: "medium", default_size: "medium" },
  { code: "it_staff_statistics", title: "إحصائية معالجة الطلبات", description: "أداء معالجة وتنفيذ الطلبات حسب الموظف.", type: "table", enabled: false, sort_order: 140, size: "large", default_size: "large" }
];

const widgetIcons: Record<string, IconComponent> = {
  open_requests: FileClock,
  pending_approvals: Clock3,
  completed_requests: CheckCircle2,
  delayed_requests: AlertTriangle,
  message_summary: MessageSquareText,
  attention_items: AlertTriangle,
  requests_by_status: BarChart3,
  requests_by_type: TrendingUp,
  recent_messages: Inbox,
  recent_requests: FileClock,
  monthly_statistics: BarChart3,
  requests_by_department: Building2,
  messages_by_type: MessageSquareText,
  it_staff_statistics: UserCheck2
};

const widgetSizeLabels: Record<WidgetSize, string> = {
  small: "صغير",
  medium: "متوسط",
  large: "عريض"
};

const iconButtonClass =
  "inline-flex h-8 w-8 items-center justify-center rounded-md text-slate-600 transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-40 dark:text-slate-300 dark:hover:bg-emerald-950/40";

const metricMeta: Record<string, { detail: string; tone: string; value: (stats: Stats) => number }> = {
  open_requests: { detail: "طلبات قيد المعالجة", tone: "bg-emerald-50 text-bank-700 dark:bg-emerald-950/40 dark:text-emerald-200", value: (stats) => stats.open_requests },
  pending_approvals: { detail: "خطوات اعتماد معلقة", tone: "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-200", value: (stats) => stats.pending_approvals },
  completed_requests: { detail: "طلبات مغلقة بنجاح", tone: "bg-sky-50 text-sky-700 dark:bg-sky-950/40 dark:text-sky-200", value: (stats) => stats.completed_requests },
  delayed_requests: { detail: "تجاوزت وقت الإنجاز المتوقع", tone: "bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-200", value: (stats) => stats.delayed_requests }
};

const messageCards = [
  { label: "غير مقروءة", key: "unread", icon: Inbox, tone: "bg-bank-50 text-bank-700 dark:bg-bank-950/40 dark:text-bank-200" },
  { label: "الوارد", key: "inbox_total", icon: MessageSquareText, tone: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200" },
  { label: "المرسل", key: "sent_total", icon: Send, tone: "bg-indigo-50 text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-200" },
  { label: "مسودات", key: "drafts", icon: MailCheck, tone: "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-200" }
] as const;

export function Dashboard() {
  const [stats, setStats] = useState<Stats>(fallbackStats);
  const [widgets, setWidgets] = useState<DashboardWidget[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSavingLayout, setIsSavingLayout] = useState(false);
  const [isCustomizeMode, setIsCustomizeMode] = useState(false);
  const [lastLoadedAt, setLastLoadedAt] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [layoutMessage, setLayoutMessage] = useState("");

  async function loadDashboard() {
    setIsLoading(true);
    setError("");
    setLayoutMessage("");
    try {
      const statsData = normalizeStats(await apiFetch<Stats>("/dashboard/stats"));
      setStats(statsData);
      try {
        const layoutData = await apiFetch<WidgetLayoutResponse>("/dashboard/widgets/me");
        setWidgets(normalizeWidgets(layoutData.widgets));
      } catch {
        setWidgets(buildClientFallbackWidgets(statsData));
      }
      setLastLoadedAt(new Date().toISOString());
    } catch {
      setStats(fallbackStats);
      setWidgets(buildClientFallbackWidgets(fallbackStats));
      setError("تعذر تحميل بيانات الإحصائيات من الخادم.");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    loadDashboard();
  }, []);

  const totalMonthly = useMemo(() => stats.monthly_statistics.reduce((total, item) => total + item.count, 0), [stats.monthly_statistics]);
  const maxDepartmentCount = Math.max(1, ...stats.requests_by_department.map((item) => item.count));
  const maxMonthlyCount = Math.max(1, ...stats.monthly_statistics.map((item) => item.count));
  const maxStatusCount = Math.max(1, ...stats.requests_by_status.map((item) => item.count));
  const maxTypeCount = Math.max(1, ...stats.requests_by_type.map((item) => item.count));
  const maxMessageTypeCount = Math.max(1, ...stats.messages.by_type.map((item) => item.count));
  const maxStaffProcessed = Math.max(1, ...stats.it_staff_statistics.map((item) => item.processed_requests));
  const totalStaffProcessed = stats.it_staff_statistics.reduce((total, item) => total + item.processed_requests, 0);
  const enabledWidgets = useMemo(
    () => widgets.filter((widget) => widget.enabled).sort((a, b) => a.sort_order - b.sort_order),
    [widgets]
  );

  async function saveWidgets(nextWidgets: DashboardWidget[], successMessage = "تم حفظ تخطيط لوحة القيادة.") {
    const previous = widgets;
    setWidgets(nextWidgets);
    setIsSavingLayout(true);
    setLayoutMessage("");
    try {
      const response = await apiFetch<WidgetLayoutResponse>("/dashboard/widgets/me/layout", {
        method: "PUT",
        body: JSON.stringify({
          widgets: nextWidgets.map((widget) => ({
            code: widget.code,
            enabled: widget.enabled,
            sort_order: widget.sort_order,
            size: widget.size
          }))
        })
      });
      setWidgets(normalizeWidgets(response.widgets));
      setLayoutMessage(successMessage);
    } catch {
      setWidgets(previous);
      setError("تعذر حفظ تخطيط لوحة القيادة.");
    } finally {
      setIsSavingLayout(false);
    }
  }

  function addWidget(code: string) {
    const maxOrder = Math.max(0, ...widgets.filter((widget) => widget.enabled).map((widget) => widget.sort_order));
    const next = widgets.map((widget) =>
      widget.code === code ? { ...widget, enabled: true, sort_order: maxOrder + 10, size: widget.size || widget.default_size || "medium" } : widget
    );
    void saveWidgets(next, "تمت إضافة الـ Widget.");
  }

  function hideWidget(code: string) {
    const next = widgets.map((widget) => (widget.code === code ? { ...widget, enabled: false } : widget));
    void saveWidgets(next, "تم إخفاء الـ Widget.");
  }

  function changeWidgetSize(code: string, size: WidgetSize) {
    const next = widgets.map((widget) => (widget.code === code ? { ...widget, size } : widget));
    void saveWidgets(next, "تم تحديث حجم الـ Widget.");
  }

  function moveWidget(code: string, direction: -1 | 1) {
    const ordered = [...enabledWidgets];
    const index = ordered.findIndex((widget) => widget.code === code);
    const targetIndex = index + direction;
    if (index < 0 || targetIndex < 0 || targetIndex >= ordered.length) {
      return;
    }
    [ordered[index], ordered[targetIndex]] = [ordered[targetIndex], ordered[index]];
    const orderMap = new Map(ordered.map((widget, itemIndex) => [widget.code, (itemIndex + 1) * 10]));
    const next = widgets.map((widget) => ({
      ...widget,
      sort_order: orderMap.get(widget.code) ?? widget.sort_order
    }));
    void saveWidgets(next, "تم تحديث ترتيب Widgets.");
  }

  function resetLayout() {
    const next = widgets.map((widget, index) => ({
      ...widget,
      enabled: defaultWidgetCodes.has(widget.code),
      size: widget.default_size ?? widget.size,
      sort_order: (index + 1) * 10
    }));
    void saveWidgets(next, "تمت إعادة التخطيط الافتراضي.");
  }

  function renderWidget(widget: DashboardWidget, index: number) {
    const commonProps = {
      widget,
      index,
      total: enabledWidgets.length,
      isCustomizeMode,
      onHide: hideWidget,
      onMove: moveWidget,
      onSizeChange: changeWidgetSize
    };

    if (metricMeta[widget.code]) {
      const meta = metricMeta[widget.code];
      return (
        <WidgetShell key={widget.code} {...commonProps}>
          <MetricContent
            label={widget.title}
            value={meta.value(stats)}
            detail={meta.detail}
            icon={widgetIcons[widget.code] || FileClock}
            tone={meta.tone}
          />
        </WidgetShell>
      );
    }

    switch (widget.code) {
      case "message_summary":
        return (
          <WidgetShell key={widget.code} {...commonProps}>
            <div className={`grid gap-3 ${widget.size === "large" ? "sm:grid-cols-2 2xl:grid-cols-4" : "grid-cols-2"}`}>
              {messageCards.map(({ label, key, icon: Icon, tone }) => (
                <div key={key} className="min-h-[132px] rounded-lg border border-slate-200 bg-slate-50 p-4 shadow-sm dark:border-emerald-900/40 dark:bg-[#0c1914]">
                  <div className={`mb-3 inline-flex rounded-md p-2 ${tone}`}>
                    <Icon className="h-5 w-5" />
                  </div>
                  <p className="text-xs font-semibold leading-5 text-slate-500 dark:text-slate-400">{label}</p>
                  <p className="mt-2 text-2xl font-black text-slate-950 dark:text-slate-50">{stats.messages[key]}</p>
                </div>
              ))}
            </div>
            <div className="mt-5 rounded-lg border border-bank-100 bg-bank-50/60 p-4 dark:border-bank-900/40 dark:bg-bank-950/20">
              <p className="text-sm font-bold text-bank-800 dark:text-bank-200">رسائل مرتبطة بطلبات: {stats.messages.linked_messages}</p>
              <p className="mt-1 text-xs leading-5 text-slate-600 dark:text-slate-400">مؤشر سريع على حجم التواصل المرتبط بسير الطلبات.</p>
            </div>
          </WidgetShell>
        );
      case "attention_items":
        return (
          <WidgetShell key={widget.code} {...commonProps}>
            <div className="space-y-3">
              {stats.attention_items.length === 0 && <EmptyState text="لا توجد مؤشرات حرجة حالياً." />}
              {stats.attention_items.map((item, itemIndex) => (
                <div key={`${item.title}-${itemIndex}`} className={`rounded-lg border p-4 ${attentionTone(item.tone)}`}>
                  <p className="font-bold">{item.title}</p>
                  <p className="mt-1 text-sm leading-6 opacity-80">{item.description}</p>
                </div>
              ))}
            </div>
          </WidgetShell>
        );
      case "requests_by_status":
        return (
          <WidgetShell key={widget.code} {...commonProps}>
            <ProgressList emptyText="لا توجد بيانات حالات بعد." rows={stats.requests_by_status.map((row) => ({ key: row.status, label: row.label, value: row.count }))} max={maxStatusCount} />
          </WidgetShell>
        );
      case "requests_by_type":
        return (
          <WidgetShell key={widget.code} {...commonProps}>
            <ProgressList emptyText="لا توجد بيانات أنواع بعد." rows={stats.requests_by_type.map((row) => ({ key: row.type, label: row.label, value: row.count }))} max={maxTypeCount} />
          </WidgetShell>
        );
      case "recent_messages":
        return (
          <WidgetShell key={widget.code} {...commonProps}>
            <div className="divide-y divide-slate-100 overflow-hidden rounded-lg border border-slate-200 dark:divide-emerald-950 dark:border-emerald-900/40">
              {stats.messages.recent.length === 0 && <EmptyState text="لا توجد رسائل واردة بعد." />}
              {stats.messages.recent.map((message) => (
                <div key={message.id} className={`p-4 ${message.is_read ? "bg-white dark:bg-transparent" : "bg-bank-50/50 dark:bg-bank-950/20"}`}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-black text-slate-950 dark:text-slate-50">{message.subject}</p>
                    <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-600 dark:bg-slate-800 dark:text-slate-300">{message.message_type_label}</span>
                  </div>
                  <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">من: {message.sender_name}</p>
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{message.message_uid || ""} · {formatDate(message.created_at)}</p>
                </div>
              ))}
            </div>
          </WidgetShell>
        );
      case "recent_requests":
        return (
          <WidgetShell key={widget.code} {...commonProps}>
            <div className="divide-y divide-slate-100 overflow-hidden rounded-lg border border-slate-200 dark:divide-emerald-950 dark:border-emerald-900/40">
              {stats.recent_requests.length === 0 && <EmptyState text="لا توجد نشاطات طلبات بعد." />}
              {stats.recent_requests.map((request) => (
                <div key={request.id} className="p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-black text-slate-950 dark:text-slate-50">{request.title || request.request_number}</p>
                    <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-600 dark:bg-slate-800 dark:text-slate-300">{request.status_label}</span>
                  </div>
                  <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">{request.request_number} · {request.requester_name}</p>
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{formatDate(request.updated_at)}</p>
                </div>
              ))}
            </div>
          </WidgetShell>
        );
      case "monthly_statistics":
        return (
          <WidgetShell key={widget.code} {...commonProps} subtitle={`إجمالي الطلبات خلال الفترة: ${totalMonthly}`}>
            <ProgressList emptyText="لا توجد بيانات شهرية بعد." rows={stats.monthly_statistics.map((row) => ({ key: row.month, label: row.month, value: row.count }))} max={maxMonthlyCount} />
          </WidgetShell>
        );
      case "requests_by_department":
        return (
          <WidgetShell key={widget.code} {...commonProps}>
            <ProgressList emptyText="لا توجد بيانات إدارات بعد." rows={stats.requests_by_department.map((row) => ({ key: row.department, label: row.department, value: row.count }))} max={maxDepartmentCount} />
          </WidgetShell>
        );
      case "messages_by_type":
        return (
          <WidgetShell key={widget.code} {...commonProps}>
            <ProgressList emptyText="لا توجد بيانات تصنيفات بعد." rows={stats.messages.by_type.map((row) => ({ key: row.type, label: row.label, value: row.count }))} max={maxMessageTypeCount} />
          </WidgetShell>
        );
      case "it_staff_statistics":
        return (
          <WidgetShell key={widget.code} {...commonProps} subtitle={`إجمالي الطلبات المعالجة: ${totalStaffProcessed}`}>
            {stats.it_staff_statistics.length === 0 ? (
              <EmptyState text="لا توجد طلبات تمت معالجتها حتى الآن." />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[860px] text-sm">
                  <thead className="bg-slate-50 text-xs font-bold text-slate-500 dark:bg-[#0c1914] dark:text-slate-400">
                    <tr>
                      {["الموظف", "الإدارة", "طلبات معالجة", "خطوات تنفيذ", "طلبات مغلقة", "آخر معالجة", "المؤشر"].map((header) => (
                        <th key={header} className="p-3 text-right">{header}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-emerald-950">
                    {stats.it_staff_statistics.map((staff) => (
                      <tr key={staff.user_id} className="hover:bg-slate-50/80 dark:hover:bg-emerald-950/20">
                        <td className="p-3">
                          <p className="font-bold text-slate-950 dark:text-slate-50">{staff.full_name_ar}</p>
                          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{staff.email}</p>
                        </td>
                        <td className="p-3 text-slate-600 dark:text-slate-300">{staff.department || "-"}</td>
                        <td className="p-3 font-bold text-bank-700 dark:text-bank-200">{staff.processed_requests}</td>
                        <td className="p-3 text-slate-700 dark:text-slate-300">{staff.processed_steps}</td>
                        <td className="p-3 text-slate-700 dark:text-slate-300">{staff.closed_requests}</td>
                        <td className="p-3 text-slate-500 dark:text-slate-400">{formatDate(staff.last_action_at)}</td>
                        <td className="p-3"><ProgressBar value={staff.processed_requests} max={maxStaffProcessed} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </WidgetShell>
        );
      default:
        return null;
    }
  }

  return (
    <div className="space-y-6">
      <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm dark:border-emerald-900/40 dark:bg-[#0d1915]">
        <div className="border-b border-slate-100 bg-slate-50/80 px-5 py-4 dark:border-emerald-950/60 dark:bg-[#0a1511]">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-sm font-semibold text-bank-700 dark:text-bank-200">مركز المؤشرات</p>
              <h2 className="mt-1 text-2xl font-black text-slate-950 dark:text-slate-50">لوحة الإحصائيات التشغيلية</h2>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setIsCustomizeMode((value) => !value)}
                className={`inline-flex h-10 items-center justify-center gap-2 rounded-md px-4 text-sm font-black transition ${
                  isCustomizeMode
                    ? "bg-bank-700 text-white hover:bg-bank-600"
                    : "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-emerald-900/50 dark:bg-[#0f1c17] dark:text-slate-100 dark:hover:bg-emerald-950/30"
                }`}
              >
                <SlidersHorizontal className="h-4 w-4" />
                {isCustomizeMode ? "إنهاء التخصيص" : "تخصيص اللوحة"}
              </button>
              <Button onClick={loadDashboard} disabled={isLoading} className="gap-2">
                <RefreshCw className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
                تحديث
              </Button>
            </div>
          </div>
        </div>
        <div className="grid gap-4 p-5 lg:grid-cols-[1.4fr_1fr]">
          <div>
            <p className="text-sm leading-7 text-slate-600 dark:text-slate-300">
              عرض موحد لحركة الطلبات والموافقات والمراسلات بحسب صلاحيات المستخدم، مع إمكانية تخصيص المؤشرات بدون التأثير على بيانات النظام.
            </p>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <DashboardPulse label="طلبات مفتوحة" value={stats.open_requests} />
            <DashboardPulse label="بانتظار موافقة" value={stats.pending_approvals} />
            <DashboardPulse label="رسائل غير مقروءة" value={stats.messages.unread} />
            <DashboardPulse label="آخر تحديث" value={lastLoadedAt ? formatDate(lastLoadedAt) : "-"} compact />
          </div>
        </div>
      </section>

      <OperationalOverview stats={stats} />

      {error && (
        <div className="flex items-center gap-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
          <AlertTriangle className="h-5 w-5 shrink-0" />
          {error}
        </div>
      )}

      {layoutMessage && (
        <div className="flex items-center gap-3 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-200">
          <Save className="h-5 w-5 shrink-0" />
          {layoutMessage}
        </div>
      )}

      {isCustomizeMode && (
        <WidgetCatalogPanel
          widgets={widgets}
          isSaving={isSavingLayout}
          onAdd={addWidget}
          onHide={hideWidget}
          onReset={resetLayout}
        />
      )}

      <section className="grid grid-cols-1 gap-4 xl:grid-cols-12">
        {enabledWidgets.length === 0 ? (
          <Card className="xl:col-span-12 p-6 dark:border-emerald-900/40 dark:bg-[#0f1c17]">
            <EmptyState text="لم يتم اختيار أي Widget. افتح تخصيص اللوحة وأضف المؤشرات التي تحتاجها." />
          </Card>
        ) : (
          enabledWidgets.map((widget, index) => renderWidget(widget, index))
        )}
      </section>
    </div>
  );
}

function DashboardPulse({ label, value, compact = false }: { label: string; value: number | string; compact?: boolean }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-sm dark:border-emerald-900/40 dark:bg-[#0f1c17]">
      <p className="text-xs font-bold text-slate-500 dark:text-slate-400">{label}</p>
      <p className={`mt-1 font-black text-slate-950 dark:text-slate-50 ${compact ? "text-sm" : "text-2xl"}`}>{value}</p>
    </div>
  );
}

function OperationalOverview({ stats }: { stats: Stats }) {
  const totalRequests = stats.open_requests + stats.pending_approvals + stats.completed_requests + stats.delayed_requests;
  const completionRate = totalRequests > 0 ? Math.round((stats.completed_requests / totalRequests) * 100) : 0;
  const delayRate = totalRequests > 0 ? Math.round((stats.delayed_requests / totalRequests) * 100) : 0;
  const cards = [
    { label: "نسبة الإنجاز", value: `${completionRate}%`, detail: "مكتملة من إجمالي المؤشرات الحالية", tone: "emerald" },
    { label: "مؤشر التأخير", value: `${delayRate}%`, detail: "طلبات متأخرة ضمن النطاق الحالي", tone: "amber" },
    { label: "حجم المراسلات", value: stats.messages.inbox_total + stats.messages.sent_total, detail: "وارد ومرسل", tone: "slate" },
    { label: "مؤشرات تحتاج متابعة", value: stats.attention_items.length, detail: "تنبيهات أو ملاحظات تشغيلية", tone: "sky" }
  ];

  return (
    <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      {cards.map((card) => (
        <div key={card.label} className={`rounded-lg border p-4 shadow-sm ${overviewTone(card.tone)}`}>
          <p className="text-xs font-bold opacity-75">{card.label}</p>
          <p className="mt-2 text-3xl font-black">{card.value}</p>
          <p className="mt-2 text-xs leading-5 opacity-75">{card.detail}</p>
        </div>
      ))}
    </section>
  );
}

function WidgetCatalogPanel({
  widgets,
  isSaving,
  onAdd,
  onHide,
  onReset
}: {
  widgets: DashboardWidget[];
  isSaving: boolean;
  onAdd: (code: string) => void;
  onHide: (code: string) => void;
  onReset: () => void;
}) {
  return (
    <Card className="overflow-hidden p-0 dark:border-emerald-900/40 dark:bg-[#0f1c17]">
      <div className="flex flex-col gap-3 border-b border-slate-100 bg-slate-50/70 p-5 lg:flex-row lg:items-center lg:justify-between dark:border-emerald-950/60 dark:bg-[#0a1511]">
        <SectionHeader title="تخصيص لوحة الإحصائيات" subtitle="اختر المؤشرات التي تحتاجها فقط. التخصيص محفوظ لحسابك." icon={LayoutGrid} />
        <button
          type="button"
          onClick={onReset}
          disabled={isSaving}
          className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-slate-200 px-4 text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-60 dark:border-emerald-900/50 dark:text-slate-200 dark:hover:bg-emerald-950/20"
        >
          إعادة الافتراضي
        </button>
      </div>
      <div className="grid gap-3 p-5 md:grid-cols-2 xl:grid-cols-3">
        {widgets.map((widget) => {
          const Icon = widgetIcons[widget.code] || LayoutGrid;
          return (
            <div key={widget.code} className="flex items-start justify-between gap-3 rounded-lg border border-slate-200 bg-white p-3 shadow-sm dark:border-emerald-900/40 dark:bg-[#0c1914]">
              <div className="flex gap-3">
                <div className="rounded-md bg-bank-50 p-2 text-bank-700 dark:bg-emerald-950/30 dark:text-bank-200">
                  <Icon className="h-5 w-5" />
                </div>
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-black text-slate-950 dark:text-slate-50">{widget.title}</p>
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-black ${widget.enabled ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-200" : "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-300"}`}>
                      {widget.enabled ? "ظاهر" : "مخفي"}
                    </span>
                  </div>
                  <p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-500 dark:text-slate-400">{widget.description}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => (widget.enabled ? onHide(widget.code) : onAdd(widget.code))}
                disabled={isSaving}
                className={`shrink-0 rounded-md px-3 py-2 text-xs font-black transition disabled:opacity-60 ${
                  widget.enabled
                    ? "border border-red-200 text-red-700 hover:bg-red-50 dark:border-red-900/50 dark:text-red-200 dark:hover:bg-red-950/20"
                    : "bg-bank-700 text-white hover:bg-bank-600"
                }`}
              >
                {widget.enabled ? "إخفاء" : "إضافة"}
              </button>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function WidgetShell({
  widget,
  index,
  total,
  isCustomizeMode,
  subtitle,
  children,
  onHide,
  onMove,
  onSizeChange
}: {
  widget: DashboardWidget;
  index: number;
  total: number;
  isCustomizeMode: boolean;
  subtitle?: string;
  children: ReactNode;
  onHide: (code: string) => void;
  onMove: (code: string, direction: -1 | 1) => void;
  onSizeChange: (code: string, size: WidgetSize) => void;
}) {
  const Icon = widgetIcons[widget.code] || LayoutGrid;
  return (
    <Card className={`${widgetGridSpan(widget.size)} overflow-hidden p-0 shadow-sm dark:border-emerald-900/40 dark:bg-[#0f1c17]`}>
      <div className="flex flex-col gap-4 border-b border-slate-100 bg-white p-5 lg:flex-row lg:items-start lg:justify-between dark:border-emerald-950/60 dark:bg-[#0f1c17]">
        <SectionHeader title={widget.title} subtitle={subtitle || widget.description} icon={Icon} />
        {isCustomizeMode && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-slate-200 bg-slate-50 p-1 dark:border-emerald-900/50 dark:bg-[#0a1511]">
          <div className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-slate-50 p-1 dark:border-emerald-900/50 dark:bg-[#0c1914]">
            <button type="button" className={iconButtonClass} onClick={() => onMove(widget.code, -1)} disabled={index === 0} title="تحريك للأعلى">
              <ArrowUp className="h-4 w-4" />
            </button>
            <button type="button" className={iconButtonClass} onClick={() => onMove(widget.code, 1)} disabled={index === total - 1} title="تحريك للأسفل">
              <ArrowDown className="h-4 w-4" />
            </button>
          </div>
          <select
            value={widget.size}
            onChange={(event) => onSizeChange(widget.code, event.target.value as WidgetSize)}
            className="h-9 rounded-md border border-slate-200 bg-white px-2 text-xs font-bold text-slate-700 dark:border-emerald-900/50 dark:bg-[#0c1914] dark:text-slate-200"
            aria-label="حجم Widget"
          >
            <option value="small">صغير</option>
            <option value="medium">متوسط</option>
            <option value="large">عريض</option>
          </select>
          <button type="button" className={`${iconButtonClass} text-red-700 dark:text-red-200`} onClick={() => onHide(widget.code)} title="إخفاء">
            <Trash2 className="h-4 w-4" />
          </button>
          <GripVertical className="hidden h-5 w-5 text-slate-300 lg:block" />
        </div>
        )}
      </div>
      <div className="p-5">{children}</div>
    </Card>
  );
}

function MetricContent({ label, value, detail, icon: Icon, tone }: { label: string; value: number; detail: string; icon: IconComponent; tone: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div>
        <p className="text-xs font-bold text-slate-500 dark:text-slate-400">{label}</p>
        <p className="mt-2 text-4xl font-black tracking-normal text-slate-950 dark:text-slate-50">{value}</p>
        <p className="mt-2 text-xs leading-5 text-slate-500 dark:text-slate-400">{detail}</p>
      </div>
      <div className={`rounded-lg p-3 ring-1 ring-inset ring-black/5 dark:ring-white/10 ${tone}`}>
        <Icon className="h-6 w-6" />
      </div>
    </div>
  );
}

function SectionHeader({ title, subtitle, icon: Icon }: { title: string; subtitle: string; icon: IconComponent }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div>
        <h3 className="font-black text-slate-950 dark:text-slate-50">{title}</h3>
        <p className="mt-1 text-sm leading-6 text-slate-500 dark:text-slate-400">{subtitle}</p>
      </div>
      <div className="rounded-md bg-bank-50 p-2 text-bank-700 dark:bg-bank-950/40 dark:text-bank-200">
        <Icon className="h-5 w-5" />
      </div>
    </div>
  );
}

function ProgressList({ rows, max, emptyText }: { rows: { key: string; label: string; value: number }[]; max: number; emptyText: string }) {
  if (rows.length === 0) {
    return <EmptyState text={emptyText} />;
  }
  return (
    <div className="space-y-3">
      {rows.map((row) => (
        <ProgressRow key={row.key} label={row.label} value={row.value} max={max} />
      ))}
    </div>
  );
}

function ProgressRow({ label, value, max }: { label: string; value: number; max: number }) {
  return (
    <div className="rounded-lg border border-slate-100 bg-slate-50/80 p-3 dark:border-emerald-950/60 dark:bg-[#0a1511]">
      <div className="mb-2 flex items-center justify-between gap-3">
        <span className="truncate text-sm font-bold text-slate-700 dark:text-slate-200">{label}</span>
        <span className="rounded-full bg-white px-2.5 py-1 text-xs font-black text-slate-950 shadow-sm dark:bg-[#0f1c17] dark:text-slate-50">{value}</span>
      </div>
      <ProgressBar value={value} max={max} />
    </div>
  );
}

function ProgressBar({ value, max }: { value: number; max: number }) {
  return (
    <div className="h-2 rounded-full bg-slate-100 dark:bg-slate-800">
      <div className="h-2 rounded-full bg-bank-600 dark:bg-bank-400" style={{ width: `${Math.max(8, (value / Math.max(1, max)) * 100)}%` }} />
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return <p className="rounded-lg bg-slate-50 p-4 text-sm text-slate-500 dark:bg-[#0c1914] dark:text-slate-400">{text}</p>;
}

function attentionTone(tone: string) {
  if (tone === "danger") return "border-red-200 bg-red-50 text-red-800 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-200";
  if (tone === "warning") return "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200";
  if (tone === "message") return "border-bank-200 bg-bank-50 text-bank-800 dark:border-bank-900/50 dark:bg-bank-950/30 dark:text-bank-200";
  return "border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-900/50 dark:bg-sky-950/30 dark:text-sky-200";
}

function overviewTone(tone: string) {
  if (tone === "emerald") return "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-100";
  if (tone === "amber") return "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-100";
  if (tone === "sky") return "border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-900/50 dark:bg-sky-950/30 dark:text-sky-100";
  return "border-slate-200 bg-white text-slate-800 dark:border-emerald-900/40 dark:bg-[#0f1c17] dark:text-slate-100";
}

function widgetGridSpan(size: WidgetSize) {
  if (size === "large") return "xl:col-span-12";
  if (size === "small") return "xl:col-span-4";
  return "xl:col-span-6";
}

function normalizeStats(data?: Partial<Stats>): Stats {
  return {
    ...fallbackStats,
    ...(data ?? {}),
    monthly_statistics: data?.monthly_statistics ?? [],
    requests_by_department: data?.requests_by_department ?? [],
    requests_by_status: data?.requests_by_status ?? [],
    requests_by_type: data?.requests_by_type ?? [],
    recent_requests: data?.recent_requests ?? [],
    attention_items: data?.attention_items ?? [],
    messages: { ...fallbackStats.messages, ...(data?.messages ?? {}), by_type: data?.messages?.by_type ?? [], recent: data?.messages?.recent ?? [] },
    it_staff_statistics: data?.it_staff_statistics ?? [],
    can_view_it_staff_statistics: Boolean(data?.can_view_it_staff_statistics)
  };
}

function normalizeWidgets(items?: DashboardWidget[]): DashboardWidget[] {
  return (items ?? []).map((widget, index) => ({
    ...widget,
    enabled: Boolean(widget.enabled),
    sort_order: Number(widget.sort_order ?? (index + 1) * 10),
    size: normalizeWidgetSize(widget.size),
    default_size: normalizeWidgetSize(widget.default_size)
  }));
}

function buildClientFallbackWidgets(stats: Stats): DashboardWidget[] {
  return normalizeWidgets(
    clientWidgetCatalog
      .filter((widget) => widget.code !== "it_staff_statistics" || stats.can_view_it_staff_statistics)
      .map((widget) => ({ ...widget }))
  );
}

function normalizeWidgetSize(size?: string): WidgetSize {
  if (size === "small" || size === "large" || size === "medium") {
    return size;
  }
  return "medium";
}

function formatDate(value?: string | null) {
  return formatSystemDateTime(value);
}
