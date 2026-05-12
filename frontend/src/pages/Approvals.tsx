import { FormEvent, useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Circle, Clock3, Download, ExternalLink, FileCheck2, FileText, Filter, HelpCircle, Image as ImageIcon, Paperclip, RefreshCw, RotateCcw, Search, Send, UserCheck, XCircle } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { API_BASE, apiFetch, ApprovalAction, ApprovalStep, Attachment, CurrentUser, ServiceRequest } from "../lib/api";
import { formatSystemDateTime } from "../lib/datetime";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { Pagination } from "../components/ui/Pagination";

const requestTypeLabels: Record<string, string> = {
  email: "طلبات البريد الإلكتروني",
  domain: "طلبات الدومين",
  vpn_remote_access: "VPN وصول عن بعد",
  internet_access: "الوصول للإنترنت",
  data_copy: "نسخ البيانات",
  network_access: "صلاحيات الشبكة",
  computer_move_installation: "نقل أو تركيب جهاز",
  it_support_ticket: "تذكرة دعم فني"
};

const statusLabels: Record<string, string> = {
  draft: "مسودة",
  submitted: "مرسل",
  pending_approval: "بانتظار الموافقة",
  returned_for_edit: "معاد للتعديل",
  approved: "معتمد",
  rejected: "مرفوض",
  in_implementation: "قيد التنفيذ",
  completed: "مكتمل",
  closed: "مغلق",
  cancelled: "ملغي"
};

const priorityLabels: Record<string, string> = {
  low: "منخفضة",
  medium: "متوسطة",
  high: "عالية",
  critical: "حرجة"
};

const roleLabels: Record<string, string> = {
  direct_manager: "المدير المباشر",
  department_manager: "مدير الإدارة",
  department_specialist: "مختص الإدارة",
  specific_department_manager: "مدير إدارة",
  information_security: "أمن المعلومات (مرحلة قديمة)",
  administration_manager: "مدير إدارة",
  it_staff: "مختص تنفيذ",
  executive_management: "الإدارة التنفيذية",
  implementation_engineer: "مختص تنفيذ",
  implementation: "مختص تنفيذ",
  execution: "مختص تنفيذ"
};

const sectionLabels: Record<string, string> = {
  networks: "قسم الشبكات",
  servers: "قسم السيرفرات",
  support: "قسم الدعم الفني",
  development: "وحدة تطوير البرامج"
};

const fieldLabels: Record<string, string> = {
  source_ip: "عنوان المصدر",
  destination_ip: "عنوان الوجهة",
  destination_port: "منفذ الوجهة",
  nat_port: "منفذ NAT",
  reason: "المبرر",
  asset_tag: "رقم الجهاز",
  current_location: "الموقع الحالي",
  new_location: "الموقع الجديد",
  issue_description: "وصف المشكلة",
  assigned_section: "القسم المختص",
  administrative_section: "القسم المختص",
  assigned_section_label: "القسم المختص",
  administrative_section_label: "القسم المختص",
  request_type_code: "رمز نوع الطلب",
  request_type_label: "نوع الطلب"
};

const actionLabels: Record<ApprovalAction, string> = {
  pending: "بانتظار الإجراء",
  approved: "تمت الموافقة",
  rejected: "تم الرفض",
  returned_for_edit: "أعيد للتعديل",
  skipped: "تم التجاوز"
};

const approvalsPageSize = 12;

type ApprovalsTab = "mine" | "tracking" | "execution" | "returned" | "overdue" | "completed" | "history";

type ApprovalsSummary = {
  waiting_my_approval: number;
  tracking: number;
  waiting_execution: number;
  returned_for_edit: number;
  overdue: number;
  processed_today: number;
};

const approvalCardDescriptions: Record<Exclude<ApprovalsTab, "history">, string> = {
  mine: "الطلبات التي يمكنك اعتمادها الآن",
  tracking: "طلباتك المقدمة ومسارها الحالي",
  execution: "خطوات التنفيذ المسندة لك",
  returned: "طلبات أُعيدت لأصحابها",
  overdue: "طلبات تجاوزت SLA",
  completed: "طلبات تمت معالجتها اليوم"
};

function getCurrentStep(request?: ServiceRequest) {
  return [...(request?.approvals ?? [])].sort((first, second) => first.step_order - second.step_order).find((step) => step.action === "pending") ?? null;
}

function formatDate(value?: string | null) {
  return formatSystemDateTime(value);
}

function assignedSection(request?: ServiceRequest) {
  const key = request?.form_data?.assigned_section || request?.form_data?.administrative_section || "";
  const label = request?.form_data?.assigned_section_label || request?.form_data?.administrative_section_label;
  return label || sectionLabels[key] || "-";
}

function requestTypeName(request: ServiceRequest) {
  const snapshot = request.request_type_snapshot ?? {};
  const snapshotName = typeof snapshot.name_ar === "string" ? snapshot.name_ar : "";
  return snapshotName || request.form_data?.request_type_label || requestTypeLabels[request.request_type] || request.request_type || "-";
}

function workflowSectionName(request?: ServiceRequest | null) {
  const formData = request?.form_data ?? {};
  const snapshot = request?.request_type_snapshot ?? {};
  const formSectionKey = formData.assigned_section || formData.administrative_section || "";
  const snapshotSectionKey = typeof snapshot.assigned_section === "string" ? snapshot.assigned_section : "";
  const snapshotSectionLabel = typeof snapshot.assigned_section_label === "string" ? snapshot.assigned_section_label : "";
  const snapshotSpecializedName = typeof snapshot.specialized_section_name === "string" ? snapshot.specialized_section_name : "";

  return (
    formData.assigned_section_label ||
    formData.administrative_section_label ||
    snapshotSpecializedName ||
    snapshotSectionLabel ||
    sectionLabels[formSectionKey] ||
    sectionLabels[snapshotSectionKey] ||
    ""
  );
}

