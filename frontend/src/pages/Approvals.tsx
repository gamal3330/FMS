import { FormEvent, useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Circle, Clock3, ExternalLink, FileCheck2, FileText, Filter, Image as ImageIcon, Paperclip, RefreshCw, Search, Send, UserCheck, XCircle } from "lucide-react";
import { API_BASE, apiFetch, ApprovalAction, ApprovalStep, Attachment, CurrentUser, ServiceRequest } from "../lib/api";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";

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
  information_security: "أمن المعلومات",
  it_manager: "مدير تقنية المعلومات",
  it_staff: "فريق تقنية المعلومات",
  executive_management: "الإدارة التنفيذية",
  implementation_engineer: "مهندس التنفيذ",
  implementation: "التنفيذ",
  execution: "التنفيذ"
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
  skipped: "تم التجاوز"
};

function getCurrentStep(request?: ServiceRequest) {
  return [...(request?.approvals ?? [])].sort((first, second) => first.step_order - second.step_order).find((step) => step.action === "pending") ?? null;
}

function formatDate(value?: string | null) {
  return value ? new Date(value).toLocaleString("ar-QA") : "-";
}

function assignedSection(request?: ServiceRequest) {
  const key = request?.form_data?.assigned_section || request?.form_data?.administrative_section || "";
  const label = request?.form_data?.assigned_section_label || request?.form_data?.administrative_section_label;
  return label || sectionLabels[key] || "-";
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

function formatBytes(size?: number) {
  if (!size) return "-";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function isActionableForUser(step: ApprovalStep | null, user: CurrentUser | null) {
  if (!step || !user || user.role === "employee") return false;
  if (user.role === "super_admin") return true;
  if (step.role === user.role) return true;
  return ["implementation", "execution", "implementation_engineer", "close_request"].includes(step.role) && ["it_staff", "it_manager"].includes(user.role);
}

export function Approvals() {
  const [requests, setRequests] = useState<ServiceRequest[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [decision, setDecision] = useState<"approved" | "rejected">("approved");
  const [note, setNote] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);
  const [search, setSearch] = useState("");
  const [statusView, setStatusView] = useState<"all" | "pending" | "done">("pending");

  const selectedRequest = useMemo(
    () => (selectedId ? requests.find((request) => request.id === selectedId) : undefined),
    [requests, selectedId]
  );

  const currentStep = getCurrentStep(selectedRequest);
  const pendingCount = requests.filter((request) => request.status === "pending_approval").length;
  const completedCount = requests.filter((request) => ["closed", "completed"].includes(request.status)).length;
  const actionableCount = requests.filter((request) => isActionableForUser(getCurrentStep(request), currentUser)).length;
  const canShowDecisionForm = isActionableForUser(currentStep, currentUser);
  const filteredRequests = useMemo(() => {
    const term = search.trim().toLowerCase();
    return requests.filter((request) => {
      const matchesSearch =
        !term ||
        [request.title, request.request_number, request.requester?.full_name_ar, request.request_type, assignedSection(request)]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(term));
      const matchesStatus =
        statusView === "all" ||
        (statusView === "pending" && request.status === "pending_approval") ||
        (statusView === "done" && request.status !== "pending_approval");
      return matchesSearch && matchesStatus;
    });
  }, [requests, search, statusView, currentUser]);

  useEffect(() => {
    if (filteredRequests.length === 0) {
      setSelectedId(null);
      return;
    }
    if (!selectedId || !filteredRequests.some((request) => request.id === selectedId)) {
      setSelectedId(filteredRequests[0].id);
    }
  }, [filteredRequests, selectedId]);

  async function loadApprovals() {
    setIsLoading(true);
    setError("");
    try {
      const data = await apiFetch<ServiceRequest[]>("/requests");
      const sorted = data.sort((a, b) => Number(b.status === "pending_approval") - Number(a.status === "pending_approval"));
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
    apiFetch<CurrentUser>("/auth/me").then(setCurrentUser).catch(() => setCurrentUser(null));
  }, []);

  async function submitDecision(event: FormEvent) {
    event.preventDefault();
    if (!selectedRequest) return;
    setMessage("");
    setError("");
    setIsSubmitting(true);

    try {
      const updated = await apiFetch<ServiceRequest>(`/requests/${selectedRequest.id}/approval`, {
        method: "POST",
        body: JSON.stringify({ action: decision, note })
      });
      setRequests((current) => current.map((request) => (request.id === updated.id ? updated : request)));
      setSelectedId(updated.id);
      setNote("");
      setMessage(decision === "approved" ? "تمت الموافقة على الخطوة الحالية." : "تم رفض الطلب وتحديث سجل الموافقات.");
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
            <h2 className="mt-2 text-2xl font-bold text-slate-950">مراجعة واعتماد طلبات الخدمات</h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">
              راجع تفاصيل الطلب، تحقق من البيانات والمبررات، ثم اختر الموافقة أو الرفض مع توثيق الملاحظة.
            </p>
          </div>
          <Button onClick={loadApprovals} disabled={isLoading} className="gap-2 self-start lg:self-auto">
            <RefreshCw className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
            تحديث الموافقات
          </Button>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        <Card className="p-5">
          <p className="text-sm text-slate-500">بانتظار الإجراء</p>
          <p className="mt-3 text-3xl font-bold text-slate-950">{pendingCount}</p>
        </Card>
        <Card className="p-5">
          <p className="text-sm text-slate-500">يمكنك اتخاذ إجراء عليها</p>
          <p className="mt-3 text-3xl font-bold text-bank-700">{actionableCount}</p>
        </Card>
        <Card className="p-5">
          <p className="text-sm text-slate-500">طلبات مكتملة أو مغلقة</p>
          <p className="mt-3 text-3xl font-bold text-slate-950">{completedCount}</p>
        </Card>
      </section>

      <section className="grid gap-3 rounded-lg border border-slate-200 bg-white p-4 shadow-sm lg:grid-cols-[1fr_240px]">
        <div className="relative">
          <Search className="pointer-events-none absolute right-3 top-2.5 h-4 w-4 text-slate-400" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="بحث برقم الطلب أو الموظف أو القسم المختص"
            className="h-10 w-full rounded-md border border-slate-300 bg-white pr-9 pl-3 text-sm outline-none focus:border-bank-600 focus:ring-2 focus:ring-bank-100"
          />
        </div>
        <div className="flex items-center gap-2">
          <Filter className="h-4 w-4 text-slate-400" />
          <select value={statusView} onChange={(event) => setStatusView(event.target.value as "all" | "pending" | "done")} className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm">
            <option value="pending">بانتظار الإجراء</option>
            <option value="all">كل الطلبات</option>
            <option value="done">المنتهية</option>
          </select>
        </div>
      </section>

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
            {filteredRequests.map((request) => (
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
                  <span>{requestTypeLabels[request.request_type] ?? request.request_type}</span>
                  <span>•</span>
                  <span>{priorityLabels[request.priority] ?? request.priority}</span>
                  <span>•</span>
                  <span>{assignedSection(request)}</span>
                </div>
              </button>
            ))}
          </div>
        </Card>

        <div className="space-y-5">
          {!selectedRequest && (
            <Card className="p-8 text-center text-slate-500">اختر طلباً من القائمة لعرض نموذج الموافقة.</Card>
          )}

          {selectedRequest && (
            <>
              <Card className="p-5">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <p className="text-sm font-semibold text-bank-700">{selectedRequest.request_number}</p>
                    <h3 className="mt-2 text-xl font-bold text-slate-950">{selectedRequest.title}</h3>
                    <p className="mt-2 text-sm text-slate-500">
                      مقدم الطلب: {selectedRequest.requester.full_name_ar} • الإدارة: {selectedRequest.department?.name_ar ?? "-"}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <span className="rounded-md bg-slate-100 px-3 py-2 text-sm font-semibold text-slate-700">
                      {requestTypeLabels[selectedRequest.request_type] ?? selectedRequest.request_type}
                    </span>
                    <span className="rounded-md bg-bank-50 px-3 py-2 text-sm font-semibold text-bank-700">
                      {statusLabels[selectedRequest.status] ?? selectedRequest.status}
                    </span>
                  </div>
                </div>

                <div className="mt-5 grid gap-3 md:grid-cols-4">
                  <Info label="الأولوية" value={priorityLabels[selectedRequest.priority] ?? selectedRequest.priority} />
                  <Info label="تاريخ الإنشاء" value={formatDate(selectedRequest.created_at)} />
                  <Info label="الخطوة الحالية" value={currentStep ? roleLabels[currentStep.role] ?? currentStep.role : "-"} />
                  <Info label="القسم المختص" value={assignedSection(selectedRequest)} />
                </div>

                <ApprovalProgressBar steps={selectedRequest.approvals ?? []} />

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
                      <h3 className="font-bold text-slate-950">{currentStep && ["implementation", "execution", "implementation_engineer"].includes(currentStep.role) ? "قرار التنفيذ" : "قرار الموافقة"}</h3>
                    </div>
                    <div className="mb-4 rounded-md border border-bank-100 bg-bank-50 p-3 text-sm text-bank-800">
                      المرحلة الحالية: <span className="font-bold">{currentStep ? roleLabels[currentStep.role] ?? currentStep.role : "-"}</span>
                    </div>
                    <form onSubmit={submitDecision} className="space-y-4">
                      <div className="grid grid-cols-2 gap-2">
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
                      </div>
                      <label className="block space-y-2 text-sm font-medium text-slate-700">
                        ملاحظة القرار
                        <textarea
                          value={note}
                          onChange={(event) => setNote(event.target.value)}
                          rows={5}
                          required={decision === "rejected"}
                          placeholder="اكتب سبب القرار أو أي تعليمات للتنفيذ"
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
                        <p className="mt-1">المرحلة الحالية: {roleLabels[currentStep.role] ?? currentStep.role}. لن يظهر زر الإجراء إلا للمستخدم المخول بهذه المرحلة.</p>
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
                    <ApprovalTimelineItem key={step.id} step={step} />
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

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-slate-200 bg-white p-3">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-1 break-words text-sm font-semibold text-slate-900">{value}</p>
    </div>
  );
}

function ApprovalTimelineItem({ step }: { step: ApprovalStep }) {
  const isApproved = step.action === "approved";
  const isRejected = step.action === "rejected";
  const tone = isApproved ? "bg-bank-50 text-bank-700" : isRejected ? "bg-red-50 text-red-700" : "bg-slate-100 text-slate-600";

  return (
    <div className="flex gap-3 rounded-md border border-slate-200 p-3">
      <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-md ${tone}`}>
        {isApproved ? <CheckCircle2 className="h-5 w-5" /> : isRejected ? <XCircle className="h-5 w-5" /> : <Clock3 className="h-5 w-5" />}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
          <p className="font-semibold text-slate-900">
            {step.step_order}. {roleLabels[step.role] ?? step.role}
          </p>
          <span className="text-xs text-slate-500">{formatDate(step.acted_at)}</span>
        </div>
        <p className="mt-1 text-sm text-slate-500">{actionLabels[step.action]}</p>
        {step.note && <p className="mt-2 rounded-md bg-slate-50 p-2 text-sm leading-6 text-slate-600">{step.note}</p>}
      </div>
    </div>
  );
}

function ApprovalProgressBar({ steps }: { steps: ApprovalStep[] }) {
  const orderedSteps = [...steps].sort((first, second) => first.step_order - second.step_order);
  const rejectedIndex = orderedSteps.findIndex((step) => step.action === "rejected");
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
              ? `تم إيقاف المسار عند مرحلة ${roleLabels[orderedSteps[rejectedIndex].role] ?? orderedSteps[rejectedIndex].role}`
              : currentIndex >= 0
                ? `الموافقة وصلت إلى مرحلة ${roleLabels[orderedSteps[currentIndex].role] ?? orderedSteps[currentIndex].role}`
                : "اكتملت جميع مراحل الموافقة"}
          </p>
        </div>
        <span className={`rounded-md px-3 py-1 text-xs font-bold ${rejectedIndex >= 0 ? "bg-red-50 text-red-700" : currentIndex >= 0 ? "bg-amber-50 text-amber-700" : "bg-bank-50 text-bank-700"}`}>
          {rejectedIndex >= 0 ? "مرفوض" : currentIndex >= 0 ? `نسبة الإنجاز ${progressPercent}%` : "مكتمل"}
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
            <ProgressStep key={step.id} step={step} index={index} currentIndex={currentIndex} rejectedIndex={rejectedIndex} />
          ))}
        </div>
      </div>

      <div className="space-y-3 md:hidden">
        {orderedSteps.map((step, index) => (
          <ProgressStepMobile key={step.id} step={step} index={index} currentIndex={currentIndex} rejectedIndex={rejectedIndex} />
        ))}
      </div>
    </div>
  );
}

function ProgressStep({
  step,
  index,
  currentIndex,
  rejectedIndex
}: {
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
      <p className={`mt-3 w-full truncate text-xs font-bold ${state.text}`}>{roleLabels[step.role] ?? step.role}</p>
      <p className="mt-1 text-[11px] text-slate-500">{state.label}</p>
    </div>
  );
}

function ProgressStepMobile({
  step,
  index,
  currentIndex,
  rejectedIndex
}: {
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
        <p className={`truncate text-sm font-bold ${state.text}`}>{roleLabels[step.role] ?? step.role}</p>
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
