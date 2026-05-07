import { FormEvent, ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
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
};

type InternalMessage = {
  id: number;
  message_uid?: string | null;
  thread_id?: number | null;
  message_type: string;
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
};

type MessageSettings = {
  enabled: boolean;
  enable_attachments: boolean;
  enable_drafts: boolean;
  enable_templates: boolean;
  enable_signatures: boolean;
  enable_circulars: boolean;
  enable_department_broadcasts: boolean;
  enable_read_receipts: boolean;
  enable_linked_requests: boolean;
  max_attachment_mb: number;
  max_recipients: number;
  default_message_type: string;
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
};

type Mailbox = "inbox" | "sent" | "drafts" | "archived" | "compose";
const pageSize = 50;
const defaultMessageType = "internal_correspondence";
const defaultMessageSettings: MessageSettings = {
  enabled: true,
  enable_attachments: true,
  enable_drafts: true,
  enable_templates: true,
  enable_signatures: true,
  enable_circulars: true,
  enable_department_broadcasts: true,
  enable_read_receipts: true,
  enable_linked_requests: true,
  max_attachment_mb: 25,
  max_recipients: 200,
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

export default function MessagesPage() {
  const [searchParams] = useSearchParams();
  const [mailbox, setMailbox] = useState<Mailbox>("inbox");
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
  const [messageTemplates, setMessageTemplates] = useState<MessageTemplate[]>([]);
  const [messageTypeOptions, setMessageTypeOptions] = useState<MessageTypeOption[]>(defaultMessageTypeOptions);
  const [selectedTemplateKey, setSelectedTemplateKey] = useState("");
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [form, setForm] = useState({ recipient_ids: [] as number[], message_type: defaultMessageSettings.default_message_type, subject: "", body: "", related_request_id: "" });
  const [selectedDepartmentIds, setSelectedDepartmentIds] = useState<number[]>([]);
  const [departmentRecipientIds, setDepartmentRecipientIds] = useState<number[]>([]);
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
  const [selectedAiSuggestion, setSelectedAiSuggestion] = useState<{ type: "reply"; body: string } | null>(null);
  const [selectedAiLoading, setSelectedAiLoading] = useState("");
  const [selectedAiError, setSelectedAiError] = useState("");
  const [aiStatus, setAiStatus] = useState<AIStatus>({ is_enabled: false, allow_message_drafting: false, allow_summarization: false, allow_reply_suggestion: false });
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const queryComposeInitialized = useRef(false);

  const selected = useMemo(() => messages.find((message) => message.id === selectedId) || messages[0] || null, [messages, selectedId]);
  const unreadCount = messages.filter((message) => !message.is_read).length;
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
  const canUseAiDrafting = Boolean(aiStatus.is_enabled && aiStatus.allow_message_drafting);
  const canUseAiSummaries = Boolean(aiStatus.is_enabled && aiStatus.allow_summarization);
  const canUseAiReplies = Boolean(aiStatus.is_enabled && aiStatus.allow_reply_suggestion);

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
    if (typeFilter) query.set("message_type", typeFilter);
    if (senderFilter && nextMailbox === "inbox") query.set("sender_id", senderFilter);
    if (relatedRequestFilter) query.set("related_request", relatedRequestFilter);
    if (dateFrom) query.set("date_from", dateFrom);
    if (dateTo) query.set("date_to", dateTo);
    if (nextMailbox === "inbox" && unreadOnly) query.set("unread_only", "true");
    if (nextMailbox === "archived") query.set("archived", "true");
    query.set("limit", String(pageSize));
    query.set("offset", String(mode === "append" ? messages.length : 0));
    try {
      const endpoint = nextMailbox === "archived" ? archiveView : nextMailbox;
      const data = await apiFetch<InternalMessage[]>(`/messages/${endpoint}?${query.toString()}`);
      setHasMore(data.length === pageSize);
      if (mode === "append") {
        setMessages((current) => [...current, ...data]);
      } else {
        setMessages(data);
        setSelectedId(data[0]?.id ?? null);
        setSelectedIds([]);
      }
    } catch {
      setError("تعذر تحميل المراسلات.");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    loadUsers();
    loadMessageSettings();
    loadMessageCapabilities();
    loadSignature();
    loadTemplates();
    loadTypes();
    loadAiStatus();
  }, []);

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
      subject: searchParams.get("subject") || storedAiDraft?.subject || "",
      body: storedAiDraft?.body || "",
      related_request_id: searchParams.get("related_request_id") || ""
    });
    setMailbox("compose");
    window.requestAnimationFrame(() => bodyRef.current?.focus());
  }, [searchParams]);

  useEffect(() => {
    loadMessages(mailbox);
  }, [mailbox, unreadOnly, archiveView, typeFilter]);

  useEffect(() => {
    if (mailbox === "compose") return;
    function refreshMessagesImmediately() {
      loadMessages(mailbox);
    }
    window.addEventListener("qib-messages-updated", refreshMessagesImmediately);
    return () => window.removeEventListener("qib-messages-updated", refreshMessagesImmediately);
  }, [mailbox, unreadOnly, search, archiveView, typeFilter, senderFilter, relatedRequestFilter, dateFrom, dateTo]);

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

  async function loadMessageDetails(messageId: number) {
    try {
      const details = await apiFetch<InternalMessage>(`/messages/${messageId}`);
      setMessages((current) => current.map((item) => (item.id === details.id ? details : item)));
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
    try {
      if (replySource) {
        if (attachments.length > 0) {
          const data = new FormData();
          data.append("message_type", form.message_type);
          data.append("body", form.body);
          attachments.forEach((file) => data.append("attachments", file));
          await apiFetch<InternalMessage>(`/messages/${replySource.id}/reply-with-attachments`, { method: "POST", body: data });
        } else {
          await apiFetch<InternalMessage>(`/messages/${replySource.id}/reply`, {
            method: "POST",
            body: JSON.stringify({ body: form.body, message_type: form.message_type })
          });
        }
      } else if (forwardSource) {
        await apiFetch<InternalMessage>(`/messages/${forwardSource.id}/forward`, {
          method: "POST",
          body: JSON.stringify({ recipient_ids: form.recipient_ids, message_type: form.message_type, note: form.body.trim() || undefined })
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
      setForm({ recipient_ids: [], message_type: messageSettings.default_message_type || defaultMessageType, subject: "", body: "", related_request_id: "" });
      setSelectedDepartmentIds([]);
      setDepartmentRecipientIds([]);
      setAttachments([]);
      setEditingDraftId(null);
      setForwardSource(null);
      setReplySource(null);
      setFeedback(replySource ? "تم إرسال الرد." : "تم إرسال الرسالة بنجاح.");
      setMailbox("sent");
    } catch (error) {
      const detail = error instanceof Error ? extractApiError(error.message) : "";
      setError(detail || "تعذر إرسال الرسالة. تأكد من اختيار مستلم وكتابة العنوان والمحتوى.");
    }
  }

  async function saveDraft() {
    setFeedback("");
    setError("");
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

  async function archiveSelected() {
    if (!selected) return;
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

  async function bulkMarkRead() {
    if (selectedIds.length === 0) return;
    try {
      await apiFetch<void>("/messages/bulk/read", { method: "POST", body: JSON.stringify({ message_ids: selectedIds }) });
      setMessages((current) => current.map((message) => (selectedIds.includes(message.id) ? { ...message, is_read: true } : message)));
      setSelectedIds([]);
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
      setForm((current) => ({ ...current, message_type: current.message_type || data.default_message_type || defaultMessageType }));
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
    setForwardSource(message);
    setReplySource(null);
    setSelectedDepartmentIds([]);
    setDepartmentRecipientIds([]);
    setForm({
      recipient_ids: [],
      message_type: message.message_type || defaultMessageType,
      subject: message.subject.startsWith("تحويل:") ? message.subject : `تحويل: ${message.subject}`,
      body: "",
      related_request_id: message.related_request_number || (message.related_request_id ? String(message.related_request_id) : "")
    });
    setAttachments([]);
    setRecipientSearch("");
    setMailbox("compose");
    window.requestAnimationFrame(() => bodyRef.current?.focus());
  }

  function cancelForward() {
    setForwardSource(null);
    setForm({ recipient_ids: [], message_type: messageSettings.default_message_type || defaultMessageType, subject: "", body: "", related_request_id: "" });
    setSelectedDepartmentIds([]);
    setDepartmentRecipientIds([]);
    setRecipientSearch("");
  }

  function beginReply(message: InternalMessage) {
    setReplySource(message);
    setForwardSource(null);
    setSelectedDepartmentIds([]);
    setDepartmentRecipientIds([]);
    setForm({
      recipient_ids: [],
      message_type: "reply_to_clarification",
      subject: message.subject.startsWith("رد:") ? message.subject : `رد: ${message.subject}`,
      body: "",
      related_request_id: message.related_request_number || (message.related_request_id ? String(message.related_request_id) : "")
    });
    setAttachments([]);
    setRecipientSearch("");
    setMailbox("compose");
    window.requestAnimationFrame(() => bodyRef.current?.focus());
  }

  function cancelReply() {
    setReplySource(null);
    setForm({ recipient_ids: [], message_type: messageSettings.default_message_type || defaultMessageType, subject: "", body: "", related_request_id: "" });
    setSelectedDepartmentIds([]);
    setDepartmentRecipientIds([]);
    setRecipientSearch("");
  }

  function startNewMessage() {
    setMailPanelCollapsed(true);
    window.dispatchEvent(new CustomEvent("qib-sidebar-collapse", { detail: { collapsed: true } }));
    setForm({ recipient_ids: [], message_type: messageSettings.default_message_type || defaultMessageType, subject: "", body: "", related_request_id: "" });
    setSelectedTemplateKey("");
    setSelectedDepartmentIds([]);
    setDepartmentRecipientIds([]);
    setAttachments([]);
    setRecipientSearch("");
    setEditingDraftId(null);
    setForwardSource(null);
    setReplySource(null);
    setMailbox("compose");
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
      subject: message.subject,
      body: message.body,
      related_request_id: message.related_request_number || (message.related_request_id ? String(message.related_request_id) : "")
    });
    setAttachments([]);
    setRecipientSearch("");
    setMailbox("compose");
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
    setForm((current) => ({
      ...current,
      recipient_ids: current.recipient_ids.includes(userId) ? current.recipient_ids : [...current.recipient_ids, userId]
    }));
    setRecipientSearch("");
  }

  function applyDepartmentRecipients(nextDepartmentIds: number[]) {
    const ids = users.filter((user) => user.department_id && nextDepartmentIds.includes(user.department_id)).map((user) => user.id);
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

  function removeRecipient(userId: number) {
    setForm((current) => ({ ...current, recipient_ids: current.recipient_ids.filter((id) => id !== userId) }));
  }

  function removeAttachment(index: number) {
    setAttachments((current) => current.filter((_, itemIndex) => itemIndex !== index));
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
            <Tab collapsed={mailPanelCollapsed} active={mailbox === "inbox"} onClick={() => setMailbox("inbox")} icon={Inbox} label={`الوارد${unreadCount ? ` (${unreadCount})` : ""}`} />
            <Tab collapsed={mailPanelCollapsed} active={mailbox === "sent"} onClick={() => setMailbox("sent")} icon={Send} label="المرسل" />
            {messageSettings.enable_drafts && <Tab collapsed={mailPanelCollapsed} active={mailbox === "drafts"} onClick={() => setMailbox("drafts")} icon={Save} label="المسودات" />}
            <Tab collapsed={mailPanelCollapsed} active={mailbox === "compose"} onClick={startNewMessage} icon={SendHorizonal} label="رسالة جديدة" featured />
          </div>
          <button type="button" onClick={() => loadMessages(mailbox)} disabled={isLoading || mailbox === "compose"} className="flex h-10 w-full items-center justify-center gap-2 rounded-md border border-slate-200 bg-white text-sm font-semibold text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60" title="تحديث">
            <RefreshCw className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
            {!mailPanelCollapsed && "تحديث"}
          </button>
          <button type="button" onClick={() => setMailbox("archived")} className={`flex h-10 w-full items-center justify-center gap-2 rounded-md border text-sm font-semibold ${mailbox === "archived" ? "border-bank-200 bg-bank-50 text-bank-700" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"}`} title="الأرشيف">
            <Archive className="h-4 w-4" />
            {!mailPanelCollapsed && "الأرشيف"}
          </button>

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
                      className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 outline-none focus:border-bank-600 focus:ring-2 focus:ring-bank-100"
                    >
                      <option value="">كل التصنيفات</option>
                      {messageTypeOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
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
                      <button type="button" onClick={bulkArchive} disabled={selectedIds.length === 0} className="h-8 rounded-md border border-slate-300 bg-white px-3 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50">أرشفة</button>
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
                        selectedIds={selectedIds}
                        selectedId={selected?.id ?? null}
                        mailbox={mailbox}
                        archiveView={archiveView}
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
                        selectedIds={selectedIds}
                        selectedId={selected?.id ?? null}
                        mailbox={mailbox}
                        archiveView={archiveView}
                        onSelect={selectMessage}
                        onToggleSelection={toggleMessageSelection}
                      />
                    )}
                  </>
                ) : (
                  messages.map((message) => <MessageListItem key={message.id} message={message} messageTypeOptions={messageTypeOptions} selectedIds={selectedIds} selectedId={selected?.id ?? null} mailbox={mailbox} archiveView={archiveView} onSelect={selectMessage} onToggleSelection={toggleMessageSelection} />)
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
            <div className="flex flex-col gap-3 border-b border-slate-200 bg-slate-50 px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <h3 className="text-lg font-bold text-slate-950">{replySource ? "رد على رسالة" : forwardSource ? "تحويل رسالة" : editingDraftId ? "تحرير مسودة" : "رسالة جديدة"}</h3>
                <p className="mt-1 text-xs text-slate-500">
                  {replySource ? `اكتب ردك على: ${replySource.subject}` : forwardSource ? `سيتم تضمين الرسالة الأصلية: ${forwardSource.subject}` : editingDraftId ? "أكمل المسودة ثم احفظها أو أرسلها." : "اكتب رسالة داخلية مع مستلمين ومرفقات وربط اختياري بطلب."}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {messageSettings.enable_drafts && !replySource && !forwardSource && (
                  <button type="button" onClick={saveDraft} className="flex h-10 items-center gap-2 rounded-md border border-bank-200 bg-bank-50 px-3 text-sm font-bold text-bank-800 hover:bg-bank-100">
                    <Save className="h-4 w-4" />
                    حفظ مسودة
                  </button>
                )}
                <Button type="submit" className="gap-2">
                  <SendHorizonal className="h-4 w-4" />
                  {replySource ? "إرسال الرد" : editingDraftId ? "إرسال المسودة" : "إرسال"}
                </Button>
                <button
                  type="button"
                  onClick={() => {
                    setForm({ recipient_ids: [], message_type: messageSettings.default_message_type || defaultMessageType, subject: "", body: "", related_request_id: "" });
                    setSelectedDepartmentIds([]);
                    setDepartmentRecipientIds([]);
                    setAttachments([]);
                    setRecipientSearch("");
                    setEditingDraftId(null);
                    setForwardSource(null);
                    setReplySource(null);
                  }}
                  className="flex h-10 items-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                >
                  <Eraser className="h-4 w-4" />
                  تفريغ
                </button>
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
                    <div className="grid gap-3 lg:grid-cols-[220px_1fr]">
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
                    {replySource ? (
                      <div className="rounded-md border border-sky-100 bg-sky-50 px-4 py-3 text-sm leading-6 text-sky-900">
                        <p className="font-bold">سيتم الرد على أطراف المحادثة تلقائياً</p>
                        <p className="text-xs text-sky-700">الرسالة الأصلية من: {replySource.sender_name}</p>
                      </div>
                    ) : (
                      <>
                      <div className="rounded-md border border-slate-200 bg-white">
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
                      </div>
                      {messageSettings.enable_circulars && messageSettings.enable_department_broadcasts && messageCapabilities.can_send_department_broadcast && <div className="rounded-md border border-bank-100 bg-bank-50/60 p-3">
                        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                          <span className="text-xs font-bold text-slate-600">تعميم حسب الإدارات</span>
                          <button type="button" onClick={clearDepartmentRecipients} disabled={selectedDepartmentIds.length === 0} className="h-8 rounded-md border border-slate-200 bg-white px-3 text-xs font-bold text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50">
                            مسح الإدارات
                          </button>
                        </div>
                        <div className="grid max-h-40 gap-2 overflow-y-auto rounded-md border border-slate-200 bg-white p-2 sm:grid-cols-2">
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
                          يمكنك اختيار أكثر من إدارة. سيتم تحديث مستلمي الإدارات تلقائياً مع إبقاء المستلمين الذين أضفتهم يدوياً.
                        </p>
                      </div>}
                      </>
                    )}

                  </div>
                </div>
              </div>

              {canUseAiDrafting && (
                <div className="border-t border-slate-100 bg-slate-50/60 p-5">
                  <AIAssistantBox
                    body={form.body}
                    relatedRequestId={form.related_request_id}
                    requestType={form.message_type}
                    onUseDraft={applyAiDraft}
                    onUseBody={applyAiBody}
                  />
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
                        <input type="file" multiple onChange={(event) => setAttachments((current) => [...current, ...Array.from(event.target.files || [])])} className="hidden" />
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
                          placeholder={"مثال:\nتحياتي،\nعبدالله باجرش\nإدارة تقنية المعلومات"}
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
                      <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-700">{messageTypeLabel(selected.message_type)}</span>
                      <h3 className="text-xl font-bold text-slate-950">{selected.subject || "بدون موضوع"}</h3>
                    </div>
                    {selected.related_request_id && (
                      <p className="mt-2 inline-flex items-center gap-2 rounded-md bg-bank-50 px-3 py-1 text-xs font-bold text-bank-700">
                        <Link className="h-3.5 w-3.5" />
                        طلب مرتبط: {selected.related_request_number || selected.related_request_id}
                      </p>
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
                    <button type="button" onClick={restoreSelected} className="inline-flex h-10 items-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50">
                      <Undo2 className="h-4 w-4" />
                      استعادة
                    </button>
                  ) : (
                    <div className="flex flex-wrap items-center gap-2">
                      {canUseAiReplies && (
                        <button type="button" onClick={() => suggestAiReply(selected)} disabled={selectedAiLoading === "reply"} className="inline-flex h-10 items-center gap-2 rounded-md border border-bank-200 bg-bank-50 px-3 text-sm font-bold text-bank-800 hover:bg-bank-100 disabled:cursor-not-allowed disabled:opacity-60">
                          <Sparkles className="h-4 w-4" />
                          {selectedAiLoading === "reply" ? "جاري الاقتراح..." : "اقتراح رد"}
                        </button>
                      )}
                      <button type="button" onClick={() => beginReply(selected)} className="inline-flex h-10 items-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50">
                        <Reply className="h-4 w-4" />
                        رد
                      </button>
                      <button type="button" onClick={() => beginForward(selected)} className="inline-flex h-10 items-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50">
                        <ArrowBigLeftDash className="h-4 w-4" />
                        تحويل
                      </button>
                      <button type="button" onClick={archiveSelected} className="inline-flex h-10 items-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50">
                        <Archive className="h-4 w-4" />
                        أرشفة
                      </button>
                    </div>
                  )}
                </div>
                {canUseAiReplies && selectedAiError && <div className="rounded-md border border-red-100 bg-red-50 p-3 text-sm text-red-700">{selectedAiError}</div>}
                {canUseAiReplies && selectedAiSuggestion?.type === "reply" && (
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
                        <button key={attachment.id} type="button" onClick={() => downloadAttachment(selected.id, attachment)} className="flex items-center justify-between rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-right text-sm hover:bg-bank-50">
                          <span>
                            <span className="block font-semibold text-slate-800">{attachment.original_name}</span>
                            <span className="text-xs text-slate-500">{formatBytes(attachment.size_bytes)}</span>
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
  selectedIds,
  selectedId,
  mailbox,
  archiveView,
  onSelect,
  onToggleSelection
}: {
  title: string;
  count: number;
  messages: InternalMessage[];
  messageTypeOptions: MessageTypeOption[];
  selectedIds: number[];
  selectedId: number | null;
  mailbox: Mailbox;
  archiveView: "inbox" | "sent";
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
        <MessageListItem key={message.id} message={message} messageTypeOptions={messageTypeOptions} selectedIds={selectedIds} selectedId={selectedId} mailbox={mailbox} archiveView={archiveView} onSelect={onSelect} onToggleSelection={onToggleSelection} />
      ))}
    </div>
  );
}

function MessageListItem({
  message,
  messageTypeOptions,
  selectedIds,
  selectedId,
  mailbox,
  archiveView,
  onSelect,
  onToggleSelection
}: {
  message: InternalMessage;
  messageTypeOptions: MessageTypeOption[];
  selectedIds: number[];
  selectedId: number | null;
  mailbox: Mailbox;
  archiveView: "inbox" | "sent";
  onSelect: (message: InternalMessage) => void;
  onToggleSelection: (messageId: number) => void;
}) {
  const isInboxLike = mailbox === "inbox" || (mailbox === "archived" && archiveView === "inbox");
  const messageDate = message.is_draft ? message.updated_at || message.created_at : message.created_at;
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
            <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-600">{getMessageTypeLabel(message.message_type, messageTypeOptions)}</span>
            <p className={`min-w-0 flex-1 truncate font-semibold ${message.is_read ? "text-slate-700" : "text-slate-950"}`}>{message.subject || "بدون موضوع"}</p>
          </div>
          <p className="mt-1 truncate text-xs text-slate-500">
            {message.is_draft ? `مسودة - ${formatDate(messageDate)}` : isInboxLike ? message.sender_name : message.recipient_names.join("، ")}
          </p>
          {message.message_uid && <p className="mt-1 truncate text-[11px] font-bold text-slate-400">معرف الرسالة: {message.message_uid}</p>}
        </div>
        {!message.is_read && mailbox === "inbox" && <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full bg-bank-700" />}
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

function Tab({ active, onClick, icon: Icon, label, collapsed = false, featured = false }: { active: boolean; onClick: () => void; icon: typeof Mail; label: string; collapsed?: boolean; featured?: boolean }) {
  if (featured) {
    return (
      <button
        type="button"
        onClick={onClick}
        title={label}
        className={`relative flex h-11 items-center justify-center gap-2 rounded-md border-2 border-bank-700 bg-white text-xs font-bold text-bank-700 shadow-sm transition hover:bg-bank-50 focus:outline-none focus:ring-2 focus:ring-bank-100 ${active ? "bg-bank-50 ring-2 ring-bank-100" : ""} ${collapsed ? "w-full px-0" : "px-3"}`}
      >
        <Icon className="relative h-5 w-5" />
        {!collapsed && <span className="relative">{label}</span>}
      </button>
    );
  }
  return (
    <button type="button" onClick={onClick} title={label} className={`flex h-10 items-center justify-center gap-2 rounded-md text-xs font-bold ${active ? "bg-bank-50 text-bank-700" : "text-slate-600 hover:bg-slate-50"} ${collapsed ? "w-full" : ""}`}>
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
