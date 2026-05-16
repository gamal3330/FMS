export const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "/api/v1";
export const IS_DOTNET_API = API_BASE.includes("/api/dotnet/");

export type RequestStatus = "draft" | "submitted" | "pending_approval" | "returned_for_edit" | "approved" | "rejected" | "in_implementation" | "completed" | "closed" | "cancelled";

export type ApprovalAction = "waiting" | "pending" | "approved" | "rejected" | "returned_for_edit" | "skipped";

export type UserRole =
  | "employee"
  | "direct_manager"
  | "it_staff"
  | "administration_manager"
  | "executive_management"
  | "super_admin";

export interface CurrentUser {
  id: number;
  employee_id: string;
  username?: string | null;
  full_name_ar: string;
  full_name_en: string;
  email: string;
  mobile?: string | null;
  role: UserRole;
  administrative_section?: string | null;
  administrative_section_label?: string | null;
  specialized_section_id?: number | null;
  specialized_section?: { id: number; code: string; name_ar: string; name_en?: string | null } | null;
  force_password_change?: boolean;
  is_active: boolean;
  department?: { id: number; name_ar: string; name_en: string } | null;
  permissions?: string[];
}

export interface ApprovalStep {
  id: number;
  step_order: number;
  role: string;
  display_label?: string | null;
  target_department_name_ar?: string | null;
  approver_role_name_ar?: string | null;
  action: ApprovalAction;
  can_reject?: boolean;
  can_return_for_edit?: boolean;
  can_act?: boolean;
  note?: string | null;
  acted_at?: string | null;
  action_by?: CurrentUser | null;
  approver?: CurrentUser | null;
}

export interface RequestComment {
  id: number;
  body: string;
  is_internal: boolean;
  created_at: string;
}

export interface Attachment {
  id: number;
  original_name: string;
  content_type: string;
  size_bytes: number;
  created_at: string;
}

export interface ServiceRequest {
  id: number;
  request_number: string;
  title: string;
  request_type: string;
  request_type_id?: number | null;
  request_type_version_number?: number;
  status: RequestStatus;
  priority: string;
  created_at: string;
  updated_at: string;
  sla_due_at?: string | null;
  closed_at?: string | null;
  form_data: Record<string, string>;
  request_type_snapshot?: Record<string, unknown>;
  form_schema_snapshot?: Array<{ field_name: string; label_ar?: string; label_en?: string; field_type?: string; sort_order?: number }>;
  business_justification?: string | null;
  requester: { id: number; full_name_ar: string; email: string };
  assigned_to?: { id: number; full_name_ar: string; email: string } | null;
  department?: { name_ar: string };
  specialized_department?: { name_ar: string };
  approvals?: ApprovalStep[];
  comments?: RequestComment[];
  attachments?: Attachment[];
}

export async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = localStorage.getItem("qib_token");
  const isFormData = options.body instanceof FormData;
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      ...(isFormData ? {} : { "Content-Type": "application/json" }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers
    }
  });
  if (!response.ok) {
    if (response.status === 401 && localStorage.getItem("qib_token")) {
      localStorage.removeItem("qib_token");
      window.dispatchEvent(new Event("qib-session-ended"));
    }
    throw new Error(await response.text());
  }
  if (response.status === 204) {
    return undefined as T;
  }
  const data = await response.json();
  return normalizeApiResponse(path, data) as T;
}

function normalizeApiResponse(path: string, data: unknown): unknown {
  if (!IS_DOTNET_API || !data || typeof data !== "object") {
    return data;
  }

  if (path === "/auth/me") {
    return normalizeCurrentUser(data as Record<string, unknown>);
  }

  const cleanPath = path.split("?")[0];
  if (cleanPath === "/approvals/summary") {
    return normalizeApprovalsSummary(data as Record<string, unknown>);
  }

  if (cleanPath === "/approvals" && Array.isArray(data)) {
    return data.map((item) => normalizeApprovalQueueItem(item as Record<string, unknown>));
  }

  if (cleanPath === "/requests" && Array.isArray(data)) {
    return data.map((item) => normalizeRequestDto(item as Record<string, unknown>));
  }

  if (
    cleanPath === "/requests/dynamic" ||
    /^\/requests\/\d+$/.test(cleanPath) ||
    /^\/requests\/\d+\/approval$/.test(cleanPath) ||
    /^\/requests\/\d+\/resubmit$/.test(cleanPath) ||
    /^\/approvals\/\d+$/.test(cleanPath)
  ) {
    return normalizeRequestResponse(data as Record<string, unknown>);
  }

  return data;
}