function workflowDepartmentName(request?: ServiceRequest | null) {
  const formData = request?.form_data ?? {};
  const snapshot = request?.request_type_snapshot ?? {};
  const formDepartmentName = typeof formData.assigned_department_name === "string" ? formData.assigned_department_name : "";
  const snapshotDepartmentName = typeof snapshot.assigned_department_name === "string" ? snapshot.assigned_department_name : "";

  return formDepartmentName || snapshotDepartmentName || request?.department?.name_ar || workflowSectionName(request);
}

function approvalStepLabel(step?: ApprovalStep | null, request?: ServiceRequest | null) {
  if (!step) return "-";
  if (step.display_label) return step.display_label;
  const departmentName = workflowDepartmentName(request);
  const sectionName = workflowSectionName(request);
  if (departmentName && step.role === "department_manager") return `مدير ${departmentName}`;
  if (sectionName && step.role === "department_specialist") return `مختص ${sectionName}`;
  if (departmentName && step.role === "specific_department_manager") return `مدير ${departmentName}`;
  return roleLabels[step.role] ?? step.role;
}

function slaStatus(request: ServiceRequest) {
  if (!request.sla_due_at) return "none";
  const due = new Date(request.sla_due_at).getTime();
  const now = Date.now();
  if (["closed", "completed", "rejected", "cancelled"].includes(request.status)) {
    const closed = request.closed_at ? new Date(request.closed_at).getTime() : now;
    return closed <= due ? "met" : "breached";
  }
  return due < now ? "overdue" : "within";
}

function slaLabel(request: ServiceRequest) {
  const status = slaStatus(request);
  if (status === "overdue") return "متأخر";
  if (status === "within") return "ضمن الوقت";
  if (status === "breached") return "تم تجاوزه";
  if (status === "met") return "ملتزم";
  return "غير محدد";
}

function slaTone(request: ServiceRequest) {
  const status = slaStatus(request);
  if (status === "overdue" || status === "breached") return "bg-red-50 text-red-700";
  if (status === "within") return "bg-amber-50 text-amber-700";
  if (status === "met") return "bg-bank-50 text-bank-700";
  return "bg-slate-100 text-slate-600";
}

function waitingTimeLabel(request: ServiceRequest) {
  const step = getCurrentStep(request);
  const start = step?.acted_at || request.updated_at || request.created_at;
  const diffMs = Math.max(0, Date.now() - new Date(start).getTime());
  const hours = Math.floor(diffMs / 3_600_000);
  if (hours < 1) return "أقل من ساعة";
  if (hours < 24) return `${hours} ساعة`;
  return `${Math.floor(hours / 24)} يوم`;
}

function isExecutionStep(step: ApprovalStep | null) {
  return Boolean(step && ["implementation", "execution", "implementation_engineer", "close_request"].includes(step.role));
}

async function openAttachment(requestId: number, attachment: Attachment) {
  const token = localStorage.getItem("qib_token");
  const response = await fetch(`${API_BASE}/requests/${requestId}/attachments/${attachment.id}/download`, {
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    }
  });
  if (!response.ok) return;
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  window.open(url, "_blank", "noopener,noreferrer");
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

async function handleRequestPdf(request: ServiceRequest, action: "preview" | "download") {
  const token = localStorage.getItem("qib_token");
  const response = await fetch(`${API_BASE}/requests/${request.id}/print.pdf`, {
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    }
  });
  if (!response.ok) return;
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  if (action === "preview") {
    const opened = window.open(url, "_blank", "noopener,noreferrer");
    if (!opened) {
      const link = document.createElement("a");
      link.href = url;
      link.download = `${request.request_number || "request"}.pdf`;
      link.click();
    }
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } else {
    const link = document.createElement("a");
    link.href = url;
    link.download = `${request.request_number || "request"}.pdf`;
    link.click();
    URL.revokeObjectURL(url);
  }
}

