import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, BarChart3, CheckCircle2, Clock3, FileClock, RefreshCw, TrendingUp, UserCheck2 } from "lucide-react";
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

interface Stats {
  open_requests: number;
  pending_approvals: number;
  completed_requests: number;
  monthly_statistics: { month: string; count: number }[];
  requests_by_department: { department: string; count: number }[];
  can_view_it_staff_statistics: boolean;
  it_staff_statistics: ItStaffStat[];
}

const fallbackStats: Stats = {
  open_requests: 0,
  pending_approvals: 0,
  completed_requests: 0,
  monthly_statistics: [],
  requests_by_department: [],
  can_view_it_staff_statistics: false,
  it_staff_statistics: []
};

const statCards = [
  {
    label: "الطلبات المفتوحة",
    key: "open_requests",
    icon: FileClock,
    tone: "bg-emerald-50 text-bank-700",
    detail: "طلبات قيد المعالجة"
  },
  {
    label: "بانتظار الموافقة",
    key: "pending_approvals",
    icon: Clock3,
    tone: "bg-amber-50 text-amber-700",
    detail: "خطوات اعتماد معلقة"
  },
  {
    label: "طلبات مكتملة",
    key: "completed_requests",
    icon: CheckCircle2,
    tone: "bg-sky-50 text-sky-700",
    detail: "طلبات مغلقة بنجاح"
  }
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

  const totalMonthly = useMemo(
    () => stats.monthly_statistics.reduce((total, item) => total + item.count, 0),
    [stats.monthly_statistics]
  );

  const maxDepartmentCount = Math.max(1, ...stats.requests_by_department.map((item) => item.count));
  const maxMonthlyCount = Math.max(1, ...stats.monthly_statistics.map((item) => item.count));
  const maxStaffProcessed = Math.max(1, ...stats.it_staff_statistics.map((item) => item.processed_requests));
  const totalStaffProcessed = stats.it_staff_statistics.reduce((total, item) => total + item.processed_requests, 0);

  return (
    <div className="space-y-6">
      <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-sm font-semibold text-bank-700">إحصائيات</p>
            <h2 className="mt-2 text-2xl font-bold text-slate-950">إحصائية الطلبات التي قمت برفعها</h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">
              تابع حالة طلباتك وعدد الطلبات المفتوحة والمكتملة والطلبات التي تنتظر الموافقة.
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
        {statCards.map(({ label, key, icon: Icon, tone, detail }) => (
          <Card key={key} className="p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm text-slate-500">{label}</p>
                <p className="mt-3 text-3xl font-bold text-slate-950">{stats[key]}</p>
                <p className="mt-2 text-xs text-slate-500">{detail}</p>
              </div>
              <div className={`rounded-md p-3 ${tone}`}>
                <Icon className="h-6 w-6" />
              </div>
            </div>
          </Card>
        ))}
      </section>

      {stats.can_view_it_staff_statistics && (
        <Card className="p-5">
          <div className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h3 className="font-bold text-slate-950">إحصائية معالجة الطلبات</h3>
              <p className="mt-1 text-sm text-slate-500">إجمالي الطلبات المعالجة: {totalStaffProcessed}</p>
            </div>
            <div className="rounded-md bg-bank-50 p-2 text-bank-700">
              <UserCheck2 className="h-5 w-5" />
            </div>
          </div>

          {stats.it_staff_statistics.length === 0 ? (
            <p className="rounded-md bg-slate-50 p-4 text-sm text-slate-500">لا توجد طلبات تمت معالجتها حتى الآن.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[860px] text-sm">
                <thead className="bg-slate-50 text-xs font-bold text-slate-500">
                  <tr>
                    {["الموظف", "الإدارة", "طلبات معالجة", "خطوات تنفيذ", "طلبات مغلقة", "آخر معالجة", "المؤشر"].map((header) => (
                      <th key={header} className="p-3 text-right">
                        {header}
                      </th>
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
                        <div className="h-2 rounded-full bg-slate-100">
                          <div
                            className="h-2 rounded-full bg-bank-600"
                            style={{ width: `${Math.max(8, (staff.processed_requests / maxStaffProcessed) * 100)}%` }}
                          />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      <section className="grid gap-5 xl:grid-cols-[1.1fr_.9fr]">
        <Card className="p-5">
          <div className="mb-5 flex items-center justify-between">
            <div>
              <h3 className="font-bold text-slate-950">الإحصائيات الشهرية</h3>
              <p className="mt-1 text-sm text-slate-500">إجمالي الطلبات خلال الفترة: {totalMonthly}</p>
            </div>
            <div className="rounded-md bg-slate-100 p-2 text-slate-600">
              <BarChart3 className="h-5 w-5" />
            </div>
          </div>

          <div className="space-y-4">
            {stats.monthly_statistics.length === 0 && (
              <p className="rounded-md bg-slate-50 p-4 text-sm text-slate-500">لا توجد بيانات شهرية بعد.</p>
            )}
            {stats.monthly_statistics.map((row) => (
              <div key={row.month} className="grid grid-cols-[88px_1fr_40px] items-center gap-3">
                <span className="text-sm text-slate-500">{row.month}</span>
                <div className="h-3 rounded-full bg-slate-100">
                  <div
                    className="h-3 rounded-full bg-bank-600"
                    style={{ width: `${Math.max(8, (row.count / maxMonthlyCount) * 100)}%` }}
                  />
                </div>
                <span className="text-right text-sm font-semibold text-slate-900">{row.count}</span>
              </div>
            ))}
          </div>
        </Card>

        <Card className="p-5">
          <div className="mb-5 flex items-center justify-between">
            <div>
              <h3 className="font-bold text-slate-950">الطلبات حسب الإدارة</h3>
              <p className="mt-1 text-sm text-slate-500">توزيع الطلبات ضمن نطاق صلاحية المستخدم الحالي</p>
            </div>
            <div className="rounded-md bg-bank-50 p-2 text-bank-700">
              <TrendingUp className="h-5 w-5" />
            </div>
          </div>

          <div className="space-y-4">
            {stats.requests_by_department.length === 0 && (
              <p className="rounded-md bg-slate-50 p-4 text-sm text-slate-500">لا توجد بيانات إدارات بعد.</p>
            )}
            {stats.requests_by_department.map((row) => (
              <div key={row.department} className="space-y-2">
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="font-medium text-slate-700">{row.department}</span>
                  <span className="font-bold text-bank-700">{row.count}</span>
                </div>
                <div className="h-2 rounded-full bg-slate-100">
                  <div
                    className="h-2 rounded-full bg-bank-600"
                    style={{ width: `${Math.max(8, (row.count / maxDepartmentCount) * 100)}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </Card>
      </section>
    </div>
  );
}

function formatDate(value?: string | null) {
  return formatSystemDateTime(value);
}