function normalizeCurrentUser(user: Record<string, unknown>): CurrentUser {
  const role = user.role as Record<string, unknown> | string | null | undefined;
  const department = user.department as Record<string, unknown> | null | undefined;
  const specializedSection = user.specializedSection as Record<string, unknown> | null | undefined;
  const roleCode = typeof role === "string" ? role : String(role?.code ?? "employee");
  const specializedSectionCode = getString(user, "specializedSectionCode", "specialized_section_code", "administrative_section");
  const specializedSectionName = getString(user, "specializedSectionNameAr", "specialized_section_name_ar", "administrative_section_label");
  const specializedSectionId = getNumberOrNull(user, "specializedSectionId", "specialized_section_id");

  return {
    id: Number(user.id),
    employee_id: String(user.employeeNumber ?? user.employee_id ?? ""),
    username: String(user.username ?? ""),
    full_name_ar: String(user.nameAr ?? user.full_name_ar ?? user.username ?? "مستخدم النظام"),
    full_name_en: String(user.nameEn ?? user.full_name_en ?? user.username ?? ""),
    email: String(user.email ?? ""),
    role: roleCode as UserRole,
    administrative_section: specializedSectionCode || null,
    administrative_section_label: specializedSectionName || null,
    specialized_section_id: specializedSectionId,
    specialized_section:
      specializedSection || specializedSectionId || specializedSectionCode
        ? {
            id: Number(specializedSection?.id ?? specializedSectionId ?? 0),
            code: String(specializedSection?.code ?? specializedSectionCode ?? ""),
            name_ar: String(specializedSection?.nameAr ?? specializedSection?.name_ar ?? specializedSectionName ?? ""),
            name_en: specializedSection?.nameEn != null || specializedSection?.name_en != null ? String(specializedSection?.nameEn ?? specializedSection?.name_en) : null
          }
        : null,
    force_password_change: Boolean(user.forcePasswordChange ?? user.force_password_change),
    is_active: Boolean(user.isActive ?? user.is_active ?? true),
    department: department
      ? {
          id: Number(department.id),
          name_ar: String(department.nameAr ?? department.name_ar ?? ""),
          name_en: String(department.nameEn ?? department.name_en ?? "")
        }
      : null,
    permissions: Array.isArray(user.permissions) ? user.permissions.map((permission) => String(permission)) : []
  };
}

function normalizeApprovalsSummary(summary: Record<string, unknown>) {
  return {
    waiting_my_approval: Number(getValue(summary, "waiting_my_approval", "pendingMyApproval") ?? 0),
    tracking: Number(getValue(summary, "tracking") ?? 0),
    waiting_execution: Number(getValue(summary, "waiting_execution", "pendingExecution") ?? 0),
    returned_for_edit: Number(getValue(summary, "returned_for_edit", "returnedForEdit") ?? 0),
    overdue: Number(getValue(summary, "overdue") ?? 0),
    processed_today: Number(getValue(summary, "processed_today", "completedToday") ?? 0)
  };
}

