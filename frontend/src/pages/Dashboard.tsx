import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  Clock3,
  FileClock,
  Inbox,
  MailCheck,
  MessageSquareText,
  RefreshCw,
  Send,
  TrendingUp,
  UserCheck2
} from "lucide-react";
import { apiFetch } from "../lib/api";
import { formatSystemDateTime } from "../lib/datetime";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";

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

const requestCards = [
  { label: "الطلبات المفتوحة", key: "open_requests", icon: FileClock, tone: "bg-emerald-50 text-bank-700", detail: "طلبات قيد المعالجة" },
  { label: "بانتظار الموافقة", key: "pending_approvals", icon: Clock3, tone: "bg-amber-50 text-amber-700", detail: "خطوات اعتماد معلقة" },
  { label: "طلبات مكتملة", key: "completed_requests", icon: CheckCircle2, tone: "bg-sky-50 text-sky-700", detail: "طلبات مغلقة بنجاح" }
] as const;

const messageCards = [
  { label: "غير مقروءة", key: "unread", icon: Inbox, tone: "bg-bank-50 text-bank-700" },
  { label: "الوارد", key: "inbox_total", icon: MessageSquareText, tone: "bg-slate-100 text-slate-700" },
  { label: "المرسل", key: "sent_total", icon: Send, tone: "bg-indigo-50 text-indigo-700" },
  { label: "مسودات", key: "drafts", icon: MailCheck, tone: "bg-amber-50 text-amber-700" }
] as const;

