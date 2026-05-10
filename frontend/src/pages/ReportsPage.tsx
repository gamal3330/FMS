import { FormEvent, ReactNode, useEffect, useMemo, useState } from "react";
import {
  BarChart3,
  CalendarClock,
  Download,
  FileSpreadsheet,
  FileText,
  Filter,
  RefreshCw,
  Save,
  Search,
  Star,
  Trash2
} from "lucide-react";
import { api, getErrorMessage } from "../lib/axios";
import { apiFetch } from "../lib/api";
import { formatSystemDate } from "../lib/datetime";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { Pagination } from "../components/ui/Pagination";

type ReportKey =
  | "summary"
  | "requests"
  | "approvals"
  | "sla"
  | "users-permissions"
  | "messaging"
  | "attachments"
  | "audit"
  | "saved"
  | "templates"
  | "scheduled";

type ReportFilters = {
  date_from: string;
  date_to: string;
  department_id: string;
  request_type_id: string;
  status: string;
  priority: string;
  specialized_section_id: string;
  requester_id: string;
  assigned_user_id: string;
  approval_step: string;
  sla_status: string;
  message_type: string;
  audit_action: string;
};

type ReportResponse = {
  disabled?: boolean;
  message?: string;
  cards?: Record<string, unknown>;
  summary?: Record<string, unknown>;
  charts?: Record<string, Array<Record<string, unknown>>>;
  items?: Array<Record<string, unknown>>;
  pagination?: { page: number; page_size: number; total: number };
};

type Option = { id: number; name_ar?: string; full_name_ar?: string; code?: string; label?: string };

const emptyFilters: ReportFilters = {
  date_from: "",
  date_to: "",
  department_id: "",
  request_type_id: "",
  status: "",
  priority: "",
  specialized_section_id: "",
  requester_id: "",
  assigned_user_id: "",
  approval_step: "",
  sla_status: "",
  message_type: "",
  audit_action: ""
};

const reportTabs: Array<{ key: ReportKey; label: string; api?: string; reportType?: string }> = [
  { key: "summary", label: "نظرة عامة", api: "/reports/summary", reportType: "summary" },
  { key: "requests", label: "تقارير الطلبات", api: "/reports/requests", reportType: "requests" },
  { key: "approvals", label: "تقارير الموافقات", api: "/reports/approvals", reportType: "approvals" },
  { key: "sla", label: "تقارير SLA والتأخير", api: "/reports/sla", reportType: "sla" },
  { key: "users-permissions", label: "المستخدمون والصلاحيات", api: "/reports/users-permissions", reportType: "users-permissions" },
  { key: "messaging", label: "تقارير المراسلات", api: "/reports/messaging", reportType: "messaging" },
  { key: "attachments", label: "تقارير المرفقات", api: "/reports/attachments", reportType: "attachments" },
  { key: "audit", label: "تقارير التدقيق", api: "/reports/audit", reportType: "audit" },
  { key: "saved", label: "التقارير المحفوظة" },
  { key: "templates", label: "قوالب التقارير" },
  { key: "scheduled", label: "جدولة التقارير" }
];

const quickRanges = [
  { key: "today", label: "اليوم", days: 0 },
  { key: "7", label: "آخر 7 أيام", days: 7 },
  { key: "30", label: "آخر 30 يوم", days: 30 },
  { key: "month", label: "هذا الشهر", month: true },
  { key: "year", label: "هذا العام", year: true }
];

const statusOptions = [
  ["", "كل الحالات"],
  ["submitted", "مرسل"],
  ["pending_approval", "بانتظار الموافقة"],
  ["returned_for_edit", "معاد للتعديل"],
  ["approved", "معتمد"],
  ["in_implementation", "قيد التنفيذ"],
  ["completed", "مكتمل"],
  ["closed", "مغلق"],
  ["rejected", "مرفوض"],
  ["cancelled", "ملغي"]
];

const priorityOptions = [
  ["", "كل الأولويات"],
  ["low", "منخفضة"],
  ["normal", "عادية"],
  ["medium", "متوسطة"],
  ["high", "مرتفعة"],
  ["urgent", "عاجلة"],
  ["critical", "حرجة"]
];

const slaOptions = [
  ["", "كل حالات SLA"],
  ["on_track", "ضمن الوقت"],
  ["breached", "متأخر"],
  ["met", "ملتزم"],
  ["no_sla", "بدون SLA"]
];