function normalizeRequestResponse(data: Record<string, unknown>): unknown {
  if (!data || typeof data !== "object") {
    return data;
  }

  if ("request" in data || "fields" in data || "workflow" in data) {
    const request = normalizeRequestDto((getValue(data, "request") as Record<string, unknown>) ?? data);
    const fields = (getValue(data, "fields") as Array<Record<string, unknown>> | undefined) ?? [];
    const workflow = (getValue(data, "workflow") as Array<Record<string, unknown>> | undefined) ?? [];
    const attachments = (getValue(data, "attachments") as Array<Record<string, unknown>> | undefined) ?? [];
    const statusHistory = (getValue(data, "statusHistory", "status_history") as Array<Record<string, unknown>> | undefined) ?? [];

    return {
      ...request,
      form_data: {
        ...request.form_data,
        ...normalizeFieldSnapshots(fields)
      },
      form_schema_snapshot: fields.map(normalizeFieldSchemaSnapshot),
      approvals: workflow.map(normalizeWorkflowStep),
      attachments: attachments.map(normalizeAttachment),
      status_history: statusHistory.map(normalizeStatusHistory)
    };
  }

  return normalizeRequestDto(data);
}

function normalizeApprovalQueueItem(item: Record<string, unknown>): ServiceRequest {
  const requestTypeName = getString(item, "requestTypeNameAr", "request_type_name_ar") || String(getValue(item, "requestTypeId", "request_type_id") ?? "");
  const sectionName = getString(item, "specializedSectionNameAr", "specialized_section_name_ar") || "";
  const departmentName = getString(item, "departmentNameAr", "department_name_ar") || "";
  const specializedDepartmentName = getString(item, "specializedDepartmentNameAr", "specialized_department_name_ar") || "";
  const currentStepType = getString(item, "currentStepType", "current_step_type") || "";
  const currentStepName = getString(item, "currentStepNameAr", "current_step_name_ar") || currentStepType;
  const currentStepStatus = getString(item, "currentStepStatus", "current_step_status") || "pending";

  return {
    id: getNumber(item, "requestId", "request_id", "id"),
    request_number: getString(item, "requestNumber", "request_number"),
    title: getString(item, "title"),
    request_type: requestTypeName,
    request_type_id: getNumberOrNull(item, "requestTypeId", "request_type_id"),
    status: getString(item, "status") as RequestStatus,
    priority: normalizePriorityCode(getString(item, "priority")),
    created_at: getString(item, "createdAt", "created_at"),
    updated_at: getString(item, "submittedAt", "submitted_at", "createdAt", "created_at"),
    sla_due_at: getString(item, "currentStepSlaDueAt", "current_step_sla_due_at", "slaResolutionDueAt", "sla_resolution_due_at"),
    closed_at: null,
    form_data: {
      request_type_label: requestTypeName,
      assigned_section_label: sectionName,
      administrative_section_label: sectionName,
      assigned_department_name: specializedDepartmentName || departmentName
    },
    request_type_snapshot: {
      name_ar: requestTypeName,
      specialized_section_name: sectionName,
      assigned_section_label: sectionName,
      assigned_department_name: specializedDepartmentName || departmentName
    },
    requester: {
      id: getNumber(item, "requesterId", "requester_id"),
      full_name_ar: getString(item, "requesterNameAr", "requester_name_ar") || "-",
      email: ""
    },
    assigned_to: null,
    department: departmentName ? { name_ar: departmentName } : undefined,
    specialized_department: specializedDepartmentName ? { name_ar: specializedDepartmentName } : undefined,
    approvals: [
      {
        id: getNumber(item, "currentStepId", "current_step_id"),
        step_order: 1,
        role: currentStepType,
        display_label: currentStepName,
        action: normalizeApprovalAction(currentStepStatus),
        can_reject: Boolean(getValue(item, "canReject", "can_reject")),
        can_return_for_edit: Boolean(getValue(item, "canReturnForEdit", "can_return_for_edit")),
        can_act: Boolean(
          getValue(item, "canApprove", "can_approve") ||
            getValue(item, "canReject", "can_reject") ||
            getValue(item, "canReturnForEdit", "can_return_for_edit") ||
            getValue(item, "canExecute", "can_execute") ||
            getValue(item, "canClose", "can_close")
        ),
        acted_at: getString(item, "currentStepPendingAt", "current_step_pending_at"),
        action_by: null,
        note: null,
        approver: null
      }
    ],
    attachments: []
  };
}

