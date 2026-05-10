import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  Download,
  FileText,
  History,
  Mail,
  MessageSquare,
  Paperclip,
  Printer,
  RefreshCw,
  Send,
  ShieldCheck,
  Sparkles,
  UserCheck,
  XCircle
} from "lucide-react";
import { API_BASE, apiFetch, ApprovalStep, Attachment, ServiceRequest } from "../lib/api";
import { formatSystemDateTime, parseApiDate } from "../lib/datetime";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import AISuggestionPanel from "../components/ai/AISuggestionPanel";
import AISummaryBox from "../components/ai/AISummaryBox";

interface LinkedMessage {
  id: number;
  message_uid?: string | null;
  message_type_label?: string | null;
  subject: string;
  sender_name: string;
  recipient_names?: string[];
  created_at?: string | null;
}

interface AIStatus {
  is_enabled: boolean;
  allow_message_drafting: boolean;
  allow_summarization: boolean;
  allow_reply_suggestion: boolean;
  show_in_compose_message?: boolean;
  show_in_message_details?: boolean;
  show_in_request_messages_tab?: boolean;
}

interface MessageSettings {
  enable_linked_requests: boolean;
  allow_send_message_from_request: boolean;
  show_messages_tab_in_request_details: boolean;
}

interface RequestHistoryRow {
  event: string;
  label: string;
  status?: string | null;
  actor_name?: string | null;
  changed_at?: string | null;
  comment?: string | null;
}

interface RequestAuditRow {
  id: number;
  action: string;
  actor_name?: string | null;
  created_at?: string | null;
  ip_address?: string | null;
  metadata?: Record<string, unknown>;
}

const defaultMessageSettings: MessageSettings = {
  enable_linked_requests: true,
  allow_send_message_from_request: true,
  show_messages_tab_in_request_details: true
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
  department_manager: "مدير الإدارة المختصة",
  department_specialist: "مختص الإدارة المختصة",
  information_security: "أمن المعلومات (مرحلة قديمة)",
  it_manager: "مدير إدارة",
  it_staff: "مختص تنفيذ",
  executive_management: "الإدارة التنفيذية",
  implementation_engineer: "مختص تنفيذ",
  implementation: "مختص تنفيذ",
  execution: "مختص تنفيذ"
};

const actionLabels: Record<string, string> = {
  pending: "بانتظار الإجراء",
  approved: "تمت الموافقة",
  rejected: "تم الرفض",
  returned_for_edit: "أعيد للتعديل",
  skipped: "تم التجاوز"
};

const sectionLabels: Record<string, string> = {
  networks: "قسم الشبكات",
  servers: "قسم السيرفرات",
  support: "قسم الدعم الفني",
  development: "وحدة تطوير البرامج"
};

const hiddenFormKeys = new Set(["assigned_section", "administrative_section", "assigned_section_label", "administrative_section_label"]);

const fieldLabels: Record<string, string> = {
  request_type_label: "نوع الطلب",
  request_type_code: "رمز نوع الطلب",
  target_user: "المستخدم المستفيد",
  employee_name: "اسم الموظف",
  employee_id: "الرقم الوظيفي",
  department: "الإدارة",
  access_needed: "الصلاحية المطلوبة",
  access_duration: "مدة الوصول",
  business_systems: "الأنظمة المطلوبة",
  remote_country: "الدولة المتوقعة للوصول",
  source_ip: "عنوان المصدر",
  destination_ip: "عنوان الوجهة",
  destination_port: "منفذ الوجهة",
  nat_port: "منفذ NAT",
  reason: "المبرر",
  asset_tag: "رقم الجهاز",
  current_location: "الموقع الحالي",
  new_location: "الموقع الجديد",
  issue_description: "وصف المشكلة"
};

