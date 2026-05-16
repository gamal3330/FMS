import { ChangeEvent, FormEvent, ReactNode, useEffect, useMemo, useState } from "react";
import { Eye, FilePlus2, MessageSquare, RefreshCw, RotateCcw, Save, Search, Send, X } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { API_BASE, apiFetch, CurrentUser, ServiceRequest } from "../lib/api";
import { formatSystemDate, formatSystemDateTime, parseApiDate } from "../lib/datetime";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import FeedbackDialog from "../components/ui/FeedbackDialog";
import { Input } from "../components/ui/input";
import { Pagination } from "../components/ui/Pagination";

type RequestType = string;
type Priority = "low" | "medium" | "high" | "critical";
type FieldKind = "text" | "textarea" | "select" | "multi_select" | "checkbox" | "date" | "datetime" | "number" | "email" | "phone" | "ip_address" | "mac_address" | "file";
type FieldValue = string | string[];
type AdministrativeSection = string;

interface FieldConfig {
  name: string;
  label: string;
  kind?: FieldKind;
  placeholder?: string;
  options?: string[];
  required?: boolean;
  colSpan?: boolean;
}

interface TypeConfig {
  value: RequestType;
  requestTypeId?: number;
  code?: string;
  label: string;
  description: string;
  section: AdministrativeSection;
  sectionLabel?: string;
  autoAssignStrategy?: string;
  requiresAttachment?: boolean;
  allowMultipleAttachments?: boolean;
  maxAttachments?: number;
  maxFileSizeMb?: number;
  allowedExtensions?: string[];
  defaultPriority?: Priority;
  slaResponseHours?: number | null;
  slaResolutionHours?: number | null;
  icon: typeof FilePlus2;
  fields: FieldConfig[];
}

interface LinkedMessage {
  id: number;
  message_type: string;
  subject: string;
  body: string;
  sender_name: string;
  recipient_names: string[];
  recipients_count?: number;
  is_read: boolean;
  created_at: string;
}

interface RequestNotificationControl {
  show_checkbox: boolean;
  default_checked: boolean;
  allow_toggle: boolean;
}

interface MessageSettings {
  enable_linked_requests: boolean;
  allow_send_message_from_request: boolean;
  show_messages_tab_in_request_details: boolean;
}

const defaultMessageSettings: MessageSettings = {
  enable_linked_requests: true,
  allow_send_message_from_request: true,
  show_messages_tab_in_request_details: true
};
const defaultComposeMessageType = API_BASE.includes("/api/dotnet") ? "internal_message" : "internal_correspondence";

const administrativeSections: Record<AdministrativeSection, string> = {
  servers: "قسم السيرفرات",
  networks: "قسم الشبكات",
  support: "قسم الدعم الفني",
  development: "وحدة تطوير البرامج"
};

const fieldTypeMap: Record<string, FieldKind> = {
  text: "text",
  number: "number",
  email: "email",
  phone: "phone",
  ip_address: "ip_address",
  mac_address: "mac_address",
  file: "text",
  textarea: "textarea",
  select: "select",
  multi_select: "multi_select",
  checkbox: "checkbox",
  date: "date",
  datetime: "datetime"
};

const priorities: { value: Priority; label: string }[] = [
  { value: "low", label: "منخفضة" },
  { value: "medium", label: "متوسطة" },
  { value: "high", label: "عالية" },
  { value: "critical", label: "حرجة" }
];

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

const requestPageSize = 10;