export function Dashboard() {
  const [stats, setStats] = useState<Stats>(fallbackStats);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  async function loadStats() {
    setIsLoading(true);
    setError("");
    try {
      const data = await apiFetch<Stats>("/dashboard/stats");
      setStats({
        ...fallbackStats,
        ...data,
        messages: { ...fallbackStats.messages, ...(data.messages ?? {}) },
        it_staff_statistics: data.it_staff_statistics ?? [],
        can_view_it_staff_statistics: Boolean(data.can_view_it_staff_statistics)
      });
    } catch {
      setStats(fallbackStats);
      setError("تعذر تحميل بيانات الإحصائيات من الخادم.");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    loadStats();
  }, []);

  const totalMonthly = useMemo(() => stats.monthly_statistics.reduce((total, item) => total + item.count, 0), [stats.monthly_statistics]);
  const maxDepartmentCount = Math.max(1, ...stats.requests_by_department.map((item) => item.count));
  const maxMonthlyCount = Math.max(1, ...stats.monthly_statistics.map((item) => item.count));
  const maxStatusCount = Math.max(1, ...stats.requests_by_status.map((item) => item.count));
  const maxTypeCount = Math.max(1, ...stats.requests_by_type.map((item) => item.count));
  const maxMessageTypeCount = Math.max(1, ...stats.messages.by_type.map((item) => item.count));
  const maxStaffProcessed = Math.max(1, ...stats.it_staff_statistics.map((item) => item.processed_requests));
  const totalStaffProcessed = stats.it_staff_statistics.reduce((total, item) => total + item.processed_requests, 0);

  return (
    <div className="space-y-6">
      <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-sm font-semibold text-bank-700">لوحة القيادة</p>
            <h2 className="mt-2 text-2xl font-bold text-slate-950">إحصائيات النظام</h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">
              نظرة تفاعلية على الطلبات والموافقات والمراسلات الداخلية وآخر النشاطات.
            </p>
          </div>
          <Button onClick={loadStats} disabled={isLoading} className="gap-2 self-start lg:self-auto">
            <RefreshCw className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
            تحديث
          </Button>
        </div>
      </section>

      {error && (
        <div className="flex items-center gap-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          <AlertTriangle className="h-5 w-5 shrink-0" />
          {error}
        </div>
      )}

      <section className="grid gap-4 md:grid-cols-3">
        {requestCards.map(({ label, key, icon: Icon, tone, detail }) => (
          <MetricCard key={key} label={label} value={stats[key]} detail={detail} icon={Icon} tone={tone} />
        ))}
      </section>

      <section className="grid gap-5 xl:grid-cols-[1fr_1fr]">
        <Card className="p-5">
          <SectionHeader title="المراسلات الداخلية" subtitle="الوارد والمرسل والمسودات والرسائل المرتبطة بالطلبات" icon={MessageSquareText} />
          <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {messageCards.map(({ label, key, icon: Icon, tone }) => (
              <div key={key} className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                <div className={`mb-3 inline-flex rounded-md p-2 ${tone}`}>
                  <Icon className="h-5 w-5" />
                </div>
                <p className="text-xs font-semibold text-slate-500">{label}</p>
                <p className="mt-2 text-2xl font-black text-slate-950">{stats.messages[key]}</p>
              </div>
            ))}
          </div>
          <div className="mt-5 rounded-md border border-bank-100 bg-bank-50/60 p-4">
            <p className="text-sm font-bold text-bank-800">رسائل مرتبطة بطلبات: {stats.messages.linked_messages}</p>
            <p className="mt-1 text-xs leading-5 text-slate-600">تعطيك مؤشراً سريعاً على حجم التواصل المرتبط بسير الطلبات.</p>
          </div>
        </Card>

        <Card className="p-5">
          <SectionHeader title="تحتاج انتباهك" subtitle="أهم المؤشرات التي تستحق المتابعة الآن" icon={AlertTriangle} />
          <div className="mt-5 space-y-3">
            {stats.attention_items.length === 0 && <EmptyState text="لا توجد مؤشرات حرجة حالياً." />}
            {stats.attention_items.map((item, index) => (
              <div key={`${item.title}-${index}`} className={`rounded-lg border p-4 ${attentionTone(item.tone)}`}>
                <p className="font-bold">{item.title}</p>
                <p className="mt-1 text-sm leading-6 opacity-80">{item.description}</p>
              </div>
            ))}
          </div>
        </Card>
      </section>

      <section className="grid gap-5 xl:grid-cols-[1.1fr_.9fr]">
        <Card className="p-5">
          <SectionHeader title="الطلبات حسب الحالة" subtitle="توزيع الطلبات داخل نطاق صلاحيتك" icon={BarChart3} />
          <div className="mt-5 space-y-4">
            {stats.requests_by_status.length === 0 && <EmptyState text="لا توجد بيانات حالات بعد." />}
            {stats.requests_by_status.map((row) => (
              <ProgressRow key={row.status} label={row.label} value={row.count} max={maxStatusCount} />
            ))}
          </div>
        </Card>

        <Card className="p-5">
          <SectionHeader title="أنواع الطلبات الأكثر استخداماً" subtitle="أعلى أنواع الطلبات إنشاءً" icon={TrendingUp} />
          <div className="mt-5 space-y-4">
            {stats.requests_by_type.length === 0 && <EmptyState text="لا توجد بيانات أنواع بعد." />}
            {stats.requests_by_type.map((row) => (
              <ProgressRow key={row.type} label={row.label} value={row.count} max={maxTypeCount} />
            ))}
          </div>
        </Card>
      </section>

      <section className="grid gap-5 xl:grid-cols-[1fr_1fr]">
        <Card className="p-5">
          <SectionHeader title="آخر الرسائل الواردة" subtitle="الجديدة تظهر أولاً ثم المقروءة" icon={Inbox} />
          <div className="mt-5 divide-y divide-slate-100 rounded-lg border border-slate-200">
            {stats.messages.recent.length === 0 && <EmptyState text="لا توجد رسائل واردة بعد." />}
            {stats.messages.recent.map((message) => (
              <div key={message.id} className={`p-4 ${message.is_read ? "bg-white" : "bg-bank-50/50"}`}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-black text-slate-950">{message.subject}</p>
                  <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-600">{message.message_type_label}</span>
                </div>
                <p className="mt-2 text-sm text-slate-600">من: {message.sender_name}</p>
                <p className="mt-1 text-xs text-slate-500">{message.message_uid || ""} · {formatDate(message.created_at)}</p>
              </div>
            ))}
          </div>
        </Card>

        <Card className="p-5">
          <SectionHeader title="آخر نشاطات الطلبات" subtitle="آخر الطلبات التي تم تحديثها" icon={FileClock} />
          <div className="mt-5 divide-y divide-slate-100 rounded-lg border border-slate-200">
            {stats.recent_requests.length === 0 && <EmptyState text="لا توجد نشاطات طلبات بعد." />}
            {stats.recent_requests.map((request) => (
              <div key={request.id} className="p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-black text-slate-950">{request.title || request.request_number}</p>
                  <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-600">{request.status_label}</span>
                </div>
                <p className="mt-2 text-sm text-slate-600">{request.request_number} · {request.requester_name}</p>
                <p className="mt-1 text-xs text-slate-500">{formatDate(request.updated_at)}</p>
              </div>
            ))}
          </div>
        </Card>
      </section>

      <section className="grid gap-5 xl:grid-cols-[1.1fr_.9fr]">
        <Card className="p-5">
          <SectionHeader title="الإحصائيات الشهرية" subtitle={`إجمالي الطلبات خلال الفترة: ${totalMonthly}`} icon={BarChart3} />
          <div className="mt-5 space-y-4">
            {stats.monthly_statistics.length === 0 && <EmptyState text="لا توجد بيانات شهرية بعد." />}
            {stats.monthly_statistics.map((row) => (
              <ProgressRow key={row.month} label={row.month} value={row.count} max={maxMonthlyCount} />
            ))}
          </div>
        </Card>

        <Card className="p-5">
          <SectionHeader title="الطلبات حسب الإدارة" subtitle="توزيع الطلبات ضمن نطاق صلاحية المستخدم الحالي" icon={TrendingUp} />
          <div className="mt-5 space-y-4">
            {stats.requests_by_department.length === 0 && <EmptyState text="لا توجد بيانات إدارات بعد." />}
            {stats.requests_by_department.map((row) => (
              <ProgressRow key={row.department} label={row.department} value={row.count} max={maxDepartmentCount} />
            ))}
          </div>
        </Card>
      </section>

      <section className="grid gap-5 xl:grid-cols-[.9fr_1.1fr]">
        <Card className="p-5">
          <SectionHeader title="تصنيفات المراسلات" subtitle="توزيع الرسائل حسب التصنيف" icon={MessageSquareText} />
          <div className="mt-5 space-y-4">
            {stats.messages.by_type.length === 0 && <EmptyState text="لا توجد بيانات تصنيفات بعد." />}
            {stats.messages.by_type.map((row) => (
              <ProgressRow key={row.type} label={row.label} value={row.count} max={maxMessageTypeCount} />
            ))}
          </div>
        </Card>

        {stats.can_view_it_staff_statistics && (
          <Card className="p-5">
            <SectionHeader title="إحصائية معالجة الطلبات" subtitle={`إجمالي الطلبات المعالجة: ${totalStaffProcessed}`} icon={UserCheck2} />
            {stats.it_staff_statistics.length === 0 ? (
              <div className="mt-5">
                <EmptyState text="لا توجد طلبات تمت معالجتها حتى الآن." />
              </div>
            ) : (
              <div className="mt-5 overflow-x-auto">
                <table className="w-full min-w-[860px] text-sm">
                  <thead className="bg-slate-50 text-xs font-bold text-slate-500">
                    <tr>
                      {["الموظف", "الإدارة", "طلبات معالجة", "خطوات تنفيذ", "طلبات مغلقة", "آخر معالجة", "المؤشر"].map((header) => (
                        <th key={header} className="p-3 text-right">{header}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {stats.it_staff_statistics.map((staff) => (
                      <tr key={staff.user_id} className="hover:bg-slate-50/80">
                        <td className="p-3">
                          <p className="font-bold text-slate-950">{staff.full_name_ar}</p>
                          <p className="mt-1 text-xs text-slate-500">{staff.email}</p>
                        </td>
                        <td className="p-3 text-slate-600">{staff.department || "-"}</td>
                        <td className="p-3 font-bold text-bank-700">{staff.processed_requests}</td>
                        <td className="p-3 text-slate-700">{staff.processed_steps}</td>
                        <td className="p-3 text-slate-700">{staff.closed_requests}</td>
                        <td className="p-3 text-slate-500">{formatDate(staff.last_action_at)}</td>
                        <td className="p-3">
                          <ProgressBar value={staff.processed_requests} max={maxStaffProcessed} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        )}
      </section>
    </div>
  );
}

function MetricCard({ label, value, detail, icon: Icon, tone }: { label: string; value: number; detail: string; icon: typeof FileClock; tone: string }) {
  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm text-slate-500">{label}</p>
          <p className="mt-3 text-3xl font-black text-slate-950">{value}</p>
          <p className="mt-2 text-xs text-slate-500">{detail}</p>
        </div>
        <div className={`rounded-md p-3 ${tone}`}>
          <Icon className="h-6 w-6" />
        </div>
      </div>
    </Card>
  );
}

function SectionHeader({ title, subtitle, icon: Icon }: { title: string; subtitle: string; icon: typeof FileClock }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div>
        <h3 className="font-black text-slate-950">{title}</h3>
        <p className="mt-1 text-sm leading-6 text-slate-500">{subtitle}</p>
      </div>
      <div className="rounded-md bg-bank-50 p-2 text-bank-700">
        <Icon className="h-5 w-5" />
      </div>
    </div>
  );
}

function ProgressRow({ label, value, max }: { label: string; value: number; max: number }) {
  return (
    <div className="grid grid-cols-[minmax(90px,170px)_1fr_42px] items-center gap-3">
      <span className="truncate text-sm font-semibold text-slate-700">{label}</span>
      <ProgressBar value={value} max={max} />
      <span className="text-right text-sm font-black text-slate-950">{value}</span>
    </div>
  );
}

function ProgressBar({ value, max }: { value: number; max: number }) {
  return (
    <div className="h-2 rounded-full bg-slate-100">
      <div className="h-2 rounded-full bg-bank-600" style={{ width: `${Math.max(8, (value / Math.max(1, max)) * 100)}%` }} />
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return <p className="rounded-md bg-slate-50 p-4 text-sm text-slate-500">{text}</p>;
}

function attentionTone(tone: string) {
  if (tone === "danger") return "border-red-200 bg-red-50 text-red-800";
  if (tone === "warning") return "border-amber-200 bg-amber-50 text-amber-800";
  if (tone === "message") return "border-bank-200 bg-bank-50 text-bank-800";
  return "border-sky-200 bg-sky-50 text-sky-800";
}

function formatDate(value?: string | null) {
  return formatSystemDateTime(value);
}