export function RequestDetails() {
  const { requestId } = useParams();
  const navigate = useNavigate();
  const [request, setRequest] = useState<ServiceRequest | null>(null);
  const [messages, setMessages] = useState<LinkedMessage[]>([]);
  const [statusHistory, setStatusHistory] = useState<RequestHistoryRow[]>([]);
  const [auditLogs, setAuditLogs] = useState<RequestAuditRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [aiDraft, setAiDraft] = useState<{ subject: string; body: string } | null>(null);
  const [aiError, setAiError] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiStatus, setAiStatus] = useState<AIStatus>({ is_enabled: false, allow_message_drafting: false, allow_summarization: false, allow_reply_suggestion: false });
  const [messageSettings, setMessageSettings] = useState<MessageSettings>(defaultMessageSettings);

  async function loadDetails() {
    if (!requestId) return;
    setIsLoading(true);
    setError("");
    try {
      const nextRequest = await apiFetch<ServiceRequest>(`/requests/${requestId}`);
      setRequest(nextRequest);
      const [historyRows, auditRows] = await Promise.all([
        apiFetch<RequestHistoryRow[]>(`/requests/${nextRequest.id}/status-history`).catch(() => []),
        apiFetch<RequestAuditRow[]>(`/requests/${nextRequest.id}/audit-logs`).catch(() => [])
      ]);
      setStatusHistory(historyRows);
      setAuditLogs(auditRows);
      const nextMessageSettings = await apiFetch<MessageSettings>("/messages/settings").catch(() => defaultMessageSettings);
      setMessageSettings(nextMessageSettings);
      if (nextMessageSettings.enable_linked_requests && nextMessageSettings.show_messages_tab_in_request_details) {
        const linked = await apiFetch<LinkedMessage[]>(`/requests/${nextRequest.id}/messages`).catch(() => []);
        setMessages(linked);
      } else {
        setMessages([]);
      }
    } catch {
      setRequest(null);
      setMessages([]);
      setStatusHistory([]);
      setAuditLogs([]);
      setError("تعذر تحميل تفاصيل الطلب.");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    loadDetails();
    loadAiStatus();
  }, [requestId]);

  const timeline = useMemo(() => buildTimeline(request, messages, statusHistory), [request, messages, statusHistory]);
  const canShowRequestMessages = Boolean(messageSettings.enable_linked_requests && messageSettings.show_messages_tab_in_request_details);
  const canSendFromRequest = Boolean(canShowRequestMessages && messageSettings.allow_send_message_from_request);
  const canUseAiDrafting = Boolean(canShowRequestMessages && aiStatus.is_enabled && aiStatus.allow_message_drafting && aiStatus.show_in_request_messages_tab !== false);
  const canUseAiSummaries = Boolean(canShowRequestMessages && aiStatus.is_enabled && aiStatus.allow_summarization && aiStatus.show_in_request_messages_tab !== false);

  async function loadAiStatus() {
    try {
      setAiStatus(await apiFetch<AIStatus>("/ai/status"));
    } catch {
      setAiStatus({ is_enabled: false, allow_message_drafting: false, allow_summarization: false, allow_reply_suggestion: false });
    }
  }

  function composeMessage(draft?: { subject?: string; body?: string }) {
    if (!request) return;
    if (!canSendFromRequest) return;
    if (draft?.body || draft?.subject) {
      sessionStorage.setItem("qib_ai_compose_draft", JSON.stringify({ subject: draft.subject || "", body: draft.body || "", message_type: "clarification_request" }));
    }
    const params = new URLSearchParams({
      compose: "1",
      related_request_id: request.request_number,
      subject: draft?.subject || `بخصوص الطلب ${request.request_number}`
    });
    navigate(`/messages?${params.toString()}`);
  }

  async function suggestClarificationMessage() {
    if (!canUseAiDrafting) return;
    if (!request) return;
    setAiError("");
    setAiDraft(null);
    setAiLoading(true);
    try {
      const data = await apiFetch<{ subject: string; body: string }>("/ai/messages/draft", {
        method: "POST",
        body: JSON.stringify({
          instruction: "اقترح رسالة طلب استيضاح مهنية بخصوص هذا الطلب مع طلب المعلومات الناقصة بشكل واضح",
          related_request_id: request.id
        })
      });
      setAiDraft({ subject: data.subject || "", body: data.body || "" });
    } catch (error) {
      setAiError(readApiError(error));
    } finally {
      setAiLoading(false);
    }
  }

  if (isLoading) {
    return (
      <Card className="p-6 text-sm text-slate-500">
        <RefreshCw className="ml-2 inline h-4 w-4 animate-spin" />
        جاري تحميل تفاصيل الطلب...
      </Card>
    );
  }

  if (error || !request) {
    return (
      <Card className="p-6">
        <div className="flex items-center gap-3 text-red-700">
          <AlertTriangle className="h-5 w-5" />
          <p className="font-bold">{error || "الطلب غير موجود."}</p>
        </div>
        <Link to="/requests" className="mt-4 inline-flex text-sm font-bold text-bank-700 hover:underline">
          العودة إلى الطلبات
        </Link>
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      <Card className="p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-sm font-semibold text-bank-700">{request.request_number}</p>
            <h2 className="mt-2 text-2xl font-black text-slate-950">{request.title}</h2>
            <p className="mt-2 text-sm leading-6 text-slate-500">
              مقدم الطلب: {request.requester?.full_name_ar || "-"}، الإدارة: {request.department?.name_ar || "-"}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <StatusPill status={request.status} />
            {canSendFromRequest && (
              <Button type="button" onClick={() => composeMessage()} className="gap-2">
                <Send className="h-4 w-4" />
                مراسلة بخصوص الطلب
              </Button>
            )}
            <button
              type="button"
              onClick={() => downloadPdf(request)}
              className="inline-flex h-10 items-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-sm font-bold text-slate-700 hover:bg-slate-50"
            >
              <Printer className="h-4 w-4" />
              PDF
            </button>
          </div>
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <Info label="نوع الطلب" value={requestTypeName(request)} />
          <Info label="نسخة نوع الطلب" value={`v${request.request_type_version_number || 1}`} />
          <Info label="الأولوية" value={priorityLabels[request.priority] ?? request.priority} />
          <Info label="SLA" value={requestSlaText(request)} />
          <Info label="تاريخ الإنشاء" value={formatDate(request.created_at)} />
          <Info label="آخر تحديث" value={formatDate(request.updated_at)} />
          <Info label="القسم المختص" value={assignedSection(request)} />
          <Info label="الموظف المعيّن" value={request.assigned_to?.full_name_ar || "-"} />
        </div>
      </Card>

      <section className="grid gap-5 xl:grid-cols-[1fr_380px]">
        <div className="space-y-5">
          <Card className="p-5">
            <SectionTitle icon={FileText} title="بيانات الطلب" />
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <Info label="رقم الطلب" value={request.request_number} />
              <Info label="الحالة" value={statusLabels[request.status] ?? request.status} />
              <Info label="مقدم الطلب" value={request.requester?.full_name_ar || "-"} />
              <Info label="إدارة مقدم الطلب" value={request.department?.name_ar || "-"} />
              {requestFieldRows(request).map((field) => (
                <Info key={field.key} label={field.label} value={field.value} />
              ))}
            </div>
            <div className="mt-4 rounded-md bg-slate-50 p-4">
              <p className="mb-2 text-sm font-bold text-slate-700">مبرر العمل</p>
              <p className="text-sm leading-7 text-slate-600">{request.business_justification || "لا يوجد مبرر مسجل."}</p>
            </div>
          </Card>

          <Card className="p-5">
            <SectionTitle icon={UserCheck} title="مسار الموافقات" />
            <div className="mt-5 space-y-3">
              {[...(request.approvals ?? [])].sort((a, b) => a.step_order - b.step_order).map((step) => (
                <ApprovalStepCard key={step.id} step={step} />
              ))}
              {(request.approvals ?? []).length === 0 && <Empty text="لا يوجد مسار موافقات مسجل." />}
            </div>
          </Card>

          {canShowRequestMessages && (
          <Card className="p-5">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <SectionTitle icon={MessageSquare} title="المراسلات المرتبطة" />
              {canUseAiDrafting && (
                <button
                  type="button"
                  onClick={suggestClarificationMessage}
                  disabled={aiLoading}
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-bank-200 bg-bank-50 px-3 text-sm font-bold text-bank-800 hover:bg-bank-100 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <Sparkles className={`h-4 w-4 ${aiLoading ? "animate-pulse" : ""}`} />
                  {aiLoading ? "جاري الاقتراح..." : "اقتراح رسالة استيضاح"}
                </button>
              )}
            </div>
            {canUseAiSummaries && (
              <div className="mt-4">
                <AISummaryBox relatedRequestId={String(request.id)} buttonLabel="تلخيص المراسلات المرتبطة بالطلب" compact />
              </div>
            )}
            {canUseAiDrafting && aiError && <div className="mt-3 rounded-md border border-red-100 bg-red-50 p-3 text-sm text-red-700">{aiError}</div>}
            {canUseAiDrafting && aiDraft && (
              <div className="mt-3">
                <AISuggestionPanel
                  title="رسالة استيضاح مقترحة"
                  subject={aiDraft.subject}
                  body={aiDraft.body}
                  onUse={() => composeMessage(aiDraft)}
                  onRetry={suggestClarificationMessage}
                  onCancel={() => setAiDraft(null)}
                />
              </div>
            )}
            <div className="mt-4 space-y-3">
              {messages.map((message) => (
                <div key={message.id} className="rounded-md border border-slate-200 bg-white p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="font-black text-slate-950">{message.subject}</p>
                      <p className="mt-1 text-xs text-slate-500">
                        {message.message_uid || "-"} • من: {message.sender_name}
                      </p>
                    </div>
                    <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-600">{message.message_type_label || "مراسلة"}</span>
                  </div>
                  <p className="mt-2 text-xs text-slate-500">{formatDate(message.created_at)}</p>
                </div>
              ))}
              {messages.length === 0 && <Empty text="لا توجد مراسلات مرتبطة بهذا الطلب حتى الآن." />}
            </div>
          </Card>
          )}

          <Card className="p-5">
            <SectionTitle icon={History} title="سجل الحالة" />
            <div className="mt-4 space-y-3">
              {statusHistory.map((row, index) => (
                <div key={`${row.event}-${index}`} className="rounded-md border border-slate-200 bg-white p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-black text-slate-950">{row.label}</p>
                    {row.status && <span className={`rounded-full px-3 py-1 text-xs font-bold ${statusTone(row.status)}`}>{actionLabels[row.status] || statusLabels[row.status] || row.status}</span>}
                  </div>
                  <p className="mt-2 text-sm text-slate-600">
                    {row.actor_name ? `بواسطة: ${row.actor_name}` : "بانتظار الإجراء"}
                    {row.changed_at ? ` - ${formatDate(row.changed_at)}` : ""}
                  </p>
                  {row.comment && <p className="mt-2 rounded-md bg-slate-50 p-3 text-sm leading-6 text-slate-600">{row.comment}</p>}
                </div>
              ))}
              {statusHistory.length === 0 && <Empty text="لا يوجد سجل حالة لهذا الطلب." />}
            </div>
          </Card>

          <Card className="p-5">
            <SectionTitle icon={ShieldCheck} title="سجل التدقيق" />
            <div className="mt-4 overflow-hidden rounded-md border border-slate-200">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-slate-500">
                  <tr>
                    <th className="p-3 text-right">الإجراء</th>
                    <th className="p-3 text-right">المستخدم</th>
                    <th className="p-3 text-right">التاريخ</th>
                    <th className="p-3 text-right">IP</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {auditLogs.map((log) => (
                    <tr key={log.id}>
                      <td className="p-3 font-bold text-slate-900">{auditActionLabel(log.action)}</td>
                      <td className="p-3 text-slate-600">{log.actor_name || "-"}</td>
                      <td className="p-3 text-slate-600">{formatDate(log.created_at)}</td>
                      <td className="p-3 text-slate-600">{log.ip_address || "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {auditLogs.length === 0 && <Empty text="لا يوجد سجل تدقيق لهذا الطلب." />}
            </div>
          </Card>
        </div>

        <aside className="space-y-5">
          <Card className="p-5">
            <SectionTitle icon={Clock3} title="Timeline" />
            <div className="mt-5 space-y-0">
              {timeline.map((item, index) => (
                <div key={`${item.title}-${index}`} className="relative flex gap-3 pb-5 last:pb-0">
                  {index < timeline.length - 1 && <span className="absolute right-[15px] top-8 h-full w-px bg-slate-200" />}
                  <span className={`relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${itemTone(item.tone)}`}>
                    {item.tone === "danger" ? <XCircle className="h-4 w-4" /> : item.tone === "success" ? <CheckCircle2 className="h-4 w-4" /> : <Clock3 className="h-4 w-4" />}
                  </span>
                  <div>
                    <p className="font-bold text-slate-950">{item.title}</p>
                    <p className="mt-1 text-xs leading-5 text-slate-500">{item.description}</p>
                    <p className="mt-1 text-xs text-slate-400">{formatDate(item.date)}</p>
                  </div>
                </div>
              ))}
            </div>
          </Card>

          <Card className="p-5">
            <SectionTitle icon={Paperclip} title="المرفقات" />
            <div className="mt-4 space-y-2">
              {(request.attachments ?? []).map((attachment) => (
                <button
                  key={attachment.id}
                  type="button"
                  onClick={() => downloadAttachment(request.id, attachment)}
                  className="flex w-full items-center justify-between gap-3 rounded-md border border-slate-200 bg-white p-3 text-right hover:bg-slate-50"
                >
                  <span>
                    <span className="block text-sm font-bold text-slate-900">{attachment.original_name}</span>
                    <span className="mt-1 block text-xs text-slate-500">{formatBytes(attachment.size_bytes)}</span>
                  </span>
                  <Download className="h-4 w-4 text-slate-500" />
                </button>
              ))}
              {(request.attachments ?? []).length === 0 && <Empty text="لا توجد مرفقات." />}
            </div>
          </Card>
        </aside>
      </section>
    </div>
  );
}

function buildTimeline(request: ServiceRequest | null, messages: LinkedMessage[], statusHistory: RequestHistoryRow[]) {
  if (!request) return [];
  const historyItems = statusHistory.length > 0
    ? statusHistory.map((row) => ({
        title: row.label,
        description: `${row.actor_name ? `بواسطة ${row.actor_name}` : "بانتظار الإجراء"}${row.comment ? ` - ${row.comment}` : ""}`,
        date: row.changed_at || request.updated_at,
        tone: row.status === "approved" ? "success" : row.status === "rejected" || row.status === "returned_for_edit" ? "danger" : "info"
      }))
    : [
        {
          title: "تم إنشاء الطلب",
          description: `بواسطة ${request.requester?.full_name_ar || "-"}`,
          date: request.created_at,
          tone: "info"
        },
        ...[...(request.approvals ?? [])].sort((a, b) => a.step_order - b.step_order).map((step) => ({
          title: roleLabels[step.role] ?? step.role,
          description: `${actionLabels[step.action] ?? step.action}${step.approver ? ` بواسطة ${step.approver.full_name_ar}` : ""}${step.note ? ` - ${step.note}` : ""}`,
          date: step.acted_at || request.updated_at,
          tone: step.action === "approved" ? "success" : step.action === "rejected" || step.action === "returned_for_edit" ? "danger" : "info"
        }))
      ];
  const items = [
    ...historyItems,
    ...messages.slice(0, 6).map((message) => ({
      title: "مراسلة مرتبطة",
      description: `${message.subject} - من ${message.sender_name}`,
      date: message.created_at || request.updated_at,
      tone: "message"
    }))
  ];
  return items.sort((a, b) => new Date(a.date || 0).getTime() - new Date(b.date || 0).getTime());
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
      <p className="text-xs font-bold text-slate-500">{label}</p>
      <p className="mt-2 break-words text-sm font-bold leading-6 text-slate-950">{value || "-"}</p>
    </div>
  );
}

function requestTypeName(request: ServiceRequest) {
  const snapshot = request.request_type_snapshot || {};
  const name = snapshot.name_ar;
  return typeof name === "string" && name ? name : request.form_data?.request_type_label || request.request_type || "-";
}

function requestFieldRows(request: ServiceRequest) {
  const formData = request.form_data ?? {};
  const snapshot = [...(request.form_schema_snapshot || [])].sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
  if (snapshot.length > 0) {
    return snapshot
      .filter((field) => !hiddenFormKeys.has(field.field_name) && formData[field.field_name] !== null && formData[field.field_name] !== undefined && formData[field.field_name] !== "")
      .map((field) => ({
        key: field.field_name,
        label: field.label_ar || fieldLabels[field.field_name] || field.field_name.replace(/_/g, " "),
        value: String(formData[field.field_name] || "-")
      }));
  }
  return Object.entries(formData)
    .filter(([key, value]) => !hiddenFormKeys.has(key) && value !== null && value !== "")
    .map(([key, value]) => ({
      key,
      label: fieldLabels[key] ?? key.replace(/_/g, " "),
      value: String(value || "-")
    }));
}

function SectionTitle({ icon: Icon, title }: { icon: typeof FileText; title: string }) {
  return (
    <div className="flex items-center gap-2">
      <Icon className="h-5 w-5 text-bank-700" />
      <h3 className="font-black text-slate-950">{title}</h3>
    </div>
  );
}

function ApprovalStepCard({ step }: { step: ApprovalStep }) {
  return (
    <div className="rounded-md border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-black text-slate-950">{roleLabels[step.role] ?? step.role}</p>
          <p className="mt-1 text-xs text-slate-500">الخطوة {step.step_order}</p>
        </div>
        <span className={`rounded-full px-3 py-1 text-xs font-bold ${approvalTone(step.action)}`}>{actionLabels[step.action] ?? step.action}</span>
      </div>
      {(step.approver || step.acted_at || step.note) && (
        <div className="mt-3 text-sm leading-6 text-slate-600">
          {step.approver && <p>بواسطة: {step.approver.full_name_ar || step.approver.email}</p>}
          {step.acted_at && <p>في: {formatDate(step.acted_at)}</p>}
          {step.note && <p>الملاحظة: {step.note}</p>}
        </div>
      )}
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  return <span className={`inline-flex h-10 items-center rounded-md px-3 text-sm font-bold ${statusTone(status)}`}>{statusLabels[status] ?? status}</span>;
}

function Empty({ text }: { text: string }) {
  return <p className="rounded-md bg-slate-50 p-4 text-sm text-slate-500">{text}</p>;
}

function assignedSection(request: ServiceRequest) {
  const key = request.form_data?.assigned_section || request.form_data?.administrative_section || "";
  return request.form_data?.assigned_section_label || request.form_data?.administrative_section_label || sectionLabels[key] || "-";
}

function requestSlaText(request: ServiceRequest) {
  if (!request.sla_due_at) return "بدون SLA";
  const dueDate = parseApiDate(request.sla_due_at);
  if (!dueDate) return "غير محدد";
  const finalStatuses = new Set(["completed", "closed", "rejected", "cancelled"]);
  if (finalStatuses.has(request.status)) return `انتهى في ${formatDate(request.sla_due_at)}`;
  const diffMs = dueDate.getTime() - Date.now();
  if (diffMs < 0) return `متأخر منذ ${formatDate(request.sla_due_at)}`;
  const remainingHours = Math.max(1, Math.ceil(diffMs / (1000 * 60 * 60)));
  return `متبقّي ${remainingHours} ساعة - ${formatDate(request.sla_due_at)}`;
}

function formatDate(value?: string | null) {
  return formatSystemDateTime(value);
}

function formatBytes(value: number) {
  if (!value) return "0 KB";
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function statusTone(status: string) {
  if (["rejected", "cancelled"].includes(status)) return "bg-red-50 text-red-700";
  if (["completed", "closed", "approved"].includes(status)) return "bg-emerald-50 text-emerald-700";
  if (["pending_approval", "in_implementation"].includes(status)) return "bg-amber-50 text-amber-700";
  return "bg-slate-100 text-slate-700";
}

function approvalTone(action: string) {
  if (action === "approved") return "bg-emerald-50 text-emerald-700";
  if (action === "rejected" || action === "returned_for_edit") return "bg-red-50 text-red-700";
  return "bg-slate-100 text-slate-700";
}

function auditActionLabel(action: string) {
  const labels: Record<string, string> = {
    request_created: "إنشاء الطلب",
    dynamic_request_created: "إنشاء طلب ديناميكي",
    request_edited: "تعديل الطلب",
    request_resubmitted: "إعادة إرسال الطلب",
    request_approved: "موافقة على الطلب",
    request_rejected: "رفض الطلب",
    request_returned_for_edit: "إرجاع الطلب للتعديل",
    request_printed_pdf: "طباعة PDF",
    attachment_uploaded: "رفع مرفق",
    attachment_downloaded: "تحميل مرفق",
    comment_added: "إضافة تعليق"
  };
  return labels[action] || action;
}

function itemTone(tone: string) {
  if (tone === "success") return "bg-emerald-50 text-emerald-700";
  if (tone === "danger") return "bg-red-50 text-red-700";
  if (tone === "message") return "bg-bank-50 text-bank-700";
  return "bg-slate-100 text-slate-600";
}

function readApiError(error: unknown) {
  const message = error instanceof Error ? error.message : "تعذر تنفيذ طلب المساعد الذكي.";
  try {
    const parsed = JSON.parse(message);
    return parsed.detail || message;
  } catch {
    return message;
  }
}

async function downloadPdf(request: ServiceRequest) {
  const token = localStorage.getItem("qib_token");
  const response = await fetch(`${API_BASE}/requests/${request.id}/print.pdf`, {
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    }
  });
  if (!response.ok) return;
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${request.request_number || "request"}.pdf`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

async function downloadAttachment(requestId: number, attachment: Attachment) {
  const token = localStorage.getItem("qib_token");
  const response = await fetch(`${API_BASE}/requests/${requestId}/attachments/${attachment.id}/download`, {
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    }
  });
  if (!response.ok) return;
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = attachment.original_name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
