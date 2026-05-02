import { FormEvent, ReactNode, useEffect, useMemo, useState } from "react";
import { FileSpreadsheet, Filter, Printer, RefreshCw } from "lucide-react";
import { Card } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { api } from "../lib/axios";
import { API_BASE, apiFetch, ServiceRequest } from "../lib/api";
import { formatSystemDate } from "../lib/datetime";

const statusLabels: Record<string, string> = {
  draft: "مسودة",
  submitted: "مرسل",
  pending_approval: "بانتظار الموافقة",
  approved: "معتمد",
  rejected: "مرفوض",
  in_implementation: "قيد التنفيذ",
  completed: "مكتمل",
  closed: "مغلق",
  cancelled: "ملغي"
};

type Filters = {
  from_date: string;
  to_date: string;
  employee_id: string;
  request_type_id: string;
};

type ActiveRequestType = {
  id: number;
  code?: string;
  name_ar?: string;
};

const emptyFilters: Filters = { from_date: "", to_date: "", employee_id: "", request_type_id: "" };

export function ReportsPage() {
  const [filters, setFilters] = useState<Filters>(emptyFilters);
  const [requests, setRequests] = useState<ServiceRequest[]>([]);
  const [requestTypes, setRequestTypes] = useState<ActiveRequestType[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isExporting, setIsExporting] = useState("");
  const [printingId, setPrintingId] = useState<number | null>(null);
  const [error, setError] = useState("");

  async function loadRequests(event?: FormEvent) {
    event?.preventDefault();
    setIsLoading(true);
    setError("");
    try {
      const [requestsData, activeTypes] = await Promise.all([
        apiFetch<ServiceRequest[]>("/requests"),
        apiFetch<ActiveRequestType[]>("/request-types/active").catch(() => [])
      ]);
      setRequests(requestsData);
      setRequestTypes(activeTypes);
    } catch {
      setError("تعذر تحميل بيانات التقارير.");
      setRequests([]);
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    loadRequests();
  }, []);

  const requestTypeById = useMemo(() => new Map(requestTypes.map((item) => [item.id, item.name_ar || item.code || `نوع ${item.id}`])), [requestTypes]);

  const employees = useMemo(() => {
    const map = new Map<number, string>();
    requests.forEach((request) => {
      if (request.requester?.full_name_ar) map.set(request.requester.id, request.requester.full_name_ar);
    });
    return Array.from(map, ([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, "ar"));
  }, [requests]);

  const filteredRequests = useMemo(() => {
    const fromTime = filters.from_date ? new Date(`${filters.from_date}T00:00:00`).getTime() : null;
    const toTime = filters.to_date ? new Date(`${filters.to_date}T23:59:59`).getTime() : null;
    return requests.filter((request) => {
      const createdTime = new Date(request.created_at).getTime();
      const matchesFrom = fromTime === null || createdTime >= fromTime;
      const matchesTo = toTime === null || createdTime <= toTime;
      const matchesEmployee = !filters.employee_id || String(request.requester.id) === filters.employee_id;
      const matchesType = !filters.request_type_id || String(request.request_type_id || "") === filters.request_type_id;
      return matchesFrom && matchesTo && matchesEmployee && matchesType;
    });
  }, [filters, requests]);

  const summary = useMemo(() => {
    const completed = filteredRequests.filter((request) => ["completed", "closed"].includes(request.status)).length;
    const pending = filteredRequests.filter((request) => request.status === "pending_approval").length;
    return { total: filteredRequests.length, completed, pending };
  }, [filteredRequests]);

  async function exportReport(format: "xlsx" | "pdf") {
    setIsExporting(format);
    setError("");
    try {
      const params = Object.fromEntries(Object.entries(filters).filter(([, value]) => value));
      const response = await api.get(`/reports/requests.${format}`, { params, responseType: "blob" });
      const url = URL.createObjectURL(response.data);
      const link = document.createElement("a");
      link.href = url;
      link.download = `qib-requests-report.${format}`;
      link.click();
      URL.revokeObjectURL(url);
    } catch {
      setError("تعذر تصدير التقرير. تحقق من صلاحياتك أو اتصال الخادم.");
    } finally {
      setIsExporting("");
    }
  }

  async function printRequest(request: ServiceRequest) {
    setPrintingId(request.id);
    setError("");
    try {
      const token = localStorage.getItem("qib_token");
      const response = await fetch(`${API_BASE}/requests/${request.id}/print.pdf`, {
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        }
      });
      if (!response.ok) throw new Error("print_failed");
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const opened = window.open(url, "_blank", "noopener,noreferrer");
      if (!opened) {
        const link = document.createElement("a");
        link.href = url;
        link.download = `${request.request_number || "request"}.pdf`;
        link.click();
      }
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch {
      setError("تعذر طباعة الطلب. تحقق من صلاحياتك أو اتصال الخادم.");
    } finally {
      setPrintingId(null);
    }
  }

  function typeLabel(request: ServiceRequest) {
    return request.form_data?.request_type_label || (request.request_type_id ? requestTypeById.get(request.request_type_id) : "") || request.request_type;
  }

  return (
    <div className="space-y-5" dir="rtl">
      <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <p className="text-sm font-semibold text-bank-700">التقارير</p>
        <h2 className="mt-2 text-2xl font-bold text-slate-950">تقارير الطلبات</h2>
        <p className="mt-2 text-sm leading-6 text-slate-500">فلترة الطلبات حسب المدة والموظف ونوع الطلب، ثم تصدير النتائج بصيغة Excel أو PDF.</p>
      </section>

      <Card className="p-5">
        <form onSubmit={loadRequests} className="grid gap-3 lg:grid-cols-[repeat(4,minmax(0,1fr))_auto]">
          <Field label="من تاريخ"><input type="date" value={filters.from_date} onChange={(e) => setFilters({ ...filters, from_date: e.target.value })} className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm outline-none focus:border-bank-600 focus:ring-2 focus:ring-bank-100" /></Field>
          <Field label="إلى تاريخ"><input type="date" value={filters.to_date} onChange={(e) => setFilters({ ...filters, to_date: e.target.value })} className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm outline-none focus:border-bank-600 focus:ring-2 focus:ring-bank-100" /></Field>
          <Field label="الموظف">
            <select value={filters.employee_id} onChange={(e) => setFilters({ ...filters, employee_id: e.target.value })} className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm outline-none focus:border-bank-600 focus:ring-2 focus:ring-bank-100">
              <option value="">كل الموظفين</option>
              {employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.name}</option>)}
            </select>
          </Field>
          <Field label="نوع الطلب">
            <select value={filters.request_type_id} onChange={(e) => setFilters({ ...filters, request_type_id: e.target.value })} className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm outline-none focus:border-bank-600 focus:ring-2 focus:ring-bank-100">
              <option value="">كل الأنواع</option>
              {requestTypes.map((item) => <option key={item.id} value={item.id}>{item.name_ar || item.code || `نوع ${item.id}`}</option>)}
            </select>
          </Field>
          <div className="flex items-end gap-2">
            <Button type="submit" disabled={isLoading} className="gap-2"><Filter className="h-4 w-4" /> تطبيق</Button>
            <button type="button" onClick={() => setFilters(emptyFilters)} className="h-10 rounded-md border border-slate-300 px-3 text-sm font-semibold text-slate-700">مسح</button>
          </div>
        </form>
      </Card>

      <div className="grid gap-3 md:grid-cols-3">
        <Metric label="إجمالي النتائج" value={summary.total} />
        <Metric label="طلبات مكتملة أو مغلقة" value={summary.completed} />
        <Metric label="بانتظار الموافقة" value={summary.pending} />
      </div>

      <Card className="p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="font-bold text-slate-950">نتائج التقرير</h3>
            <p className="mt-1 text-sm text-slate-500">عدد الطلبات المطابقة: {filteredRequests.length}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={() => loadRequests()} disabled={isLoading} className="gap-2"><RefreshCw className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} /> تحديث</Button>
            <button type="button" onClick={() => exportReport("xlsx")} disabled={Boolean(isExporting)} className="inline-flex h-10 items-center gap-2 rounded-md border border-slate-300 px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"><FileSpreadsheet className="h-4 w-4" /> Excel</button>
          </div>
        </div>
        {error && <p className="mb-4 rounded-md bg-red-50 p-3 text-sm font-semibold text-red-700">{error}</p>}
        <div className="overflow-x-auto rounded-md border border-slate-200">
          <table className="w-full min-w-[940px] text-sm">
            <thead className="bg-slate-50 text-xs font-bold text-slate-500">
              <tr>{["رقم الطلب", "العنوان", "الموظف", "نوع الطلب", "الحالة", "التاريخ", "الإجراءات"].map((header) => <th key={header} className="p-3 text-right">{header}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {isLoading && <tr><td colSpan={7} className="p-6 text-center text-slate-500">جار تحميل التقرير...</td></tr>}
              {!isLoading && filteredRequests.length === 0 && <tr><td colSpan={7} className="p-6 text-center text-slate-500">لا توجد نتائج مطابقة.</td></tr>}
              {!isLoading && filteredRequests.map((request) => (
                <tr key={request.id} className="hover:bg-slate-50">
                  <td className="p-3 font-semibold text-bank-700">{request.request_number}</td>
                  <td className="p-3 text-slate-900">{request.title}</td>
                  <td className="p-3">{request.requester.full_name_ar}</td>
                  <td className="p-3">{typeLabel(request)}</td>
                  <td className="p-3">{statusLabels[request.status] ?? request.status}</td>
                  <td className="p-3">{formatSystemDate(request.created_at)}</td>
                  <td className="p-3">
                    <button
                      type="button"
                      onClick={() => printRequest(request)}
                      disabled={printingId === request.id}
                      className="inline-flex h-9 items-center gap-2 rounded-md border border-slate-300 px-3 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-60"
                    >
                      <Printer className="h-4 w-4" />
                      {printingId === request.id ? "جاري الطباعة..." : "طباعة"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="block space-y-2 text-sm font-medium text-slate-700">{label}{children}</label>;
}

function Metric({ label, value }: { label: string; value: number }) {
  return <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm"><p className="text-sm text-slate-500">{label}</p><p className="mt-2 text-3xl font-bold text-slate-950">{value}</p></div>;
}