export function Requests() {
  const navigate = useNavigate();
  const [items, setItems] = useState<ServiceRequest[]>([]);
  const [managedRequestTypes, setManagedRequestTypes] = useState<TypeConfig[]>([]);
  const [sectionLabels, setSectionLabels] = useState<Record<string, string>>(administrativeSections);
  const [requestType, setRequestType] = useState<RequestType>("");
  const [title, setTitle] = useState("");
  const [priority, setPriority] = useState<Priority>("medium");
  const [businessJustification, setBusinessJustification] = useState("");
  const [sendNotification, setSendNotification] = useState(true);
  const [requestNotificationControl, setRequestNotificationControl] = useState<RequestNotificationControl>({
    show_checkbox: true,
    default_checked: true,
    allow_toggle: true
  });
  const [formData, setFormData] = useState<Record<string, FieldValue>>({});
  const [attachments, setAttachments] = useState<File[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isTypesLoading, setIsTypesLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [editingRequestId, setEditingRequestId] = useState<number | null>(null);
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);
  const [linkedRequest, setLinkedRequest] = useState<ServiceRequest | null>(null);
  const [linkedMessages, setLinkedMessages] = useState<LinkedMessage[]>([]);
  const [isLinkedMessagesLoading, setIsLinkedMessagesLoading] = useState(false);
  const [messageSettings, setMessageSettings] = useState<MessageSettings>(defaultMessageSettings);
  const [requestSearch, setRequestSearch] = useState("");
  const [requestsPage, setRequestsPage] = useState(1);
  const [requestsHasMore, setRequestsHasMore] = useState(false);

  const availableRequestTypes = useMemo(() => managedRequestTypes, [managedRequestTypes]);
  const selectedType = useMemo(
    () => availableRequestTypes.find((item) => item.value === requestType) ?? availableRequestTypes[0] ?? null,
    [availableRequestTypes, requestType]
  );
  const requestListTotal = requestsHasMore ? requestsPage * requestPageSize + 1 : (requestsPage - 1) * requestPageSize + items.length;
  const selectedRequiredFieldsCount = selectedType?.fields.filter((field) => field.required).length ?? 0;
  const selectedAttachmentLabel = !selectedType ? "-" : selectedType.requiresAttachment ? "إلزامية" : typeAllowsAttachments(selectedType) ? "اختيارية" : "غير مفعلة";

  function updateField(name: string, value: FieldValue) {
    setFormData((current) => ({ ...current, [name]: value }));
  }

  function resetForm(nextType = requestType, sourceTypes = availableRequestTypes) {
    const nextConfig = sourceTypes.find((item) => item.value === nextType) ?? sourceTypes[0];
    setTitle("");
    setPriority(nextConfig?.defaultPriority ?? "medium");
    setBusinessJustification("");
    setSendNotification(requestNotificationControl.default_checked);
    setAttachments([]);
    if (!nextConfig) {
      setFormData({});
      return;
    }
    setFormData(
      nextConfig.fields.reduce<Record<string, FieldValue>>((acc, field) => {
        acc[field.name] = field.kind === "multi_select" ? [] : field.kind === "select" ? field.options?.[0] ?? "" : field.kind === "checkbox" ? "لا" : "";
        return acc;
      }, {})
    );
  }

  async function loadRequests(page = requestsPage) {
    setIsLoading(true);
    try {
      const query = new URLSearchParams({
        page: String(page),
        per_page: String(requestPageSize)
      });
      const term = requestSearch.trim();
      if (term) query.set("search", term);
      const data = await apiFetch<ServiceRequest[]>(`/requests?${query.toString()}`);
      setItems(data);
      setRequestsHasMore(data.length === requestPageSize);
      if (data.length === 0 && page > 1) setRequestsPage(page - 1);
    } catch {
      setItems([]);
      setRequestsHasMore(false);
    } finally {
      setIsLoading(false);
    }
  }

  async function loadActiveRequestTypes() {
    setIsTypesLoading(true);
    try {
      const data = await apiFetch<
        Array<{
          id: number;
          code?: string;
          request_type?: string;
          name_ar?: string;
          description?: string;
          category?: string;
          assigned_section?: string;
          assigned_section_label?: string;
          specialized_section_code?: string;
          auto_assign_strategy?: string;
          specialized_section_name?: string;
          specialized_section_name_ar?: string;
          specialized_section?: {
            code?: string;
            name_ar?: string;
            nameAr?: string;
          } | null;
          requires_attachment?: boolean;
          allow_multiple_attachments?: boolean;
          max_attachments?: number;
          max_file_size_mb?: number;
          allowed_extensions_json?: string[] | string;
          default_priority?: string;
          sla_response_hours?: number | null;
          sla_resolution_hours?: number | null;
        }>
      >("/request-types/active");
      const sections = await apiFetch<Array<{ code: string; name_ar: string }>>("/settings/specialized-sections?active_only=true").catch(() => []);
      const labels = { ...administrativeSections, ...Object.fromEntries(sections.map((section) => [section.code, section.name_ar])) };
      const nextSectionLabels = { ...labels };

      const nextTypes = await Promise.all(
        data.map(async (item) => {
          const fields = await loadManagedFields(item.id, []);
          const sectionCode = item.assigned_section || item.specialized_section_code || item.specialized_section?.code || categoryToSection(item.category);
          const sectionLabel =
            item.assigned_section_label ||
            item.specialized_section_name_ar ||
            item.specialized_section_name ||
            item.specialized_section?.name_ar ||
            item.specialized_section?.nameAr ||
            labels[sectionCode] ||
            sectionCode;
          if (sectionCode && sectionLabel) {
            nextSectionLabels[sectionCode] = sectionLabel;
          }
          return {
            value: `managed_${item.id}`,
            label: item.name_ar || item.code || "نوع طلب",
            description: item.description || "نوع طلب معرف من شاشة إدارة الطلبات.",
            section: sectionCode,
            sectionLabel,
            autoAssignStrategy: item.auto_assign_strategy || "none",
            icon: FilePlus2,
            requestTypeId: item.id,
            code: item.code,
            requiresAttachment: Boolean(item.requires_attachment),
            allowMultipleAttachments: Boolean(item.allow_multiple_attachments),
            maxAttachments: item.max_attachments ?? (item.allow_multiple_attachments ? 5 : 1),
            maxFileSizeMb: item.max_file_size_mb ?? 10,
            allowedExtensions: normalizeAllowedExtensions(item.allowed_extensions_json),
            defaultPriority: normalizePriority(item.default_priority),
            slaResponseHours: item.sla_response_hours ?? null,
            slaResolutionHours: item.sla_resolution_hours ?? null,
            fields
          } as TypeConfig;
        })
      );
      setSectionLabels(nextSectionLabels);

      if (nextTypes.length > 0) {
        setManagedRequestTypes(nextTypes);
        const nextType = nextTypes.some((item) => item.value === requestType) ? requestType : nextTypes[0].value;
        if (nextType !== requestType) {
          setRequestType(nextType);
        }
        resetForm(nextType, nextTypes);
      } else {
        setManagedRequestTypes([]);
        setRequestType("");
        resetForm("", []);
      }
    } catch {
      setManagedRequestTypes([]);
      setRequestType("");
      resetForm("", []);
      setError("تعذر تحميل أنواع الطلبات من الخادم.");
    } finally {
      setIsTypesLoading(false);
    }
  }

  useEffect(() => {
    loadActiveRequestTypes();
    apiFetch<CurrentUser>("/auth/me").then(setCurrentUser).catch(() => setCurrentUser(null));
    apiFetch<RequestNotificationControl>("/settings/messaging/request-notification-control")
      .then((control) => {
        setRequestNotificationControl(control);
        setSendNotification(control.default_checked);
      })
      .catch(() => undefined);
    apiFetch<MessageSettings>("/messages/settings").then(setMessageSettings).catch(() => setMessageSettings(defaultMessageSettings));
  }, []);

  useEffect(() => {
    loadRequests(requestsPage);
  }, [requestsPage, requestSearch]);

  function handleTypeChange(event: ChangeEvent<HTMLSelectElement>) {
    const nextType = event.target.value;
    setRequestType(nextType);
    resetForm(nextType);
    setMessage("");
    setError("");
  }

  async function create(event: FormEvent) {
    event.preventDefault();
    setMessage("");
    setError("");
    setIsSubmitting(true);

    try {
      if (selectedType && !typeAllowsAttachments(selectedType) && attachments.length > 0) {
        setError("المرفقات غير مفعلة لهذا النوع من الطلبات.");
        return;
      }
      if (selectedType?.requiresAttachment && attachments.length === 0 && !editingRequestId) {
        setError("هذا النوع من الطلبات يتطلب إرفاق ملف قبل الإرسال.");
        return;
      }
      if (selectedType) {
        const attachmentError = validateAttachmentsForType(attachments, selectedType);
        if (attachmentError) {
          setError(attachmentError);
          return;
        }
      }
      const payload = buildRequestPayload();
      if (editingRequestId) {
        await apiFetch<ServiceRequest>(`/requests/${editingRequestId}`, {
          method: "PATCH",
          body: JSON.stringify(payload)
        });
        await uploadAttachments(editingRequestId, attachments);
        await apiFetch<ServiceRequest>(`/requests/${editingRequestId}/resubmit`, { method: "POST" });
        setMessage("تم تحديث الطلب وإعادة إرساله إلى مسار الموافقات.");
        setEditingRequestId(null);
      } else {
        const created = await apiFetch<{ id: number }>(selectedType.requestTypeId ? "/requests/dynamic" : "/requests", {
          method: "POST",
          body: JSON.stringify(payload)
        });
        if (created?.id) {
          await uploadAttachments(created.id, attachments);
        }
        setMessage("تم إرسال الطلب بنجاح وإضافته إلى مسار الموافقات.");
      }
      resetForm();
      setRequestsPage(1);
      await loadRequests(1);
    } catch (submitError) {
      setError(readableSubmitError(submitError) || "تعذر إرسال الطلب. تحقق من الاتصال بالخادم وصلاحية الجلسة.");
    } finally {
      setIsSubmitting(false);
    }
  }

  function beginEditReturnedRequest(item: ServiceRequest) {
    const nextType =
      availableRequestTypes.find((type) => type.requestTypeId === item.request_type_id) ??
      availableRequestTypes.find((type) => type.value === item.request_type || type.code === item.form_data?.request_type_code) ??
      availableRequestTypes[0];
    if (!nextType) return;
    setEditingRequestId(item.id);
    setRequestType(nextType.value);
    setTitle(item.title);
    setPriority(item.priority as Priority);
    setBusinessJustification(item.business_justification || "");
    setSendNotification(requestNotificationControl.default_checked);
    setAttachments([]);
    setFormData({ ...(item.form_data || {}) });
    setMessage("");
    setError("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function buildRequestPayload() {
    if (!selectedType) {
      throw new Error("Request type is not loaded");
    }
    const sendRequestNotification = requestNotificationControl.allow_toggle ? sendNotification : requestNotificationControl.default_checked;
    const enrichedFormData = {
      ...formData,
      administrative_section: selectedType.section,
      administrative_section_label: sectionLabelForType(selectedType),
      assigned_section: selectedType.section,
      assigned_section_label: sectionLabelForType(selectedType),
      request_type_code: selectedType.code || selectedType.value,
      request_type_label: selectedType.label
    };

    if (selectedType.requestTypeId) {
      return {
        request_type_id: selectedType.requestTypeId,
        title,
        priority,
        business_justification: businessJustification,
        send_notification: sendRequestNotification,
        attachment_count: attachments.length,
        form_data: enrichedFormData
      };
    }

    return {
      title,
      request_type: requestType,
      priority,
      business_justification: businessJustification,
      send_notification: sendRequestNotification,
      attachment_count: attachments.length,
      form_data: enrichedFormData
    };
  }

  function requestTypeLabel(item: ServiceRequest) {
    return availableRequestTypes.find((type) => type.value === item.request_type || type.code === item.form_data?.request_type_code)?.label ?? item.form_data?.request_type_label ?? item.request_type;
  }

  function requestSectionLabel(item: ServiceRequest) {
    const type = availableRequestTypes.find((candidate) => candidate.value === item.request_type || candidate.code === item.form_data?.request_type_code);
    const key =
      item.form_data?.assigned_section ||
      item.form_data?.administrative_section ||
      type?.section ||
      "";
    return item.form_data?.assigned_section_label || item.form_data?.administrative_section_label || type?.sectionLabel || sectionLabels[key] || item.department?.name_ar || key || "-";
  }

  function sectionLabelForType(type?: TypeConfig | null) {
    if (!type) return "-";
    return type.sectionLabel || sectionLabels[type.section] || type.section || "-";
  }

  async function showLinkedMessages(item: ServiceRequest) {
    if (!messageSettings.enable_linked_requests || !messageSettings.show_messages_tab_in_request_details) return;
    setLinkedRequest(item);
    setLinkedMessages([]);
    setIsLinkedMessagesLoading(true);
    setError("");
    try {
      const data = await apiFetch<unknown[]>(`/requests/${item.id}/messages`);
      setLinkedMessages(normalizeLinkedMessages(data));
    } catch {
      setError("تعذر تحميل المراسلات المرتبطة بالطلب.");
    } finally {
      setIsLinkedMessagesLoading(false);
    }
  }

  function composeRequestMessage(item: ServiceRequest) {
    if (!messageSettings.enable_linked_requests || !messageSettings.allow_send_message_from_request) return;
    const params = new URLSearchParams({
      compose: "1",
      related_request_id: item.request_number,
      subject: `بخصوص الطلب ${item.request_number}`,
      message_type: defaultComposeMessageType
    });
    navigate(`/messages?${params.toString()}`);
  }

  return (
    <div className="space-y-6">
      <FeedbackDialog open={Boolean(message)} type="success" message={message} onClose={() => setMessage("")} />
      <FeedbackDialog open={Boolean(error)} type="error" message={error} onClose={() => setError("")} />

      <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-sm font-semibold text-bank-700">طلبات الخدمات</p>
            <h2 className="mt-2 text-2xl font-bold text-slate-950">نموذج تقديم طلب جديد</h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">
              اختر نوع الطلب، أدخل البيانات المطلوبة، ثم أرسل الطلب ليتم توجيهه تلقائياً إلى مسار الموافقات المناسب.
            </p>
          </div>
          <Button onClick={() => loadRequests(requestsPage)} disabled={isLoading} className="gap-2 self-start lg:self-auto">
            <RefreshCw className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
            تحديث القائمة
          </Button>
        </div>
      </section>

      <div className="space-y-5">
        <Card className="p-5">
          {isTypesLoading ? (
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <div className="rounded-md bg-bank-50 p-3 text-bank-700">
                  <RefreshCw className="h-5 w-5 animate-spin" />
                </div>
                <div>
                  <h3 className="font-bold text-slate-950">جاري تحميل نموذج الطلب</h3>
                  <p className="text-sm text-slate-500">يتم جلب أنواع الطلبات والحقول المعرفة من الخادم.</p>
                </div>
              </div>
              <div className="space-y-3">
                <div className="h-10 animate-pulse rounded-md bg-slate-100" />
                <div className="h-10 animate-pulse rounded-md bg-slate-100" />
                <div className="h-24 animate-pulse rounded-md bg-slate-100" />
              </div>
            </div>
          ) : !selectedType ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
              <h3 className="font-bold text-slate-950">لا توجد أنواع طلبات متاحة</h3>
              <p className="mt-1 text-sm leading-6 text-slate-600">يرجى تفعيل نوع طلب واحد على الأقل من شاشة إدارة أنواع الطلبات.</p>
            </div>
          ) : (
            <>
              <div className="request-form-intro mb-4 rounded-md border p-4">
                <div className="flex items-start gap-3">
                  <div className="request-form-icon rounded-md p-2">
                    <FilePlus2 className="h-4 w-4" />
                  </div>
                  <div className="min-w-0">
                    <h3 className="font-bold text-slate-950">بيانات الطلب</h3>
                    <p className="mt-1 line-clamp-1 text-sm text-slate-500">{selectedType.description}</p>
                    {editingRequestId && <p className="mt-1 text-xs font-bold text-amber-700">وضع تعديل طلب معاد: سيتم إعادة إرساله للموافقات بعد الحفظ.</p>}
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap gap-2 text-xs font-bold">
                  <span className="request-form-meta rounded-full px-3 py-1">القسم: {sectionLabelForType(selectedType)}</span>
                  <span className="request-form-meta rounded-full px-3 py-1">الحقول المطلوبة: {selectedRequiredFieldsCount}</span>
                  {typeAllowsAttachments(selectedType) && <span className="request-form-meta rounded-full px-3 py-1">المرفقات: {selectedAttachmentLabel}</span>}
                </div>
              </div>

              <form onSubmit={create} className="space-y-5">
            <FormSection title="معلومات الطلب الأساسية" description="يتم جلب نوع الطلب والقسم المختص والأولوية الافتراضية من إدارة الطلبات.">
              <div className="grid gap-4 md:grid-cols-2">
                <label className="block space-y-2 text-sm font-medium text-slate-700">
                  نوع الطلب
                  <select value={requestType} onChange={handleTypeChange} className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm outline-none focus:border-bank-600 focus:ring-2 focus:ring-bank-100">
                    {availableRequestTypes.map((item) => (
                      <option key={item.value} value={item.value}>{item.label}</option>
                    ))}
                  </select>
                </label>

                <label className="block space-y-2 text-sm font-medium text-slate-700">
                  القسم المختص
                  <div className="flex h-10 w-full items-center rounded-md border border-slate-300 bg-slate-100 px-3 text-sm font-semibold text-slate-600">
                    {sectionLabelForType(selectedType)}
                  </div>
                  <span className="block text-xs font-normal text-slate-500">يتم تحديد القسم من إدارة أنواع الطلبات.</span>
                </label>

                <label className="block space-y-2 text-sm font-medium text-slate-700 md:col-span-2">
                  عنوان الطلب
                  <Input value={title} onChange={(event) => setTitle(event.target.value)} required placeholder="مثال: تفعيل VPN لموظف إدارة العمليات" />
                </label>

                <label className="block space-y-2 text-sm font-medium text-slate-700">
                  الأولوية
                  <select value={priority} onChange={(event) => setPriority(event.target.value as Priority)} className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm outline-none focus:border-bank-600 focus:ring-2 focus:ring-bank-100">
                    {priorities.map((item) => (
                      <option key={item.value} value={item.value}>{item.label}</option>
                    ))}
                  </select>
                </label>

                <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm">
                  <p className="font-bold text-slate-900">SLA المتوقع</p>
                  <p className="mt-1 text-slate-500">{selectedTypeSlaText(selectedType)}</p>
                </div>
              </div>
            </FormSection>

            <FormSection title="بيانات النموذج" description={selectedType.fields.length ? "املأ الحقول المطلوبة لهذا النوع من الطلب." : "لا توجد حقول إضافية لهذا النوع."}>
            <div className="grid gap-4 md:grid-cols-2">
              {selectedType.fields.map((field) => {
                const value = formData[field.name];
                return (
                <label key={field.name} className={`block space-y-2 text-sm font-medium text-slate-700 ${field.colSpan ? "md:col-span-2" : ""}`}>
                  {field.label}
                  {field.kind === "textarea" ? (
                    <textarea value={fieldValueAsString(value)} onChange={(event) => updateField(field.name, event.target.value)} required={field.required} placeholder={field.placeholder} rows={4} className="w-full resize-y rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-bank-600 focus:ring-2 focus:ring-bank-100" />
                  ) : field.kind === "select" ? (
                    <select value={fieldValueAsString(value) || field.options?.[0] || ""} onChange={(event) => updateField(field.name, event.target.value)} required={field.required} className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm outline-none focus:border-bank-600 focus:ring-2 focus:ring-bank-100">
                      {(field.options ?? []).map((option) => (
                        <option key={option} value={option}>{option}</option>
                      ))}
                    </select>
                  ) : field.kind === "multi_select" ? (
                    <select
                      multiple
                      value={Array.isArray(value) ? value : []}
                      onChange={(event) => updateField(field.name, Array.from(event.target.selectedOptions).map((option) => option.value))}
                      required={field.required}
                      className="min-h-28 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-bank-600 focus:ring-2 focus:ring-bank-100"
                    >
                      {(field.options ?? []).map((option) => (
                        <option key={option} value={option}>{option}</option>
                      ))}
                    </select>
                  ) : field.kind === "checkbox" ? (
                    <label className="flex h-10 items-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700">
                      <input
                        type="checkbox"
                        checked={fieldValueAsString(value) === "نعم"}
                        onChange={(event) => updateField(field.name, event.target.checked ? "نعم" : "لا")}
                        className="h-4 w-4 rounded border-slate-300 text-bank-700 focus:ring-bank-600"
                      />
                      نعم
                    </label>
                  ) : (
                    <Input value={fieldValueAsString(value)} onChange={(event) => updateField(field.name, event.target.value)} required={field.required} placeholder={field.placeholder} type={inputTypeForField(field.kind)} />
                  )}
                </label>
                );
              })}
            </div>
            {selectedType.fields.length === 0 && <p className="rounded-md bg-slate-50 p-4 text-sm text-slate-500">هذا النوع لا يحتوي على حقول إضافية.</p>}
            </FormSection>

            {typeAllowsAttachments(selectedType) && (
            <FormSection title="المرفقات" description="تتبع هذه القواعد إعدادات نوع الطلب الحالية.">
            {selectedType && (
              <label className="block space-y-2 text-sm font-medium text-slate-700">
                {selectedType.requiresAttachment ? "المرفقات المطلوبة" : "المرفقات"}
                <input
                  type="file"
                  accept={fileAcceptAttribute(selectedType)}
                  multiple={Boolean(selectedType.allowMultipleAttachments)}
                  required={selectedType.requiresAttachment && attachments.length === 0 && !editingRequestId}
                  onChange={(event) => {
                    const selectedFiles = Array.from(event.target.files || []);
                    const nextFiles = selectedType.allowMultipleAttachments
                      ? mergeAttachmentFiles(attachments, selectedFiles)
                      : selectedFiles.slice(0, 1);
                    const attachmentError = validateAttachmentsForType(nextFiles, selectedType);
                    if (attachmentError) {
                      setError(attachmentError);
                      event.target.value = "";
                      return;
                    }
                    setError("");
                    setAttachments(nextFiles);
                    event.target.value = "";
                  }}
                  className="block w-full rounded-md border border-dashed border-slate-300 bg-white px-3 py-2 text-sm file:ml-3 file:rounded-md file:border-0 file:bg-bank-50 file:px-3 file:py-1.5 file:text-sm file:font-bold file:text-bank-700"
                />
                {attachments.length > 0 && (
                  <div className="space-y-1 rounded-md border border-slate-200 bg-slate-50 p-3">
                    {attachments.map((file, index) => (
                      <div key={`${file.name}-${file.size}`} className="flex items-center justify-between gap-3 text-xs text-slate-600">
                        <span className="truncate font-bold text-slate-800">{file.name}</span>
                        <span className="flex shrink-0 items-center gap-2">
                          {formatFileSize(file.size)}
                          <button
                            type="button"
                            onClick={() => setAttachments((current) => current.filter((_, fileIndex) => fileIndex !== index))}
                            className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 hover:border-red-200 hover:text-red-600"
                            aria-label="إزالة المرفق"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </span>
                      </div>
                    ))}
                  </div>
                )}
                <span className="block text-xs font-normal text-slate-500">
                  الامتدادات المسموحة: {formatAllowedExtensions(selectedType)}. الحد الأقصى للملف: {selectedType.maxFileSizeMb ?? 10} MB. عدد الملفات: {selectedType.allowMultipleAttachments ? `حتى ${selectedType.maxAttachments ?? 5}` : "ملف واحد"}.
                </span>
              </label>
            )}
            </FormSection>
            )}

            <FormSection title="المراجعة والإرسال" description="أضف مبرر الطلب ثم أرسله إلى مسار الموافقات.">
              <label className="block space-y-2 text-sm font-medium text-slate-700">
                مبرر العمل
                <textarea value={businessJustification} onChange={(event) => setBusinessJustification(event.target.value)} required rows={4} placeholder="اشرح سبب الطلب والأثر التشغيلي المتوقع" className="w-full resize-y rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-bank-600 focus:ring-2 focus:ring-bank-100" />
              </label>

              {requestNotificationControl.show_checkbox && (
                <label className="mt-4 flex items-start gap-3 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={requestNotificationControl.allow_toggle ? sendNotification : requestNotificationControl.default_checked}
                    disabled={!requestNotificationControl.allow_toggle}
                    onChange={(event) => setSendNotification(event.target.checked)}
                    className="mt-1 h-4 w-4 rounded border-slate-300 text-bank-700 focus:ring-bank-600 disabled:opacity-60"
                  />
                  <span>
                    <span className="block font-bold text-slate-900">إرسال إشعار في المراسلات</span>
                    <span className="mt-1 block text-xs leading-5 text-slate-500">
                      عند التفعيل سيتم إرسال رسالة تصنيفها إشعار للجهة الأولى في مسار الموافقات.
                      {!requestNotificationControl.allow_toggle && " هذا الخيار مقفل من إعدادات المراسلات."}
                    </span>
                  </span>
                </label>
              )}
            </FormSection>

            <div className="flex flex-col gap-3 rounded-md border border-slate-200 bg-slate-50 p-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="text-xs leading-5 text-slate-500">
                <p className="font-bold text-slate-700">ملخص سريع</p>
                <p>{selectedType.label} - {sectionLabelForType(selectedType)} - {priorities.find((type) => type.value === priority)?.label ?? priority}</p>
              </div>
              <div className="flex flex-col gap-3 sm:flex-row">
              <Button type="submit" disabled={isSubmitting} className="gap-2">
                <Send className="h-4 w-4" />
                {isSubmitting ? "جاري الإرسال..." : editingRequestId ? "حفظ وإعادة إرسال" : "إرسال الطلب"}
              </Button>
              <button type="button" onClick={() => { setEditingRequestId(null); resetForm(); }} className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50">
                <Save className="h-4 w-4" />
                تفريغ النموذج
              </button>
              </div>
            </div>
              </form>
            </>
          )}
        </Card>

        <Card className="overflow-hidden">
          <div className="flex flex-col gap-4 border-b border-slate-200 p-5 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h3 className="font-bold text-slate-950">آخر الطلبات</h3>
              <p className="mt-1 text-sm text-slate-500">قائمة مختصرة بالطلبات التي تم تقديمها من خلال النظام.</p>
            </div>
            <label className="relative block w-full lg:max-w-md">
              <Search className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input
                value={requestSearch}
                onChange={(event) => {
                  setRequestSearch(event.target.value);
                  setRequestsPage(1);
                }}
                placeholder="بحث برقم الطلب أو العنوان"
                className="pr-10"
              />
            </label>
          </div>

          <div className="hidden overflow-hidden lg:block">
            <table className="w-full table-fixed text-sm">
              <colgroup>
                <col className="w-[12%]" />
                <col className="w-[18%]" />
                <col className="w-[11%]" />
                <col className="w-[10%]" />
                <col className="w-[10%]" />
                <col className="w-[8%]" />
                <col className="w-[8%]" />
                <col className="w-[9%]" />
                <col className="w-[8%]" />
                <col className="w-[6%]" />
              </colgroup>
              <thead className="bg-slate-50 text-xs font-bold text-slate-600">
                <tr>
                  <th className="px-3 py-3 text-right leading-5">رقم الطلب</th>
                  <th className="px-3 py-3 text-right leading-5">العنوان</th>
                  <th className="px-3 py-3 text-right leading-5">النوع</th>
                  <th className="px-3 py-3 text-right leading-5">القسم المختص</th>
                  <th className="px-3 py-3 text-right leading-5">المعيّن</th>
                  <th className="px-3 py-3 text-right leading-5">الحالة</th>
                  <th className="px-3 py-3 text-right leading-5">الأولوية</th>
                  <th className="px-3 py-3 text-right leading-5">SLA</th>
                  <th className="px-3 py-3 text-right leading-5">تاريخ الإنشاء</th>
                  <th className="px-3 py-3 text-right leading-5">الإجراء</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {items.length === 0 && (
                  <tr>
                    <td colSpan={10} className="p-6 text-center text-slate-500">
                      {requestSearch.trim() ? "لا توجد نتائج مطابقة للبحث." : "لا توجد طلبات لعرضها حالياً."}
                    </td>
                  </tr>
                )}
                {items.map((item) => (
                  <tr key={item.id} className="align-top hover:bg-slate-50">
                    <td className="px-3 py-4">
                      <span className="block break-words text-sm font-black leading-6 text-bank-700">{item.request_number}</span>
                    </td>
                    <td className="px-3 py-4 text-slate-900">
                      <span className="line-clamp-3 break-words leading-6">{item.title || "-"}</span>
                    </td>
                    <td className="px-3 py-4 leading-6 text-slate-700">{requestTypeLabel(item)}</td>
                    <td className="px-3 py-4 leading-6 text-slate-700">{requestSectionLabel(item)}</td>
                    <td className="px-3 py-4 leading-6 text-slate-700">{item.assigned_to?.full_name_ar || "-"}</td>
                    <td className="px-3 py-4 leading-6 text-slate-700">{statusLabels[item.status] ?? item.status}</td>
                    <td className="px-3 py-4 leading-6 text-slate-700">{priorities.find((type) => type.value === item.priority)?.label ?? item.priority}</td>
                    <td className="px-3 py-4">
                      <SLABadge request={item} />
                    </td>
                    <td className="px-3 py-4 text-xs leading-6 text-slate-600">{formatSystemDate(item.created_at)}</td>
                    <td className="px-3 py-4">
                      {item.status === "returned_for_edit" && currentUser?.id === item.requester?.id ? (
                        <div className="flex flex-col gap-2">
                          <button
                            type="button"
                            onClick={() => navigate(`/requests/${item.id}`)}
                            className="inline-flex h-9 items-center justify-center rounded-md border border-bank-100 bg-bank-50 px-2 text-xs font-bold text-bank-700 hover:bg-bank-100"
                            title="تفاصيل الطلب"
                          >
                            <Eye className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => beginEditReturnedRequest(item)}
                            className="inline-flex h-9 items-center justify-center rounded-md border border-amber-200 bg-amber-50 px-2 text-xs font-bold text-amber-700 hover:bg-amber-100"
                            title="تعديل وإعادة إرسال"
                          >
                            <RotateCcw className="h-4 w-4" />
                          </button>
                          {messageSettings.enable_linked_requests && messageSettings.show_messages_tab_in_request_details && (
                            <button
                              type="button"
                              onClick={() => showLinkedMessages(item)}
                              className="inline-flex h-9 items-center justify-center rounded-md border border-slate-200 bg-white px-2 text-xs font-bold text-slate-700 hover:bg-slate-50"
                              title="المراسلات"
                            >
                              <MessageSquare className="h-4 w-4" />
                            </button>
                          )}
                        </div>
                      ) : (
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => navigate(`/requests/${item.id}`)}
                            className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-bank-100 bg-bank-50 text-bank-700 hover:bg-bank-100"
                            title="تفاصيل الطلب"
                          >
                            <Eye className="h-4 w-4" />
                          </button>
                          {messageSettings.enable_linked_requests && messageSettings.show_messages_tab_in_request_details && (
                            <button
                              type="button"
                              onClick={() => showLinkedMessages(item)}
                              className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                              title="المراسلات"
                            >
                              <MessageSquare className="h-4 w-4" />
                            </button>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="divide-y divide-slate-100 lg:hidden">
            {items.length === 0 && (
              <div className="p-6 text-center text-sm text-slate-500">
                {requestSearch.trim() ? "لا توجد نتائج مطابقة للبحث." : "لا توجد طلبات لعرضها حالياً."}
              </div>
            )}
            {items.map((item) => (
              <RequestListCard
                key={item.id}
                item={item}
                currentUserId={currentUser?.id}
                requestTypeLabel={requestTypeLabel(item)}
                requestSectionLabel={requestSectionLabel(item)}
                messageEnabled={messageSettings.enable_linked_requests && messageSettings.show_messages_tab_in_request_details}
                onView={() => navigate(`/requests/${item.id}`)}
                onEdit={() => beginEditReturnedRequest(item)}
                onMessages={() => showLinkedMessages(item)}
              />
            ))}
          </div>
          <Pagination page={requestsPage} totalItems={requestListTotal} pageSize={requestPageSize} onPageChange={setRequestsPage} />
        </Card>

        {linkedRequest && (
          <Card className="xl:col-span-2">
            <div className="flex flex-col gap-3 border-b border-slate-200 p-5 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <p className="text-sm font-semibold text-bank-700">المراسلات المرتبطة</p>
                <h3 className="mt-1 text-lg font-bold text-slate-950">
                  {linkedRequest.request_number} - {linkedRequest.title}
                </h3>
              </div>
              <div className="flex flex-wrap gap-2">
                {messageSettings.allow_send_message_from_request && (
                  <Button type="button" onClick={() => composeRequestMessage(linkedRequest)} className="gap-2">
                    <MessageSquare className="h-4 w-4" />
                    مراسلة بخصوص هذا الطلب
                  </Button>
                )}
                <button
                  type="button"
                  onClick={() => showLinkedMessages(linkedRequest)}
                  disabled={isLinkedMessagesLoading}
                  className="inline-flex h-10 items-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                >
                  <RefreshCw className={`h-4 w-4 ${isLinkedMessagesLoading ? "animate-spin" : ""}`} />
                  تحديث
                </button>
              </div>
            </div>

            <div className="p-5">
              {isLinkedMessagesLoading ? (
                <div className="rounded-md bg-slate-50 p-5 text-sm text-slate-500">جاري تحميل المراسلات المرتبطة...</div>
              ) : linkedMessages.length === 0 ? (
                <div className="rounded-md bg-slate-50 p-5 text-sm text-slate-500">لا توجد مراسلات مرتبطة بهذا الطلب حتى الآن.</div>
              ) : (
                <div className="space-y-3">
                  {linkedMessages.map((message) => (
                    <div key={message.id} className="rounded-md border border-slate-200 bg-white p-4">
                      <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-600">{messageTypeLabel(message.message_type)}</span>
                            <h4 className="font-bold text-slate-950">{message.subject || "بدون موضوع"}</h4>
                          </div>
                          <p className="mt-1 text-xs text-slate-500">
                            من: {message.sender_name || "-"} | إلى: {linkedMessageRecipientsText(message)}
                          </p>
                        </div>
                        <span className="text-xs text-slate-500">{formatSystemDate(message.created_at)}</span>
                      </div>
                      <p className="mt-3 whitespace-pre-line text-sm leading-7 text-slate-700">{message.body}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}

function messageTypeLabel(value: string) {
  const labels: Record<string, string> = {
    internal_correspondence: "مراسلة داخلية",
    internal_message: "مراسلة داخلية",
    official_correspondence: "مراسلة رسمية",
    official_message: "مراسلة رسمية",
    clarification_request: "طلب استيضاح",
    reply_to_clarification: "رد على استيضاح",
    approval_note: "ملاحظة موافقة",
    rejection_reason: "سبب رفض",
    implementation_note: "ملاحظة تنفيذ",
    notification: "إشعار",
    circular: "تعميم"
  };
  return labels[value] || value || "مراسلة داخلية";
}

function normalizeLinkedMessages(value: unknown): LinkedMessage[] {
  if (!Array.isArray(value)) return [];
  return value.map(normalizeLinkedMessage).filter((message) => message.id > 0);
}

function normalizeLinkedMessage(value: unknown): LinkedMessage {
  const item = toPlainRecord(value);
  const sender = toPlainRecord(item.sender);
  const recipientNames =
    normalizeRecipientNames(item.recipient_names).length > 0
      ? normalizeRecipientNames(item.recipient_names)
      : normalizeRecipientNames(item.recipientNames).length > 0
        ? normalizeRecipientNames(item.recipientNames)
        : normalizeRecipientNames(item.recipients);

  return {
    id: toNumber(item.id),
    message_type: firstText(item.message_type, item.messageType, item.message_type_code, item.messageTypeCode, item.messageTypeNameAr, item.message_type_name_ar),
    subject: firstText(item.subject),
    body: firstText(item.body, item.preview),
    sender_name: firstText(item.sender_name, item.senderName, item.senderNameAr, item.sender_name_ar, sender.name_ar, sender.nameAr, sender.full_name_ar, sender.fullNameAr, sender.username),
    recipient_names: recipientNames,
    recipients_count: toNumber(item.recipients_count, item.recipientsCount),
    is_read: Boolean(item.is_read ?? item.isRead),
    created_at: firstText(item.created_at, item.createdAt, item.sent_at, item.sentAt)
  };
}

function linkedMessageRecipientsText(message: LinkedMessage) {
  if (Array.isArray(message.recipient_names) && message.recipient_names.length > 0) {
    return message.recipient_names.join("، ");
  }
  if (message.recipients_count && message.recipients_count > 0) {
    return `${message.recipients_count} مستلم`;
  }
  return "-";
}

function normalizeRecipientNames(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((entry) => {
        if (typeof entry === "string") return entry.trim();
        const recipient = toPlainRecord(entry);
        return firstText(recipient.name_ar, recipient.nameAr, recipient.full_name_ar, recipient.fullNameAr, recipient.email, recipient.username);
      })
      .filter(Boolean);
  }
  if (typeof value === "string") {
    return value
      .split(/[،,]/)
      .map((entry) => entry.trim())
      .filter(Boolean);
  }
  return [];
}

function toPlainRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function firstText(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return "";
}

function toNumber(...values: unknown[]) {
  for (const value of values) {
    const numberValue = Number(value);
    if (Number.isFinite(numberValue) && numberValue > 0) return numberValue;
  }
  return 0;
}

function RequestSummaryChip({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
      <p className="text-[11px] font-bold text-slate-500">{label}</p>
      <p className="mt-1 truncate font-black text-slate-900">{value}</p>
    </div>
  );
}

function FormSection({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-4">
        <h4 className="font-black text-slate-950">{title}</h4>
        <p className="mt-1 text-xs leading-5 text-slate-500">{description}</p>
      </div>
      {children}
    </section>
  );
}

function RequestListCard({
  item,
  currentUserId,
  requestTypeLabel,
  requestSectionLabel,
  messageEnabled,
  onView,
  onEdit,
  onMessages
}: {
  item: ServiceRequest;
  currentUserId?: number;
  requestTypeLabel: string;
  requestSectionLabel: string;
  messageEnabled: boolean;
  onView: () => void;
  onEdit: () => void;
  onMessages: () => void;
}) {
  const canEditReturned = item.status === "returned_for_edit" && currentUserId === item.requester?.id;
  return (
    <article className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-black text-bank-700">{item.request_number}</p>
          <h4 className="mt-1 line-clamp-2 font-bold leading-6 text-slate-950">{item.title || "-"}</h4>
        </div>
        <span className={`shrink-0 rounded-full px-2 py-1 text-xs font-bold ${statusTone(item.status)}`}>{statusLabels[item.status] ?? item.status}</span>
      </div>
      <div className="mt-3 grid gap-2 text-xs text-slate-600 sm:grid-cols-2">
        <span className="rounded-md bg-slate-50 p-2"><b>النوع:</b> {requestTypeLabel}</span>
        <span className="rounded-md bg-slate-50 p-2"><b>القسم:</b> {requestSectionLabel}</span>
        <span className="rounded-md bg-slate-50 p-2"><b>الأولوية:</b> {priorities.find((type) => type.value === item.priority)?.label ?? item.priority}</span>
        <span className="rounded-md bg-slate-50 p-2"><b>التاريخ:</b> {formatSystemDate(item.created_at)}</span>
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <SLABadge request={item} />
        <div className="flex gap-2">
          <button type="button" onClick={onView} className="inline-flex h-9 items-center gap-2 rounded-md border border-bank-100 bg-bank-50 px-3 text-xs font-bold text-bank-700">
            <Eye className="h-4 w-4" />
            عرض
          </button>
          {canEditReturned && (
            <button type="button" onClick={onEdit} className="inline-flex h-9 items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 text-xs font-bold text-amber-700">
              <RotateCcw className="h-4 w-4" />
              تعديل
            </button>
          )}
          {messageEnabled && (
            <button type="button" onClick={onMessages} className="inline-flex h-9 items-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-xs font-bold text-slate-700">
              <MessageSquare className="h-4 w-4" />
              مراسلات
            </button>
          )}
        </div>
      </div>
    </article>
  );
}

function normalizePriority(value?: string | null): Priority {
  if (value === "low" || value === "medium" || value === "high" || value === "critical") return value;
  if (value === "normal") return "medium";
  if (value === "urgent") return "critical";
  return "medium";
}

function formatHours(value?: number | null) {
  if (!value || value <= 0) return "غير محدد";
  if (value < 24) return `${value} ساعة`;
  const days = value / 24;
  return Number.isInteger(days) ? `${days} يوم` : `${value} ساعة`;
}

function selectedTypeSlaText(type: TypeConfig) {
  const response = type.slaResponseHours ? `استجابة ${formatHours(type.slaResponseHours)}` : "";
  const resolution = type.slaResolutionHours ? `إنجاز ${formatHours(type.slaResolutionHours)}` : "";
  return [response, resolution].filter(Boolean).join(" / ") || "بدون SLA";
}

function statusTone(status: string) {
  if (["rejected", "cancelled"].includes(status)) return "bg-red-50 text-red-700";
  if (["completed", "closed", "approved"].includes(status)) return "bg-emerald-50 text-emerald-700";
  if (["pending_approval", "in_implementation", "returned_for_edit"].includes(status)) return "bg-amber-50 text-amber-700";
  return "bg-slate-100 text-slate-700";
}

const defaultAttachmentExtensions = ["pdf", "png", "jpg", "jpeg"];
const imageAttachmentExtensions = ["png", "jpg", "jpeg", "webp", "heic", "heif"];
const imageAttachmentExtensionSet = new Set(imageAttachmentExtensions);
const imageExtensionAliases = new Set(["image", "images", "photo", "photos", "picture", "pictures", "صورة", "صور"]);

function fileAcceptAttribute(type: TypeConfig) {
  return normalizeAllowedExtensions(type.allowedExtensions).map((extension) => `.${extension}`).join(",");
}

function typeAllowsAttachments(type: TypeConfig | null | undefined) {
  return Boolean(type?.requiresAttachment || type?.allowMultipleAttachments);
}

function validateAttachmentForType(file: File, type: TypeConfig) {
  const allowedExtensions = new Set(normalizeAllowedExtensions(type.allowedExtensions));
  const extension = file.name.split(".").pop()?.toLowerCase() || "";
  if (!extension || !allowedExtensions.has(extension)) {
    return `امتداد الملف غير مسموح. الامتدادات المسموحة: ${Array.from(allowedExtensions).join(", ")}`;
  }
  const maxBytes = (type.maxFileSizeMb ?? 10) * 1024 * 1024;
  if (file.size > maxBytes) {
    return `حجم الملف يتجاوز الحد المسموح (${type.maxFileSizeMb ?? 10} MB).`;
  }
  return "";
}

function normalizeAllowedExtensions(value?: string[] | string | null) {
  const rawItems = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value
          .replace(/^\s*\[/, "")
          .replace(/\]\s*$/, "")
          .split(",")
      : defaultAttachmentExtensions;
  const normalized = rawItems.flatMap((item) => {
    const extension = String(item).trim().replace(/^["']|["']$/g, "").replace(/^\./, "").toLowerCase();
    if (!extension) return [];
    if (imageExtensionAliases.has(extension) || imageAttachmentExtensionSet.has(extension)) return imageAttachmentExtensions;
    return [extension];
  });
  return [...new Set(normalized)].filter(Boolean).sort();
}

function formatAllowedExtensions(type: TypeConfig) {
  return normalizeAllowedExtensions(type.allowedExtensions).join(", ");
}

function validateAttachmentsForType(files: File[], type: TypeConfig) {
  if (!files.length) return "";
  if (!typeAllowsAttachments(type)) {
    return "المرفقات غير مفعلة لهذا النوع من الطلبات.";
  }
  if (!type.allowMultipleAttachments && files.length > 1) {
    return "هذا النوع من الطلبات لا يسمح بأكثر من مرفق واحد.";
  }
  const maxAttachments = type.maxAttachments ?? (type.allowMultipleAttachments ? 5 : 1);
  if (files.length > maxAttachments) {
    return `عدد المرفقات أكبر من الحد المسموح لهذا النوع (${maxAttachments}).`;
  }
  for (const file of files) {
    const fileError = validateAttachmentForType(file, type);
    if (fileError) return fileError;
  }
  return "";
}

function mergeAttachmentFiles(current: File[], selected: File[]) {
  const map = new Map<string, File>();
  for (const file of [...current, ...selected]) {
    map.set(`${file.name}-${file.size}-${file.lastModified}`, file);
  }
  return Array.from(map.values());
}

function fieldValueAsString(value: FieldValue | undefined) {
  if (Array.isArray(value)) return value.join("، ");
  return value ?? "";
}

function inputTypeForField(kind?: FieldKind) {
  if (kind === "date") return "date";
  if (kind === "datetime") return "datetime-local";
  if (kind === "number") return "number";
  if (kind === "email") return "email";
  if (kind === "phone") return "tel";
  return "text";
}

function formatFileSize(value: number) {
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function SLABadge({ request }: { request: ServiceRequest }) {
  if (!request.sla_due_at) {
    return <span className="inline-flex rounded-full bg-slate-100 px-2 py-1 text-xs font-bold text-slate-500">بدون SLA</span>;
  }
  const dueDate = parseApiDate(request.sla_due_at);
  if (!dueDate) {
    return <span className="inline-flex rounded-full bg-slate-100 px-2 py-1 text-xs font-bold text-slate-500">غير محدد</span>;
  }
  const finalStatuses = new Set(["completed", "closed", "rejected", "cancelled"]);
  if (finalStatuses.has(request.status)) {
    return (
      <span title={formatSystemDateTime(request.sla_due_at)} className="inline-flex rounded-full bg-slate-100 px-2 py-1 text-xs font-bold text-slate-600">
        منتهي
      </span>
    );
  }
  const diffMs = dueDate.getTime() - Date.now();
  if (diffMs < 0) {
    return (
      <span title={formatSystemDateTime(request.sla_due_at)} className="inline-flex rounded-full bg-red-50 px-2 py-1 text-xs font-bold text-red-700">
        متأخر
      </span>
    );
  }
  const remainingHours = Math.max(1, Math.ceil(diffMs / (1000 * 60 * 60)));
  return (
    <span title={formatSystemDateTime(request.sla_due_at)} className="inline-flex rounded-full bg-bank-50 px-2 py-1 text-xs font-bold text-bank-700">
      متبقّي {formatHours(remainingHours)}
    </span>
  );
}

async function loadManagedFields(requestTypeId: number, fallback: FieldConfig[]) {
  try {
    const schema = await apiFetch<{ fields: Array<{ field_name: string; label_ar: string; field_type: string; placeholder?: string; options?: string[]; is_required?: boolean }> }>(
      `/request-types/${requestTypeId}/form-schema`
    );
    return schema.fields.map((field) => ({
      name: field.field_name,
      label: field.label_ar || field.field_name,
      kind: fieldTypeMap[field.field_type] ?? "text",
      placeholder: field.placeholder || "",
      options: field.field_type === "checkbox" ? ["نعم", "لا"] : field.options || [],
      required: Boolean(field.is_required),
      colSpan: field.field_type === "textarea"
    }));
  } catch {
    return fallback;
  }
}

async function uploadAttachment(requestId: number, file: File) {
  const token = localStorage.getItem("qib_token");
  const body = new FormData();
  body.append("file", file);
  const response = await fetch(`${API_BASE}/requests/${requestId}/attachments`, {
    method: "POST",
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body
  });
  if (!response.ok) {
    throw new Error(await extractResponseError(response));
  }
}

async function uploadAttachments(requestId: number, files: File[]) {
  if (files.length === 0) return;
  if (files.length === 1) {
    await uploadAttachment(requestId, files[0]);
    return;
  }

  const token = localStorage.getItem("qib_token");
  const body = new FormData();
  for (const file of files) {
    body.append("files", file);
  }
  const response = await fetch(`${API_BASE}/requests/${requestId}/attachments/batch`, {
    method: "POST",
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body
  });

  if (response.status === 404 || response.status === 405) {
    for (const file of files) {
      await uploadAttachment(requestId, file);
    }
    return;
  }

  if (!response.ok) {
    throw new Error(await extractResponseError(response));
  }
}

async function extractResponseError(response: Response) {
  const text = await response.text();
  if (!text) return "تعذر رفع المرفق.";
  try {
    const data = JSON.parse(text) as { detail?: string; Detail?: string; title?: string; Title?: string };
    return data.detail || data.Detail || data.title || data.Title || text;
  } catch {
    return text;
  }
}

function readableSubmitError(error: unknown) {
  if (!(error instanceof Error)) return "";
  const message = error.message.trim();
  if (!message) return "";
  try {
    const data = JSON.parse(message) as { detail?: string; Detail?: string; title?: string; Title?: string };
    return data.detail || data.Detail || data.title || data.Title || message;
  } catch {
    return message;
  }
}

function categoryToSection(category?: string): AdministrativeSection {
  if (category === "network" || category === "access") return "networks";
  if (category === "development" || category === "software") return "development";
  if (category === "accounts") return "servers";
  return "support";
}
