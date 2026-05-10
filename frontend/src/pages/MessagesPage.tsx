import { FormEvent, ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Archive,
  ArrowBigLeftDash,
  Bold,
  ChevronLeft,
  ChevronRight,
  Download,
  Eraser,
  Eye,
  EyeOff,
  Filter,
  FileText,
  ALargeSmall,
  Hash,
  Heading1,
  Heading2,
  Inbox,
  Italic,
  Link,
  List,
  ListChecks,
  ListOrdered,
  Mail,
  MailOpen,
  Minus,
  Paperclip,
  Quote,
  Redo2,
  Reply,
  RefreshCw,
  Save,
  Search,
  Send,
  SendHorizonal,
  Signature,
  Sparkles,
  Strikethrough,
  Trash2,
  Underline,
  Undo,
  Undo2,
  UserPlus,
  X
} from "lucide-react";
import { API_BASE, apiFetch } from "../lib/api";
import { formatSystemDateTime } from "../lib/datetime";
import { Button } from "../components/ui/button";
import AIAssistantBox from "../components/ai/AIAssistantBox";
import AISuggestionPanel from "../components/ai/AISuggestionPanel";
import AISummaryBox from "../components/ai/AISummaryBox";

type MessageUser = {
  id: number;
  full_name_ar: string;
  email: string;
  role: string;
  department_id?: number | null;
  department_name?: string | null;
  department_manager_id?: number | null;
};

type InternalMessage = {
  id: number;
  message_uid?: string | null;
  thread_id?: number | null;
  message_type: string;
  priority?: "normal" | "high" | "urgent" | string;
  classification_code?: string | null;
  subject: string;
  body: string;
  sender_id: number;
  sender_name: string;
  recipient_ids: number[];
  recipient_names: string[];
  related_request_id?: number | null;
  related_request_number?: string | null;
  is_read: boolean;
  is_archived: boolean;
  is_draft: boolean;
  created_at: string;
  updated_at?: string | null;
  attachments: MessageAttachment[];
  read_receipts?: MessageReadReceipt[];
  replies?: InternalMessage[];
};

type MessageAttachment = {
  id: number;
  original_name: string;
  content_type: string;
  size_bytes: number;
  created_at: string;
};

type MessageReadReceipt = {
  recipient_id: number;
  recipient_name: string;
  is_read: boolean;
  read_at?: string | null;
};

type MessageTemplate = {
  key: string;
  label: string;
  message_type: string;
  subject: string;
  body: string;
};

type MessageTypeOption = {
  value: string;
  label: string;
  is_system?: boolean;
  color?: string | null;
  icon?: string | null;
  is_official?: boolean;
  requires_request?: boolean;
  requires_attachment?: boolean;
  show_in_pdf?: boolean;
  allow_reply?: boolean;
};

type MessageClassificationOption = {
  code: string;
  name_ar: string;
  name_en?: string | null;
  description?: string | null;
  is_active?: boolean;
  restricted_access?: boolean;
  show_in_pdf?: boolean;
  show_in_reports?: boolean;
  allow_attachment_download?: boolean;
  log_downloads?: boolean;
  requires_special_permission?: boolean;
};

type MessageSettings = {
  module_name_ar: string;
  module_name_en: string;
  enabled: boolean;
  enable_attachments: boolean;
  enable_drafts: boolean;
  enable_templates: boolean;
  enable_signatures: boolean;
  allow_archiving: boolean;
  allow_general_messages: boolean;
  allow_replies: boolean;
  allow_forwarding: boolean;
  allow_multiple_recipients: boolean;
  allow_user_delete_own_messages: boolean;
  prevent_hard_delete: boolean;
  exclude_official_messages_from_delete: boolean;
  exclude_confidential_messages_from_delete: boolean;
  allow_send_to_user: boolean;
  allow_send_to_department: boolean;
  allow_broadcast: boolean;
  enable_circulars: boolean;
  enable_department_broadcasts: boolean;
  enable_read_receipts: boolean;
  enable_unread_badge: boolean;
  enable_linked_requests: boolean;
  enable_message_notifications: boolean;
  notify_on_new_message: boolean;
  notify_on_reply: boolean;
  notify_on_read: boolean;
  notify_on_clarification_request: boolean;
  notify_on_official_message: boolean;
  max_attachment_mb: number;
  max_attachments_per_message: number;
  max_recipients: number;
  default_priority: string;
  default_message_type: string;
  allowed_extensions: string[];
  block_executable_files: boolean;
  department_recipient_behavior: string;
};

type MessageCapabilities = {
  can_send_circular: boolean;
  can_send_department_broadcast: boolean;
  can_use_templates: boolean;
};

type AIStatus = {
  is_enabled: boolean;
  allow_message_drafting: boolean;
  allow_summarization: boolean;
  allow_reply_suggestion: boolean;
  allow_message_improvement?: boolean;
  allow_missing_info_detection?: boolean;
  show_in_compose_message?: boolean;
  show_in_message_details?: boolean;
  show_in_request_messages_tab?: boolean;
};

type Mailbox = "inbox" | "sent" | "drafts" | "archived" | "unread" | "request-linked" | "official" | "clarifications" | "compose";
const pageSize = 50;
const defaultMessageType = "internal_correspondence";
const defaultMessageClassification = "internal";
const mailboxPaths: Record<Mailbox, string> = {
  inbox: "/messages/inbox",
  sent: "/messages/sent",
  drafts: "/messages/drafts",
  archived: "/messages/archived",
  unread: "/messages/unread",
  "request-linked": "/messages/request-linked",
  official: "/messages/official",
  clarifications: "/messages/clarifications",
  compose: "/messages/new"
};
const defaultMessageSettings: MessageSettings = {
  module_name_ar: "المراسلات الداخلية",
  module_name_en: "Internal Messaging",
  enabled: true,
  enable_attachments: true,
  enable_drafts: true,
  enable_templates: true,
  enable_signatures: true,
  allow_archiving: true,
  allow_general_messages: true,
  allow_replies: true,
  allow_forwarding: false,
  allow_multiple_recipients: true,
  allow_user_delete_own_messages: false,
  prevent_hard_delete: true,
  exclude_official_messages_from_delete: true,
  exclude_confidential_messages_from_delete: true,
  allow_send_to_user: true,
  allow_send_to_department: true,
  allow_broadcast: false,
  enable_circulars: true,
  enable_department_broadcasts: true,
  enable_read_receipts: true,
  enable_unread_badge: true,
  enable_linked_requests: true,
  enable_message_notifications: true,
  notify_on_new_message: true,
  notify_on_reply: true,
  notify_on_read: false,
  notify_on_clarification_request: true,
  notify_on_official_message: true,
  max_attachment_mb: 25,
  max_attachments_per_message: 10,
  max_recipients: 200,
  default_priority: "normal",
  allowed_extensions: ["pdf", "png", "jpg", "jpeg"],
  block_executable_files: true,
  department_recipient_behavior: "selected_department_users",
  default_message_type: defaultMessageType
};
const defaultMessageCapabilities: MessageCapabilities = {
  can_send_circular: true,
  can_send_department_broadcast: true,
  can_use_templates: true
};
const defaultMessageTypeOptions = [
  { value: "internal_correspondence", label: "مراسلة داخلية" },
  { value: "official_correspondence", label: "مراسلة رسمية" },
  { value: "clarification_request", label: "طلب استيضاح" },
  { value: "reply_to_clarification", label: "رد على استيضاح" },
  { value: "approval_note", label: "ملاحظة موافقة" },
  { value: "rejection_reason", label: "سبب رفض" },
  { value: "implementation_note", label: "ملاحظة تنفيذ" },
  { value: "notification", label: "إشعار" },
  { value: "circular", label: "تعميم" }
];
const defaultMessageClassificationOptions: MessageClassificationOption[] = [
  { code: "public", name_ar: "عام", allow_attachment_download: true },
  { code: "internal", name_ar: "داخلي", allow_attachment_download: true },
  { code: "confidential", name_ar: "سري", restricted_access: true, allow_attachment_download: true, log_downloads: true },
  { code: "top_secret", name_ar: "سري للغاية", restricted_access: true, allow_attachment_download: false, log_downloads: true, requires_special_permission: true }
];

