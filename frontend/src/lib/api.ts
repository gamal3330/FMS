export const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "/api/v1";

export type RequestStatus = "draft" | "submitted" | "pending_approval" | "returned_for_edit" | "approved" | "rejected" | "in_implementation" | "completed" | "closed" | "cancelled";

export type ApprovalAction = "pending" | "approved" | "rejected" | "returned_for_edit" | "skipped";

export type UserRole =
  | "employee"
  | "direct_manager"
  | "it_staff"
  | "it_manager"
  | "information_security"
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
  is_active: boolean;
  department?: { id: number; name_ar: string; name_en: string } | null;
}

export interface ApprovalStep {
  id: number;
  step_order: number;
  role: string;
  action: ApprovalAction;
  can_return_for_edit?: boolean;
  note?: string | null;
  acted_at?: string | null;
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
  status: RequestStatus;
  priority: string;
  created_at: string;
  updated_at: string;
  sla_due_at?: string | null;
  closed_at?: string | null;
  form_data: Record<string, string>;
  business_justification?: string | null;
  requester: { id: number; full_name_ar: string; email: string };
  department?: { name_ar: string };
  approvals?: ApprovalStep[];
  comments?: RequestComment[];
  attachments?: Attachment[];
}

export async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = localStorage.getItem("qib_token");
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers
    }
  });
  if (!response.ok) {
    throw new Error(await response.text());
  }
  if (response.status === 204) {
    return undefined as T;
  }
  return response.json();
}