const summaryLabels: Record<string, string> = {
  total_requests: "إجمالي الطلبات",
  completed_requests: "الطلبات المكتملة",
  open_requests: "الطلبات المفتوحة",
  delayed_requests: "الطلبات المتأخرة",
  sla_compliance: "نسبة الالتزام بـ SLA",
  average_completion_hours: "متوسط الإنجاز بالساعة",
  total_messages: "إجمالي المراسلات",
  last_exported_report: "آخر تقرير تم تصديره",
  pending_approvals: "موافقات معلقة",
  approved_count: "موافقات معتمدة",
  rejected_count: "موافقات مرفوضة",
  returned_for_edit_count: "معادة للتعديل",
  breached_requests: "طلبات متأخرة",
  average_resolution_hours: "متوسط وقت الإنجاز",
  requests_breached_today: "تأخرت اليوم",
  total_users: "إجمالي المستخدمين",
  active_users: "نشطون",
  inactive_users: "غير نشطين",
  locked_users: "مقفلون",
  without_manager: "بدون مدير",
  without_department: "بدون إدارة",
  administrative_privileges: "صلاحيات إدارية",
  official_messages: "مراسلات رسمية",
  internal_messages: "مراسلات داخلية",
  clarification_requests: "طلبات استيضاح",
  unread_messages: "غير مقروءة",
  linked_to_requests: "مرتبطة بالطلبات",
  total_attachments: "إجمالي المرفقات",
  total_storage_bytes: "حجم التخزين",
  large_files: "ملفات كبيرة",
  missing_files: "ملفات مفقودة",
  orphan_files: "ملفات يتيمة",
  total_logs: "سجلات التدقيق"
};

const columnSets: Record<string, Array<{ key: string; label: string }>> = {
  requests: [
    { key: "request_number", label: "رقم الطلب" },
    { key: "request_type", label: "نوع الطلب" },
    { key: "requester", label: "مقدم الطلب" },
    { key: "department", label: "الإدارة" },
    { key: "specialized_section", label: "القسم المختص" },
    { key: "assigned_user", label: "الموظف المنفذ" },
    { key: "status_label", label: "الحالة" },
    { key: "priority_label", label: "الأولوية" },
    { key: "created_at", label: "تاريخ الإنشاء" },
    { key: "closed_at", label: "تاريخ الإغلاق" },
    { key: "duration_hours", label: "مدة الإنجاز" },
    { key: "sla_status_label", label: "SLA" }
  ],
  approvals: [
    { key: "request_number", label: "رقم الطلب" },
    { key: "request_type", label: "نوع الطلب" },
    { key: "step_name", label: "خطوة الموافقة" },
    { key: "approver", label: "الموافق" },
    { key: "status", label: "الحالة" },
    { key: "wait_hours", label: "وقت الانتظار" },
    { key: "action_at", label: "تاريخ الإجراء" },
    { key: "note", label: "الملاحظة" }
  ],
  sla: [
    { key: "request_number", label: "رقم الطلب" },
    { key: "request_type", label: "نوع الطلب" },
    { key: "status_label", label: "الحالة" },
    { key: "department", label: "الإدارة" },
    { key: "specialized_section", label: "القسم المختص" },
    { key: "assigned_user", label: "الموظف المنفذ" },
    { key: "sla_due_at", label: "تاريخ الاستحقاق" },
    { key: "delay_hours", label: "مدة التأخير" },
    { key: "delay_reason", label: "سبب التأخير" }
  ],
  "users-permissions": [
    { key: "name", label: "اسم المستخدم" },
    { key: "email", label: "البريد" },
    { key: "department", label: "الإدارة" },
    { key: "role", label: "الدور" },
    { key: "status", label: "الحالة" },
    { key: "last_login", label: "آخر دخول" },
    { key: "has_high_privileges", label: "صلاحيات عالية؟" },
    { key: "notes", label: "ملاحظات" }
  ],
  messaging: [
    { key: "message_uid", label: "رقم الرسالة" },
    { key: "subject", label: "الموضوع" },
    { key: "message_type_label", label: "نوع الرسالة" },
    { key: "sender", label: "المرسل" },
    { key: "recipients", label: "المستلم" },
    { key: "related_request_id", label: "الطلب المرتبط" },
    { key: "classification", label: "التصنيف" },
    { key: "priority_label", label: "الأولوية" },
    { key: "created_at", label: "تاريخ الإرسال" },
    { key: "read_status", label: "حالة القراءة" }
  ],
  attachments: [
    { key: "file_name", label: "اسم الملف" },
    { key: "type", label: "النوع" },
    { key: "size_bytes", label: "الحجم" },
    { key: "linked_to", label: "مرتبط بـ" },
    { key: "module", label: "الوحدة" },
    { key: "uploaded_by", label: "تم رفعه بواسطة" },
    { key: "created_at", label: "تاريخ الرفع" },
    { key: "downloads_count", label: "عدد التحميلات" },
    { key: "status", label: "الحالة" }
  ],
  audit: [
    { key: "action", label: "الإجراء" },
    { key: "user", label: "المستخدم" },
    { key: "entity_type", label: "الكيان" },
    { key: "entity_id", label: "رقم الكيان" },
    { key: "created_at", label: "التاريخ" },
    { key: "ip_address", label: "IP Address" },
    { key: "result", label: "النتيجة" },
    { key: "old_value", label: "القيمة القديمة" },
    { key: "new_value", label: "القيمة الجديدة" }
  ]
};