function normalizeRequestDto(item: Record<string, unknown>): ServiceRequest {
  const requestTypeName = getString(item, "requestTypeNameAr", "request_type_name_ar", "request_type") || String(getValue(item, "requestTypeId", "request_type_id") ?? "");
  const sectionName = getString(item, "specializedSectionNameAr", "specialized_section_name_ar") || "";
  const departmentName = getString(item, "departmentNameAr", "department_name_ar") || "";
  const specializedDepartmentName = getString(item, "specializedDepartmentNameAr", "specialized_department_name_ar") || "";
  const formData = parseObject(getValue(item, "formData", "form_data"));

  return {
    id: getNumber(item, "id"),
    request_number: getString(item, "requestNumber", "request_number"),
    title: getString(item, "title"),
    request_type: requestTypeName,
    request_type_id: getNumberOrNull(item, "requestTypeId", "request_type_id"),
    request_type_version_number: getNumberOrUndefined(item, "requestTypeVersionNumber", "request_type_version_number"),
    status: getString(item, "status") as RequestStatus,
    priority: normalizePriorityCode(getString(item, "priority")),
    created_at: getString(item, "createdAt", "created_at"),
    updated_at: getString(item, "updatedAt", "updated_at", "submittedAt", "submitted_at", "createdAt", "created_at"),
    sla_due_at: getString(item, "slaResolutionDueAt", "sla_resolution_due_at", "sla_due_at"),
    closed_at: getStringOrNull(item, "closedAt", "closed_at"),
    form_data: {
      ...formData,
      request_type_label: String(formData.request_type_label ?? requestTypeName),
      assigned_section_label: String(formData.assigned_section_label ?? sectionName),
      administrative_section_label: String(formData.administrative_section_label ?? sectionName),
      assigned_department_name: specializedDepartmentName || String(formData.assigned_department_name ?? departmentName)
    },
    request_type_snapshot: {
      name_ar: requestTypeName,
      specialized_section_name: sectionName,
      assigned_section_label: sectionName,
      assigned_department_name: specializedDepartmentName || departmentName
    },
    requester: {
      id: getNumber(item, "requesterId", "requester_id"),
      full_name_ar: getString(item, "requesterNameAr", "requester_name_ar") || "-",
      email: ""
    },
    assigned_to: getNumberOrNull(item, "assignedToId", "assigned_to_id")
      ? {
          id: getNumber(item, "assignedToId", "assigned_to_id"),
          full_name_ar: getString(item, "assignedToNameAr", "assigned_to_name_ar") || "-",
          email: ""
        }
      : null,
    department: departmentName ? { name_ar: departmentName } : undefined,
    specialized_department: specializedDepartmentName ? { name_ar: specializedDepartmentName } : undefined,
    approvals: [],
    attachments: []
  };
}

function normalizeFieldSnapshots(fields: Array<Record<string, unknown>>): Record<string, string> {
  return fields.reduce<Record<string, string>>((acc, field) => {
    const name = getString(field, "fieldName", "field_name");
    if (!name) return acc;
    const valueJson = getStringOrNull(field, "valueJson", "value_json");
    if (valueJson) {
      try {
        acc[name] = JSON.parse(valueJson);
      } catch {
        acc[name] = valueJson;
      }
      return acc;
    }
    const value = getValue(field, "valueText", "value_text", "valueNumber", "value_number", "valueDate", "value_date");
    acc[name] = value == null ? "" : String(value);
    return acc;
  }, {});
}

function normalizeFieldSchemaSnapshot(field: Record<string, unknown>) {
  return {
    field_name: getString(field, "fieldName", "field_name"),
    label_ar: getString(field, "labelAr", "label_ar"),
    label_en: getString(field, "labelEn", "label_en"),
    field_type: getString(field, "fieldType", "field_type"),
    sort_order: getNumberOrUndefined(field, "sortOrder", "sort_order")
  };
}

