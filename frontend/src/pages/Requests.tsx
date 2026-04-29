import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from "react";
import { FilePlus2, Laptop, Mail, Network, RefreshCw, Router, Save, Send, Shield, Ticket, Upload } from "lucide-react";
import { API_BASE, apiFetch, ServiceRequest } from "../lib/api";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import FeedbackDialog from "../components/ui/FeedbackDialog";
import { Input } from "../components/ui/input";

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
  approved: "معتمد",
  rejected: "مرفوض",
  in_implementation: "قيد التنفيذ",
  completed: "مكتمل",
  closed: "مغلق",
  cancelled: "ملغي"
};

export function Requests() {
  const [items, setItems] = useState<ServiceRequest[]>([]);
  const [managedRequestTypes, setManagedRequestTypes] = useState<TypeConfig[]>(requestTypes);
  const [sectionLabels, setSectionLabels] = useState<Record<string, string>>(administrativeSections);
  const [requestType, setRequestType] = useState<RequestType>("vpn_remote_access");
  const [title, setTitle] = useState("");
  const [priority, setPriority] = useState<Priority>("medium");
  const [businessJustification, setBusinessJustification] = useState("");
  const [formData, setFormData] = useState<Record<string, string>>({});
  const [attachment, setAttachment] = useState<File | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const availableRequestTypes = useMemo(() => managedRequestTypes, [managedRequestTypes]);
  const selectedType = useMemo(
    () => availableRequestTypes.find((item) => item.value === requestType) ?? availableRequestTypes[0] ?? requestTypes[0],
    [availableRequestTypes, requestType]
  );

  function updateField(name: string, value: string) {
    setFormData((current) => ({ ...current, [name]: value }));
  }

  function resetForm(nextType = requestType, sourceTypes = availableRequestTypes) {
    const nextConfig = sourceTypes.find((item) => item.value === nextType) ?? sourceTypes[0] ?? requestTypes[0];
    setTitle("");
    setPriority("medium");
    setBusinessJustification("");
    setAttachment(null);
    setFormData(
      nextConfig.fields.reduce<Record<string, string>>((acc, field) => {
        acc[field.name] = field.kind === "select" ? field.options?.[0] ?? "" : "";
        return acc;
      }, {})
    );
  }

  async function loadRequests() {
    setIsLoading(true);
    try {
      const data = await apiFetch<ServiceRequest[]>("/requests");
      setItems(data);
    } catch {
      setItems([]);
    } finally {
      setIsLoading(false);
    }
  }

  async function loadActiveRequestTypes() {
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
      }
    } catch {
      setManagedRequestTypes(requestTypes);
    }
  }

  useEffect(() => {
    resetForm("vpn_remote_access");
    loadActiveRequestTypes();
    loadRequests();
  }, []);

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
      const created = await apiFetch<{ id: number }>(selectedType.requestTypeId ? "/requests/dynamic" : "/requests", {
        method: "POST",
        body: JSON.stringify(payload)
      });
      if (attachment && created?.id) {
        await uploadAttachment(created.id, attachment);
      }
      setMessage("تم إرسال الطلب بنجاح وإضافته إلى مسار الموافقات.");
      resetForm();
      await loadRequests();
    } catch {
      setError("تعذر إرسال الطلب. تحقق من الاتصال بالخادم وصلاحية الجلسة.");
    } finally {
      setIsSubmitting(false);
    }
  }

  function buildRequestPayload() {
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
        form_data: enrichedFormData
      };
    }

    return {
      title,
      request_type: requestType,
      priority,
      business_justification: businessJustification,
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
          <Button onClick={loadRequests} disabled={isLoading} className="gap-2 self-start lg:self-auto">
            <RefreshCw className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
            تحديث القائمة
          </Button>
        </div>
      </section>

      <div className="grid gap-5 xl:grid-cols-[460px_1fr]">
        <Card className="p-5">
          <div className="mb-5 flex items-center gap-3">
            <div className="rounded-md bg-bank-50 p-3 text-bank-700">
              <FilePlus2 className="h-5 w-5" />
            </div>
            <div>
              <h3 className="font-bold text-slate-950">بيانات الطلب</h3>
              <p className="text-sm text-slate-500">{selectedType.description}</p>
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

            <div className="flex flex-col gap-3 sm:flex-row">
              <Button type="submit" disabled={isSubmitting} className="gap-2">
                <Send className="h-4 w-4" />
                {isSubmitting ? "جاري الإرسال..." : "إرسال الطلب"}
              </Button>
              <button type="button" onClick={() => resetForm()} className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50">
                <Save className="h-4 w-4" />
                تفريغ النموذج
              </button>
            </div>
          </form>
        </Card>

        <Card className="overflow-hidden">
          <div className="border-b border-slate-200 p-5">
            <h3 className="font-bold text-slate-950">آخر الطلبات</h3>
            <p className="mt-1 text-sm text-slate-500">قائمة مختصرة بالطلبات التي تم تقديمها من خلال النظام.</p>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="bg-slate-50 text-slate-500">
                <tr>
                  <th className="p-3 text-right">رقم الطلب</th>
                  <th className="p-3 text-right">العنوان</th>
                  <th className="p-3 text-right">النوع</th>
                  <th className="p-3 text-right">القسم المختص</th>
                  <th className="p-3 text-right">الحالة</th>
                  <th className="p-3 text-right">الأولوية</th>
                  <th className="p-3 text-right">تاريخ الإنشاء</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {items.length === 0 && (
                  <tr>
                    <td colSpan={7} className="p-6 text-center text-slate-500">لا توجد طلبات لعرضها حالياً.</td>
                  </tr>
                )}
                {items.map((item) => (
                  <tr key={item.id} className="hover:bg-slate-50">
                    <td className="p-3 font-semibold text-bank-700">{item.request_number}</td>
                    <td className="p-3 text-slate-900">{item.title}</td>
                    <td className="p-3">{requestTypeLabel(item)}</td>
                    <td className="p-3">{requestSectionLabel(item)}</td>
                    <td className="p-3">{statusLabels[item.status] ?? item.status}</td>
                    <td className="p-3">{priorities.find((type) => type.value === item.priority)?.label ?? item.priority}</td>
                    <td className="p-3">{new Date(item.created_at).toLocaleDateString("ar-QA")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </div>
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
    throw new Error(await response.text());
  }
}

function categoryToSection(category?: string): AdministrativeSection {
  if (category === "network" || category === "access") return "networks";
  if (category === "development" || category === "software") return "development";
  if (category === "accounts") return "servers";
  return "support";
}