export function ReportsPage() {
  const [activeTab, setActiveTab] = useState<ReportKey>("summary");
  const [filters, setFilters] = useState<ReportFilters>(emptyFilters);
  const [data, setData] = useState<ReportResponse>({});
  const [savedReports, setSavedReports] = useState<Array<Record<string, unknown>>>([]);
  const [templates, setTemplates] = useState<Array<Record<string, unknown>>>([]);
  const [scheduledReports, setScheduledReports] = useState<Array<Record<string, unknown>>>([]);
  const [departments, setDepartments] = useState<Option[]>([]);
  const [requestTypes, setRequestTypes] = useState<Option[]>([]);
  const [specializedSections, setSpecializedSections] = useState<Option[]>([]);
  const [users, setUsers] = useState<Option[]>([]);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState("");
  const [notice, setNotice] = useState<{ type: "success" | "error"; message: string }>({ type: "success", message: "" });
  const [templateForm, setTemplateForm] = useState({ name_ar: "", code: "", report_type: "requests", description: "" });
  const [scheduleForm, setScheduleForm] = useState({ name: "", report_template_id: "", frequency: "monthly", run_time: "08:00", export_format: "excel" });

  const activeTabConfig = reportTabs.find((tab) => tab.key === activeTab);
  const activeReportType = activeTabConfig?.reportType || "requests";

  useEffect(() => {
    loadOptions();
    loadCurrentTab();
  }, []);

  useEffect(() => {
    setPage(1);
  }, [activeTab]);

  useEffect(() => {
    loadCurrentTab();
  }, [activeTab, page]);

  async function loadOptions() {
    const [deptData, typeData, sectionData, userData] = await Promise.all([
      apiFetch<Option[]>("/departments").catch(() => []),
      apiFetch<Option[]>("/request-types/active").catch(() => []),
      apiFetch<Option[]>("/settings/specialized-sections?active_only=true").catch(() => []),
      apiFetch<Option[]>("/users").catch(() => [])
    ]);
    setDepartments(deptData);
    setRequestTypes(typeData);
    setSpecializedSections(sectionData);
    setUsers(userData);
  }

  async function loadCurrentTab(event?: FormEvent) {
    event?.preventDefault();
    setLoading(true);
    setNotice({ type: "success", message: "" });
    try {
      if (activeTab === "saved") {
        setSavedReports(await apiFetch<Array<Record<string, unknown>>>("/reports/saved"));
        setData({});
        return;
      }
      if (activeTab === "templates") {
        setTemplates(await apiFetch<Array<Record<string, unknown>>>("/reports/templates"));
        setData({});
        return;
      }
      if (activeTab === "scheduled") {
        const [scheduledData, templateData] = await Promise.all([
          apiFetch<Array<Record<string, unknown>>>("/reports/scheduled"),
          apiFetch<Array<Record<string, unknown>>>("/reports/templates").catch(() => templates)
        ]);
        setScheduledReports(scheduledData);
        setTemplates(templateData);
        setData({});
        return;
      }
      if (!activeTabConfig?.api) return;
      const response = await api.get(activeTabConfig.api, { params: { ...cleanFilters(filters), page, page_size: 15 } });
      setData(response.data);
    } catch (error) {
      setNotice({ type: "error", message: getErrorMessage(error) || "تعذر تحميل التقرير." });
      setData({});
    } finally {
      setLoading(false);
    }
  }

  function applyQuickRange(range: (typeof quickRanges)[number]) {
    const today = new Date();
    const end = toDateInput(today);
    const start = new Date(today);
    if (range.month) start.setDate(1);
    else if (range.year) {
      start.setMonth(0);
      start.setDate(1);
    } else start.setDate(today.getDate() - (range.days ?? 0));
    setFilters((current) => ({ ...current, date_from: toDateInput(start), date_to: end }));
  }

  async function saveCurrentReport() {
    const name = window.prompt("اسم التقرير المحفوظ");
    if (!name?.trim()) return;
    try {
      await apiFetch("/reports/saved", {
        method: "POST",
        body: JSON.stringify({
          name,
          description: "",
          report_type: activeReportType,
          filters_json: cleanFilters(filters),
          is_favorite: false
        })
      });
      setNotice({ type: "success", message: "تم حفظ التقرير." });
      if (activeTab === "saved") loadCurrentTab();
    } catch (error) {
      setNotice({ type: "error", message: error instanceof Error ? error.message : "تعذر حفظ التقرير." });
    }
  }

  async function exportReport(format: "excel" | "pdf") {
    setExporting(format);
    setNotice({ type: "success", message: "" });
    try {
      const response = await api.get(`/reports/export/${format}`, {
        params: { report_type: activeReportType, ...cleanFilters(filters) },
        responseType: "blob"
      });
      const url = URL.createObjectURL(response.data);
      const link = document.createElement("a");
      link.href = url;
      link.download = `qib-${activeReportType}-report.${format === "excel" ? "xlsx" : "pdf"}`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      setNotice({ type: "error", message: getErrorMessage(error) || "تعذر تصدير التقرير." });
    } finally {
      setExporting("");
    }
  }

  async function runSavedReport(item: Record<string, unknown>) {
    try {
      const response = await apiFetch<ReportResponse>(`/reports/saved/${item.id}/run`, { method: "POST" });
      setData(response);
      setActiveTab((item.report_type as ReportKey) || "requests");
    } catch (error) {
      setNotice({ type: "error", message: error instanceof Error ? error.message : "تعذر تشغيل التقرير." });
    }
  }

  async function deleteSavedReport(id: unknown) {
    if (!window.confirm("هل تريد حذف التقرير المحفوظ؟")) return;
    await apiFetch(`/reports/saved/${id}`, { method: "DELETE" });
    loadCurrentTab();
  }

  async function createTemplate(event: FormEvent) {
    event.preventDefault();
    try {
      await apiFetch("/reports/templates", {
        method: "POST",
        body: JSON.stringify({ ...templateForm, default_filters_json: {}, default_columns_json: [], is_active: true })
      });
      setTemplateForm({ name_ar: "", code: "", report_type: "requests", description: "" });
      setNotice({ type: "success", message: "تم إنشاء القالب." });
      loadCurrentTab();
    } catch (error) {
      setNotice({ type: "error", message: error instanceof Error ? error.message : "تعذر إنشاء القالب." });
    }
  }

  async function runTemplate(id: unknown) {
    try {
      const response = await apiFetch<ReportResponse>(`/reports/templates/${id}/run`, { method: "POST" });
      setData(response);
      setActiveTab("requests");
    } catch (error) {
      setNotice({ type: "error", message: error instanceof Error ? error.message : "تعذر تشغيل القالب." });
    }
  }

  async function disableTemplate(id: unknown) {
    if (!window.confirm("هل تريد تعطيل هذا القالب؟")) return;
    await apiFetch(`/reports/templates/${id}`, { method: "DELETE" });
    loadCurrentTab();
  }

  async function createSchedule(event: FormEvent) {
    event.preventDefault();
    try {
      await apiFetch("/reports/scheduled", {
        method: "POST",
        body: JSON.stringify({
          name: scheduleForm.name,
          report_template_id: scheduleForm.report_template_id ? Number(scheduleForm.report_template_id) : null,
          frequency: scheduleForm.frequency,
          run_time: scheduleForm.run_time,
          recipients_json: [],
          export_format: scheduleForm.export_format,
          is_active: true
        })
      });
      setScheduleForm({ name: "", report_template_id: "", frequency: "monthly", run_time: "08:00", export_format: "excel" });
      setNotice({ type: "success", message: "تم حفظ جدولة التقرير." });
      loadCurrentTab();
    } catch (error) {
      setNotice({ type: "error", message: error instanceof Error ? error.message : "تعذر حفظ الجدولة." });
    }
  }

  async function deleteSchedule(id: unknown) {
    if (!window.confirm("هل تريد حذف جدولة التقرير؟")) return;
    await apiFetch(`/reports/scheduled/${id}`, { method: "DELETE" });
    loadCurrentTab();
  }

  const cards = useMemo(() => data.cards || data.summary || {}, [data]);
  const chartGroups = useMemo(() => Object.entries(data.charts || {}).slice(0, 4), [data]);
  const tableColumns = columnSets[activeTab] || [];
  const tableRows = data.items || [];
  const totalItems = data.pagination?.total || tableRows.length || 0;

  return (
    <div className="space-y-5" dir="rtl">
      <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-sm font-semibold text-bank-700">مركز التقارير</p>
            <h2 className="mt-2 text-2xl font-bold text-slate-950">التقارير</h2>
            <p className="mt-2 text-sm leading-6 text-slate-500">تقارير تشغيلية ورقابية مبنية على بيانات النظام ونطاق صلاحيات المستخدم.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={() => exportReport("excel")} disabled={Boolean(exporting)} className="gap-2">
              <FileSpreadsheet className="h-4 w-4" />
              {exporting === "excel" ? "جاري التصدير..." : "تصدير Excel"}
            </Button>
            <button type="button" onClick={() => exportReport("pdf")} disabled={Boolean(exporting)} className="inline-flex h-10 items-center gap-2 rounded-md border border-slate-300 px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60">
              <Download className="h-4 w-4" />
              PDF
            </button>
          </div>
        </div>
      </section>

      <Card className="p-4">
        <div className="flex gap-2 overflow-x-auto pb-1">
          {reportTabs.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key)}
              className={`shrink-0 rounded-md border px-4 py-2 text-sm font-bold transition ${
                activeTab === tab.key ? "border-bank-600 bg-bank-50 text-bank-800" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </Card>

      <Card className="p-5">
        <form onSubmit={loadCurrentTab} className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {quickRanges.map((range) => (
              <button key={range.key} type="button" onClick={() => applyQuickRange(range)} className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-bold text-slate-700 hover:bg-bank-50">
                {range.label}
              </button>
            ))}
          </div>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <Field label="من تاريخ"><input type="date" value={filters.date_from} onChange={(e) => setFilters({ ...filters, date_from: e.target.value })} className="input" /></Field>
            <Field label="إلى تاريخ"><input type="date" value={filters.date_to} onChange={(e) => setFilters({ ...filters, date_to: e.target.value })} className="input" /></Field>
            <Field label="الإدارة"><Select value={filters.department_id} onChange={(value) => setFilters({ ...filters, department_id: value })} options={departments} allLabel="كل الإدارات" /></Field>
            <Field label="نوع الطلب"><Select value={filters.request_type_id} onChange={(value) => setFilters({ ...filters, request_type_id: value })} options={requestTypes} allLabel="كل أنواع الطلب" /></Field>
            <Field label="الحالة"><NativeSelect value={filters.status} onChange={(value) => setFilters({ ...filters, status: value })} options={statusOptions} /></Field>
            <Field label="الأولوية"><NativeSelect value={filters.priority} onChange={(value) => setFilters({ ...filters, priority: value })} options={priorityOptions} /></Field>
            <Field label="القسم المختص"><Select value={filters.specialized_section_id} onChange={(value) => setFilters({ ...filters, specialized_section_id: value })} options={specializedSections} allLabel="كل الأقسام" /></Field>
            <Field label="مقدم الطلب"><Select value={filters.requester_id} onChange={(value) => setFilters({ ...filters, requester_id: value })} options={users} allLabel="كل المستخدمين" userLabel /></Field>
            <Field label="الموظف المنفذ"><Select value={filters.assigned_user_id} onChange={(value) => setFilters({ ...filters, assigned_user_id: value })} options={users} allLabel="كل المنفذين" userLabel /></Field>
            <Field label="خطوة الموافقة"><input value={filters.approval_step} onChange={(e) => setFilters({ ...filters, approval_step: e.target.value })} placeholder="مثال: مدير مباشر" className="input" /></Field>
            <Field label="حالة SLA"><NativeSelect value={filters.sla_status} onChange={(value) => setFilters({ ...filters, sla_status: value })} options={slaOptions} /></Field>
            <Field label="نوع الرسالة"><input value={filters.message_type} onChange={(e) => setFilters({ ...filters, message_type: e.target.value })} placeholder="official_message" className="input" /></Field>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4">
            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={loading} className="gap-2"><Filter className="h-4 w-4" /> تطبيق الفلاتر</Button>
              <button type="button" onClick={() => { setFilters(emptyFilters); setPage(1); }} className="inline-flex h-10 items-center gap-2 rounded-md border border-slate-300 px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50">
                <RefreshCw className="h-4 w-4" />
                إعادة تعيين
              </button>
            </div>
            <button type="button" onClick={saveCurrentReport} className="inline-flex h-10 items-center gap-2 rounded-md border border-bank-300 px-4 text-sm font-bold text-bank-700 hover:bg-bank-50">
              <Save className="h-4 w-4" />
              حفظ كتقرير محفوظ
            </button>
          </div>
        </form>
      </Card>

      {notice.message && <div className={`rounded-lg border p-3 text-sm font-bold ${notice.type === "error" ? "border-red-200 bg-red-50 text-red-700" : "border-emerald-200 bg-emerald-50 text-emerald-800"}`}>{notice.message}</div>}

      {activeTab === "saved" ? (
        <SavedReportsPanel items={savedReports} onRun={runSavedReport} onDelete={deleteSavedReport} loading={loading} />
      ) : activeTab === "templates" ? (
        <TemplatesPanel items={templates} form={templateForm} setForm={setTemplateForm} onCreate={createTemplate} onRun={runTemplate} onDisable={disableTemplate} loading={loading} />
      ) : activeTab === "scheduled" ? (
        <ScheduledPanel items={scheduledReports} templates={templates} form={scheduleForm} setForm={setScheduleForm} onCreate={createSchedule} onDelete={deleteSchedule} loading={loading} />
      ) : (
        <>
          {data.disabled ? (
            <Card className="p-6 text-center text-sm font-bold text-slate-500">{data.message || "الوحدة غير مفعلة."}</Card>
          ) : (
            <>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                {Object.entries(cards).slice(0, 8).map(([key, value]) => <Metric key={key} label={summaryLabels[key] || key} value={formatMetric(value)} />)}
                {!loading && Object.keys(cards).length === 0 && <EmptyCard text="لا توجد مؤشرات لهذا التبويب حالياً." />}
              </div>
              <div className="grid gap-3 xl:grid-cols-2">
                {chartGroups.map(([key, rows]) => <ChartCard key={key} title={chartTitle(key)} rows={rows || []} />)}
              </div>
              <Card className="p-5">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h3 className="text-lg font-bold text-slate-950">{activeTabConfig?.label}</h3>
                    <p className="mt-1 text-sm text-slate-500">عدد النتائج: {totalItems}</p>
                  </div>
                  <button type="button" onClick={() => loadCurrentTab()} className="inline-flex h-10 items-center gap-2 rounded-md border border-slate-300 px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50">
                    <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
                    تحديث
                  </button>
                </div>
                <ReportTable columns={tableColumns} rows={tableRows} loading={loading} />
                {data.pagination && <Pagination page={page} totalItems={data.pagination.total} pageSize={data.pagination.page_size} onPageChange={setPage} />}
              </Card>
            </>
          )}
        </>
      )}
    </div>
  );
}

function cleanFilters(filters: ReportFilters) {
  return Object.fromEntries(Object.entries(filters).filter(([, value]) => value !== ""));
}

function toDateInput(date: Date) {
  return date.toISOString().slice(0, 10);
}

function formatMetric(value: unknown) {
  if (value === null || value === undefined || value === "") return "-";
  if (typeof value === "boolean") return value ? "نعم" : "لا";
  if (typeof value === "number") return value.toLocaleString("ar");
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value)) return formatSystemDate(value);
  return String(value);
}

function formatCell(value: unknown) {
  if (value === null || value === undefined || value === "") return "-";
  if (typeof value === "boolean") return value ? "نعم" : "لا";
  if (typeof value === "number") {
    if (value > 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`;
    return value.toLocaleString("ar");
  }
  if (typeof value === "object") return JSON.stringify(value);
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value)) return formatSystemDate(value);
  return String(value);
}