function normalizeWorkflowStep(step: Record<string, unknown>): ApprovalStep {
  const status = getString(step, "status") || "waiting";
  return {
    id: getNumber(step, "id"),
    step_order: getNumber(step, "sortOrder", "sort_order"),
    role: getString(step, "stepType", "step_type"),
    display_label: getStringOrNull(step, "stepNameAr", "step_name_ar"),
    target_department_name_ar: getStringOrNull(step, "targetDepartmentNameAr", "target_department_name_ar"),
    approver_role_name_ar: getStringOrNull(step, "approverRoleNameAr", "approver_role_name_ar"),
    action: normalizeApprovalAction(status),
    can_reject: Boolean(getValue(step, "canReject", "can_reject")),
    can_return_for_edit: Boolean(getValue(step, "canReturnForEdit", "can_return_for_edit")),
    can_act: Boolean(getValue(step, "canAct", "can_act")),
    note: getStringOrNull(step, "comments"),
    acted_at: getStringOrNull(step, "actionAt", "action_at", "pendingAt", "pending_at"),
    action_by: getNumberOrNull(step, "actionByUserId", "action_by_user_id")
      ? ({
          id: getNumber(step, "actionByUserId", "action_by_user_id"),
          employee_id: "",
          full_name_ar: getString(step, "actionByNameAr", "action_by_name_ar") || "-",
          full_name_en: "",
          email: "",
          role: "employee",
          is_active: true
        } as CurrentUser)
      : null,
    approver: getNumberOrNull(step, "approverUserId", "approver_user_id")
      ? ({
          id: getNumber(step, "approverUserId", "approver_user_id"),
          employee_id: "",
          full_name_ar: getString(step, "approverUserNameAr", "approver_user_name_ar") || "-",
          full_name_en: "",
          email: "",
          role: "employee",
          is_active: true
        } as CurrentUser)
      : null
  };
}

function normalizeAttachment(item: Record<string, unknown>): Attachment {
  return {
    id: getNumber(item, "id"),
    original_name: getString(item, "fileName", "file_name", "original_name"),
    content_type: getString(item, "contentType", "content_type"),
    size_bytes: getNumber(item, "fileSize", "file_size", "size_bytes"),
    created_at: getString(item, "uploadedAt", "uploaded_at", "created_at")
  };
}

function normalizeStatusHistory(item: Record<string, unknown>) {
  return {
    id: getNumber(item, "id"),
    old_status: getStringOrNull(item, "oldStatus", "old_status"),
    new_status: getString(item, "newStatus", "new_status"),
    changed_by: getStringOrNull(item, "changedByNameAr", "changed_by_name_ar"),
    changed_at: getString(item, "changedAt", "changed_at"),
    comment: getStringOrNull(item, "comment")
  };
}

function normalizeApprovalAction(status: string): ApprovalAction {
  if (status === "approved" || status === "executed" || status === "closed" || status === "completed") return "approved";
  if (status === "rejected") return "rejected";
  if (status === "returned_for_edit") return "returned_for_edit";
  if (status === "pending") return "pending";
  if (status === "skipped") return "skipped";
  return "waiting";
}

function normalizePriorityCode(value?: string | null): string {
  if (value === "normal") return "medium";
  return value || "medium";
}

function getValue(source: Record<string, unknown>, ...names: string[]): unknown {
  for (const name of names) {
    if (Object.prototype.hasOwnProperty.call(source, name)) {
      return source[name];
    }
  }
  return undefined;
}

function getString(source: Record<string, unknown>, ...names: string[]): string {
  const value = getValue(source, ...names);
  return value == null ? "" : String(value);
}

function getStringOrNull(source: Record<string, unknown>, ...names: string[]): string | null {
  const value = getValue(source, ...names);
  return value == null ? null : String(value);
}

function getNumber(source: Record<string, unknown>, ...names: string[]): number {
  const value = getValue(source, ...names);
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function getNumberOrNull(source: Record<string, unknown>, ...names: string[]): number | null {
  const value = getValue(source, ...names);
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function getNumberOrUndefined(source: Record<string, unknown>, ...names: string[]): number | undefined {
  return getNumberOrNull(source, ...names) ?? undefined;
}

function parseObject(value: unknown): Record<string, string> {
  if (!value) return {};
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
  return typeof value === "object" && !Array.isArray(value) ? (value as Record<string, string>) : {};
}
