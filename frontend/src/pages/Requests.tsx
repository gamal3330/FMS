import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from "react";
import { Eye, FilePlus2, Laptop, Mail, MessageSquare, Network, RefreshCw, Router, RotateCcw, Save, Search, Send, Shield, Ticket, Upload } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { API_BASE, apiFetch, CurrentUser, ServiceRequest } from "../lib/api";
import { formatSystemDate } from "../lib/datetime";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import FeedbackDialog from "../components/ui/FeedbackDialog";
import { Input } from "../components/ui/input";
import { Pagination } from "../components/ui/Pagination";

type RequestType = string;
type Priority = "low" | "medium" | "high" | "critical";
type FieldKind = "text" | "textarea" | "select" | "date";
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
  requiresAttachment?: boolean;
  icon: typeof Mail;
  fields: FieldConfig[];
}

interface LinkedMessage {
  id: number;
  message_type: string;
  subject: string;
  body: string;
  sender_name: string;
  recipient_names: string[];
  is_read: boolean;
  created_at: string;
}

const administrativeSections: Record<AdministrativeSection, string> = {
  servers: "قسم السيرفرات",
  networks: "قسم الشبكات",
  support: "قسم الدعم الفني",
  development: "وحدة تطوير البرامج"
};

const backendTypeMap: Record<string, RequestType> = {
  EMAIL: "email",
  email: "email",
  DOMAIN: "domain",
  domain: "domain",
  VPN: "vpn_remote_access",
  vpn_remote_access: "vpn_remote_access",
  INTERNET: "internet_access",
  internet_access: "internet_access",
  DATA_COPY: "data_copy",
  data_copy: "data_copy",
  NETWORK: "network_access",
  network_access: "network_access",
  COMPUTER_MOVE: "computer_move_installation",
  computer_move_installation: "computer_move_installation",
  SUPPORT: "it_support_ticket",
  it_support_ticket: "it_support_ticket"
};

const fieldTypeMap: Record<string, FieldKind> = {
  text: "text",
  number: "text",
  ip_address: "text",
  mac_address: "text",
  file: "text",
  textarea: "textarea",
  select: "select",
  multi_select: "select",
  checkbox: "select",
  date: "date",
  datetime: "date"
};