function chartTitle(key: string) {
  return {
    requests_by_status: "الطلبات حسب الحالة",
    requests_by_priority: "الطلبات حسب الأولوية",
    requests_by_department: "الطلبات حسب الإدارة",
    requests_by_month: "الطلبات حسب الشهر",
    sla_trend: "اتجاه الالتزام بـ SLA",
    by_status: "حسب الحالة",
    by_priority: "حسب الأولوية",
    by_type: "حسب النوع",
    by_action: "حسب الإجراء",
    by_module: "حسب الوحدة",
    over_time: "مع مرور الوقت",
    sla_status: "حالة SLA"
  }[key] || key;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="block space-y-2 text-sm font-bold text-slate-700">{label}{children}</label>;
}

function NativeSelect({ value, onChange, options }: { value: string; onChange: (value: string) => void; options: string[][] }) {
  return <select value={value} onChange={(e) => onChange(e.target.value)} className="input">{options.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>;
}

function Select({ value, onChange, options, allLabel, userLabel = false }: { value: string; onChange: (value: string) => void; options: Option[]; allLabel: string; userLabel?: boolean }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className="input">
      <option value="">{allLabel}</option>
      {options.map((item) => <option key={item.id} value={item.id}>{userLabel ? item.full_name_ar || item.name_ar || item.code : item.name_ar || item.label || item.code || `#${item.id}`}</option>)}
    </select>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <Card className="p-4"><p className="text-sm font-semibold text-slate-500">{label}</p><p className="mt-2 text-2xl font-black text-slate-950">{value}</p></Card>;
}

function EmptyCard({ text }: { text: string }) {
  return <Card className="p-4 text-sm font-bold text-slate-500">{text}</Card>;
}

function ChartCard({ title, rows }: { title: string; rows: Array<Record<string, unknown>> }) {
  const max = Math.max(1, ...rows.map((row) => Number(row.count || row.met || row.breached || 0)));
  return (
    <Card className="p-5">
      <div className="mb-4 flex items-center gap-2">
        <BarChart3 className="h-5 w-5 text-bank-700" />
        <h3 className="font-bold text-slate-950">{title}</h3>
      </div>
      <div className="space-y-3">
        {rows.length === 0 && <p className="text-sm text-slate-500">لا توجد بيانات كافية للرسم.</p>}
        {rows.slice(0, 8).map((row, index) => {
          const label = String(row.label ?? row.name ?? "غير محدد");
          const count = Number(row.count ?? row.met ?? row.breached ?? 0);
          return (
            <div key={`${label}-${index}`} className="space-y-1">
              <div className="flex items-center justify-between text-xs font-bold text-slate-600"><span>{label}</span><span>{count.toLocaleString("ar")}</span></div>
              <div className="h-2 rounded-full bg-slate-100"><div className="h-2 rounded-full bg-bank-600" style={{ width: `${Math.max(6, (count / max) * 100)}%` }} /></div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function ReportTable({ columns, rows, loading }: { columns: Array<{ key: string; label: string }>; rows: Array<Record<string, unknown>>; loading: boolean }) {
  if (!columns.length) return null;
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200">
      <table className="w-full min-w-[980px] text-sm">
        <thead className="bg-slate-50 text-xs font-black text-slate-500">
          <tr>{columns.map((column) => <th key={column.key} className="p-3 text-right">{column.label}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {loading && <tr><td colSpan={columns.length} className="p-8 text-center text-slate-500">جار تحميل التقرير...</td></tr>}
          {!loading && rows.length === 0 && <tr><td colSpan={columns.length} className="p-8 text-center text-slate-500">لا توجد نتائج مطابقة.</td></tr>}
          {!loading && rows.map((row, index) => (
            <tr key={String(row.id ?? index)} className="hover:bg-slate-50">
              {columns.map((column) => <td key={column.key} className="p-3 font-medium text-slate-700">{formatCell(row[column.key])}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SavedReportsPanel({ items, onRun, onDelete, loading }: { items: Array<Record<string, unknown>>; onRun: (item: Record<string, unknown>) => void; onDelete: (id: unknown) => void; loading: boolean }) {
  return (
    <Card className="p-5">
      <PanelHeader icon={<Save className="h-5 w-5" />} title="التقارير المحفوظة" subtitle="التقارير التي تحفظ فلاتر المستخدم لتشغيلها لاحقاً." />
      <div className="grid gap-3">
        {loading && <p className="text-sm text-slate-500">جار التحميل...</p>}
        {!loading && items.length === 0 && <p className="text-sm text-slate-500">لا توجد تقارير محفوظة.</p>}
        {items.map((item) => (
          <div key={String(item.id)} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 p-4">
            <div>
              <h3 className="font-bold text-slate-950">{String(item.name)}</h3>
              <p className="mt-1 text-sm text-slate-500">{String(item.report_type_label || item.report_type || "")} - {item.created_at ? formatSystemDate(String(item.created_at)) : ""}</p>
            </div>
            <div className="flex gap-2">
              <Button type="button" onClick={() => onRun(item)} className="gap-2"><Search className="h-4 w-4" /> تشغيل</Button>
              <button type="button" onClick={() => onDelete(item.id)} className="inline-flex h-10 items-center gap-2 rounded-md border border-red-200 px-3 text-sm font-bold text-red-700"><Trash2 className="h-4 w-4" /> حذف</button>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

function TemplatesPanel({ items, form, setForm, onCreate, onRun, onDisable, loading }: {
  items: Array<Record<string, unknown>>;
  form: { name_ar: string; code: string; report_type: string; description: string };
  setForm: (value: { name_ar: string; code: string; report_type: string; description: string }) => void;
  onCreate: (event: FormEvent) => void;
  onRun: (id: unknown) => void;
  onDisable: (id: unknown) => void;
  loading: boolean;
}) {
  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_360px]">
      <Card className="p-5">
        <PanelHeader icon={<FileText className="h-5 w-5" />} title="قوالب التقارير" subtitle="قوالب جاهزة أو مخصصة لتشغيل تقارير بفلاتر وأعمدة محددة." />
        <div className="grid gap-3">
          {loading && <p className="text-sm text-slate-500">جار التحميل...</p>}
          {items.map((item) => (
            <div key={String(item.id)} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 p-4">
              <div>
                <h3 className="font-bold text-slate-950">{String(item.name_ar)}</h3>
                <p className="mt-1 text-sm text-slate-500">{String(item.report_type_label || item.report_type || "")} - {String(item.description || "")}</p>
              </div>
              <div className="flex gap-2">
                <Button type="button" onClick={() => onRun(item.id)}>تشغيل</Button>
                <button type="button" onClick={() => onDisable(item.id)} className="h-10 rounded-md border border-slate-300 px-3 text-sm font-bold text-slate-700">تعطيل</button>
              </div>
            </div>
          ))}
        </div>
      </Card>
      <Card className="p-5">
        <h3 className="font-bold text-slate-950">إضافة قالب</h3>
        <form onSubmit={onCreate} className="mt-4 space-y-3">
          <Field label="اسم القالب"><input value={form.name_ar} onChange={(e) => setForm({ ...form, name_ar: e.target.value })} required className="input" /></Field>
          <Field label="الكود"><input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} required className="input" /></Field>
          <Field label="نوع التقرير"><NativeSelect value={form.report_type} onChange={(value) => setForm({ ...form, report_type: value })} options={reportTabs.filter((tab) => tab.reportType && tab.key !== "summary").map((tab) => [tab.reportType || "", tab.label])} /></Field>
          <Field label="الوصف"><textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="input min-h-24" /></Field>
          <Button type="submit" className="w-full">حفظ القالب</Button>
        </form>
      </Card>
    </div>
  );
}

function ScheduledPanel({ items, templates, form, setForm, onCreate, onDelete, loading }: {
  items: Array<Record<string, unknown>>;
  templates: Array<Record<string, unknown>>;
  form: { name: string; report_template_id: string; frequency: string; run_time: string; export_format: string };
  setForm: (value: { name: string; report_template_id: string; frequency: string; run_time: string; export_format: string }) => void;
  onCreate: (event: FormEvent) => void;
  onDelete: (id: unknown) => void;
  loading: boolean;
}) {
  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_360px]">
      <Card className="p-5">
        <PanelHeader icon={<CalendarClock className="h-5 w-5" />} title="جدولة التقارير" subtitle="المرحلة الحالية تحفظ تعريفات الجدولة، ولا ترسل بريداً إلا عند توفر وحدة إشعارات مناسبة." />
        <div className="grid gap-3">
          {loading && <p className="text-sm text-slate-500">جار التحميل...</p>}
          {items.length === 0 && !loading && <p className="text-sm text-slate-500">لا توجد جدولة تقارير.</p>}
          {items.map((item) => (
            <div key={String(item.id)} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 p-4">
              <div>
                <h3 className="font-bold text-slate-950">{String(item.name)}</h3>
                <p className="mt-1 text-sm text-slate-500">{String(item.template_name || "")} - {String(item.frequency)} - {String(item.run_time)}</p>
              </div>
              <button type="button" onClick={() => onDelete(item.id)} className="inline-flex h-10 items-center gap-2 rounded-md border border-red-200 px-3 text-sm font-bold text-red-700"><Trash2 className="h-4 w-4" /> حذف</button>
            </div>
          ))}
        </div>
      </Card>
      <Card className="p-5">
        <h3 className="font-bold text-slate-950">إضافة جدولة</h3>
        <form onSubmit={onCreate} className="mt-4 space-y-3">
          <Field label="اسم الجدولة"><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required className="input" /></Field>
          <Field label="القالب">
            <select value={form.report_template_id} onChange={(e) => setForm({ ...form, report_template_id: e.target.value })} required className="input">
              <option value="">اختر قالباً</option>
              {templates.map((item) => <option key={String(item.id)} value={String(item.id)}>{String(item.name_ar)}</option>)}
            </select>
          </Field>
          <Field label="التكرار"><NativeSelect value={form.frequency} onChange={(value) => setForm({ ...form, frequency: value })} options={[["daily", "يومي"], ["weekly", "أسبوعي"], ["monthly", "شهري"]]} /></Field>
          <Field label="وقت التشغيل"><input type="time" value={form.run_time} onChange={(e) => setForm({ ...form, run_time: e.target.value })} className="input" /></Field>
          <Field label="الصيغة"><NativeSelect value={form.export_format} onChange={(value) => setForm({ ...form, export_format: value })} options={[["excel", "Excel"], ["pdf", "PDF"]]} /></Field>
          <Button type="submit" className="w-full">حفظ الجدولة</Button>
        </form>
      </Card>
    </div>
  );
}

function PanelHeader({ icon, title, subtitle }: { icon: ReactNode; title: string; subtitle: string }) {
  return <div className="mb-4 flex items-start gap-3">{icon}<div><h3 className="font-bold text-slate-950">{title}</h3><p className="mt-1 text-sm text-slate-500">{subtitle}</p></div></div>;
}
