export type DocumentClassification = "public" | "internal" | "confidential" | "top_secret";

export interface DocumentCategory {
  id: number;
  name_ar: string;
  name_en?: string | null;
  code: string;
  description?: string | null;
  icon?: string | null;
  color?: string | null;
  sort_order: number;
  is_active: boolean;
  documents_count?: number;
  last_updated_at?: string | null;
}

export interface DocumentVersion {
  id: number;
  version_number: number;
  file_name: string;
  file_size: number;
  mime_type: string;
  checksum: string;
  issue_date?: string | null;
  effective_date?: string | null;
  review_date?: string | null;
  uploaded_at?: string | null;
  change_summary?: string | null;
  is_current: boolean;
}

export interface LibraryDocument {
  id: number;
  title_ar: string;
  title_en?: string | null;
  document_number?: string | null;
  description?: string | null;
  classification: DocumentClassification;
  status: string;
  requires_acknowledgement: boolean;
  keywords?: string | null;
  is_active: boolean;
  created_at?: string | null;
  updated_at?: string | null;
  category: DocumentCategory;
  owner_department?: { id: number; name_ar: string; name_en?: string | null } | null;
  current_version?: DocumentVersion | null;
  acknowledged?: boolean;
  capabilities?: {
    can_view: boolean;
    can_download: boolean;
    can_print: boolean;
    can_manage: boolean;
  };
}