const requestTypes: TypeConfig[] = [
  {
    value: "email",
    label: "طلبات البريد الإلكتروني",
    description: "إنشاء بريد، إعادة تعيين كلمة المرور، أو نقل الملكية.",
    section: "servers",
    icon: Mail,
    fields: [
      { name: "email_action", label: "نوع الإجراء", kind: "select", options: ["إنشاء بريد", "إعادة تعيين كلمة المرور", "نقل الملكية"], required: true },
      { name: "target_user", label: "المستخدم المستفيد", placeholder: "اسم الموظف أو الرقم الوظيفي", required: true },
      { name: "mailbox_address", label: "عنوان البريد المطلوب", placeholder: "user@qib.com.qa" },
      { name: "current_owner", label: "المالك الحالي", placeholder: "في حالة نقل الملكية" },
      { name: "new_owner", label: "المالك الجديد", placeholder: "في حالة نقل الملكية" }
    ]
  },
  {
    value: "domain",
    label: "طلبات الدومين",
    description: "إنشاء مستخدم دومين، إعادة كلمة المرور، أو نقل الملكية.",
    section: "servers",
    icon: Shield,
    fields: [
      { name: "domain_action", label: "نوع الإجراء", kind: "select", options: ["إنشاء مستخدم دومين", "إعادة تعيين كلمة المرور", "نقل الملكية"], required: true },
      { name: "target_user", label: "المستخدم المستفيد", placeholder: "اسم الموظف أو الرقم الوظيفي", required: true },
      { name: "domain_username", label: "اسم مستخدم الدومين", placeholder: "qib\\username" },
      { name: "device_name", label: "اسم الجهاز", placeholder: "اختياري" }
    ]
  },
  {
    value: "vpn_remote_access",
    label: "طلب VPN",
    description: "صلاحية وصول آمن للأنظمة الداخلية من خارج الشبكة.",
    section: "networks",
    icon: Router,
    fields: [
      { name: "target_user", label: "المستخدم المستفيد", placeholder: "اسم الموظف أو الرقم الوظيفي", required: true },
      { name: "access_duration", label: "مدة الوصول", kind: "select", options: ["أسبوع", "شهر", "3 أشهر", "6 أشهر", "دائم"], required: true },
      { name: "business_systems", label: "الأنظمة المطلوبة", placeholder: "Core Banking, HR, Email", colSpan: true },
      { name: "remote_country", label: "الدولة المتوقعة للوصول", placeholder: "قطر" }
    ]
  },
  {
    value: "internet_access",
    label: "الوصول للإنترنت",
    description: "طلب صلاحية إنترنت أو تغيير مستوى التصفح.",
    section: "networks",
    icon: Network,
    fields: [
      { name: "target_user", label: "المستخدم المستفيد", placeholder: "اسم الموظف أو الرقم الوظيفي", required: true },
      { name: "access_level", label: "مستوى الوصول", kind: "select", options: ["أساسي", "موسع", "مواقع أعمال محددة"], required: true },
      { name: "websites", label: "المواقع المطلوبة", kind: "textarea", placeholder: "اكتب المواقع أو التصنيفات المطلوبة", colSpan: true }
    ]
  },
  {
    value: "data_copy",
    label: "نسخ البيانات",
    description: "نسخ بيانات إلى فلاش، بريد، أو قرص خارجي مع اعتماد أمني.",
    section: "support",
    icon: Upload,
    fields: [
      { name: "copy_method", label: "طريقة النسخ", kind: "select", options: ["Flash", "Email", "External Hard Drive"], required: true },
      { name: "data_classification", label: "تصنيف البيانات", kind: "select", options: ["عام", "داخلي", "سري", "سري للغاية"], required: true },
      { name: "source_location", label: "مصدر البيانات", placeholder: "مسار المجلد أو النظام", required: true },
      { name: "destination", label: "الوجهة", placeholder: "البريد أو الجهاز أو القرص", required: true },
      { name: "data_description", label: "وصف البيانات", kind: "textarea", colSpan: true, required: true }
    ]
  },
  {
    value: "network_access",
    label: "صلاحيات الشبكة",
    description: "فتح اتصال بين مصدر ووجهة مع تحديد المنفذ و NAT.",
    section: "networks",
    icon: Network,
    fields: [
      { name: "source_ip", label: "Source IP", placeholder: "10.10.10.10", required: true },
      { name: "destination_ip", label: "Destination IP", placeholder: "10.20.20.20", required: true },
      { name: "port", label: "Port", placeholder: "443", required: true },
      { name: "nat_port", label: "NAT Port", placeholder: "اختياري" },
      { name: "protocol", label: "Protocol", kind: "select", options: ["TCP", "UDP", "Both"], required: true }
    ]
  },
  {
    value: "computer_move_installation",
    label: "نقل أو تركيب جهاز",
    description: "طلب نقل جهاز، تركيب جهاز جديد، أو تجهيز مكتب.",
    section: "support",
    icon: Laptop,
    fields: [
      { name: "service_action", label: "نوع الخدمة", kind: "select", options: ["نقل جهاز", "تركيب جهاز", "تجهيز مكتب"], required: true },
      { name: "asset_tag", label: "رقم الأصل", placeholder: "Asset Tag" },
      { name: "current_location", label: "الموقع الحالي", placeholder: "الطابق / الفرع / المكتب" },
      { name: "new_location", label: "الموقع الجديد", placeholder: "الطابق / الفرع / المكتب", required: true },
      { name: "preferred_date", label: "التاريخ المفضل", kind: "date" }
    ]
  },
  {
    value: "it_support_ticket",
    label: "تذكرة دعم فني",
    description: "بلاغ عطل أو طلب دعم عام من فريق تقنية المعلومات.",
    section: "support",
    icon: Ticket,
    fields: [
      { name: "category", label: "التصنيف", kind: "select", options: ["جهاز", "طابعة", "نظام", "شبكة", "صلاحيات", "أخرى"], required: true },
      { name: "affected_user", label: "المستخدم المتأثر", placeholder: "اسم الموظف أو الرقم الوظيفي", required: true },
      { name: "asset_tag", label: "رقم الأصل", placeholder: "اختياري" },
      { name: "issue_description", label: "وصف المشكلة", kind: "textarea", colSpan: true, required: true }
    ]
  }
];

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
  const [formData, setFormData] = useState<Record<string, string>>({});
  const [attachment, setAttachment] = useState<File | null>(null);
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
  const [requestSearch, setRequestSearch] = useState("");
  const [requestsPage, setRequestsPage] = useState(1);
  const [requestsHasMore, setRequestsHasMore] = useState(false);

  const availableRequestTypes = useMemo(() => managedRequestTypes, [managedRequestTypes]);
  const selectedType = useMemo(
    () => availableRequestTypes.find((item) => item.value === requestType) ?? availableRequestTypes[0] ?? null,
    [availableRequestTypes, requestType]
  );
  const requestListTotal = requestsHasMore ? requestsPage * requestPageSize + 1 : (requestsPage - 1) * requestPageSize + items.length;

  function updateField(name: string, value: string) {
    setFormData((current) => ({ ...current, [name]: value }));
  }

  function resetForm(nextType = requestType, sourceTypes = availableRequestTypes) {
    const nextConfig = sourceTypes.find((item) => item.value === nextType) ?? sourceTypes[0];
    setTitle("");
    setPriority("medium");
    setBusinessJustification("");
    setSendNotification(true);
    setAttachment(null);
    if (!nextConfig) {
      setFormData({});
      return;
    }
    setFormData(
      nextConfig.fields.reduce<Record<string, string>>((acc, field) => {
        acc[field.name] = field.kind === "select" ? field.options?.[0] ?? "" : "";
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
        Array<{ id: number; code?: string; request_type?: string; name_ar?: string; description?: string; category?: string; assigned_section?: string; requires_attachment?: boolean }>
      >("/request-types/active");
      const sections = await apiFetch<Array<{ code: string; name_ar: string }>>("/settings/specialized-sections?active_only=true").catch(() => []);
      const labels = { ...administrativeSections, ...Object.fromEntries(sections.map((section) => [section.code, section.name_ar])) };
      setSectionLabels(labels);

      const nextTypes = await Promise.all(
        data.map(async (item) => {
          const mappedValue = backendTypeMap[item.code || ""] ?? backendTypeMap[item.request_type || ""];
          const base = mappedValue ? requestTypes.find((type) => type.value === mappedValue) : null;
          const fields = await loadManagedFields(item.id, base?.fields ?? []);
          return {
            ...(base ?? {
              value: `managed_${item.id}`,
              label: item.name_ar || item.code || "نوع طلب",
              description: item.description || "نوع طلب معرف من شاشة إدارة أنواع الطلبات.",
              section: item.assigned_section || categoryToSection(item.category),
              icon: FilePlus2,
              fields: []
            }),
            requestTypeId: item.id,
            code: item.code,
            label: item.name_ar || base?.label || item.code || "نوع طلب",
            description: item.description || base?.description || "نوع طلب معرف من شاشة إدارة أنواع الطلبات.",
            section: item.assigned_section || base?.section || categoryToSection(item.category),
            requiresAttachment: Boolean(item.requires_attachment),
            fields: fields.length ? fields : base?.fields ?? []
          } as TypeConfig;
        })
      );

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
      const payload = buildRequestPayload();
      if (editingRequestId) {
        await apiFetch<ServiceRequest>(`/requests/${editingRequestId}`, {
          method: "PATCH",
          body: JSON.stringify(payload)
        });
        if (attachment) {
          await uploadAttachment(editingRequestId, attachment);
        }
        await apiFetch<ServiceRequest>(`/requests/${editingRequestId}/resubmit`, { method: "POST" });
        setMessage("تم تحديث الطلب وإعادة إرساله إلى مسار الموافقات.");
        setEditingRequestId(null);
      } else {
        const created = await apiFetch<{ id: number }>(selectedType.requestTypeId ? "/requests/dynamic" : "/requests", {
          method: "POST",
          body: JSON.stringify(payload)
        });
        if (attachment && created?.id) {
          await uploadAttachment(created.id, attachment);
        }
        setMessage("تم إرسال الطلب بنجاح وإضافته إلى مسار الموافقات.");
      }
      resetForm();
      setRequestsPage(1);
      await loadRequests(1);
    } catch {
      setError("تعذر إرسال الطلب. تحقق من الاتصال بالخادم وصلاحية الجلسة.");
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
    setSendNotification(true);
    setAttachment(null);
    setFormData({ ...(item.form_data || {}) });
    setMessage("");
    setError("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function buildRequestPayload() {
    if (!selectedType) {
      throw new Error("Request type is not loaded");
    }
    const enrichedFormData = {
      ...formData,
      administrative_section: selectedType.section,
      administrative_section_label: sectionLabels[selectedType.section] || selectedType.section,
      assigned_section: selectedType.section,
      assigned_section_label: sectionLabels[selectedType.section] || selectedType.section,
      request_type_code: selectedType.code || selectedType.value,
      request_type_label: selectedType.label
    };

    if (selectedType.requestTypeId) {
      return {
        request_type_id: selectedType.requestTypeId,
        title,
        priority,
        business_justification: businessJustification,
        send_notification: sendNotification,
        form_data: enrichedFormData
      };
    }

    return {
      title,
      request_type: requestType,
      priority,
      business_justification: businessJustification,
      send_notification: sendNotification,
      form_data: enrichedFormData
    };
  }

  function requestTypeLabel(item: ServiceRequest) {
    return availableRequestTypes.find((type) => type.value === item.request_type || type.code === item.form_data?.request_type_code)?.label ?? item.form_data?.request_type_label ?? item.request_type;
  }

  function requestSectionLabel(item: ServiceRequest) {
    const key =
      item.form_data?.assigned_section ||
      item.form_data?.administrative_section ||
      availableRequestTypes.find((type) => type.value === item.request_type || type.code === item.form_data?.request_type_code)?.section ||
      "";
    return item.form_data?.assigned_section_label || item.form_data?.administrative_section_label || sectionLabels[key] || item.department?.name_ar || key || "-";
  }

  async function showLinkedMessages(item: ServiceRequest) {
    setLinkedRequest(item);
    setLinkedMessages([]);
    setIsLinkedMessagesLoading(true);
    setError("");
    try {
      const data = await apiFetch<LinkedMessage[]>(`/messages/request/${item.id}`);
      setLinkedMessages(data);
    } catch {
      setError("تعذر تحميل المراسلات المرتبطة بالطلب.");
    } finally {
      setIsLinkedMessagesLoading(false);
    }
  }

  function composeRequestMessage(item: ServiceRequest) {
    const params = new URLSearchParams({
      compose: "1",
      related_request_id: item.request_number,
      subject: `بخصوص الطلب ${item.request_number}`,
      message_type: "internal_correspondence"
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
              <div className="mb-5 flex items-center gap-3">
                <div className="rounded-md bg-bank-50 p-3 text-bank-700">
                  <FilePlus2 className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="font-bold text-slate-950">بيانات الطلب</h3>
                  <p className="text-sm text-slate-500">{selectedType.description}</p>
                  {editingRequestId && <p className="mt-1 text-xs font-bold text-amber-700">وضع تعديل طلب معاد: سيتم إعادة إرساله للموافقات بعد الحفظ.</p>}
                </div>
              </div>

              <form onSubmit={create} className="space-y-4">
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
              <select value={selectedType.section} disabled className="h-10 w-full rounded-md border border-slate-300 bg-slate-100 px-3 text-sm text-slate-600 outline-none">
                {Object.entries(sectionLabels).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
              <span className="block text-xs font-normal text-slate-500">يتم تحديد القسم من إدارة أنواع الطلبات.</span>
            </label>

            <label className="block space-y-2 text-sm font-medium text-slate-700">
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

            <div className="grid gap-4 md:grid-cols-2">
              {selectedType.fields.map((field) => (
                <label key={field.name} className={`block space-y-2 text-sm font-medium text-slate-700 ${field.colSpan ? "md:col-span-2" : ""}`}>
                  {field.label}
                  {field.kind === "textarea" ? (
                    <textarea value={formData[field.name] ?? ""} onChange={(event) => updateField(field.name, event.target.value)} required={field.required} placeholder={field.placeholder} rows={4} className="w-full resize-y rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-bank-600 focus:ring-2 focus:ring-bank-100" />
                  ) : field.kind === "select" ? (
                    <select value={formData[field.name] ?? field.options?.[0] ?? ""} onChange={(event) => updateField(field.name, event.target.value)} required={field.required} className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm outline-none focus:border-bank-600 focus:ring-2 focus:ring-bank-100">
                      {(field.options ?? []).map((option) => (
                        <option key={option} value={option}>{option}</option>
                      ))}
                    </select>
                  ) : (
                    <Input value={formData[field.name] ?? ""} onChange={(event) => updateField(field.name, event.target.value)} required={field.required} placeholder={field.placeholder} type={field.kind === "date" ? "date" : "text"} />
                  )}
                </label>
              ))}
            </div>

            {selectedType.requiresAttachment && (
              <label className="block space-y-2 text-sm font-medium text-slate-700">
                المرفق المطلوب
                <input
                  type="file"
                  accept="application/pdf,image/png,image/jpeg,image/webp"
                  required
                  onChange={(event) => {
                    const file = event.target.files?.[0] || null;
                    if (file && !["application/pdf", "image/png", "image/jpeg", "image/webp"].includes(file.type)) {
                      setError("صيغة المرفق غير مدعومة. يسمح فقط بملفات PDF أو الصور.");
                      event.target.value = "";
                      setAttachment(null);
                      return;
                    }
                    setError("");
                    setAttachment(file);
                  }}
                  className="block w-full rounded-md border border-dashed border-slate-300 bg-white px-3 py-2 text-sm file:ml-3 file:rounded-md file:border-0 file:bg-bank-50 file:px-3 file:py-1.5 file:text-sm file:font-bold file:text-bank-700"
                />
                <span className="block text-xs font-normal text-slate-500">يسمح فقط بملف PDF أو صورة PNG/JPG/WEBP.</span>
              </label>
            )}

            <label className="block space-y-2 text-sm font-medium text-slate-700">
              مبرر العمل
              <textarea value={businessJustification} onChange={(event) => setBusinessJustification(event.target.value)} required rows={4} placeholder="اشرح سبب الطلب والأثر التشغيلي المتوقع" className="w-full resize-y rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-bank-600 focus:ring-2 focus:ring-bank-100" />
            </label>

            <label className="flex items-start gap-3 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={sendNotification}
                onChange={(event) => setSendNotification(event.target.checked)}
                className="mt-1 h-4 w-4 rounded border-slate-300 text-bank-700 focus:ring-bank-600"
              />
              <span>
                <span className="block font-bold text-slate-900">إرسال إشعار في المراسلات</span>
                <span className="mt-1 block text-xs leading-5 text-slate-500">عند التفعيل سيتم إرسال رسالة تصنيفها إشعار للجهة الأولى في مسار الموافقات.</span>
              </span>
            </label>

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

          <div className="overflow-hidden">
            <table className="w-full table-fixed text-sm">
              <colgroup>
                <col className="w-[14%]" />
                <col className="w-[22%]" />
                <col className="w-[14%]" />
                <col className="w-[14%]" />
                <col className="w-[10%]" />
                <col className="w-[9%]" />
                <col className="w-[9%]" />
                <col className="w-[8%]" />
              </colgroup>
              <thead className="bg-slate-50 text-xs font-bold text-slate-600">
                <tr>
                  <th className="px-3 py-3 text-right leading-5">رقم الطلب</th>
                  <th className="px-3 py-3 text-right leading-5">العنوان</th>
                  <th className="px-3 py-3 text-right leading-5">النوع</th>
                  <th className="px-3 py-3 text-right leading-5">القسم المختص</th>
                  <th className="px-3 py-3 text-right leading-5">الحالة</th>
                  <th className="px-3 py-3 text-right leading-5">الأولوية</th>
                  <th className="px-3 py-3 text-right leading-5">تاريخ الإنشاء</th>
                  <th className="px-3 py-3 text-right leading-5">الإجراء</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {items.length === 0 && (
                  <tr>
                    <td colSpan={8} className="p-6 text-center text-slate-500">
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
                    <td className="px-3 py-4 leading-6 text-slate-700">{statusLabels[item.status] ?? item.status}</td>
                    <td className="px-3 py-4 leading-6 text-slate-700">{priorities.find((type) => type.value === item.priority)?.label ?? item.priority}</td>
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
                          <button
                            type="button"
                            onClick={() => showLinkedMessages(item)}
                            className="inline-flex h-9 items-center justify-center rounded-md border border-slate-200 bg-white px-2 text-xs font-bold text-slate-700 hover:bg-slate-50"
                            title="المراسلات"
                          >
                            <MessageSquare className="h-4 w-4" />
                          </button>
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
                          <button
                            type="button"
                            onClick={() => showLinkedMessages(item)}
                            className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                            title="المراسلات"
                          >
                            <MessageSquare className="h-4 w-4" />
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
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
                <Button type="button" onClick={() => composeRequestMessage(linkedRequest)} className="gap-2">
                  <MessageSquare className="h-4 w-4" />
                  مراسلة بخصوص هذا الطلب
                </Button>
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
                            من: {message.sender_name} | إلى: {message.recipient_names.join("، ") || "-"}
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
    official_correspondence: "مراسلة رسمية",
    clarification_request: "طلب استيضاح",
    reply_to_clarification: "رد على استيضاح",
    approval_note: "ملاحظة موافقة",
    rejection_reason: "سبب رفض",
    implementation_note: "ملاحظة تنفيذ",
    notification: "إشعار",
    circular: "تعميم"
  };
  return labels[value] || "مراسلة داخلية";
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
    throw new Error(await response.text());
  }
}

function categoryToSection(category?: string): AdministrativeSection {
  if (category === "network" || category === "access") return "networks";
  if (category === "development" || category === "software") return "development";
  if (category === "accounts") return "servers";
  return "support";
}