function formatBytes(size?: number) {
  if (!size) return "-";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

type ActiveDelegation = {
  id: number;
  delegator_role?: string | null;
  delegation_scope: string;
};

function isActionableForUser(step: ApprovalStep | null, user: CurrentUser | null, delegations: ActiveDelegation[] = []) {
  if (!step || !user) return false;
  if (typeof step.can_act === "boolean") return step.can_act;
  if (user.role === "super_admin") return true;
  if (step.role === user.role) return true;
  if (["implementation", "execution", "implementation_engineer", "close_request"].includes(step.role) && ["it_staff", "administration_manager"].includes(user.role)) {
    return true;
  }
  return delegations.some(
    (delegation) =>
      ["approvals_only", "all_allowed_actions"].includes(delegation.delegation_scope) &&
      delegation.delegator_role === step.role
  );
}

export function Approvals() {
  const navigate = useNavigate();
  const [requests, setRequests] = useState<ServiceRequest[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [decision, setDecision] = useState<"approved" | "rejected" | "returned_for_edit">("approved");
  const [note, setNote] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);
  const [activeDelegations, setActiveDelegations] = useState<ActiveDelegation[]>([]);
  const [summary, setSummary] = useState<ApprovalsSummary>({ waiting_my_approval: 0, tracking: 0, waiting_execution: 0, returned_for_edit: 0, overdue: 0, processed_today: 0 });
  const [activeTab, setActiveTab] = useState<ApprovalsTab>("mine");
  const [search, setSearch] = useState("");
  const [priorityFilter, setPriorityFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [slaFilter, setSlaFilter] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [showApprovalPath, setShowApprovalPath] = useState(false);
  const [approvalsPage, setApprovalsPage] = useState(1);

  const selectedRequest = useMemo(
    () => (selectedId ? requests.find((request) => request.id === selectedId) : undefined),
    [requests, selectedId]
  );

  const currentStep = getCurrentStep(selectedRequest);
  const canShowDecisionForm = isActionableForUser(currentStep, currentUser, activeDelegations);
  const currentStepCanReject = Boolean(currentStep && currentStep.can_reject !== false);
  const decisionGridClass =
    currentStepCanReject && currentStep?.can_return_for_edit
      ? "grid-cols-3"
      : currentStepCanReject || currentStep?.can_return_for_edit
        ? "grid-cols-2"
        : "grid-cols-1";
  const hasActiveFilters = Boolean(search.trim() || priorityFilter || statusFilter || slaFilter || dateFrom || dateTo);
  const filteredRequests = useMemo(() => requests, [requests]);
  const paginatedRequests = useMemo(() => {
    const start = (approvalsPage - 1) * approvalsPageSize;
    return filteredRequests.slice(start, start + approvalsPageSize);
  }, [filteredRequests, approvalsPage]);

  useEffect(() => {
    const totalPages = Math.max(1, Math.ceil(filteredRequests.length / approvalsPageSize));
    if (approvalsPage > totalPages) {
      setApprovalsPage(totalPages);
      return;
    }
    if (paginatedRequests.length === 0) {
      setSelectedId(null);
      return;
    }
    if (!selectedId || !paginatedRequests.some((request) => request.id === selectedId)) {
      setSelectedId(paginatedRequests[0].id);
    }
  }, [filteredRequests.length, paginatedRequests, selectedId, approvalsPage]);

  async function loadSummary() {
    try {
      setSummary(await apiFetch<ApprovalsSummary>("/approvals/summary"));
    } catch {
      setSummary({ waiting_my_approval: 0, tracking: 0, waiting_execution: 0, returned_for_edit: 0, overdue: 0, processed_today: 0 });
    }
  }

  function approvalsQuery() {
    const params = new URLSearchParams({ tab: activeTab });
    if (search.trim()) params.set("search", search.trim());
    if (priorityFilter) params.set("priority", priorityFilter);
    if (statusFilter) params.set("status", statusFilter);
    if (slaFilter) params.set("sla_status", slaFilter);
    if (dateFrom) params.set("date_from", `${dateFrom}T00:00:00`);
    if (dateTo) params.set("date_to", `${dateTo}T23:59:59`);
    return params.toString();
  }

  async function loadApprovals(query = approvalsQuery()) {
    setIsLoading(true);
    setError("");
    try {
      const data = await apiFetch<ServiceRequest[]>(`/approvals?${query}`);
      const sorted = data.sort((a, b) => Number(isActionableForUser(getCurrentStep(b), currentUser, activeDelegations)) - Number(isActionableForUser(getCurrentStep(a), currentUser, activeDelegations)));
      setRequests(sorted);
      setSelectedId((current) => current ?? sorted[0]?.id ?? null);
    } catch {
      setRequests([]);
      setError("تعذر تحميل طلبات الموافقات من الخادم.");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    loadApprovals();
    loadSummary();
    apiFetch<CurrentUser>("/auth/me").then(setCurrentUser).catch(() => setCurrentUser(null));
    apiFetch<ActiveDelegation[]>("/users/delegations/me").then(setActiveDelegations).catch(() => setActiveDelegations([]));
  }, []);

  useEffect(() => {
    if (currentUser?.role === "employee") {
      setActiveTab("tracking");
    }
  }, [currentUser?.role]);

  useEffect(() => {
    setShowApprovalPath(false);
  }, [selectedId]);

  useEffect(() => {
    setApprovalsPage(1);
    setSelectedId(null);
    loadApprovals();
  }, [activeTab]);

  useEffect(() => {
    if ((decision === "rejected" && !currentStepCanReject) || (decision === "returned_for_edit" && !currentStep?.can_return_for_edit)) {
      setDecision("approved");
    }
  }, [currentStep?.can_return_for_edit, currentStepCanReject, decision]);

  async function submitDecision(event: FormEvent) {
    event.preventDefault();
    if (!selectedRequest) return;
    setMessage("");
    setError("");
    if (decision === "rejected" && !currentStepCanReject) {
      setError("هذه المرحلة لا تسمح بالرفض حسب إعدادات مسار الموافقات.");
      return;
    }
    if (decision === "returned_for_edit" && !currentStep?.can_return_for_edit) {
      setError("هذه المرحلة لا تسمح بالإرجاع للتعديل حسب إعدادات مسار الموافقات.");
      return;
    }
    if ((decision === "rejected" || decision === "returned_for_edit") && !note.trim()) {
      setError(decision === "rejected" ? "سبب الرفض مطلوب قبل حفظ القرار." : "ملاحظات الإرجاع للتعديل مطلوبة قبل حفظ القرار.");
      return;
    }
    const confirmationText =
      decision === "approved"
        ? "تأكيد الموافقة على هذه المرحلة؟"
        : decision === "returned_for_edit"
          ? "تأكيد إرجاع الطلب للتعديل؟"
          : "تأكيد رفض الطلب؟";
    if (!window.confirm(confirmationText)) return;
    setIsSubmitting(true);

    try {
      const updated = await apiFetch<ServiceRequest>(`/requests/${selectedRequest.id}/approval`, {
        method: "POST",
        body: JSON.stringify({ action: decision, note })
      });
      setRequests((current) => current.map((request) => (request.id === updated.id ? updated : request)));
      setSelectedId(updated.id);
      setNote("");
      loadSummary();
      setMessage(decision === "approved" ? "تمت الموافقة على الخطوة الحالية." : decision === "returned_for_edit" ? "تم إرجاع الطلب للتعديل حسب إعدادات مسار الموافقات." : "تم رفض الطلب وتحديث سجل الموافقات.");
    } catch {
      setError("تعذر تنفيذ قرار الموافقة. تحقق من أن لديك صلاحية على الخطوة الحالية.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="space-y-6">
      <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-sm font-semibold text-bank-700">الموافقات</p>
            <h2 className="mt-2 text-2xl font-bold text-slate-950">مركز الموافقات والتنفيذ</h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">
              راجع الطلبات المسندة لك، اتخذ قرار الموافقة أو التنفيذ، وتابع المسارات المتأخرة والمعادة للتعديل من مكان واحد.
            </p>
          </div>
          <Button onClick={() => { loadApprovals(); loadSummary(); }} disabled={isLoading} className="gap-2 self-start lg:self-auto">
            <RefreshCw className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
            تحديث الموافقات
          </Button>
        </div>
      </section>

      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
        <SummaryCard label="بانتظار موافقتي" description={approvalCardDescriptions.mine} value={summary.waiting_my_approval} active={activeTab === "mine"} onClick={() => setActiveTab("mine")} />
        <SummaryCard label="متابعة طلباتي" description={approvalCardDescriptions.tracking} value={summary.tracking} active={activeTab === "tracking"} onClick={() => setActiveTab("tracking")} />
        <SummaryCard label="بانتظار التنفيذ" description={approvalCardDescriptions.execution} value={summary.waiting_execution} active={activeTab === "execution"} onClick={() => setActiveTab("execution")} />
        <SummaryCard label="متأخرة" description={approvalCardDescriptions.overdue} value={summary.overdue} active={activeTab === "overdue"} tone="danger" onClick={() => setActiveTab("overdue")} />
        <SummaryCard label="معادة للتعديل" description={approvalCardDescriptions.returned} value={summary.returned_for_edit} active={activeTab === "returned"} tone="warning" onClick={() => setActiveTab("returned")} />
        <SummaryCard label="تمت معالجتها اليوم" description={approvalCardDescriptions.completed} value={summary.processed_today} active={activeTab === "completed"} onClick={() => setActiveTab("completed")} />
      </section>

      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => setShowFilters((current) => !current)}
          className={`inline-flex h-10 items-center gap-2 rounded-md border px-4 text-sm font-bold transition ${
            showFilters || hasActiveFilters
              ? "border-bank-200 bg-bank-50 text-bank-800"
              : "border-slate-200 bg-white text-slate-700 hover:border-bank-200 hover:bg-bank-50"
          }`}
        >
          <Filter className="h-4 w-4" />
          {showFilters ? "إخفاء الفلاتر" : "إظهار الفلاتر"}
          {hasActiveFilters && <span className="rounded-full bg-bank-700 px-2 py-0.5 text-xs text-white">مفعلة</span>}
        </button>
      </div>

      {showFilters && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            setApprovalsPage(1);
            loadApprovals();
          }}
          className="grid gap-3 rounded-lg border border-slate-200 bg-white p-4 shadow-sm lg:grid-cols-[1.4fr_repeat(5,minmax(0,1fr))_auto]"
        >
          <div className="relative">
            <Search className="pointer-events-none absolute right-3 top-2.5 h-4 w-4 text-slate-400" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="بحث برقم الطلب أو الموظف أو العنوان"
              className="h-10 w-full rounded-md border border-slate-300 bg-white pr-9 pl-3 text-sm outline-none focus:border-bank-600 focus:ring-2 focus:ring-bank-100"
            />
          </div>
          <select value={priorityFilter} onChange={(event) => setPriorityFilter(event.target.value)} className="h-10 rounded-md border border-slate-300 bg-white px-3 text-sm">
            <option value="">كل الأولويات</option>
            <option value="low">منخفضة</option>
            <option value="medium">متوسطة</option>
            <option value="high">عالية</option>
            <option value="critical">حرجة</option>
          </select>
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="h-10 rounded-md border border-slate-300 bg-white px-3 text-sm">
            <option value="">كل الحالات</option>
            {Object.entries(statusLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select>
          <select value={slaFilter} onChange={(event) => setSlaFilter(event.target.value)} className="h-10 rounded-md border border-slate-300 bg-white px-3 text-sm">
            <option value="">كل SLA</option>
            <option value="within">ضمن الوقت</option>
            <option value="overdue">متأخر</option>
            <option value="met">ملتزم</option>
            <option value="breached">تم تجاوزه</option>
          </select>
          <input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} className="h-10 rounded-md border border-slate-300 bg-white px-3 text-sm" />
          <input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} className="h-10 rounded-md border border-slate-300 bg-white px-3 text-sm" />
          <div className="flex gap-2">
            <Button type="submit" className="h-10 gap-2"><Filter className="h-4 w-4" /> تطبيق</Button>
            <button
              type="button"
              onClick={() => {
                setSearch("");
                setPriorityFilter("");
                setStatusFilter("");
                setSlaFilter("");
                setDateFrom("");
                setDateTo("");
                setApprovalsPage(1);
                loadApprovals(new URLSearchParams({ tab: activeTab }).toString());
              }}
              className="h-10 rounded-md border border-slate-300 px-3 text-sm font-bold text-slate-700 hover:bg-slate-50"
            >
              إعادة
            </button>
          </div>
        </form>
      )}

      {error && (
        <div className="flex items-center gap-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          <AlertTriangle className="h-5 w-5 shrink-0" />
          {error}
        </div>
      )}

      {currentUser?.role === "it_staff" && !currentUser.administrative_section && (
        <div className="flex items-start gap-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm leading-6 text-amber-800">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
          <div>
            <p className="font-bold">حساب التنفيذ غير مربوط بقسم مختص</p>
            <p className="mt-1">يرجى ربط المستخدم بقسم من الإعدادات لضمان ظهور طلبات قسمه فقط. حاليًا ستظهر له الطلبات التي لا يوجد لها موظف مخصص في نفس القسم.</p>
          </div>
        </div>
      )}

      <div className="grid gap-5 xl:grid-cols-[380px_1fr]">
        <Card className="overflow-hidden">
          <div className="border-b border-slate-200 p-5">
            <h3 className="font-bold text-slate-950">طلبات المراجعة</h3>
            <p className="mt-1 text-sm text-slate-500">اختر طلباً لعرض التفاصيل واتخاذ القرار.</p>
          </div>
          <div className="max-h-[720px] overflow-y-auto">
            {filteredRequests.length === 0 && <p className="p-5 text-sm text-slate-500">لا توجد طلبات مطابقة حالياً.</p>}
            {paginatedRequests.map((request) => (
              <button
                key={request.id}
                onClick={() => {
                  setSelectedId(request.id);
                  setMessage("");
                  setError("");
                }}
                className={`block w-full border-b border-slate-100 p-4 text-right transition hover:bg-slate-50 ${
                  selectedRequest?.id === request.id ? "bg-bank-50" : "bg-white"
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold text-slate-950">{request.title}</p>
                    <p className="mt-1 text-xs text-slate-500">{request.request_number}</p>
                  </div>
                  <span className="rounded-md bg-white px-2 py-1 text-xs font-semibold text-bank-700 ring-1 ring-bank-100">
                    {statusLabels[request.status] ?? request.status}
                  </span>
                </div>
                <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-500">
                  <span>{requestTypeName(request)}</span>
                  <span>•</span>
                  <span>{priorityLabels[request.priority] ?? request.priority}</span>
                  <span>•</span>
                  <span>{assignedSection(request)}</span>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${slaTone(request)}`}>
                    SLA: {slaLabel(request)}
                  </span>
                  <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-600">
                    انتظار: {waitingTimeLabel(request)}
                  </span>
                  {isActionableForUser(getCurrentStep(request), currentUser, activeDelegations) && (
                    <span className="rounded-full bg-bank-50 px-2.5 py-1 text-xs font-bold text-bank-700">يمكنك الإجراء</span>
                  )}
                </div>
              </button>
            ))}
          </div>
          <Pagination page={approvalsPage} totalItems={filteredRequests.length} pageSize={approvalsPageSize} onPageChange={setApprovalsPage} />
        </Card>

        <div className="space-y-5">
          {!selectedRequest && (
            <Card className="p-8 text-center text-slate-500">اختر طلباً من القائمة لعرض نموذج الموافقة.</Card>
          )}

          {selectedRequest && (
            <>
              <Card className="p-5">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold text-bank-700">{selectedRequest.request_number}</span>
                      <span className="rounded-full bg-bank-50 px-3 py-1 text-xs font-bold text-bank-700">
                        {statusLabels[selectedRequest.status] ?? selectedRequest.status}
                      </span>
                    </div>
                    <h3 className="mt-2 break-words text-xl font-bold text-slate-950">{selectedRequest.title}</h3>
                    <p className="mt-2 text-sm leading-6 text-slate-500">
                      {requestTypeName(selectedRequest)} • مقدم الطلب: {selectedRequest.requester.full_name_ar} • الإدارة: {selectedRequest.department?.name_ar ?? "-"}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => navigate(`/requests/${selectedRequest.id}`)}
                      className="inline-flex h-10 items-center gap-2 rounded-md border border-bank-100 bg-bank-50 px-3 text-sm font-semibold text-bank-700 hover:bg-bank-100"
                    >
                      <ExternalLink className="h-4 w-4" />
                      تفاصيل الطلب
                    </button>
                    <button
                      type="button"
                      onClick={() => handleRequestPdf(selectedRequest, "download")}
                      className="inline-flex h-10 items-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                    >
                      <Download className="h-4 w-4" />
                      تحميل PDF
                    </button>
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                  <CompactInfo label="الأولوية" value={priorityLabels[selectedRequest.priority] ?? selectedRequest.priority} />
                  <CompactInfo label="المرحلة الحالية" value={approvalStepLabel(currentStep, selectedRequest)} tone="bank" />
                  <CompactInfo label="SLA" value={slaLabel(selectedRequest)} tone={slaStatus(selectedRequest) === "overdue" || slaStatus(selectedRequest) === "breached" ? "danger" : "warning"} />
                  <CompactInfo label="الانتظار" value={waitingTimeLabel(selectedRequest)} />
                  <CompactInfo label="القسم المختص" value={assignedSection(selectedRequest)} />
                </div>

                <div className="mt-4 flex flex-col gap-3 rounded-md border border-slate-200 bg-slate-50 p-3 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-sm leading-6 text-slate-600">
                    المسار مختصر هنا لتقليل التشتيت. يمكن عرض التفاصيل الكاملة عند الحاجة.
                  </p>
                  <button
                    type="button"
                    onClick={() => setShowApprovalPath((current) => !current)}
                    className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-md border border-bank-100 bg-white px-4 text-sm font-bold text-bank-700 hover:bg-bank-50"
                  >
                    <Clock3 className="h-4 w-4" />
                    {showApprovalPath ? "إخفاء مسار الموافقات" : "عرض مسار الموافقات"}
                  </button>
                </div>

                {showApprovalPath && <ApprovalProgressBar request={selectedRequest} steps={selectedRequest.approvals ?? []} />}

                <div className="mt-5 rounded-md bg-slate-50 p-4">
                  <p className="mb-2 text-sm font-semibold text-slate-700">مبرر العمل</p>
                  <p className="text-sm leading-6 text-slate-600">{selectedRequest.business_justification || "لا يوجد مبرر مسجل."}</p>
                </div>
              </Card>

              <div className={`grid gap-5 ${canShowDecisionForm ? "xl:grid-cols-[1fr_360px]" : ""}`}>
                <Card className="p-5">
                  <div className="mb-4 flex items-center gap-2">
                    <FileCheck2 className="h-5 w-5 text-bank-700" />
                    <h3 className="font-bold text-slate-950">بيانات الطلب</h3>
                  </div>
                  <div className="grid gap-3 md:grid-cols-2">
                    <Info label="مقدم الطلب" value={selectedRequest.requester?.full_name_ar || "-"} />
                    <Info label="إدارة مقدم الطلب" value={selectedRequest.department?.name_ar || "-"} />
                    {Object.entries(selectedRequest.form_data ?? {}).filter(([key]) => !["assigned_section", "administrative_section"].includes(key)).map(([key, value]) => (
                      <Info key={key} label={fieldLabels[key] ?? key} value={String(value || "-")} />
                    ))}
                    {Object.keys(selectedRequest.form_data ?? {}).length === 0 && (
                      <p className="text-sm text-slate-500">لا توجد بيانات إضافية لهذا الطلب.</p>
                    )}
                  </div>
                </Card>

                {canShowDecisionForm && (
                  <Card className="p-5">
                    <div className="mb-4 flex items-center gap-2">
                      <UserCheck className="h-5 w-5 text-bank-700" />
                      <h3 className="font-bold text-slate-950">{isExecutionStep(currentStep) ? "قرار التنفيذ" : "قرار الموافقة"}</h3>
                    </div>
                    <div className="mb-4 rounded-md border border-bank-100 bg-bank-50 p-3 text-sm text-bank-800">
                      المرحلة الحالية: <span className="font-bold">{approvalStepLabel(currentStep, selectedRequest)}</span>
                    </div>
                    <form onSubmit={submitDecision} className="space-y-4">
                      <div className={`grid gap-2 ${decisionGridClass}`}>
                        <button
                          type="button"
                          onClick={() => setDecision("approved")}
                          className={`flex h-10 items-center justify-center gap-2 rounded-md border text-sm font-semibold ${
                            decision === "approved" ? "border-bank-600 bg-bank-50 text-bank-700" : "border-slate-200 text-slate-600"
                          }`}
                        >
                          <CheckCircle2 className="h-4 w-4" />
                          موافقة
                        </button>
                        {currentStepCanReject && (
                          <button
                            type="button"
                            onClick={() => setDecision("rejected")}
                            className={`flex h-10 items-center justify-center gap-2 rounded-md border text-sm font-semibold ${
                              decision === "rejected" ? "border-red-600 bg-red-50 text-red-700" : "border-slate-200 text-slate-600"
                            }`}
                          >
                            <XCircle className="h-4 w-4" />
                            رفض
                          </button>
                        )}
                        {currentStep?.can_return_for_edit && (
                          <button
                            type="button"
                            onClick={() => setDecision("returned_for_edit")}
                            className={`flex h-10 items-center justify-center gap-2 rounded-md border text-sm font-semibold ${
                              decision === "returned_for_edit" ? "border-amber-600 bg-amber-50 text-amber-700" : "border-slate-200 text-slate-600"
                            }`}
                          >
                            <RotateCcw className="h-4 w-4" />
                            إرجاع للتعديل
                          </button>
                        )}
                      </div>
                      <label className="block space-y-2 text-sm font-medium text-slate-700">
                        ملاحظة القرار
                        <textarea
                          value={note}
                          onChange={(event) => setNote(event.target.value)}
                          rows={5}
                          required={decision === "rejected" || decision === "returned_for_edit"}
                          placeholder={decision === "returned_for_edit" ? "اكتب التعديلات المطلوبة والمرحلة التي يجب مراجعتها" : "اكتب سبب القرار أو أي تعليمات للتنفيذ"}
                          className="w-full resize-y rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-bank-600 focus:ring-2 focus:ring-bank-100"
                        />
                      </label>
                      {message && <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">{message}</div>}
                      <Button type="submit" disabled={isSubmitting || !currentStep} className="w-full gap-2">
                        <Send className="h-4 w-4" />
                        {isSubmitting ? "جاري الحفظ..." : "حفظ القرار"}
                      </Button>
                      {!currentStep && <p className="text-xs text-slate-500">لا توجد خطوة موافقة معلقة لهذا الطلب.</p>}
                    </form>
                  </Card>
                )}
                {!canShowDecisionForm && currentStep && (
                  <Card className="p-5">
                    <div className="flex items-start gap-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm leading-6 text-amber-800">
                      <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
                      <div>
                        <p className="font-bold">الطلب بانتظار مرحلة أخرى</p>
                        <p className="mt-1">المرحلة الحالية: {approvalStepLabel(currentStep, selectedRequest)}. لن يظهر زر الإجراء إلا للمستخدم المخول بهذه المرحلة.</p>
                      </div>
                    </div>
                  </Card>
                )}
              </div>

              <AttachmentsPanel request={selectedRequest} />

              <Card className="p-5">
                <div className="mb-4 flex items-center gap-2">
                  <Clock3 className="h-5 w-5 text-bank-700" />
                  <h3 className="font-bold text-slate-950">سجل الموافقات</h3>
                </div>
                <div className="space-y-3">
                  {(selectedRequest.approvals ?? []).map((step) => (
                    <ApprovalTimelineItem key={step.id} request={selectedRequest} step={step} />
                  ))}
                </div>
              </Card>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function SummaryCard({
  label,
  description,
  value,
  active,
  tone = "default",
  onClick
}: {
  label: string;
  description: string;
  value: number;
  active?: boolean;
  tone?: "default" | "warning" | "danger";
  onClick: () => void;
}) {
  const toneClass =
    tone === "danger"
      ? active
        ? "border-red-200 bg-red-50 text-red-800"
        : "border-slate-200 bg-white text-slate-800 hover:border-red-200 hover:bg-red-50"
      : tone === "warning"
        ? active
          ? "border-amber-200 bg-amber-50 text-amber-800"
          : "border-slate-200 bg-white text-slate-800 hover:border-amber-200 hover:bg-amber-50"
        : active
          ? "border-bank-200 bg-bank-50 text-bank-800"
          : "border-slate-200 bg-white text-slate-800 hover:border-bank-200 hover:bg-bank-50";

  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-lg border p-4 text-right shadow-sm transition ${toneClass}`}
    >
      <span className="flex items-center justify-between gap-2 text-sm font-bold">
        <span>{label}</span>
        <span title={description} aria-label={description}>
          <HelpCircle className="h-4 w-4 opacity-70" aria-hidden="true" />
        </span>
      </span>
      <span className="mt-3 block text-3xl font-black">{value}</span>
    </button>
  );
}

function AttachmentsPanel({ request }: { request: ServiceRequest }) {
  const attachments = request.attachments ?? [];
  if (attachments.length === 0) return null;

  return (
    <Card className="p-5">
      <div className="mb-4 flex items-center gap-2">
        <Paperclip className="h-5 w-5 text-bank-700" />
        <h3 className="font-bold text-slate-950">مرفقات الطلب</h3>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {attachments.map((attachment) => {
          const isImage = attachment.content_type.startsWith("image/");
          const Icon = isImage ? ImageIcon : FileText;
          return (
            <button
              key={attachment.id}
              type="button"
              onClick={() => openAttachment(request.id, attachment)}
              className="flex min-h-20 items-center gap-3 rounded-md border border-slate-200 bg-white p-3 text-right transition hover:border-bank-200 hover:bg-bank-50"
            >
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-slate-100">
                <Icon className="h-5 w-5 text-bank-700" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-bold text-slate-950">{attachment.original_name}</span>
                <span className="mt-1 block text-xs text-slate-500">{formatBytes(attachment.size_bytes)} • {isImage ? "صورة" : "PDF"}</span>
              </span>
              <ExternalLink className="h-4 w-4 shrink-0 text-slate-400" />
            </button>
          );
        })}
      </div>
    </Card>
  );
}

function CompactInfo({ label, value, tone = "default" }: { label: string; value: string; tone?: "default" | "bank" | "warning" | "danger" }) {
  const toneClass =
    tone === "bank"
      ? "border-bank-100 bg-bank-50 text-bank-800"
      : tone === "warning"
        ? "border-amber-100 bg-amber-50 text-amber-800"
        : tone === "danger"
          ? "border-red-100 bg-red-50 text-red-700"
          : "border-slate-200 bg-slate-50 text-slate-700";

  return (
    <span className={`inline-flex min-h-9 items-center gap-2 rounded-full border px-3 py-1.5 text-sm ${toneClass}`}>
      <span className="text-xs font-semibold opacity-70">{label}</span>
      <span className="font-bold">{value}</span>
    </span>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-slate-200 bg-white p-3">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-1 break-words text-sm font-semibold text-slate-900">{value}</p>
    </div>
  );
}

function ApprovalTimelineItem({ request, step }: { request: ServiceRequest; step: ApprovalStep }) {
  const isApproved = step.action === "approved";
  const isRejected = step.action === "rejected";
  const isReturned = step.action === "returned_for_edit";
  const tone = isApproved ? "bg-bank-50 text-bank-700" : isRejected ? "bg-red-50 text-red-700" : isReturned ? "bg-amber-50 text-amber-700" : "bg-slate-100 text-slate-600";
  const actorLabel = isApproved ? "قام بالموافقة" : isRejected ? "قام بالرفض" : isReturned ? "قام بالإرجاع" : "";
  const dateLabel = isApproved ? "تاريخ الموافقة" : isRejected ? "تاريخ الرفض" : isReturned ? "تاريخ الإرجاع" : "";

  return (
    <div className="flex gap-3 rounded-md border border-slate-200 p-3">
      <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-md ${tone}`}>
        {isApproved ? <CheckCircle2 className="h-5 w-5" /> : isRejected ? <XCircle className="h-5 w-5" /> : isReturned ? <RotateCcw className="h-5 w-5" /> : <Clock3 className="h-5 w-5" />}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
          <p className="font-semibold text-slate-900">
            {step.step_order}. {approvalStepLabel(step, request)}
          </p>
          {!(isApproved || isRejected) && <span className="text-xs text-slate-500">{formatDate(step.acted_at)}</span>}
        </div>
        <p className="mt-1 text-sm text-slate-500">{actionLabels[step.action]}</p>
        {(isApproved || isRejected || isReturned) && (
          <div className="mt-2 grid gap-1 rounded-md bg-slate-50 p-2 text-xs leading-5 text-slate-600 sm:grid-cols-2">
            <p><span className="font-bold text-slate-700">{actorLabel}:</span> {step.approver?.full_name_ar || step.approver?.email || "-"}</p>
            <p><span className="font-bold text-slate-700">{dateLabel}:</span> {formatDate(step.acted_at)}</p>
          </div>
        )}
        {step.note && <p className="mt-2 rounded-md bg-slate-50 p-2 text-sm leading-6 text-slate-600">{step.note}</p>}
      </div>
    </div>
  );
}

function ApprovalProgressBar({ request, steps }: { request: ServiceRequest; steps: ApprovalStep[] }) {
  const orderedSteps = [...steps].sort((first, second) => first.step_order - second.step_order);
  const rejectedIndex = orderedSteps.findIndex((step) => step.action === "rejected");
  const returnedIndex = orderedSteps.findIndex((step) => step.action === "returned_for_edit");
  const currentIndex = orderedSteps.findIndex((step) => step.action === "pending");
  const completedCount = orderedSteps.filter((step) => step.action === "approved" || step.action === "skipped").length;
  const progressPercent = orderedSteps.length === 0 ? 0 : Math.round((completedCount / orderedSteps.length) * 100);

  if (orderedSteps.length === 0) {
    return null;
  }

  return (
    <div className="mt-5 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-bold text-slate-950">مسار الموافقات</p>
          <p className="mt-1 text-xs text-slate-500">
            {rejectedIndex >= 0
              ? `تم إيقاف المسار عند مرحلة ${approvalStepLabel(orderedSteps[rejectedIndex], request)}`
              : returnedIndex >= 0
                ? `تم إرجاع الطلب للتعديل من مرحلة ${approvalStepLabel(orderedSteps[returnedIndex], request)}`
              : currentIndex >= 0
                ? `الموافقة وصلت إلى مرحلة ${approvalStepLabel(orderedSteps[currentIndex], request)}`
                : "اكتملت جميع مراحل الموافقة"}
          </p>
        </div>
        <span className={`rounded-md px-3 py-1 text-xs font-bold ${rejectedIndex >= 0 ? "bg-red-50 text-red-700" : returnedIndex >= 0 || currentIndex >= 0 ? "bg-amber-50 text-amber-700" : "bg-bank-50 text-bank-700"}`}>
          {rejectedIndex >= 0 ? "مرفوض" : returnedIndex >= 0 ? "معاد للتعديل" : currentIndex >= 0 ? `نسبة الإنجاز ${progressPercent}%` : "مكتمل"}
        </span>
      </div>

      <div className="relative hidden pb-2 pt-5 md:block">
        <div className="absolute left-0 right-0 top-10 h-1 rounded-full bg-slate-200" />
        <div
          className={`absolute right-0 top-10 h-1 rounded-full ${rejectedIndex >= 0 ? "bg-red-500" : "bg-bank-600"}`}
          style={{ width: `${progressPercent}%` }}
        />
        <div className="relative grid" style={{ gridTemplateColumns: `repeat(${orderedSteps.length}, minmax(0, 1fr))` }}>
          {orderedSteps.map((step, index) => (
            <ProgressStep key={step.id} request={request} step={step} index={index} currentIndex={currentIndex} rejectedIndex={rejectedIndex} />
          ))}
        </div>
      </div>

      <div className="space-y-3 md:hidden">
        {orderedSteps.map((step, index) => (
          <ProgressStepMobile key={step.id} request={request} step={step} index={index} currentIndex={currentIndex} rejectedIndex={rejectedIndex} />
        ))}
      </div>
    </div>
  );
}

function ProgressStep({
  request,
  step,
  index,
  currentIndex,
  rejectedIndex
}: {
  request: ServiceRequest;
  step: ApprovalStep;
  index: number;
  currentIndex: number;
  rejectedIndex: number;
}) {
  const state = getStepState(step, index, currentIndex, rejectedIndex);

  return (
    <div className="flex min-w-0 flex-col items-center px-2 text-center">
      <div className={`z-[1] flex h-11 w-11 items-center justify-center rounded-full border-4 bg-white shadow-sm ${state.ring}`}>
        {state.icon}
      </div>
      <p className={`mt-3 min-h-8 w-full whitespace-normal break-words text-xs font-bold leading-4 ${state.text}`}>{approvalStepLabel(step, request)}</p>
      <p className="mt-1 text-[11px] text-slate-500">{state.label}</p>
    </div>
  );
}

function ProgressStepMobile({
  request,
  step,
  index,
  currentIndex,
  rejectedIndex
}: {
  request: ServiceRequest;
  step: ApprovalStep;
  index: number;
  currentIndex: number;
  rejectedIndex: number;
}) {
  const state = getStepState(step, index, currentIndex, rejectedIndex);

  return (
    <div className="flex items-center gap-3 rounded-md border border-slate-200 p-3">
      <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-4 bg-white ${state.ring}`}>{state.icon}</div>
      <div className="min-w-0">
        <p className={`whitespace-normal break-words text-sm font-bold leading-5 ${state.text}`}>{approvalStepLabel(step, request)}</p>
        <p className="text-xs text-slate-500">{state.label}</p>
      </div>
    </div>
  );
}

function getStepState(step: ApprovalStep, index: number, currentIndex: number, rejectedIndex: number) {
  if (step.action === "approved" || step.action === "skipped") {
    return {
      label: step.action === "skipped" ? "تم التجاوز" : "تمت الموافقة",
      ring: "border-bank-600 text-bank-700",
      text: "text-bank-700",
      icon: <CheckCircle2 className="h-5 w-5" />
    };
  }

  if (step.action === "rejected") {
    return {
      label: "تم الرفض",
      ring: "border-red-600 text-red-700",
      text: "text-red-700",
      icon: <XCircle className="h-5 w-5" />
    };
  }

  if (step.action === "returned_for_edit") {
    return {
      label: "أعيد للتعديل",
      ring: "border-amber-600 text-amber-700",
      text: "text-amber-700",
      icon: <RotateCcw className="h-5 w-5" />
    };
  }

  if (index === currentIndex && rejectedIndex === -1) {
    return {
      label: "المرحلة الحالية",
      ring: "border-amber-500 text-amber-700",
      text: "text-amber-700",
      icon: <Clock3 className="h-5 w-5" />
    };
  }

  return {
    label: "بانتظار الدور",
    ring: "border-slate-300 text-slate-400",
    text: "text-slate-500",
    icon: <Circle className="h-5 w-5" />
  };
}