export default function MessagesPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [mailbox, setMailbox] = useState<Mailbox>(() => {
    const initial = mailboxFromPath(window.location.pathname);
    if (initial) return initial;
    return new URLSearchParams(window.location.search).get("compose") === "1" ? "compose" : "inbox";
  });
  const [messages, setMessages] = useState<InternalMessage[]>([]);
  const [users, setUsers] = useState<MessageUser[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [senderFilter, setSenderFilter] = useState("");
  const [relatedRequestFilter, setRelatedRequestFilter] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [archiveView, setArchiveView] = useState<"inbox" | "sent">("inbox");
  const [isLoading, setIsLoading] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [error, setError] = useState("");
  const [usersError, setUsersError] = useState("");
  const [isUsersLoading, setIsUsersLoading] = useState(false);
  const [messageSettings, setMessageSettings] = useState<MessageSettings>(defaultMessageSettings);
  const [messageCapabilities, setMessageCapabilities] = useState<MessageCapabilities>(defaultMessageCapabilities);
  const [messageCounters, setMessageCounters] = useState({ unread: 0 });
  const [messageTemplates, setMessageTemplates] = useState<MessageTemplate[]>([]);
  const [messageTypeOptions, setMessageTypeOptions] = useState<MessageTypeOption[]>(defaultMessageTypeOptions);
  const [messageClassificationOptions, setMessageClassificationOptions] = useState<MessageClassificationOption[]>(defaultMessageClassificationOptions);
  const [selectedTemplateKey, setSelectedTemplateKey] = useState("");
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [form, setForm] = useState({ recipient_ids: [] as number[], message_type: defaultMessageSettings.default_message_type, priority: "normal", classification_code: defaultMessageClassification, subject: "", body: "", related_request_id: "" });
  const [priorityFilter, setPriorityFilter] = useState("");
  const [selectedDepartmentIds, setSelectedDepartmentIds] = useState<number[]>([]);
  const [departmentRecipientIds, setDepartmentRecipientIds] = useState<number[]>([]);
  const [departmentBroadcastOpen, setDepartmentBroadcastOpen] = useState(false);
  const [attachments, setAttachments] = useState<File[]>([]);
  const [recipientSearch, setRecipientSearch] = useState("");
  const [editingDraftId, setEditingDraftId] = useState<number | null>(null);
  const [forwardSource, setForwardSource] = useState<InternalMessage | null>(null);
  const [replySource, setReplySource] = useState<InternalMessage | null>(null);
  const [signatureText, setSignatureText] = useState("");
  const [signatureDraft, setSignatureDraft] = useState("");
  const [signatureOpen, setSignatureOpen] = useState(false);
  const [isSignatureSaving, setIsSignatureSaving] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [mailPanelCollapsed, setMailPanelCollapsed] = useState(false);
  const [composeAiOpen, setComposeAiOpen] = useState(false);
  const [selectedAiSuggestion, setSelectedAiSuggestion] = useState<{ type: "reply"; body: string } | null>(null);
  const [selectedAiLoading, setSelectedAiLoading] = useState("");
  const [selectedAiError, setSelectedAiError] = useState("");
  const [aiStatus, setAiStatus] = useState<AIStatus>({ is_enabled: false, allow_message_drafting: false, allow_summarization: false, allow_reply_suggestion: false });
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const queryComposeInitialized = useRef(false);

  const selected = useMemo(() => messages.find((message) => message.id === selectedId) || null, [messages, selectedId]);
  const unreadCount = messageSettings.enable_unread_badge ? messageCounters.unread : 0;
  const inboxStyleGroups = useMemo(() => {
    if (mailbox !== "inbox") return null;
    const unread = messages.filter((message) => !message.is_read).sort(sortByNewest);
    const read = messages.filter((message) => message.is_read).sort(sortByNewest);
    return { unread, read };
  }, [mailbox, messages]);
  const selectedRecipients = useMemo(() => users.filter((user) => form.recipient_ids.includes(user.id)), [users, form.recipient_ids]);
  const departmentOptions = useMemo(() => {
    const map = new Map<number, string>();
    users.forEach((user) => {
      if (user.department_id && user.department_name) map.set(user.department_id, user.department_name);
    });
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
  }, [users]);
  const recipientSuggestions = useMemo(() => {
    const term = recipientSearch.trim().toLowerCase();
    return users
      .filter((user) => !form.recipient_ids.includes(user.id))
      .filter((user) => !term || [user.full_name_ar, user.email, user.role].some((value) => value.toLowerCase().includes(term)))
      .slice(0, 8);
  }, [users, form.recipient_ids, recipientSearch]);
  const usableMessageTypeOptions = useMemo(
    () => messageTypeOptions.filter((option) => option.value !== "circular" || messageCapabilities.can_send_circular),
    [messageTypeOptions, messageCapabilities.can_send_circular]
  );
  const selectedFormMessageType = useMemo(
    () => messageTypeOptions.find((option) => option.value === form.message_type) || null,
    [messageTypeOptions, form.message_type]
  );
  const selectedMessageType = useMemo(
    () => (selected ? messageTypeOptions.find((option) => option.value === selected.message_type) || null : null),
    [messageTypeOptions, selected]
  );
  const selectedClassification = useMemo(
    () => (selected ? messageClassificationOptions.find((option) => option.code === (selected.classification_code || defaultMessageClassification)) || null : null),
    [messageClassificationOptions, selected]
  );
  const selectedFormClassification = useMemo(
    () => messageClassificationOptions.find((option) => option.code === form.classification_code) || null,
    [messageClassificationOptions, form.classification_code]
  );
  const selectedCanReply = Boolean(messageSettings.allow_replies && selectedMessageType?.allow_reply !== false);
  const requestLinkingBlocked = Boolean(form.related_request_id.trim() && !messageSettings.enable_linked_requests);
  const requestLinkRequired = Boolean(!messageSettings.allow_general_messages || selectedFormMessageType?.requires_request);
  const attachmentRequired = Boolean(selectedFormMessageType?.requires_attachment);
  const canUseAiDrafting = Boolean(aiStatus.is_enabled && aiStatus.allow_message_drafting && aiStatus.show_in_compose_message !== false);
  const canUseAiSummaries = Boolean(aiStatus.is_enabled && aiStatus.allow_summarization && aiStatus.show_in_message_details !== false);
  const canUseAiReplies = Boolean(aiStatus.is_enabled && aiStatus.allow_reply_suggestion && aiStatus.show_in_message_details !== false);

  function openMailbox(nextMailbox: Mailbox) {
    setMailbox(nextMailbox);
    navigate(mailboxPaths[nextMailbox]);
  }

  async function loadCounters() {
    try {
      setMessageCounters(await apiFetch<{ unread: number }>("/messages/counters"));
    } catch {
      setMessageCounters({ unread: 0 });
    }
  }

  async function loadUsers() {
    setIsUsersLoading(true);
    setUsersError("");
    try {
      setUsers(await apiFetch<MessageUser[]>("/messages/users"));
    } catch (error) {
      setUsers([]);
      setUsersError(`تعذر تحميل قائمة المستلمين.${error instanceof Error ? ` ${extractApiError(error.message)}` : ""}`);
    } finally {
      setIsUsersLoading(false);
    }
  }

  async function loadMessages(nextMailbox = mailbox, mode: "replace" | "append" = "replace") {
    if (nextMailbox === "compose") return;
    setIsLoading(true);
    setError("");
    const query = new URLSearchParams();
    if (search) query.set("search", search);
    if (nextMailbox === "official") query.set("official_only", "true");
    if (nextMailbox === "clarifications") query.set("clarification_only", "true");
    if (nextMailbox !== "official" && nextMailbox !== "clarifications" && typeFilter) query.set("message_type", typeFilter);
    if (priorityFilter) query.set("priority", priorityFilter);
    if (senderFilter && ["inbox", "unread", "official", "clarifications"].includes(nextMailbox)) query.set("sender_id", senderFilter);
    if (relatedRequestFilter) query.set("related_request", relatedRequestFilter);
    if (dateFrom) query.set("date_from", dateFrom);
    if (dateTo) query.set("date_to", dateTo);
    if ((nextMailbox === "inbox" && unreadOnly) || nextMailbox === "unread") query.set("unread_only", "true");
    if (nextMailbox === "archived") query.set("archived", "true");
    query.set("limit", String(pageSize));
    query.set("offset", String(mode === "append" ? messages.length : 0));
    try {
      const endpoint =
        nextMailbox === "archived"
          ? archiveView
          : nextMailbox === "official" || nextMailbox === "clarifications" || nextMailbox === "unread"
            ? "inbox"
            : nextMailbox;
      const data = await apiFetch<InternalMessage[]>(`/messages/${endpoint}?${query.toString()}`);
      setHasMore(data.length === pageSize);
      if (mode === "append") {
        setMessages((current) => [...current, ...data]);
      } else {
        const shouldAutoSelect = nextMailbox !== "inbox" && !(nextMailbox === "archived" && archiveView === "inbox");
        setMessages(data);
        setSelectedId((current) => {
          if (current && data.some((message) => message.id === current)) return current;
          return shouldAutoSelect ? data[0]?.id ?? null : null;
        });
        setSelectedIds([]);
      }
    } catch {
      setError("تعذر تحميل المراسلات.");
    } finally {
      setIsLoading(false);
      loadCounters();
    }
  }

  useEffect(() => {
    loadUsers();
    loadMessageSettings();
    loadMessageCapabilities();
    loadCounters();
    loadSignature();
    loadTemplates();
    loadTypes();
    loadClassifications();
    loadAiStatus();
  }, []);

  useEffect(() => {
    if (searchParams.get("compose") === "1") return;
    const pathMessageId = messageIdFromPath(location.pathname);
    if (pathMessageId) {
      if (mailbox !== "inbox") setMailbox("inbox");
      setSelectedId(pathMessageId);
      return;
    }
    const nextMailbox = mailboxFromPath(location.pathname);
    if (!nextMailbox) {
      navigate(mailboxPaths.inbox, { replace: true });
      return;
    }
    if (nextMailbox !== mailbox) {
      setMailbox(nextMailbox);
      setSelectedId(null);
      setSelectedIds([]);
    }
  }, [location.pathname, navigate, searchParams]);

  useEffect(() => {
    if (queryComposeInitialized.current || searchParams.get("compose") !== "1") return;
    queryComposeInitialized.current = true;
    const storedAiDraft = readStoredAiDraft();
    setEditingDraftId(null);
    setForwardSource(null);
    setReplySource(null);
    setAttachments([]);
    setRecipientSearch("");
    setForm({
      recipient_ids: [],
      message_type: searchParams.get("message_type") || storedAiDraft?.message_type || defaultMessageType,
      priority: searchParams.get("priority") || messageSettings.default_priority || "normal",
      classification_code: searchParams.get("classification_code") || defaultMessageClassification,
      subject: searchParams.get("subject") || storedAiDraft?.subject || "",
      body: storedAiDraft?.body || "",
      related_request_id: searchParams.get("related_request_id") || ""
    });
    setMailbox("compose");
    navigate(mailboxPaths.compose, { replace: true });
    window.requestAnimationFrame(() => bodyRef.current?.focus());
  }, [searchParams]);

  useEffect(() => {
    loadMessages(mailbox);
  }, [mailbox, unreadOnly, archiveView, typeFilter, priorityFilter]);

  useEffect(() => {
    if (!messageSettings.allow_archiving && mailbox === "archived") {
      openMailbox("inbox");
      setArchiveView("inbox");
    }
  }, [messageSettings.allow_archiving, mailbox]);

  useEffect(() => {
    if (mailbox === "compose") return;
    function refreshMessagesImmediately() {
      loadMessages(mailbox);
      loadCounters();
    }
    window.addEventListener("qib-messages-updated", refreshMessagesImmediately);
    return () => window.removeEventListener("qib-messages-updated", refreshMessagesImmediately);
  }, [mailbox, unreadOnly, search, archiveView, typeFilter, priorityFilter, senderFilter, relatedRequestFilter, dateFrom, dateTo]);

  useEffect(() => {
    if (!selectedId || mailbox === "compose") return;
    setSelectedAiSuggestion(null);
    setSelectedAiError("");
    loadMessageDetails(selectedId);
  }, [selectedId, mailbox]);

  useEffect(() => {
    if (mailbox !== "compose" || !bodyRef.current || document.activeElement === bodyRef.current) return;
    if (bodyRef.current.innerHTML !== form.body) {
      bodyRef.current.innerHTML = form.body || "";
    }
  }, [mailbox, form.body]);

  useEffect(() => {
    if (form.message_type === "circular" && !messageCapabilities.can_send_circular) {
      setForm((current) => ({ ...current, message_type: messageSettings.default_message_type || defaultMessageType }));
      clearDepartmentRecipients();
    }
  }, [form.message_type, messageCapabilities.can_send_circular, messageSettings.default_message_type]);

  useEffect(() => {
    if (messageTypeOptions.length === 0) return;
    const fallbackType = messageTypeOptions.some((option) => option.value === messageSettings.default_message_type)
      ? messageSettings.default_message_type
      : messageTypeOptions[0].value;
    setForm((current) => ({
      ...current,
      message_type: messageTypeOptions.some((option) => option.value === current.message_type) ? current.message_type : fallbackType,
      priority: current.priority && current.priority !== "normal" ? current.priority : messageSettings.default_priority || "normal"
    }));
  }, [messageTypeOptions, messageSettings.default_message_type, messageSettings.default_priority]);

  useEffect(() => {
    if (messageClassificationOptions.length === 0) return;
    setForm((current) => ({
      ...current,
      classification_code: messageClassificationOptions.some((option) => option.code === current.classification_code)
        ? current.classification_code
        : messageClassificationOptions.find((option) => option.code === defaultMessageClassification)?.code || messageClassificationOptions[0].code
    }));
  }, [messageClassificationOptions]);

  async function loadMessageDetails(messageId: number) {
    try {
      const details = await apiFetch<InternalMessage>(`/messages/${messageId}`);
      setMessages((current) => (current.some((item) => item.id === details.id) ? current.map((item) => (item.id === details.id ? details : item)) : [details, ...current]));
      setSelectedId(details.id);
    } catch {
      undefined;
    }
  }

  async function selectMessage(message: InternalMessage) {
    setSelectedId(message.id);
    if (mailbox !== "inbox" || message.is_read) {
      loadMessageDetails(message.id);
      return;
    }
    try {
      const updated = await apiFetch<InternalMessage>(`/messages/${message.id}/read`, { method: "POST" });
      setMessages((current) => current.map((item) => (item.id === updated.id ? updated : item)));
      await loadCounters();
      window.dispatchEvent(new Event("qib-messages-updated"));
      await loadMessageDetails(message.id);
    } catch {
      undefined;
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setFeedback("");
    setError("");
    if (!messageSettings.enabled) {
      setError("نظام المراسلات غير مفعل من إعدادات المراسلات.");
      return;
    }
    if (requestLinkingBlocked) {
      setError("ربط المراسلات بالطلبات غير مفعل من إعدادات المراسلات.");
      return;
    }
    if (requestLinkRequired && !form.related_request_id.trim()) {
      setError(selectedFormMessageType?.requires_request ? "هذا النوع من الرسائل يتطلب ربط الرسالة بطلب." : "المراسلات العامة غير مفعلة. يجب إرسال الرسالة من داخل طلب أو ربطها بطلب.");
      return;
    }
    if (attachmentRequired && attachments.length === 0 && !editingDraftId) {
      setError("هذا النوع من الرسائل يتطلب إضافة مرفق.");
      return;
    }
    try {
      if (replySource) {
        if (!messageSettings.allow_replies) {
          setError("الرد على الرسائل معطل من إعدادات المراسلات.");
          return;
        }
        if (attachments.length > 0) {
          const data = new FormData();
          data.append("message_type", form.message_type);
          data.append("priority", form.priority);
          data.append("classification_code", form.classification_code);
          data.append("body", form.body);
          attachments.forEach((file) => data.append("attachments", file));
          await apiFetch<InternalMessage>(`/messages/${replySource.id}/reply-with-attachments`, { method: "POST", body: data });
        } else {
          await apiFetch<InternalMessage>(`/messages/${replySource.id}/reply`, {
            method: "POST",
            body: JSON.stringify({ body: form.body, message_type: form.message_type, priority: form.priority, classification_code: form.classification_code })
          });
        }
      } else if (forwardSource) {
        if (!messageSettings.allow_forwarding) {
          setError("تحويل الرسائل معطل من إعدادات المراسلات.");
          return;
        }
        await apiFetch<InternalMessage>(`/messages/${forwardSource.id}/forward`, {
          method: "POST",
          body: JSON.stringify({ recipient_ids: form.recipient_ids, message_type: form.message_type, priority: form.priority, classification_code: form.classification_code, note: form.body.trim() || undefined })
        });
      } else if (editingDraftId) {
        await apiFetch<InternalMessage>(`/messages/drafts/${editingDraftId}/send`, {
          method: "POST",
          body: JSON.stringify(form)
        });
      } else if (attachments.length > 0) {
        const relatedRequestId = form.related_request_id.trim() || undefined;
        const data = new FormData();
        data.append("recipient_ids", form.recipient_ids.join(","));
        data.append("message_type", form.message_type);
        data.append("priority", form.priority);
        data.append("classification_code", form.classification_code);
        data.append("subject", form.subject);
        data.append("body", form.body);
        if (relatedRequestId) data.append("related_request_id", relatedRequestId);
        attachments.forEach((file) => data.append("attachments", file));
        await apiFetch<InternalMessage>("/messages/with-attachments", { method: "POST", body: data });
      } else {
        const relatedRequestId = form.related_request_id.trim() || undefined;
        await apiFetch<InternalMessage>("/messages", {
          method: "POST",
          body: JSON.stringify({ ...form, related_request_id: relatedRequestId })
        });
      }
      setForm({ recipient_ids: [], message_type: messageSettings.default_message_type || defaultMessageType, priority: messageSettings.default_priority || "normal", classification_code: defaultMessageClassification, subject: "", body: "", related_request_id: "" });
      setSelectedDepartmentIds([]);
      setDepartmentRecipientIds([]);
      setAttachments([]);
      setEditingDraftId(null);
      setForwardSource(null);
      setReplySource(null);
      setFeedback(replySource ? "تم إرسال الرد." : "تم إرسال الرسالة بنجاح.");
      openMailbox("sent");
    } catch (error) {
      const detail = error instanceof Error ? extractApiError(error.message) : "";
      setError(detail || "تعذر إرسال الرسالة. تأكد من اختيار مستلم وكتابة العنوان والمحتوى.");
    }
  }

  async function saveDraft() {
    setFeedback("");
    setError("");
    if (!messageSettings.enabled) {
      setError("نظام المراسلات غير مفعل من إعدادات المراسلات.");
      return;
    }
    if (!messageSettings.enable_drafts) {
      setError("المسودات غير مفعلة من إعدادات المراسلات.");
      return;
    }
    if (replySource || forwardSource) {
      setError("حفظ المسودة متاح للرسائل الجديدة فقط حالياً.");
      return;
    }
    if (!form.subject.trim() && !form.body.trim() && form.recipient_ids.length === 0 && !form.related_request_id.trim()) {
      setError("اكتب أي محتوى قبل حفظ المسودة.");
      return;
    }
    try {
      let draft: InternalMessage;
      if (!editingDraftId && attachments.length > 0) {
        const data = new FormData();
        data.append("recipient_ids", form.recipient_ids.join(","));
        data.append("message_type", form.message_type);
        data.append("priority", form.priority);
        data.append("classification_code", form.classification_code);
        data.append("subject", form.subject);
        data.append("body", form.body);
        if (form.related_request_id.trim()) data.append("related_request_id", form.related_request_id.trim());
        attachments.forEach((file) => data.append("attachments", file));
        draft = await apiFetch<InternalMessage>("/messages/drafts/with-attachments", { method: "POST", body: data });
        setAttachments([]);
      } else {
        const endpoint = editingDraftId ? `/messages/drafts/${editingDraftId}` : "/messages/drafts";
        const method = editingDraftId ? "PUT" : "POST";
        draft = await apiFetch<InternalMessage>(endpoint, {
          method,
          body: JSON.stringify(form)
        });
      }
      setEditingDraftId(draft.id);
      setFeedback("تم حفظ المسودة.");
      if (mailbox === "drafts") {
        loadMessages("drafts");
      }
    } catch (error) {
      const detail = error instanceof Error ? extractApiError(error.message) : "";
      setError(detail || "تعذر حفظ المسودة.");
    }
  }

  function clearComposeForm() {
    setForm({ recipient_ids: [], message_type: messageSettings.default_message_type || defaultMessageType, priority: messageSettings.default_priority || "normal", classification_code: defaultMessageClassification, subject: "", body: "", related_request_id: "" });
    setSelectedDepartmentIds([]);
    setDepartmentRecipientIds([]);
    setAttachments([]);
    setRecipientSearch("");
    setEditingDraftId(null);
    setForwardSource(null);
    setReplySource(null);
    setDepartmentBroadcastOpen(false);
    if (bodyRef.current) bodyRef.current.innerHTML = "";
  }

  async function archiveSelected() {
    if (!selected) return;
    if (!messageSettings.allow_archiving) {
      setError("الأرشفة معطلة من إعدادات المراسلات.");
      return;
    }
    try {
      await apiFetch<void>(`/messages/${selected.id}/archive`, { method: "POST" });
      setMessages((current) => current.filter((message) => message.id !== selected.id));
      setSelectedId(null);
      window.dispatchEvent(new Event("qib-messages-updated"));
      setFeedback("تمت أرشفة الرسالة.");
    } catch {
      setError("تعذر أرشفة الرسالة.");
    }
  }

  async function markSelectedReadState(isRead: boolean) {
    if (!selected) return;
    try {
      const endpoint = isRead ? "mark-read" : "mark-unread";
      const updated = await apiFetch<InternalMessage>(`/messages/${selected.id}/${endpoint}`, { method: "POST" });
      setMessages((current) => current.map((message) => (message.id === updated.id ? updated : message)));
      setSelectedId(updated.id);
      await loadCounters();
      window.dispatchEvent(new Event("qib-messages-updated"));
      setFeedback(isRead ? "تم تعليم الرسالة كمقروءة." : "تم تعليم الرسالة كغير مقروءة.");
    } catch {
      setError(isRead ? "تعذر تعليم الرسالة كمقروءة." : "تعذر تعليم الرسالة كغير مقروءة.");
    }
  }

  async function deleteSelectedMessage() {
    if (!selected || selected.is_draft) return;
    if (!messageSettings.allow_user_delete_own_messages) {
      setError("حذف الرسائل غير مفعل من إعدادات الأرشفة والاحتفاظ.");
      return;
    }
    const label = messageSettings.prevent_hard_delete ? "سيتم حذف الرسالة من صندوقك فقط ولن يتم حذفها نهائياً من النظام." : "سيتم حذف الرسالة من صندوقك.";
    if (!window.confirm(`${label}\nهل تريد المتابعة؟`)) return;
    try {
      await apiFetch<void>(`/messages/${selected.id}/delete`, { method: "POST" });
      setMessages((current) => current.filter((message) => message.id !== selected.id));
      setSelectedId(null);
      setSelectedIds((current) => current.filter((id) => id !== selected.id));
      window.dispatchEvent(new Event("qib-messages-updated"));
      setFeedback("تم حذف الرسالة من صندوقك.");
    } catch (error) {
      const detail = error instanceof Error ? extractApiError(error.message) : "";
      setError(detail || "تعذر حذف الرسالة.");
    }
  }

  function toggleMessageSelection(messageId: number) {
    setSelectedIds((current) => (current.includes(messageId) ? current.filter((id) => id !== messageId) : [...current, messageId]));
  }

  function toggleAllVisibleMessages() {
    const visibleIds = messages.map((message) => message.id);
    const allSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedIds.includes(id));
    setSelectedIds(allSelected ? [] : visibleIds);
  }

  async function bulkArchive() {
    if (selectedIds.length === 0) return;
    if (!messageSettings.allow_archiving) {
      setError("الأرشفة معطلة من إعدادات المراسلات.");
      return;
    }
    try {
      await apiFetch<void>("/messages/bulk/archive", { method: "POST", body: JSON.stringify({ message_ids: selectedIds }) });
      setMessages((current) => current.filter((message) => !selectedIds.includes(message.id)));
      setSelectedIds([]);
      setSelectedId(null);
      window.dispatchEvent(new Event("qib-messages-updated"));
      setFeedback("تمت أرشفة الرسائل المحددة.");
    } catch {
      setError("تعذر تنفيذ الأرشفة الجماعية.");
    }
  }

  async function bulkDeleteMessages() {
    if (selectedIds.length === 0) return;
    if (!messageSettings.allow_user_delete_own_messages) {
      setError("حذف الرسائل غير مفعل من إعدادات الأرشفة والاحتفاظ.");
      return;
    }
    const label = messageSettings.prevent_hard_delete ? "سيتم حذف الرسائل المحددة من صندوقك فقط ولن يتم حذفها نهائياً من النظام." : "سيتم حذف الرسائل المحددة من صندوقك.";
    if (!window.confirm(`${label}\nهل تريد المتابعة؟`)) return;
    try {
      await apiFetch<void>("/messages/bulk/delete", { method: "POST", body: JSON.stringify({ message_ids: selectedIds }) });
      setMessages((current) => current.filter((message) => !selectedIds.includes(message.id)));
      setSelectedIds([]);
      setSelectedId(null);
      window.dispatchEvent(new Event("qib-messages-updated"));
      setFeedback("تم حذف الرسائل المحددة من صندوقك.");
    } catch (error) {
      const detail = error instanceof Error ? extractApiError(error.message) : "";
      setError(detail || "تعذر حذف الرسائل المحددة.");
    }
  }

  async function bulkMarkRead() {
    if (selectedIds.length === 0) return;
    try {
      await apiFetch<void>("/messages/bulk/read", { method: "POST", body: JSON.stringify({ message_ids: selectedIds }) });
      setMessages((current) => current.map((message) => (selectedIds.includes(message.id) ? { ...message, is_read: true } : message)));
      setSelectedIds([]);
      await loadCounters();
      window.dispatchEvent(new Event("qib-messages-updated"));
      setFeedback("تم تعليم الرسائل كمقروءة.");
    } catch {
      setError("تعذر تعليم الرسائل كمقروءة.");
    }
  }

  async function bulkDeleteDrafts() {
    if (selectedIds.length === 0) return;
    if (!window.confirm("هل تريد حذف المسودات المحددة؟")) return;
    try {
      await apiFetch<void>("/messages/drafts/bulk-delete", { method: "POST", body: JSON.stringify({ message_ids: selectedIds }) });
      setMessages((current) => current.filter((message) => !selectedIds.includes(message.id)));
      setSelectedIds([]);
      setSelectedId(null);
      setFeedback("تم حذف المسودات المحددة.");
    } catch {
      setError("تعذر حذف المسودات المحددة.");
    }
  }

  async function restoreSelected() {
    if (!selected) return;
    try {
      await apiFetch<void>(`/messages/${selected.id}/restore`, { method: "POST" });
      setMessages((current) => current.filter((message) => message.id !== selected.id));
      setSelectedId(null);
      window.dispatchEvent(new Event("qib-messages-updated"));
      setFeedback("تمت استعادة الرسالة.");
    } catch {
      setError("تعذر استعادة الرسالة.");
    }
  }

  async function downloadAttachment(messageId: number, attachment: MessageAttachment) {
    try {
      const token = localStorage.getItem("qib_token");
      const response = await fetch(`${API_BASE}/messages/${messageId}/attachments/${attachment.id}/download`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {}
      });
      if (!response.ok) throw new Error(await response.text());
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = attachment.original_name;
      link.click();
      URL.revokeObjectURL(url);
    } catch {
      setError("تعذر تنزيل المرفق.");
    }
  }

  async function loadSignature() {
    try {
      const data = await apiFetch<{ signature: string }>("/messages/signature");
      setSignatureText(data.signature || "");
      setSignatureDraft(data.signature || "");
    } catch {
      undefined;
    }
  }

  async function loadTemplates() {
    try {
      setMessageTemplates(await apiFetch<MessageTemplate[]>("/messages/templates"));
    } catch {
      setMessageTemplates([]);
    }
  }

  async function loadMessageSettings() {
    try {
      const data = await apiFetch<MessageSettings>("/messages/settings");
      setMessageSettings({ ...defaultMessageSettings, ...data });
      setForm((current) => ({ ...current, message_type: current.message_type || data.default_message_type || defaultMessageType, priority: current.priority || data.default_priority || "normal" }));
    } catch {
      setMessageSettings(defaultMessageSettings);
    }
  }

  async function loadMessageCapabilities() {
    try {
      setMessageCapabilities(await apiFetch<MessageCapabilities>("/messages/capabilities"));
    } catch {
      setMessageCapabilities(defaultMessageCapabilities);
    }
  }

  async function loadTypes() {
    try {
      const types = await apiFetch<MessageTypeOption[]>("/messages/types");
      setMessageTypeOptions(types.length ? types : defaultMessageTypeOptions);
    } catch {
      setMessageTypeOptions(defaultMessageTypeOptions);
    }
  }

  async function loadClassifications() {
    try {
      const classifications = await apiFetch<MessageClassificationOption[]>("/messages/classifications");
      setMessageClassificationOptions(classifications.length ? classifications : defaultMessageClassificationOptions);
    } catch {
      setMessageClassificationOptions(defaultMessageClassificationOptions);
    }
  }

  async function loadAiStatus() {
    try {
      setAiStatus(await apiFetch<AIStatus>("/ai/status"));
    } catch {
      setAiStatus({ is_enabled: false, allow_message_drafting: false, allow_summarization: false, allow_reply_suggestion: false });
    }
  }

  function messageTypeLabel(value: string) {
    return getMessageTypeLabel(value, messageTypeOptions);
  }

  function applyTemplate(templateKey: string) {
    setSelectedTemplateKey(templateKey);
    const template = messageTemplates.find((item) => item.key === templateKey);
    if (!template) return;
    const requestNumber = form.related_request_id.trim() || "رقم الطلب";
    const replaceTokens = (value: string) => value.replace(/\{request_number\}/g, requestNumber);
    setForm((current) => ({
      ...current,
      message_type: template.message_type || current.message_type,
      subject: replaceTokens(template.subject || current.subject),
      body: replaceTokens(template.body || current.body)
    }));
    setTemplatesOpen(false);
    window.requestAnimationFrame(() => bodyRef.current?.focus());
  }

  async function saveSignature() {
    setIsSignatureSaving(true);
    setError("");
    try {
      const data = await apiFetch<{ signature: string }>("/messages/signature", {
        method: "PUT",
        body: JSON.stringify({ signature: signatureDraft })
      });
      setSignatureText(data.signature || "");
      setSignatureDraft(data.signature || "");
      setSignatureOpen(false);
      setFeedback("تم حفظ التوقيع.");
    } catch {
      setError("تعذر حفظ التوقيع.");
    } finally {
      setIsSignatureSaving(false);
    }
  }

  function beginForward(message: InternalMessage) {
    if (!messageSettings.allow_forwarding) {
      setError("تحويل الرسائل معطل من إعدادات المراسلات.");
      return;
    }
    setForwardSource(message);
    setReplySource(null);
    setSelectedDepartmentIds([]);
    setDepartmentRecipientIds([]);
    setForm({
      recipient_ids: [],
      message_type: message.message_type || defaultMessageType,
      priority: message.priority || "normal",
      classification_code: message.classification_code || defaultMessageClassification,
      subject: message.subject.startsWith("تحويل:") ? message.subject : `تحويل: ${message.subject}`,
      body: "",
      related_request_id: message.related_request_number || (message.related_request_id ? String(message.related_request_id) : "")
    });
    setAttachments([]);
    setRecipientSearch("");
    setComposeAiOpen(false);
    setDepartmentBroadcastOpen(false);
    openMailbox("compose");
    window.requestAnimationFrame(() => bodyRef.current?.focus());
  }

  function cancelForward() {
    setForwardSource(null);
    setForm({ recipient_ids: [], message_type: messageSettings.default_message_type || defaultMessageType, priority: messageSettings.default_priority || "normal", classification_code: defaultMessageClassification, subject: "", body: "", related_request_id: "" });
    setSelectedDepartmentIds([]);
    setDepartmentRecipientIds([]);
    setRecipientSearch("");
    setDepartmentBroadcastOpen(false);
  }

  function beginReply(message: InternalMessage) {
    if (!messageSettings.allow_replies) {
      setError("الرد على الرسائل معطل من إعدادات المراسلات.");
      return;
    }
    const typeConfig = messageTypeOptions.find((option) => option.value === message.message_type);
    if (typeConfig?.allow_reply === false) {
      setError("هذا النوع من الرسائل لا يسمح بالرد حسب إعدادات المراسلات.");
      return;
    }
    setReplySource(message);
    setForwardSource(null);
    setSelectedDepartmentIds([]);
    setDepartmentRecipientIds([]);
    setForm({
      recipient_ids: [],
      message_type: "reply_to_clarification",
      priority: message.priority || "normal",
      classification_code: message.classification_code || defaultMessageClassification,
      subject: message.subject.startsWith("رد:") ? message.subject : `رد: ${message.subject}`,
      body: "",
      related_request_id: message.related_request_number || (message.related_request_id ? String(message.related_request_id) : "")
    });
    setAttachments([]);
    setRecipientSearch("");
    setComposeAiOpen(false);
    setDepartmentBroadcastOpen(false);
    openMailbox("compose");
    window.requestAnimationFrame(() => bodyRef.current?.focus());
  }

  function cancelReply() {
    setReplySource(null);
    setForm({ recipient_ids: [], message_type: messageSettings.default_message_type || defaultMessageType, priority: messageSettings.default_priority || "normal", classification_code: defaultMessageClassification, subject: "", body: "", related_request_id: "" });
    setSelectedDepartmentIds([]);
    setDepartmentRecipientIds([]);
    setRecipientSearch("");
    setDepartmentBroadcastOpen(false);
  }

  function startNewMessage() {
    if (!messageSettings.enabled) {
      setError("نظام المراسلات غير مفعل من إعدادات المراسلات.");
      return;
    }
    setMailPanelCollapsed(true);
    window.dispatchEvent(new CustomEvent("qib-sidebar-collapse", { detail: { collapsed: true } }));
    setForm({ recipient_ids: [], message_type: messageSettings.default_message_type || defaultMessageType, priority: messageSettings.default_priority || "normal", classification_code: defaultMessageClassification, subject: "", body: "", related_request_id: "" });
    setSelectedTemplateKey("");
    setSelectedDepartmentIds([]);
    setDepartmentRecipientIds([]);
    setAttachments([]);
    setRecipientSearch("");
    setEditingDraftId(null);
    setForwardSource(null);
    setReplySource(null);
    setComposeAiOpen(false);
    setDepartmentBroadcastOpen(false);
    openMailbox("compose");
    window.requestAnimationFrame(() => bodyRef.current?.focus());
  }

  function editDraft(message: InternalMessage) {
    setEditingDraftId(message.id);
    setSelectedTemplateKey("");
    setForwardSource(null);
    setReplySource(null);
    setSelectedDepartmentIds([]);
    setDepartmentRecipientIds([]);
    setForm({
      recipient_ids: message.recipient_ids || [],
      message_type: message.message_type || defaultMessageType,
      priority: message.priority || "normal",
      classification_code: message.classification_code || defaultMessageClassification,
      subject: message.subject,
      body: message.body,
      related_request_id: message.related_request_number || (message.related_request_id ? String(message.related_request_id) : "")
    });
    setAttachments([]);
    setRecipientSearch("");
    setComposeAiOpen(false);
    setDepartmentBroadcastOpen(false);
    openMailbox("compose");
    window.requestAnimationFrame(() => bodyRef.current?.focus());
  }

  async function deleteDraft(message: InternalMessage) {
    setFeedback("");
    setError("");
    try {
      await apiFetch<void>(`/messages/drafts/${message.id}`, { method: "DELETE" });
      setMessages((current) => current.filter((item) => item.id !== message.id));
      setSelectedId(null);
      if (editingDraftId === message.id) {
        startNewMessage();
      }
      setFeedback("تم حذف المسودة.");
    } catch {
      setError("تعذر حذف المسودة.");
    }
  }

  function addRecipient(userId: number) {
    if (!messageSettings.allow_multiple_recipients && form.recipient_ids.length > 0 && !form.recipient_ids.includes(userId)) {
      setForm((current) => ({ ...current, recipient_ids: [userId] }));
      setRecipientSearch("");
      return;
    }
    if (!form.recipient_ids.includes(userId) && form.recipient_ids.length >= messageSettings.max_recipients) {
      setError(`عدد المستلمين أكبر من الحد المسموح ${messageSettings.max_recipients}`);
      return;
    }
    setForm((current) => ({
      ...current,
      recipient_ids: current.recipient_ids.includes(userId) ? current.recipient_ids : [...current.recipient_ids, userId]
    }));
    setRecipientSearch("");
  }

  function applyDepartmentRecipients(nextDepartmentIds: number[]) {
    const departmentUsers = users.filter((user) => user.department_id && nextDepartmentIds.includes(user.department_id));
    const ids =
      messageSettings.department_recipient_behavior === "department_manager_only"
        ? departmentUsers.filter((user) => user.department_manager_id === user.id).map((user) => user.id)
        : departmentUsers.map((user) => user.id);
    if (!messageSettings.allow_multiple_recipients && ids.length > 1) {
      setError("اختيار أكثر من مستلم غير مفعل من إعدادات المراسلات.");
      return;
    }
    if (ids.length > messageSettings.max_recipients) {
      setError(`عدد مستلمي الإدارات أكبر من الحد المسموح ${messageSettings.max_recipients}`);
      return;
    }
    setForm((current) => ({
      ...current,
      recipient_ids: Array.from(new Set([...current.recipient_ids.filter((id) => !departmentRecipientIds.includes(id)), ...ids])),
      message_type: ids.length ? "circular" : current.message_type
    }));
    setSelectedDepartmentIds(nextDepartmentIds);
    setDepartmentRecipientIds(ids);
  }

  function toggleDepartmentRecipients(departmentId: number) {
    const nextDepartmentIds = selectedDepartmentIds.includes(departmentId)
      ? selectedDepartmentIds.filter((id) => id !== departmentId)
      : [...selectedDepartmentIds, departmentId];
    applyDepartmentRecipients(nextDepartmentIds);
  }

  function clearDepartmentRecipients() {
    applyDepartmentRecipients([]);
  }

  function departmentRecipientBehaviorText() {
    if (messageSettings.department_recipient_behavior === "department_manager_only") {
      return "عند اختيار إدارة سيتم إضافة مدير الإدارة فقط إلى المستلمين.";
    }
    if (messageSettings.department_recipient_behavior === "all_department_users") {
      return "عند اختيار إدارة سيتم إضافة كل المستخدمين النشطين في هذه الإدارة إلى المستلمين.";
    }
    return "عند اختيار إدارة سيتم إضافة مستخدميها إلى المستلميِن، ويمكنك إزالة أي مستلم لا تريده قبل الإرسال.";
  }

  function removeRecipient(userId: number) {
    setForm((current) => ({ ...current, recipient_ids: current.recipient_ids.filter((id) => id !== userId) }));
  }

  function removeAttachment(index: number) {
    setAttachments((current) => current.filter((_, itemIndex) => itemIndex !== index));
  }

  function addAttachments(files: FileList | null) {
    if (!files) return;
    const incoming = Array.from(files);
    const allowed = new Set((messageSettings.allowed_extensions || []).map((item) => item.toLowerCase().replace(/^\./, "")));
    const blocked = new Set(["exe", "bat", "cmd", "ps1", "sh", "js", "vbs", "msi"]);
    const maxBytes = Number(messageSettings.max_attachment_mb || 25) * 1024 * 1024;
    const validFiles: File[] = [];
    for (const file of incoming) {
      const extension = file.name.split(".").pop()?.toLowerCase() || "";
      if (!extension || !allowed.has(extension)) {
        setError(`نوع الملف غير مسموح: ${file.name}`);
        continue;
      }
      if (messageSettings.block_executable_files && blocked.has(extension)) {
        setError("لا يمكن إرفاق ملفات تنفيذية.");
        continue;
      }
      if (file.size > maxBytes) {
        setError(`حجم ${file.name} أكبر من الحد المسموح ${messageSettings.max_attachment_mb}MB`);
        continue;
      }
      validFiles.push(file);
    }
    if (validFiles.length === 0) return;
    setAttachments((current) => {
      const availableSlots = Math.max(Number(messageSettings.max_attachments_per_message || 10) - current.length, 0);
      if (validFiles.length > availableSlots) {
        setError(`أقصى عدد مرفقات للرسالة هو ${messageSettings.max_attachments_per_message}`);
      }
      return [...current, ...validFiles.slice(0, availableSlots)];
    });
  }

  function updateBody(nextBody: string) {
    setForm((current) => ({ ...current, body: nextBody }));
    window.requestAnimationFrame(() => {
      if (bodyRef.current && bodyRef.current.innerHTML !== nextBody) {
        bodyRef.current.innerHTML = nextBody;
      }
      bodyRef.current?.focus();
    });
  }

  function applyAiDraft(draft: { subject?: string; body?: string }) {
    setForm((current) => ({
      ...current,
      subject: draft.subject || current.subject,
      body: draft.body || current.body
    }));
    if (draft.body) updateBody(textToHtml(draft.body));
  }

  function applyAiBody(body: string) {
    updateBody(textToHtml(body));
  }

  async function suggestAiReply(message: InternalMessage) {
    if (!canUseAiReplies) return;
    setSelectedAiError("");
    setSelectedAiSuggestion(null);
    setSelectedAiLoading("reply");
    try {
      const data = await apiFetch<{ body: string }>("/ai/messages/suggest-reply", {
        method: "POST",
        body: JSON.stringify({ message_id: message.id })
      });
      setSelectedAiSuggestion({ type: "reply", body: data.body || "" });
    } catch (error) {
      setSelectedAiError(readApiError(error));
    } finally {
      setSelectedAiLoading("");
    }
  }

  function useAiReply(message: InternalMessage, body: string) {
    beginReply(message);
    window.requestAnimationFrame(() => updateBody(textToHtml(body)));
  }

  function syncEditorBody() {
    const html = bodyRef.current?.innerHTML || "";
    setForm((current) => ({ ...current, body: html }));
  }

  function editorCommand(command: string, value?: string) {
    bodyRef.current?.focus();
    document.execCommand(command, false, value);
    syncEditorBody();
  }

  function insertHtml(html: string) {
    bodyRef.current?.focus();
    document.execCommand("insertHTML", false, html);
    syncEditorBody();
  }

  function changeFontSize(size: "small" | "normal" | "large" | "x-large") {
    const labels = { small: "0.875rem", normal: "1rem", large: "1.25rem", "x-large": "1.5rem" };
    bodyRef.current?.focus();
    document.execCommand("fontSize", false, "4");
    bodyRef.current?.querySelectorAll('font[size="4"]').forEach((node) => {
      const span = document.createElement("span");
      span.style.fontSize = labels[size];
      span.innerHTML = node.innerHTML;
      node.replaceWith(span);
    });
    syncEditorBody();
  }

  function prefixLines(prefix: string, placeholder = "النص") {
    if (prefix === "# ") return editorCommand("formatBlock", "h1");
    if (prefix === "## ") return editorCommand("formatBlock", "h2");
    if (prefix === "> ") return editorCommand("formatBlock", "blockquote");
    insertHtml(placeholder);
  }

  function alignSelection(direction: "right" | "center" | "left") {
    const commands = { right: "justifyRight", center: "justifyCenter", left: "justifyLeft" };
    editorCommand(commands[direction]);
  }

  function insertList(ordered = false) {
    editorCommand(ordered ? "insertOrderedList" : "insertUnorderedList");
  }

  function insertTaskList() {
    insertHtml('<ul><li><input type="checkbox" disabled> المهمة الأولى</li><li><input type="checkbox" disabled> المهمة الثانية</li></ul>');
  }

  function insertDivider() {
    editorCommand("insertHorizontalRule");
  }

  function insertLink() {
    const url = window.prompt("أدخل الرابط", "https://");
    if (!url) return;
    editorCommand("createLink", url);
  }

  function insertSignature() {
    if (!signatureText.trim()) {
      setSignatureOpen(true);
      setFeedback("أضف توقيعك أولاً ثم اضغط إدراج التوقيع.");
      return;
    }
    insertHtml(`<br><br>${escapeHtml(signatureText.trim()).replace(/\n/g, "<br>")}<br>`);
  }

  function undoText() {
    bodyRef.current?.focus();
    document.execCommand("undo");
    window.requestAnimationFrame(() => {
      syncEditorBody();
    });
  }

  function redoText() {
    bodyRef.current?.focus();
    document.execCommand("redo");
    window.requestAnimationFrame(() => {
      syncEditorBody();
    });
  }

  function clearFormatting() {
    editorCommand("removeFormat");
  }

  return (
    <div className="space-y-4">
      {(error || feedback) && (
        <div className={`rounded-md border p-3 text-sm ${error ? "border-red-200 bg-red-50 text-red-700" : "border-emerald-200 bg-emerald-50 text-emerald-700"}`}>
          {error || feedback}
        </div>
      )}
      {!messageSettings.enabled && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm font-bold text-amber-900">
          نظام المراسلات غير مفعل من إعدادات المراسلات. يمكنك مراجعة الإعدادات أو تفعيله من شاشة إعدادات المراسلات.
        </div>
      )}

      <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <p className="text-sm font-black text-bank-700">{messageSettings.module_name_ar || "المراسلات الداخلية"}</p>
            <h2 className="mt-1 text-2xl font-black text-slate-950">{mailboxTitle(mailbox)}</h2>
          </div>
          <div className="grid gap-2 md:grid-cols-[minmax(240px,1fr)_180px_150px_auto_auto] xl:w-[min(100%,62rem)]">
            <div className="relative">
              <Search className="pointer-events-none absolute right-3 top-3 h-4 w-4 text-slate-400" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                onKeyDown={(event) => event.key === "Enter" && loadMessages(mailbox)}
                placeholder="بحث في المراسلات"
                className="h-11 w-full rounded-md border border-slate-300 bg-white pr-9 pl-3 text-sm outline-none focus:border-bank-600 focus:ring-2 focus:ring-bank-100"
                disabled={mailbox === "compose"}
              />
            </div>
            <select
              value={typeFilter}
              onChange={(event) => setTypeFilter(event.target.value)}
              disabled={mailbox === "compose" || mailbox === "official" || mailbox === "clarifications"}
              className="h-11 rounded-md border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 outline-none focus:border-bank-600 focus:ring-2 focus:ring-bank-100 disabled:opacity-60"
              title="نوع الرسالة"
            >
              <option value="">نوع الرسالة</option>
              {messageTypeOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <select
              value={priorityFilter}
              onChange={(event) => setPriorityFilter(event.target.value)}
              disabled={mailbox === "compose"}
              className="h-11 rounded-md border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 outline-none focus:border-bank-600 focus:ring-2 focus:ring-bank-100 disabled:opacity-60"
              title="الأولوية"
            >
              <option value="">الأولوية</option>
              <option value="normal">عادية</option>
              <option value="high">مرتفعة</option>
              <option value="urgent">عاجلة</option>
            </select>
            <button
              type="button"
              onClick={() => loadMessages(mailbox)}
              disabled={isLoading || mailbox === "compose"}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-4 text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <RefreshCw className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
              تحديث
            </button>
            <button
              type="button"
              onClick={startNewMessage}
              disabled={!messageSettings.enabled}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-md border-2 border-bank-700 bg-white px-4 text-sm font-black text-bank-700 hover:bg-bank-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <SendHorizonal className="h-4 w-4" />
              رسالة جديدة
            </button>
          </div>
        </div>
        {messageSettings.enable_unread_badge && (
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs font-bold text-slate-500">
            <button type="button" onClick={() => openMailbox("unread")} className="rounded-full bg-bank-50 px-3 py-1 text-bank-800 hover:bg-bank-100">
              غير المقروء: {unreadCount}
            </button>
            {typeFilter && mailbox !== "official" && mailbox !== "clarifications" && <span className="rounded-full bg-slate-100 px-3 py-1">فلتر التصنيف مفعل</span>}
            {priorityFilter && <span className="rounded-full bg-slate-100 px-3 py-1">فلتر الأولوية مفعل</span>}
          </div>
        )}

      </div>

      <section className={`grid gap-5 ${mailPanelCollapsed ? "xl:grid-cols-[84px_1fr]" : "xl:grid-cols-[380px_1fr]"}`}>
        <div className="space-y-4">
          <div className={`rounded-lg border border-slate-200 bg-white p-2 shadow-sm ${mailPanelCollapsed ? "space-y-2" : "grid grid-cols-2 gap-2 md:grid-cols-4"}`}>
            <button
              type="button"
              onClick={() => setMailPanelCollapsed((value) => !value)}
              className={`flex h-10 items-center justify-center gap-2 rounded-md border border-slate-200 bg-slate-50 text-sm font-bold text-slate-700 hover:bg-bank-50 hover:text-bank-800 ${mailPanelCollapsed ? "w-full" : "col-span-2 md:col-span-4"}`}
              title={mailPanelCollapsed ? "إظهار صناديق المراسلات" : "طي صناديق المراسلات"}
            >
              {mailPanelCollapsed ? <ChevronLeft className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              {!mailPanelCollapsed && "طي القائمة"}
            </button>
            <Tab collapsed={mailPanelCollapsed} active={mailbox === "inbox"} onClick={() => openMailbox("inbox")} icon={Inbox} label="الوارد" />
            <Tab collapsed={mailPanelCollapsed} active={mailbox === "sent"} onClick={() => openMailbox("sent")} icon={Send} label="الصادر" />
            <Tab collapsed={mailPanelCollapsed} active={mailbox === "unread"} onClick={() => openMailbox("unread")} icon={MailOpen} label={`غير المقروءة${unreadCount ? ` (${unreadCount})` : ""}`} />
            {messageSettings.enable_linked_requests && <Tab collapsed={mailPanelCollapsed} active={mailbox === "request-linked"} onClick={() => openMailbox("request-linked")} icon={Link} label="مرتبطة بالطلبات" />}
            <Tab collapsed={mailPanelCollapsed} active={mailbox === "official"} onClick={() => openMailbox("official")} icon={FileText} label="الرسمية" />
            <Tab collapsed={mailPanelCollapsed} active={mailbox === "clarifications"} onClick={() => openMailbox("clarifications")} icon={Quote} label="طلبات الاستيضاح" />
            {messageSettings.enable_drafts && <Tab collapsed={mailPanelCollapsed} active={mailbox === "drafts"} onClick={() => openMailbox("drafts")} icon={Save} label="المسودات" />}
            <Tab collapsed={mailPanelCollapsed} active={mailbox === "compose"} onClick={startNewMessage} icon={SendHorizonal} label="رسالة جديدة" featured disabled={!messageSettings.enabled} />
          </div>
          <button type="button" onClick={() => loadMessages(mailbox)} disabled={isLoading || mailbox === "compose"} className="flex h-10 w-full items-center justify-center gap-2 rounded-md border border-slate-200 bg-white text-sm font-semibold text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60" title="تحديث">
            <RefreshCw className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
            {!mailPanelCollapsed && "تحديث"}
          </button>
          {messageSettings.allow_archiving && (
            <button type="button" onClick={() => openMailbox("archived")} className={`flex h-10 w-full items-center justify-center gap-2 rounded-md border text-sm font-semibold ${mailbox === "archived" ? "border-bank-200 bg-bank-50 text-bank-700" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"}`} title="الأرشيف">
              <Archive className="h-4 w-4" />
              {!mailPanelCollapsed && "الأرشيف"}
            </button>
          )}

          {mailbox !== "compose" && !mailPanelCollapsed && (
            <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
              <div className="space-y-3 border-b border-slate-200 p-4">
                {mailbox === "archived" && (
                  <div className="grid grid-cols-2 gap-2 rounded-md bg-slate-100 p-1">
                    <button
                      type="button"
                      onClick={() => setArchiveView("inbox")}
                      className={`h-9 rounded-md text-sm font-bold ${archiveView === "inbox" ? "bg-white text-bank-700 shadow-sm" : "text-slate-600 hover:bg-white/60"}`}
                    >
                      وارد مؤرشف
                    </button>
                    <button
                      type="button"
                      onClick={() => setArchiveView("sent")}
                      className={`h-9 rounded-md text-sm font-bold ${archiveView === "sent" ? "bg-white text-bank-700 shadow-sm" : "text-slate-600 hover:bg-white/60"}`}
                    >
                      مرسل مؤرشف
                    </button>
                  </div>
                )}
                <div className="grid gap-2 md:grid-cols-[1fr_auto]">
                  <div className="relative">
                    <Search className="pointer-events-none absolute right-3 top-2.5 h-4 w-4 text-slate-400" />
                    <input value={search} onChange={(event) => setSearch(event.target.value)} onKeyDown={(event) => event.key === "Enter" && loadMessages(mailbox)} placeholder="بحث في الرسائل أو معرف الرسالة" className="h-10 w-full rounded-md border border-slate-300 bg-white pr-9 pl-3 text-sm outline-none focus:border-bank-600 focus:ring-2 focus:ring-bank-100" />
                  </div>
                  <button
                    type="button"
                    onClick={() => setFiltersOpen((value) => !value)}
                    className={`flex h-10 items-center justify-center gap-2 rounded-md border px-3 text-sm font-bold ${filtersOpen ? "border-bank-300 bg-bank-50 text-bank-800" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"}`}
                    title="فلاتر البحث"
                  >
                    <Filter className="h-4 w-4" />
                    فلترة
                  </button>
                </div>
                {filtersOpen && (
                  <div className="space-y-3 rounded-md border border-slate-200 bg-slate-50 p-3">
                    <select
                      value={typeFilter}
                      onChange={(event) => setTypeFilter(event.target.value)}
                      disabled={mailbox === "official" || mailbox === "clarifications"}
                      className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 outline-none focus:border-bank-600 focus:ring-2 focus:ring-bank-100"
                    >
                      <option value="">كل التصنيفات</option>
                      {messageTypeOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                    <select
                      value={priorityFilter}
                      onChange={(event) => setPriorityFilter(event.target.value)}
                      className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 outline-none focus:border-bank-600 focus:ring-2 focus:ring-bank-100"
                    >
                      <option value="">كل الأولويات</option>
                      <option value="normal">عادية</option>
                      <option value="high">مرتفعة</option>
                      <option value="urgent">عاجلة</option>
                    </select>
                    {mailbox === "inbox" && (
                  <select
                    value={senderFilter}
                    onChange={(event) => setSenderFilter(event.target.value)}
                    className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 outline-none focus:border-bank-600 focus:ring-2 focus:ring-bank-100"
                  >
                    <option value="">كل المرسلين</option>
                    {users.map((user) => (
                      <option key={user.id} value={user.id}>
                        {user.full_name_ar}
                      </option>
                    ))}
                  </select>
                    )}
                    <div className="grid gap-2 md:grid-cols-3">
                      <input value={relatedRequestFilter} onChange={(event) => setRelatedRequestFilter(event.target.value)} placeholder="رقم الطلب المرتبط" className="h-10 rounded-md border border-slate-300 bg-white px-3 text-sm outline-none focus:border-bank-600 focus:ring-2 focus:ring-bank-100" />
                      <input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} className="h-10 rounded-md border border-slate-300 bg-white px-3 text-sm outline-none focus:border-bank-600 focus:ring-2 focus:ring-bank-100" />
                      <input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} className="h-10 rounded-md border border-slate-300 bg-white px-3 text-sm outline-none focus:border-bank-600 focus:ring-2 focus:ring-bank-100" />
                    </div>
                    {mailbox === "inbox" && (
                      <label className="flex items-center gap-2 text-sm font-semibold text-slate-600">
                        <input type="checkbox" checked={unreadOnly} onChange={(event) => setUnreadOnly(event.target.checked)} />
                        غير المقروء فقط
                      </label>
                    )}
                    <div className="flex flex-wrap gap-2">
                      <button type="button" onClick={() => loadMessages(mailbox)} className="h-9 rounded-md bg-bank-700 px-3 text-xs font-bold text-white hover:bg-bank-800">تطبيق الفلاتر</button>
                      <button
                        type="button"
                        onClick={() => {
                          setSearch("");
                          setTypeFilter("");
                          setPriorityFilter("");
                          setSenderFilter("");
                          setRelatedRequestFilter("");
                          setDateFrom("");
                          setDateTo("");
                          setUnreadOnly(false);
                          window.requestAnimationFrame(() => loadMessages(mailbox));
                        }}
                        className="h-9 rounded-md border border-slate-300 bg-white px-3 text-xs font-bold text-slate-700 hover:bg-slate-50"
                      >
                        مسح الفلاتر
                      </button>
                    </div>
                  </div>
                )}
              </div>
              {messages.length > 0 && (
                <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 bg-slate-50 px-4 py-3">
                  <label className="flex items-center gap-2 text-xs font-bold text-slate-600">
                    <input type="checkbox" checked={messages.length > 0 && messages.every((message) => selectedIds.includes(message.id))} onChange={toggleAllVisibleMessages} />
                    تحديد الظاهر
                  </label>
                  <span className="text-xs font-semibold text-slate-500">المحدد: {selectedIds.length}</span>
                  {mailbox !== "drafts" && (
                    <>
                      {messageSettings.allow_archiving && <button type="button" onClick={bulkArchive} disabled={selectedIds.length === 0} className="h-8 rounded-md border border-slate-300 bg-white px-3 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50">أرشفة</button>}
                      {messageSettings.allow_user_delete_own_messages && <button type="button" onClick={bulkDeleteMessages} disabled={selectedIds.length === 0} className="h-8 rounded-md border border-red-200 bg-white px-3 text-xs font-bold text-red-700 hover:bg-red-50 disabled:opacity-50">حذف</button>}
                      {mailbox === "inbox" && <button type="button" onClick={bulkMarkRead} disabled={selectedIds.length === 0} className="h-8 rounded-md border border-slate-300 bg-white px-3 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50">تعليم كمقروء</button>}
                    </>
                  )}
                  {mailbox === "drafts" && <button type="button" onClick={bulkDeleteDrafts} disabled={selectedIds.length === 0} className="h-8 rounded-md border border-red-200 bg-white px-3 text-xs font-bold text-red-700 hover:bg-red-50 disabled:opacity-50">حذف المسودات</button>}
                </div>
              )}
              <div className="max-h-[680px] overflow-y-auto">
                {messages.length === 0 && <p className="p-5 text-sm text-slate-500">لا توجد رسائل لعرضها حالياً.</p>}
                {inboxStyleGroups ? (
                  <>
                    {inboxStyleGroups.unread.length > 0 && (
                      <MessageSection
                        title="رسائل جديدة"
                        count={inboxStyleGroups.unread.length}
                        messages={inboxStyleGroups.unread}
                        messageTypeOptions={messageTypeOptions}
                        messageClassificationOptions={messageClassificationOptions}
                        selectedIds={selectedIds}
                        selectedId={selected?.id ?? null}
                        mailbox={mailbox}
                        archiveView={archiveView}
                        showUnreadBadge={messageSettings.enable_unread_badge}
                        onSelect={selectMessage}
                        onToggleSelection={toggleMessageSelection}
                      />
                    )}
                    {inboxStyleGroups.read.length > 0 && (
                      <MessageSection
                        title="رسائل مفتوحة"
                        count={inboxStyleGroups.read.length}
                        messages={inboxStyleGroups.read}
                        messageTypeOptions={messageTypeOptions}
                        messageClassificationOptions={messageClassificationOptions}
                        selectedIds={selectedIds}
                        selectedId={selected?.id ?? null}
                        mailbox={mailbox}
                        archiveView={archiveView}
                        showUnreadBadge={messageSettings.enable_unread_badge}
                        onSelect={selectMessage}
                        onToggleSelection={toggleMessageSelection}
                      />
                    )}
                  </>
                ) : (
                  messages.map((message) => <MessageListItem key={message.id} message={message} messageTypeOptions={messageTypeOptions} messageClassificationOptions={messageClassificationOptions} selectedIds={selectedIds} selectedId={selected?.id ?? null} mailbox={mailbox} archiveView={archiveView} showUnreadBadge={messageSettings.enable_unread_badge} onSelect={selectMessage} onToggleSelection={toggleMessageSelection} />)
                )}
                {hasMore && (
                  <div className="p-4">
                    <button type="button" onClick={() => loadMessages(mailbox, "append")} disabled={isLoading} className="h-10 w-full rounded-md border border-slate-300 bg-white text-sm font-semibold text-slate-700 hover:bg-slate-50">
                      تحميل المزيد
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {mailbox === "compose" ? (
          <form onSubmit={submit} className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-200 bg-slate-50 px-5 py-4">
              <div>
                <h3 className="text-lg font-bold text-slate-950">{replySource ? "رد على رسالة" : forwardSource ? "تحويل رسالة" : editingDraftId ? "تحرير مسودة" : "رسالة جديدة"}</h3>
                <p className="mt-1 text-xs text-slate-500">
                  {replySource ? `اكتب ردك على: ${replySource.subject}` : forwardSource ? `سيتم تضمين الرسالة الأصلية: ${forwardSource.subject}` : editingDraftId ? "أكمل المسودة ثم احفظها أو أرسلها." : "اكتب رسالة داخلية مع مستلمين ومرفقات وربط اختياري بطلب."}
                </p>
              </div>
            </div>

            <div className="divide-y divide-slate-100">
              {forwardSource && (
                <div className="border-b border-amber-100 bg-amber-50 px-5 py-3 text-sm text-amber-900">
                  <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
                    <span className="font-bold">وضع التحويل مفعّل: اختر المستلمين واكتب ملاحظة اختيارية، وسيتم إرفاق نص الرسالة الأصلية تلقائياً.</span>
                    <button type="button" onClick={cancelForward} className="self-start rounded-md border border-amber-200 bg-white px-3 py-1 text-xs font-bold text-amber-900 hover:bg-amber-100 lg:self-auto">
                      إلغاء التحويل
                    </button>
                  </div>
                </div>
              )}
              {replySource && (
                <div className="border-b border-sky-100 bg-sky-50 px-5 py-3 text-sm text-sky-900">
                  <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
                    <span className="font-bold">وضع الرد مفعّل: اكتب الرد بنفس أدوات إنشاء الرسائل. سيتم الإرسال إلى أطراف المحادثة تلقائياً.</span>
                    <button type="button" onClick={cancelReply} className="self-start rounded-md border border-sky-200 bg-white px-3 py-1 text-xs font-bold text-sky-900 hover:bg-sky-100 lg:self-auto">
                      إلغاء الرد
                    </button>
                  </div>
                </div>
              )}
              {editingDraftId && !replySource && !forwardSource && (
                <div className="border-b border-bank-100 bg-bank-50 px-5 py-3 text-sm text-bank-900">
                  <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
                    <span className="font-bold">أنت تعدل مسودة محفوظة. يمكنك حفظ التغييرات أو إرسالها كرسالة نهائية.</span>
                    <button type="button" onClick={startNewMessage} className="self-start rounded-md border border-bank-200 bg-white px-3 py-1 text-xs font-bold text-bank-900 hover:bg-bank-100 lg:self-auto">
                      رسالة جديدة
                    </button>
                  </div>
                </div>
              )}
              <div className="p-5">
                <div className="grid gap-4">
                  <div className="space-y-3">
                    <div className="grid gap-3 lg:grid-cols-[220px_170px_190px_1fr]">
                      <label className="block space-y-2 text-sm font-bold text-slate-700">
                        تصنيف الرسالة
                        <select
                          value={form.message_type}
                          onChange={(event) => setForm({ ...form, message_type: event.target.value })}
                          className="h-12 w-full rounded-md border border-slate-200 bg-white px-3 text-sm font-semibold outline-none focus:border-bank-600 focus:ring-2 focus:ring-bank-100"
                        >
                          {usableMessageTypeOptions.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="block space-y-2 text-sm font-bold text-slate-700">
                        الأولوية
                        <select
                          value={form.priority}
                          onChange={(event) => setForm({ ...form, priority: event.target.value })}
                          className="h-12 w-full rounded-md border border-slate-200 bg-white px-3 text-sm font-semibold outline-none focus:border-bank-600 focus:ring-2 focus:ring-bank-100"
                        >
                          <option value="normal">عادية</option>
                          <option value="high">مرتفعة</option>
                          <option value="urgent">عاجلة</option>
                        </select>
                      </label>
                      <label className="block space-y-2 text-sm font-bold text-slate-700">
                        تصنيف السرية
                        <select
                          value={form.classification_code}
                          onChange={(event) => setForm({ ...form, classification_code: event.target.value })}
                          className="h-12 w-full rounded-md border border-slate-200 bg-white px-3 text-sm font-semibold outline-none focus:border-bank-600 focus:ring-2 focus:ring-bank-100"
                        >
                          {messageClassificationOptions.map((option) => (
                            <option key={option.code} value={option.code}>
                              {option.name_ar}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="block space-y-2 text-sm font-bold text-slate-700">
                        الموضوع
                        <input
                          value={form.subject}
                          onChange={(event) => setForm({ ...form, subject: event.target.value })}
                          required
                          placeholder="الموضوع"
                          className="h-12 w-full rounded-md border border-slate-200 bg-white px-3 text-base font-semibold outline-none focus:border-bank-600 focus:ring-2 focus:ring-bank-100"
                        />
                      </label>
                    </div>
                    {selectedFormClassification?.restricted_access && (
                      <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-900">
                        تم اختيار تصنيف سري. ستظهر الرسالة فقط للأطراف المصرح لهم، وقد يتم تسجيل تنزيل المرفقات حسب إعدادات التصنيف.
                      </div>
                    )}
                    {(requestLinkRequired || requestLinkingBlocked || attachmentRequired || form.related_request_id.trim()) && (
                      <div className={`rounded-md border px-4 py-3 text-sm font-bold ${requestLinkingBlocked ? "border-red-200 bg-red-50 text-red-700" : "border-amber-200 bg-amber-50 text-amber-900"}`}>
                        {requestLinkingBlocked ? (
                          "ربط المراسلات بالطلبات غير مفعل حالياً، لذلك لا يمكن إرسال رسالة مرتبطة بطلب."
                        ) : (
                          <div className="space-y-1">
                            {form.related_request_id.trim() && <p>الطلب المرتبط: {form.related_request_id}</p>}
                            {requestLinkRequired && <p>{selectedFormMessageType?.requires_request ? "هذا التصنيف يتطلب طلباً مرتبطاً." : "المراسلات العامة غير مفعلة، لذلك يجب إرسال الرسالة من داخل طلب."}</p>}
                            {attachmentRequired && <p>هذا التصنيف يتطلب مرفقاً قبل الإرسال.</p>}
                          </div>
                        )}
                      </div>
                    )}
                    {replySource ? (
                      <div className="rounded-md border border-sky-100 bg-sky-50 px-4 py-3 text-sm leading-6 text-sky-900">
                        <p className="font-bold">سيتم الرد على أطراف المحادثة تلقائياً</p>
                      <p className="text-xs text-sky-700">الرسالة الأصلية من: {replySource.sender_name}</p>
                      </div>
                    ) : (
                      <>
                      {!messageSettings.allow_send_to_user && !messageSettings.allow_send_to_department && (
                        <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-900">
                          تم تعطيل اختيار المستلمين من إعدادات المراسلات.
                        </div>
                      )}
                      {messageSettings.allow_send_to_user && <div className="rounded-md border border-slate-200 bg-white">
                        <div className="flex min-h-12 flex-wrap items-center gap-2 px-3 py-2">
                          <span className="shrink-0 text-sm font-bold text-slate-700">إلى</span>
                          {selectedRecipients.map((user) => (
                            <span key={user.id} className="inline-flex max-w-full items-center gap-2 rounded-full bg-bank-50 px-3 py-1 text-xs font-bold text-bank-800">
                              <span className="max-w-[220px] truncate">{user.full_name_ar}</span>
                              <button type="button" onClick={() => removeRecipient(user.id)} className="text-bank-700 hover:text-red-600" aria-label={`إزالة ${user.full_name_ar}`}>
                                <X className="h-3.5 w-3.5" />
                              </button>
                            </span>
                          ))}
                          <input
                            value={recipientSearch}
                            onChange={(event) => setRecipientSearch(event.target.value)}
                            placeholder={selectedRecipients.length ? "إضافة مستلم" : "اكتب اسم المستلم أو البريد"}
                            className="min-w-[220px] flex-1 border-0 bg-transparent px-2 py-1 text-sm outline-none"
                          />
                        </div>
                        {(recipientSearch || selectedRecipients.length === 0) && (
                          <div className="max-h-56 overflow-y-auto border-t border-slate-100 bg-slate-50 p-2">
                            {isUsersLoading && <p className="p-3 text-sm text-slate-500">جار تحميل المستلمين...</p>}
                            {!isUsersLoading && usersError && <p className="rounded-md bg-red-50 p-3 text-sm text-red-700">{usersError}</p>}
                            {!isUsersLoading && !usersError && recipientSuggestions.length === 0 && <p className="p-3 text-sm text-slate-500">لا توجد نتائج مطابقة.</p>}
                            {recipientSuggestions.map((user) => (
                              <button key={user.id} type="button" onClick={() => addRecipient(user.id)} className="flex w-full items-center justify-between gap-3 rounded-md bg-white px-3 py-2 text-right text-sm hover:bg-bank-50">
                                <span className="min-w-0">
                                  <span className="block truncate font-bold text-slate-800">{user.full_name_ar}</span>
                                  <span className="block truncate text-xs text-slate-500">{user.email}</span>
                                </span>
                                <UserPlus className="h-4 w-4 shrink-0 text-bank-700" />
                              </button>
                            ))}
                          </div>
                        )}
                      </div>}
                      {messageSettings.allow_send_to_department && messageSettings.allow_multiple_recipients && messageSettings.enable_circulars && messageSettings.enable_department_broadcasts && messageCapabilities.can_send_department_broadcast && (
                        <div className="rounded-md border border-bank-100 bg-bank-50/60 p-3">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <button
                              type="button"
                              onClick={() => setDepartmentBroadcastOpen((value) => !value)}
                              className="inline-flex h-9 items-center gap-2 rounded-md border border-bank-100 bg-white px-3 text-xs font-bold text-bank-800 hover:bg-bank-50"
                              aria-expanded={departmentBroadcastOpen}
                            >
                              {departmentBroadcastOpen ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
                              تعميم حسب الإدارات
                              {selectedDepartmentIds.length > 0 && (
                                <span className="rounded-full bg-bank-100 px-2 py-0.5 text-[11px] text-bank-800">
                                  {selectedDepartmentIds.length.toLocaleString("ar")} محددة
                                </span>
                              )}
                            </button>
                            {departmentBroadcastOpen && (
                              <button type="button" onClick={clearDepartmentRecipients} disabled={selectedDepartmentIds.length === 0} className="h-8 rounded-md border border-slate-200 bg-white px-3 text-xs font-bold text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50">
                                مسح الإدارات
                              </button>
                            )}
                          </div>
                          {departmentBroadcastOpen && (
                            <>
                              <div className="mt-3 grid max-h-40 gap-2 overflow-y-auto rounded-md border border-slate-200 bg-white p-2 sm:grid-cols-2">
                                {departmentOptions.map((department) => (
                                  <label key={department.id} className={`flex cursor-pointer items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm font-bold ${selectedDepartmentIds.includes(department.id) ? "border-bank-200 bg-bank-50 text-bank-800" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"}`}>
                                    <span className="truncate">{department.name}</span>
                                    <input
                                      type="checkbox"
                                      checked={selectedDepartmentIds.includes(department.id)}
                                      onChange={() => toggleDepartmentRecipients(department.id)}
                                      className="h-4 w-4 shrink-0"
                                    />
                                  </label>
                                ))}
                                {departmentOptions.length === 0 && <p className="p-2 text-xs text-slate-500">لا توجد إدارات متاحة ضمن قائمة المستلمين.</p>}
                              </div>
                              <p className="mt-2 text-xs leading-5 text-slate-500">
                                {departmentRecipientBehaviorText()} يمكنك اختيار أكثر من إدارة، وسيتم إبقاء المستلمين الذين أضفتهم يدوياً.
                              </p>
                            </>
                          )}
                        </div>
                      )}
                      </>
                    )}

                  </div>
                </div>
              </div>

              {canUseAiDrafting && (
                <div className="border-t border-slate-100 bg-slate-50/70 px-5 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-black text-slate-800">المساعد الذكي</p>
                      <p className="mt-1 text-xs text-slate-500">اختياري، افتحه فقط عند الحاجة لصياغة أو تحسين الرسالة.</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setComposeAiOpen((value) => !value)}
                      className="inline-flex h-10 items-center gap-2 rounded-md border border-bank-200 bg-white px-4 text-sm font-bold text-bank-800 shadow-sm hover:bg-bank-50"
                      aria-expanded={composeAiOpen}
                    >
                      <Sparkles className="h-4 w-4" />
                      {composeAiOpen ? "إخفاء المساعد الذكي" : "إظهار المساعد الذكي"}
                    </button>
                  </div>
                  {composeAiOpen && (
                    <div className="mt-4">
                      <AIAssistantBox
                        body={form.body}
                        relatedRequestId={form.related_request_id}
                        requestType={form.message_type}
                        onUseDraft={applyAiDraft}
                        onUseBody={applyAiBody}
                      />
                    </div>
                  )}
                </div>
              )}

              <div className="bg-white">
                <div className="sticky top-0 z-[1] border-b border-slate-200 bg-white/95 px-5 py-3 shadow-sm backdrop-blur">
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <div>
                      <p className="text-xs font-black text-slate-700">أدوات التحرير</p>
                      <p className="text-[11px] text-slate-400">حدد النص ثم اختر الإجراء المطلوب</p>
                    </div>
                    {messageSettings.enable_attachments && (
                      <label className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-md bg-bank-700 px-3 text-xs font-bold text-white shadow-sm hover:bg-bank-800">
                        <Paperclip className="h-4 w-4" />
                        إرفاق ملف
                        <input
                          type="file"
                          multiple={messageSettings.max_attachments_per_message > 1}
                          accept={(messageSettings.allowed_extensions || []).map((extension) => `.${extension}`).join(",")}
                          onChange={(event) => {
                            addAttachments(event.target.files);
                            event.currentTarget.value = "";
                          }}
                          className="hidden"
                        />
                      </label>
                    )}
                  </div>
                  <div className="flex flex-wrap items-stretch gap-2">
                  <ToolGroup label="تحكم">
                    <ToolButton label="تراجع" icon={Undo} onClick={undoText} />
                    <ToolButton label="إعادة" icon={Redo2} onClick={redoText} />
                  </ToolGroup>
                  <ToolGroup label="العناوين">
                    <ToolButton label="عنوان رئيسي" icon={Heading1} onClick={() => prefixLines("# ", "عنوان رئيسي")} />
                    <ToolButton label="عنوان فرعي" icon={Heading2} onClick={() => prefixLines("## ", "عنوان فرعي")} />
                    <ToolButton label="اقتباس" icon={Quote} onClick={() => prefixLines("> ")} />
                    <ToolButton label="فاصل" icon={Minus} onClick={insertDivider} />
                  </ToolGroup>
                  <ToolGroup label="تنسيق">
                    <ToolButton label="غامق" icon={Bold} onClick={() => editorCommand("bold")} />
                    <ToolButton label="مائل" icon={Italic} onClick={() => editorCommand("italic")} />
                    <ToolButton label="تحته خط" icon={Underline} onClick={() => editorCommand("underline")} />
                    <ToolButton label="يتوسطه خط" icon={Strikethrough} onClick={() => editorCommand("strikeThrough")} />
                    <ToolButton label="رابط" icon={Link} onClick={insertLink} />
                  </ToolGroup>
                  <ToolGroup label="حجم الخط">
                    <ToolButton label="تصغير الخط" icon={ALargeSmall} onClick={() => changeFontSize("small")} />
                    <button type="button" title="خط عادي" onClick={() => changeFontSize("normal")} className="inline-flex h-8 min-w-8 items-center justify-center rounded-md border border-slate-200 bg-white px-2 text-xs font-black text-slate-700 shadow-sm transition hover:border-bank-200 hover:bg-bank-50 hover:text-bank-800">عادي</button>
                    <button type="button" title="تكبير الخط" onClick={() => changeFontSize("large")} className="inline-flex h-8 min-w-8 items-center justify-center rounded-md border border-slate-200 bg-white px-2 text-sm font-black text-slate-700 shadow-sm transition hover:border-bank-200 hover:bg-bank-50 hover:text-bank-800">كبير</button>
                    <button type="button" title="تكبير أكبر" onClick={() => changeFontSize("x-large")} className="inline-flex h-8 min-w-8 items-center justify-center rounded-md border border-slate-200 bg-white px-2 text-base font-black text-slate-700 shadow-sm transition hover:border-bank-200 hover:bg-bank-50 hover:text-bank-800">أكبر</button>
                  </ToolGroup>
                  <ToolGroup label="قوائم">
                    <ToolButton label="قائمة نقطية" icon={List} onClick={() => insertList(false)} />
                    <ToolButton label="قائمة مرقمة" icon={ListOrdered} onClick={() => insertList(true)} />
                    <ToolButton label="قائمة مهام" icon={ListChecks} onClick={insertTaskList} />
                  </ToolGroup>
                  <ToolGroup label="محاذاة">
                    <ToolButton label="محاذاة يمين" icon={AlignRight} onClick={() => alignSelection("right")} />
                    <ToolButton label="محاذاة وسط" icon={AlignCenter} onClick={() => alignSelection("center")} />
                    <ToolButton label="محاذاة يسار" icon={AlignLeft} onClick={() => alignSelection("left")} />
                  </ToolGroup>
                  <ToolGroup label="إدراج">
                    {messageSettings.enable_templates && messageCapabilities.can_use_templates && <div className="relative">
                      <button
                        type="button"
                        title="قوالب جاهزة"
                        onClick={() => setTemplatesOpen((value) => !value)}
                        disabled={messageTemplates.length === 0}
                        className="inline-flex h-8 items-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-xs font-bold text-slate-700 hover:border-bank-200 hover:bg-bank-50 hover:text-bank-800 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <FileText className="h-4 w-4" />
                        قالب
                      </button>
                      {templatesOpen && (
                        <div className="absolute right-0 top-10 z-20 w-[min(26rem,calc(100vw-2rem))] overflow-hidden rounded-md border border-slate-200 bg-white text-right shadow-lg">
                          <div className="border-b border-slate-100 bg-slate-50 px-3 py-2 text-xs font-bold text-slate-500">اختر قالباً لتعبئة الرسالة</div>
                          <div className="max-h-72 overflow-y-auto p-1">
                            {messageTemplates.map((template) => (
                              <button
                                key={template.key}
                                type="button"
                                onClick={() => applyTemplate(template.key)}
                                className={`block w-full min-w-0 rounded-md px-3 py-2 text-right text-sm hover:bg-bank-50 ${selectedTemplateKey === template.key ? "bg-bank-50 text-bank-800" : "text-slate-700"}`}
                              >
                                <span className="block max-w-full truncate font-bold">{template.label}</span>
                                <span className="mt-1 block max-w-full truncate text-xs leading-5 text-slate-500">{template.subject || messageTypeLabel(template.message_type)}</span>
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>}
                    {messageSettings.enable_signatures && <ToolButton label="توقيع" icon={Signature} onClick={insertSignature} />}
                    <ToolButton label="مسح التنسيق" icon={Eraser} onClick={clearFormatting} />
                  </ToolGroup>
                  {messageSettings.enable_signatures && (
                    <button
                      type="button"
                      onClick={() => {
                        setSignatureDraft(signatureText);
                        setSignatureOpen((value) => !value);
                      }}
                      className="inline-flex h-[54px] items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 text-xs font-bold text-slate-700 hover:border-bank-200 hover:bg-bank-50 hover:text-bank-800"
                    >
                      <Signature className="h-4 w-4" />
                      إعداد التوقيع
                    </button>
                  )}
                  </div>
                </div>
                {messageSettings.enable_signatures && signatureOpen && (
                  <div className="border-b border-slate-100 bg-slate-50 px-5 py-4">
                    <div className="grid gap-3 lg:grid-cols-[1fr_auto] lg:items-end">
                      <label className="block space-y-2 text-sm font-bold text-slate-700">
                        توقيع البريد
                        <textarea
                          value={signatureDraft}
                          onChange={(event) => setSignatureDraft(event.target.value)}
                          rows={4}
                          placeholder={"مثال:\nتحياتي،\nعبدالله باجرش\nالإدارة المختصة"}
                          className="w-full resize-y rounded-md border border-slate-300 bg-white px-3 py-2 text-sm leading-6 outline-none focus:border-bank-600 focus:ring-2 focus:ring-bank-100"
                        />
                      </label>
                      <div className="flex gap-2">
                        <button type="button" onClick={saveSignature} disabled={isSignatureSaving} className="h-10 rounded-md bg-bank-700 px-4 text-sm font-bold text-white hover:bg-bank-800 disabled:opacity-60">
                          {isSignatureSaving ? "جاري الحفظ..." : "حفظ"}
                        </button>
                        <button type="button" onClick={() => setSignatureOpen(false)} className="h-10 rounded-md border border-slate-300 bg-white px-4 text-sm font-bold text-slate-700 hover:bg-slate-50">
                          إغلاق
                        </button>
                      </div>
                    </div>
                  </div>
                )}
                <div
                  ref={bodyRef}
                  contentEditable
                  role="textbox"
                  aria-label="نص الرسالة"
                  data-placeholder="اكتب رسالتك هنا..."
                  onInput={syncEditorBody}
                  onBlur={syncEditorBody}
                  className="message-rich-editor min-h-[420px] w-full overflow-y-auto border-0 bg-white px-6 py-5 text-sm leading-8 text-slate-800 outline-none focus:ring-0"
                />
              </div>

              <div className="bg-slate-50 p-5">
                {forwardSource && (
                  <div className="mb-4 rounded-md border border-slate-200 bg-white p-4">
                    <p className="mb-2 text-xs font-bold text-slate-500">معاينة الرسالة الأصلية التي سيتم تحويلها</p>
                    <div className="rounded-md bg-slate-50 p-3 text-sm leading-7 text-slate-700">
                      <p className="font-bold text-slate-900">{forwardSource.subject}</p>
                      <p className="text-xs text-slate-500">من: {forwardSource.sender_name} - {formatDate(forwardSource.created_at)}</p>
                      <p className="mt-3 line-clamp-4 whitespace-pre-line">{messageBodyPreview(forwardSource.body)}</p>
                    </div>
                  </div>
                )}
                {messageSettings.enable_attachments && (attachments.length === 0 ? (
                  <div className="rounded-md border border-dashed border-slate-300 bg-white p-4 text-center text-sm text-slate-500">
                    <Paperclip className="mx-auto mb-2 h-5 w-5 text-slate-400" />
                    لا توجد مرفقات. استخدم زر إرفاق من شريط الأدوات.
                  </div>
                ) : (
                  <div className="grid gap-2 md:grid-cols-2">
                    {attachments.map((file, index) => (
                      <div key={`${file.name}-${file.size}-${index}`} className="flex items-center justify-between gap-3 rounded-md border border-slate-200 bg-white px-3 py-2">
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-bold text-slate-800">{file.name}</span>
                          <span className="text-xs text-slate-500">{formatBytes(file.size)}</span>
                        </span>
                        <button type="button" onClick={() => removeAttachment(index)} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-slate-400 hover:bg-red-50 hover:text-red-600" aria-label="حذف المرفق">
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                ))}
                <div className="mt-5 flex flex-wrap items-center justify-end gap-3 border-t border-slate-200 pt-5">
                  {messageSettings.enable_drafts && !replySource && !forwardSource && (
                    <button type="button" onClick={saveDraft} className="inline-flex h-11 items-center gap-2 rounded-md border border-bank-200 bg-bank-50 px-5 text-sm font-bold text-bank-800 hover:bg-bank-100">
                      <Save className="h-4 w-4" />
                      حفظ مسودة
                    </button>
                  )}
                  <Button type="submit" className="h-11 gap-2 px-6">
                    <SendHorizonal className="h-4 w-4" />
                    {replySource ? "إرسال الرد" : editingDraftId ? "إرسال المسودة" : "إرسال"}
                  </Button>
                  <button
                    type="button"
                    onClick={clearComposeForm}
                    className="inline-flex h-11 items-center gap-2 rounded-md border border-slate-300 bg-white px-5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    <Eraser className="h-4 w-4" />
                    تفريغ
                  </button>
                </div>
              </div>
            </div>
          </form>
        ) : (
          <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
            {!selected ? (
              <div className="flex min-h-[360px] items-center justify-center text-sm text-slate-500">اختر رسالة لعرض التفاصيل.</div>
            ) : (
              <div className="space-y-5">
                <div className="flex flex-col gap-3 border-b border-slate-100 pb-4 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <p className="text-sm font-semibold text-bank-700">
                      {mailbox === "inbox" || (mailbox === "archived" && archiveView === "inbox") ? `من: ${selected.sender_name}` : `إلى: ${selected.recipient_names.join("، ") || "لم يتم تحديد مستلمين"}`}
                    </p>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      {selected.message_uid && (
                        <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-black text-slate-600" title="معرف الرسالة">
                          <Hash className="h-3.5 w-3.5" />
                          {selected.message_uid}
                        </span>
                      )}
                      <span style={messageTypeBadgeStyle(selectedMessageType)} className="rounded-full border border-slate-200 bg-slate-100 px-3 py-1 text-xs font-bold text-slate-700">{messageTypeLabel(selected.message_type)}</span>
                      {selectedMessageType?.is_official && <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-bold text-blue-700">رسمية</span>}
                      {selectedMessageType?.show_in_pdf && <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700">تظهر في PDF</span>}
                      <span className={`rounded-full px-3 py-1 text-xs font-bold ${messagePriorityBadgeClass(selected.priority)}`}>{messagePriorityLabel(selected.priority)}</span>
                      <span className={`rounded-full px-3 py-1 text-xs font-bold ${messageClassificationBadgeClass(selectedClassification)}`}>{messageClassificationLabel(selected.classification_code, messageClassificationOptions)}</span>
                      <h3 className="text-xl font-bold text-slate-950">{selected.subject || "بدون موضوع"}</h3>
                    </div>
                    {selectedClassification?.restricted_access && (
                      <p className="mt-2 rounded-md border border-amber-100 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-800">
                        هذه الرسالة مصنفة كرسالة سرية. الوصول والتنزيل يخضعان لإعدادات تصنيف السرية.
                      </p>
                    )}
                    {messageSettings.enable_linked_requests && selected.related_request_id && (
                      <button type="button" onClick={() => navigate(`/requests/${selected.related_request_id}`)} className="mt-2 inline-flex items-center gap-2 rounded-md bg-bank-50 px-3 py-1 text-xs font-bold text-bank-700 hover:bg-bank-100">
                        <Link className="h-3.5 w-3.5" />
                        طلب مرتبط: {selected.related_request_number || selected.related_request_id}
                      </button>
                    )}
                    <p className="mt-2 text-xs text-slate-500">{mailbox === "drafts" ? `آخر حفظ: ${formatDate(selected.updated_at || selected.created_at)}` : formatDate(selected.created_at)}</p>
                  </div>
                  {mailbox === "drafts" ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <button type="button" onClick={() => editDraft(selected)} className="inline-flex h-10 items-center gap-2 rounded-md border border-bank-200 bg-bank-50 px-3 text-sm font-bold text-bank-800 hover:bg-bank-100">
                        <Save className="h-4 w-4" />
                        تحرير المسودة
                      </button>
                      <button type="button" onClick={() => deleteDraft(selected)} className="inline-flex h-10 items-center gap-2 rounded-md border border-red-200 bg-white px-3 text-sm font-semibold text-red-700 hover:bg-red-50">
                        <Trash2 className="h-4 w-4" />
                        حذف
                      </button>
                    </div>
                  ) : mailbox === "archived" ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <button type="button" onClick={restoreSelected} className="inline-flex h-10 items-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50">
                        <Undo2 className="h-4 w-4" />
                        استعادة
                      </button>
                      {messageSettings.allow_user_delete_own_messages && (
                        <button type="button" onClick={deleteSelectedMessage} className="inline-flex h-10 items-center gap-2 rounded-md border border-red-200 bg-white px-3 text-sm font-semibold text-red-700 hover:bg-red-50">
                          <Trash2 className="h-4 w-4" />
                          حذف
                        </button>
                      )}
                    </div>
                  ) : (
                    <div className="flex flex-wrap items-center gap-2">
                      {selectedCanReply && canUseAiReplies && (
                        <button type="button" onClick={() => suggestAiReply(selected)} disabled={selectedAiLoading === "reply"} className="inline-flex h-10 items-center gap-2 rounded-md border border-bank-200 bg-bank-50 px-3 text-sm font-bold text-bank-800 hover:bg-bank-100 disabled:cursor-not-allowed disabled:opacity-60">
                          <Sparkles className="h-4 w-4" />
                          {selectedAiLoading === "reply" ? "جاري الاقتراح..." : "اقتراح رد"}
                        </button>
                      )}
                      {selectedCanReply && (
                        <button type="button" onClick={() => beginReply(selected)} className="inline-flex h-10 items-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50">
                          <Reply className="h-4 w-4" />
                          رد
                        </button>
                      )}
                      {messageSettings.allow_forwarding && (
                        <button type="button" onClick={() => beginForward(selected)} className="inline-flex h-10 items-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50">
                          <ArrowBigLeftDash className="h-4 w-4" />
                          تحويل
                        </button>
                      )}
                      {mailbox === "inbox" || mailbox === "unread" ? (
                        selected.is_read ? (
                          <button type="button" onClick={() => markSelectedReadState(false)} className="inline-flex h-10 items-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50">
                            <EyeOff className="h-4 w-4" />
                            غير مقروءة
                          </button>
                        ) : (
                          <button type="button" onClick={() => markSelectedReadState(true)} className="inline-flex h-10 items-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50">
                            <Eye className="h-4 w-4" />
                            مقروءة
                          </button>
                        )
                      ) : null}
                      {messageSettings.enable_linked_requests && selected.related_request_id && (
                        <button type="button" onClick={() => navigate(`/requests/${selected.related_request_id}`)} className="inline-flex h-10 items-center gap-2 rounded-md border border-bank-200 bg-bank-50 px-3 text-sm font-bold text-bank-800 hover:bg-bank-100">
                          <Link className="h-4 w-4" />
                          فتح الطلب
                        </button>
                      )}
                      {messageSettings.allow_archiving && (
                        <button type="button" onClick={archiveSelected} className="inline-flex h-10 items-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50">
                          <Archive className="h-4 w-4" />
                          أرشفة
                        </button>
                      )}
                      {messageSettings.allow_user_delete_own_messages && (
                        <button type="button" onClick={deleteSelectedMessage} className="inline-flex h-10 items-center gap-2 rounded-md border border-red-200 bg-white px-3 text-sm font-semibold text-red-700 hover:bg-red-50">
                          <Trash2 className="h-4 w-4" />
                          حذف
                        </button>
                      )}
                    </div>
                  )}
                </div>
                {selectedCanReply && canUseAiReplies && selectedAiError && <div className="rounded-md border border-red-100 bg-red-50 p-3 text-sm text-red-700">{selectedAiError}</div>}
                {selectedCanReply && canUseAiReplies && selectedAiSuggestion?.type === "reply" && (
                  <AISuggestionPanel
                    title="اقتراح رد"
                    body={selectedAiSuggestion.body}
                    onUse={() => useAiReply(selected, selectedAiSuggestion.body)}
                    onRetry={() => suggestAiReply(selected)}
                    onCancel={() => setSelectedAiSuggestion(null)}
                  />
                )}
                {canUseAiSummaries && <AISummaryBox messageId={selected.id} buttonLabel="تلخيص الرسالة" compact />}
                <div
                  className="min-h-[260px] rounded-md bg-slate-50 p-4 text-sm leading-7 text-slate-700"
                  dangerouslySetInnerHTML={{ __html: selected.body ? sanitizeMessageHtml(selected.body) : selected.is_draft ? "لا يوجد محتوى في المسودة بعد." : "" }}
                />
                {selected.attachments?.length > 0 && (
                  <div className="rounded-md border border-slate-200 bg-white p-4">
                    <h4 className="mb-3 flex items-center gap-2 text-sm font-bold text-slate-700">
                      <Paperclip className="h-4 w-4" />
                      المرفقات
                    </h4>
                    <div className="grid gap-2 md:grid-cols-2">
                      {selected.attachments.map((attachment) => (
                        <button key={attachment.id} type="button" onClick={() => selectedClassification?.allow_attachment_download === false ? setError("تحميل مرفقات هذا التصنيف غير مسموح.") : downloadAttachment(selected.id, attachment)} disabled={selectedClassification?.allow_attachment_download === false} className="flex items-center justify-between rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-right text-sm hover:bg-bank-50 disabled:cursor-not-allowed disabled:opacity-60">
                          <span>
                            <span className="block font-semibold text-slate-800">{attachment.original_name}</span>
                            <span className="text-xs text-slate-500">{selectedClassification?.allow_attachment_download === false ? "التنزيل غير مسموح لهذا التصنيف" : formatBytes(attachment.size_bytes)}</span>
                          </span>
                          <Download className="h-4 w-4 text-bank-700" />
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {messageSettings.enable_read_receipts && (selected.read_receipts || []).length > 0 && (
                  <div className="rounded-md border border-slate-200 bg-white p-4">
                    <h4 className="mb-3 text-sm font-bold text-slate-700">سجل القراءة</h4>
                    <div className="grid gap-2 md:grid-cols-2">
                      {(selected.read_receipts || []).map((receipt) => (
                        <div key={receipt.recipient_id} className="flex items-center justify-between gap-3 rounded-md bg-slate-50 px-3 py-2 text-sm">
                          <span className="font-semibold text-slate-800">{receipt.recipient_name}</span>
                          <span className={`rounded-full px-2 py-1 text-xs font-bold ${receipt.is_read ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>
                            {receipt.is_read ? `قرأها ${receipt.read_at ? formatDate(receipt.read_at) : ""}` : "لم يقرأها"}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {(selected.replies || []).length > 0 && (
                  <div className="space-y-3">
                    <h4 className="text-sm font-bold text-slate-700">سلسلة المحادثة</h4>
                    {(selected.replies || []).map((reply) => (
                      <div key={reply.id} className="rounded-md border border-slate-200 bg-white p-4">
                        <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
                          <span className="flex flex-wrap items-center gap-2 font-bold text-slate-700">
                            {reply.sender_name}
                            {reply.message_uid && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-500">{reply.message_uid}</span>}
                          </span>
                          <span>{formatDate(reply.created_at)}</span>
                        </div>
                        <div className="text-sm leading-7 text-slate-700" dangerouslySetInnerHTML={{ __html: sanitizeMessageHtml(reply.body) }} />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
}

function ToolButton({ label, icon: Icon, onClick, disabled = false }: { label: string; icon: typeof Bold; onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" title={label} aria-label={label} onClick={onClick} disabled={disabled} className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-700 shadow-sm transition hover:border-bank-200 hover:bg-bank-50 hover:text-bank-800 focus:outline-none focus:ring-2 focus:ring-bank-100 disabled:cursor-not-allowed disabled:opacity-50">
      <Icon className="h-4 w-4" />
    </button>
  );
}

function MessageSection({
  title,
  count,
  messages,
  messageTypeOptions,
  messageClassificationOptions,
  selectedIds,
  selectedId,
  mailbox,
  archiveView,
  showUnreadBadge,
  onSelect,
  onToggleSelection
}: {
  title: string;
  count: number;
  messages: InternalMessage[];
  messageTypeOptions: MessageTypeOption[];
  messageClassificationOptions: MessageClassificationOption[];
  selectedIds: number[];
  selectedId: number | null;
  mailbox: Mailbox;
  archiveView: "inbox" | "sent";
  showUnreadBadge: boolean;
  onSelect: (message: InternalMessage) => void;
  onToggleSelection: (messageId: number) => void;
}) {
  return (
    <div>
      <div className="sticky top-0 z-[1] flex items-center justify-between border-b border-slate-100 bg-slate-50 px-4 py-2 text-xs font-bold text-slate-500">
        <span>{title}</span>
        <span>{count}</span>
      </div>
      {messages.map((message) => (
        <MessageListItem key={message.id} message={message} messageTypeOptions={messageTypeOptions} messageClassificationOptions={messageClassificationOptions} selectedIds={selectedIds} selectedId={selectedId} mailbox={mailbox} archiveView={archiveView} showUnreadBadge={showUnreadBadge} onSelect={onSelect} onToggleSelection={onToggleSelection} />
      ))}
    </div>
  );
}

function MessageListItem({
  message,
  messageTypeOptions,
  messageClassificationOptions,
  selectedIds,
  selectedId,
  mailbox,
  archiveView,
  showUnreadBadge = true,
  onSelect,
  onToggleSelection
}: {
  message: InternalMessage;
  messageTypeOptions: MessageTypeOption[];
  messageClassificationOptions: MessageClassificationOption[];
  selectedIds: number[];
  selectedId: number | null;
  mailbox: Mailbox;
  archiveView: "inbox" | "sent";
  showUnreadBadge?: boolean;
  onSelect: (message: InternalMessage) => void;
  onToggleSelection: (messageId: number) => void;
}) {
  const isInboxLike = mailbox === "inbox" || (mailbox === "archived" && archiveView === "inbox");
  const messageDate = message.is_draft ? message.updated_at || message.created_at : message.created_at;
  const classification = messageClassificationOptions.find((option) => option.code === (message.classification_code || defaultMessageClassification));
  return (
    <button
      type="button"
      onClick={() => onSelect(message)}
      dir="rtl"
      className={`block w-full border-b border-slate-100 p-4 text-right transition hover:bg-slate-50 ${selectedId === message.id ? "bg-bank-50" : message.is_read ? "bg-white" : "bg-white"}`}
    >
      <div className="flex items-start justify-between gap-3 text-right">
        <input
          type="checkbox"
          checked={selectedIds.includes(message.id)}
          onClick={(event) => event.stopPropagation()}
          onChange={() => onToggleSelection(message.id)}
          className="mt-1 h-4 w-4 shrink-0"
          aria-label="تحديد الرسالة"
        />
        <div className="min-w-0 flex-1 text-right">
          <div className="flex min-w-0 flex-wrap items-center justify-start gap-2 text-right">
            <span style={messageTypeBadgeStyle(messageTypeOptions.find((option) => option.value === message.message_type))} className="shrink-0 rounded-full border border-slate-200 bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-600">{getMessageTypeLabel(message.message_type, messageTypeOptions)}</span>
            <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold ${messagePriorityBadgeClass(message.priority)}`}>{messagePriorityLabel(message.priority)}</span>
            <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold ${messageClassificationBadgeClass(classification)}`}>{messageClassificationLabel(message.classification_code, messageClassificationOptions)}</span>
            <p className={`min-w-0 flex-1 truncate font-semibold ${message.is_read ? "text-slate-700" : "text-slate-950"}`}>{message.subject || "بدون موضوع"}</p>
          </div>
          <p className="mt-1 truncate text-xs text-slate-500">
            {message.is_draft ? `مسودة - ${formatDate(messageDate)}` : isInboxLike ? message.sender_name : message.recipient_names.join("، ")}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] font-bold text-slate-400">
            {message.message_uid && <span className="truncate">معرف الرسالة: {message.message_uid}</span>}
            {message.attachments?.length > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-slate-500">
                <Paperclip className="h-3 w-3" />
                {message.attachments.length}
              </span>
            )}
            {message.related_request_id && (
              <span className="inline-flex items-center gap-1 rounded-full bg-bank-50 px-2 py-0.5 text-bank-700">
                <Link className="h-3 w-3" />
                {message.related_request_number || message.related_request_id}
              </span>
            )}
          </div>
        </div>
        {showUnreadBadge && !message.is_read && mailbox === "inbox" && <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full bg-bank-700" />}
      </div>
      <p className={`mt-3 line-clamp-2 text-right text-xs leading-5 ${message.is_read ? "text-slate-500" : "font-semibold text-slate-700"}`}>{messageBodyPreview(message.body) || (message.is_draft ? "لا يوجد محتوى بعد." : "")}</p>
    </button>
  );
}

function ToolGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="rounded-md border border-slate-200 bg-slate-50/80 p-1.5">
      <p className="mb-1 px-1 text-[10px] font-bold text-slate-400">{label}</p>
      <div className="flex items-center gap-1">{children}</div>
    </div>
  );
}

function Tab({ active, onClick, icon: Icon, label, collapsed = false, featured = false, disabled = false }: { active: boolean; onClick: () => void; icon: typeof Mail; label: string; collapsed?: boolean; featured?: boolean; disabled?: boolean }) {
  if (featured) {
    return (
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        title={label}
        className={`relative flex h-11 items-center justify-center gap-2 rounded-md border-2 border-bank-700 bg-white text-xs font-bold text-bank-700 shadow-sm transition hover:bg-bank-50 focus:outline-none focus:ring-2 focus:ring-bank-100 disabled:cursor-not-allowed disabled:opacity-50 ${active ? "bg-bank-50 ring-2 ring-bank-100" : ""} ${collapsed ? "w-full px-0" : "px-3"}`}
      >
        <Icon className="relative h-5 w-5" />
        {!collapsed && <span className="relative">{label}</span>}
      </button>
    );
  }
  return (
    <button type="button" onClick={onClick} disabled={disabled} title={label} className={`flex h-10 items-center justify-center gap-2 rounded-md text-xs font-bold disabled:cursor-not-allowed disabled:opacity-50 ${active ? "bg-bank-50 text-bank-700" : "text-slate-600 hover:bg-slate-50"} ${collapsed ? "w-full" : ""}`}>
      <Icon className="h-4 w-4" />
      {!collapsed && label}
    </button>
  );
}

function formatDate(value: string) {
  return formatSystemDateTime(value);
}

function sortByNewest(first: InternalMessage, second: InternalMessage) {
  return new Date(second.created_at).getTime() - new Date(first.created_at).getTime();
}

function getMessageTypeLabel(value: string, options: MessageTypeOption[] = defaultMessageTypeOptions) {
  return options.find((option) => option.value === value)?.label || "مراسلة داخلية";
}

function messageTypeBadgeStyle(option?: MessageTypeOption | null) {
  if (option?.color && /^#[0-9a-f]{6}$/i.test(option.color)) {
    return {
      color: option.color,
      backgroundColor: `${option.color}14`,
      borderColor: `${option.color}33`
    };
  }
  return undefined;
}

function messagePriorityLabel(value?: string | null) {
  return { normal: "عادية", high: "مرتفعة", urgent: "عاجلة" }[value || "normal"] || "عادية";
}

function messagePriorityBadgeClass(value?: string | null) {
  if (value === "urgent") return "bg-red-50 text-red-700";
  if (value === "high") return "bg-amber-50 text-amber-700";
  return "bg-emerald-50 text-emerald-700";
}

function messageClassificationLabel(value?: string | null, options: MessageClassificationOption[] = defaultMessageClassificationOptions) {
  return options.find((option) => option.code === (value || defaultMessageClassification))?.name_ar || "داخلي";
}

function messageClassificationBadgeClass(option?: MessageClassificationOption | null) {
  if (option?.code === "top_secret") return "bg-red-50 text-red-700";
  if (option?.code === "confidential" || option?.restricted_access) return "bg-amber-50 text-amber-700";
  if (option?.code === "public") return "bg-emerald-50 text-emerald-700";
  return "bg-slate-100 text-slate-700";
}

function mailboxTitle(value: Mailbox) {
  return {
    inbox: "الوارد",
    sent: "الصادر",
    drafts: "المسودات",
    archived: "المؤرشفة",
    unread: "غير المقروءة",
    "request-linked": "مرتبطة بالطلبات",
    official: "المراسلات الرسمية",
    clarifications: "طلبات الاستيضاح",
    compose: "رسالة جديدة"
  }[value];
}

function mailboxFromPath(pathname: string): Mailbox | null {
  const normalized = pathname.replace(/\/+$/, "") || "/messages";
  if (normalized === "/messages") return null;
  if (messageIdFromPath(normalized)) return "inbox";
  if (normalized === "/messages/inbox") return "inbox";
  if (normalized === "/messages/sent") return "sent";
  if (normalized === "/messages/drafts") return "drafts";
  if (normalized === "/messages/archived") return "archived";
  if (normalized === "/messages/unread") return "unread";
  if (normalized === "/messages/request-linked") return "request-linked";
  if (normalized === "/messages/official") return "official";
  if (normalized === "/messages/clarifications") return "clarifications";
  if (normalized === "/messages/new") return "compose";
  return null;
}

function messageIdFromPath(pathname: string) {
  const match = pathname.match(/^\/messages\/(\d+)\/?$/);
  return match ? Number(match[1]) : null;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function messageBodyPreview(value: string) {
  if (!value) return "";
  const template = document.createElement("template");
  template.innerHTML = value;
  return (template.content.textContent || value).replace(/\s+/g, " ").trim();
}

function sanitizeMessageHtml(value: string) {
  const template = document.createElement("template");
  template.innerHTML = value;
  const allowedTags = new Set(["B", "STRONG", "I", "EM", "U", "S", "STRIKE", "A", "BR", "DIV", "P", "UL", "OL", "LI", "H1", "H2", "BLOCKQUOTE", "HR", "SPAN"]);
  const allowedAttrs = new Set(["href", "target", "rel", "dir", "style"]);
  template.content.querySelectorAll("*").forEach((element) => {
    if (!allowedTags.has(element.tagName)) {
      element.replaceWith(document.createTextNode(element.textContent || ""));
      return;
    }
    Array.from(element.attributes).forEach((attr) => {
      const name = attr.name.toLowerCase();
      if (!allowedAttrs.has(name) || name.startsWith("on")) {
        element.removeAttribute(attr.name);
      }
    });
    if (element.hasAttribute("style")) {
      const fontSize = (element as HTMLElement).style.fontSize;
      (element as HTMLElement).removeAttribute("style");
      if (/^(0\.875|1|1\.25|1\.5)rem$/.test(fontSize)) {
        (element as HTMLElement).style.fontSize = fontSize;
      }
    }
    if (element.tagName === "A") {
      const href = element.getAttribute("href") || "";
      if (!/^https?:\/\//i.test(href) && !/^mailto:/i.test(href)) element.removeAttribute("href");
      element.setAttribute("target", "_blank");
      element.setAttribute("rel", "noreferrer");
    }
  });
  return template.innerHTML;
}

function textToHtml(value: string) {
  return escapeHtml(value || "").replace(/\n/g, "<br>");
}

function readStoredAiDraft() {
  const raw = sessionStorage.getItem("qib_ai_compose_draft");
  if (!raw) return null;
  sessionStorage.removeItem("qib_ai_compose_draft");
  try {
    const parsed = JSON.parse(raw);
    return {
      subject: String(parsed.subject || ""),
      body: parsed.body ? textToHtml(String(parsed.body)) : "",
      message_type: String(parsed.message_type || "")
    };
  } catch {
    return null;
  }
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

function formatBytes(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function extractApiError(raw: string) {
  try {
    const data = JSON.parse(raw);
    if (typeof data.detail === "string") return data.detail;
    if (Array.isArray(data.detail)) {
      return data.detail.map((item: { msg?: string; message?: string }) => item?.msg || item?.message || "").filter(Boolean).join("، ");
    }
    return "";
  } catch {
    return "";
  }
}
