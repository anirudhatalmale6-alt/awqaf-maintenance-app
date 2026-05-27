import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { customApi } from "@/lib/customApi";

export interface WarrantyItem {
  id: number;
  title: string;
  description?: string | null;
  category?: string | null;
  category_value?: string | null;
  mosque_id?: number | null;
  mosque_name?: string | null;
  region_id?: number | null;
  region_name?: string | null;
  contractor_id?: number | null;
  contractor_label?: string | null;
  contractor_value?: string | null;
  start_date: string;
  duration_months: number;
  end_date: string;
  cost?: number | null;
  status: "active" | "expired" | "claimed" | "cancelled";
  source_type?: string | null;
  source_id?: number | null;
  claim_count: number;
  last_claim_at?: string | null;
  claim_notes?: string | null;
  notes?: string | null;
  is_archived: boolean;
  created_by?: string | null;
  created_by_name?: string | null;
  creator_role?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  days_remaining?: number | null;
  is_expiring_soon: boolean;
}

export interface WarrantyTopMosque {
  mosque_id?: number | null;
  mosque_name?: string | null;
  claim_count: number;
}

export interface WarrantyTopCategory {
  category?: string | null;
  category_value?: string | null;
  claim_count: number;
}

export interface WarrantyTopContractor {
  contractor_id?: number | null;
  contractor_name?: string | null;
  claim_count: number;
}

export interface WarrantyStats {
  total: number;
  active: number;
  expired: number;
  claimed: number;
  cancelled: number;
  expiring_soon: number;
  by_status?: Record<string, number>;
  by_category?: Record<string, number>;
  expiring_within_30_days?: number;
  top_claimed_mosque?: WarrantyTopMosque | null;
  top_claimed_category?: WarrantyTopCategory | null;
  top_claimed_contractor?: WarrantyTopContractor | null;
}

export interface WarrantyListFilters {
  status?: string;
  mosque_id?: number;
  contractor_id?: number;
  expiring_within_days?: number;
  search?: string;
  include_archived?: boolean;
}

const WARRANTIES_KEY = ["warranties"] as const;

export function useWarranties(filters: WarrantyListFilters = {}) {
  return useQuery({
    queryKey: [...WARRANTIES_KEY, filters],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (filters.status) params.set("status", filters.status);
      if (filters.mosque_id != null) params.set("mosque_id", String(filters.mosque_id));
      if (filters.contractor_id != null) params.set("contractor_id", String(filters.contractor_id));
      if (filters.expiring_within_days != null)
        params.set("expiring_within_days", String(filters.expiring_within_days));
      if (filters.search) params.set("search", filters.search);
      if (filters.include_archived) params.set("include_archived", "true");
      const qs = params.toString();
      const url = `/api/v1/warranties/list${qs ? `?${qs}` : ""}`;
      const res = await customApi<WarrantyItem[]>(url, "GET");
      return res.data;
    },
    staleTime: 30_000,
  });
}

export function useWarrantyStats() {
  return useQuery({
    queryKey: [...WARRANTIES_KEY, "stats"],
    queryFn: async () => {
      const res = await customApi<WarrantyStats>("/api/v1/warranties/stats", "GET");
      return res.data;
    },
    staleTime: 30_000,
  });
}

export interface CreateWarrantyPayload {
  title: string;
  description?: string;
  category?: string;
  category_value?: string;
  mosque_id?: number;
  mosque_name?: string;
  region_id?: number;
  region_name?: string;
  contractor_id?: number;
  contractor_label?: string;
  contractor_value?: string;
  start_date: string;
  duration_months: number;
  cost?: number;
  notes?: string;
  source_type?: string;
  source_id?: number;
}

export function useCreateWarranty() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: CreateWarrantyPayload) => {
      console.log("[useCreateWarranty] sending payload", payload);
      const res = await customApi<WarrantyItem>(
        "/api/v1/warranties/create",
        "POST",
        payload,
      );
      console.log("[useCreateWarranty] response", res);
      return res.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: WARRANTIES_KEY });
    },
    onError: (err) => {
      console.error("[useCreateWarranty] error", err);
    },
  });
}

export interface UpdateWarrantyPayload extends Partial<CreateWarrantyPayload> {
  id: number;
  status?: "active" | "expired" | "claimed" | "cancelled";
}

export function useUpdateWarranty() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: UpdateWarrantyPayload) => {
      const res = await customApi<WarrantyItem>(
        "/api/v1/warranties/update",
        "POST",
        payload,
      );
      return res.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: WARRANTIES_KEY });
    },
    onError: (err) => {
      console.error("[useUpdateWarranty] error", err);
    },
  });
}

export interface ClaimWarrantyPayload {
  id: number;
  claim_notes?: string;
  /** Direct user ids to notify after claim is recorded. */
  notify_user_ids?: string[];
}

export function useClaimWarranty() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: ClaimWarrantyPayload) => {
      const res = await customApi<WarrantyItem>(
        "/api/v1/warranties/claim",
        "POST",
        payload,
      );
      return res.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: WARRANTIES_KEY });
    },
    onError: (err) => {
      console.error("[useClaimWarranty] error", err);
    },
  });
}

export interface WarrantyNotifyUser {
  id: string;
  name?: string | null;
  email?: string | null;
  role?: string | null;
}

/** Lightweight users list for the warranty notification target picker. */
export function useWarrantyNotifyUsers(enabled: boolean = true) {
  return useQuery({
    queryKey: ["warranty-notify-users"],
    enabled,
    queryFn: async () => {
      const res = await customApi<WarrantyNotifyUser[]>(
        "/api/v1/warranties/notify-user-options",
        "GET",
      );
      return res.data || [];
    },
    staleTime: 5 * 60 * 1000,
  });
}

export function useDeleteWarranty() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      const res = await customApi<{ message: string; deleted_id: number }>(
        "/api/v1/warranties/delete",
        "POST",
        { id },
      );
      return res.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: WARRANTIES_KEY });
    },
    onError: (err) => {
      console.error("[useDeleteWarranty] error", err);
    },
  });
}

export interface BulkCreateWarrantiesPayload {
  items: CreateWarrantyPayload[];
}

export interface BulkCreateWarrantiesResponse {
  created: number;
  failed: number;
  created_ids: number[];
  errors: string[];
}

export function useBulkCreateWarranties() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: BulkCreateWarrantiesPayload) => {
      const res = await customApi<BulkCreateWarrantiesResponse>(
        "/api/v1/warranties/bulk-create",
        "POST",
        payload,
      );
      return res.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: WARRANTIES_KEY });
    },
    onError: (err) => {
      console.error("[useBulkCreateWarranties] error", err);
    },
  });
}

export interface DeleteWarrantyClaimPayload {
  warranty_id: number;
  claim_index: number;
}

/**
 * Delete a single previous claim entry from a warranty's claim_notes.
 * `claim_index` is 0-based and matches the order entries appear in the
 * parsed claim list (earliest first).
 */
export function useDeleteWarrantyClaim() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: DeleteWarrantyClaimPayload) => {
      const res = await customApi<WarrantyItem>(
        "/api/v1/warranties/delete-claim",
        "POST",
        payload,
      );
      return res.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: WARRANTIES_KEY });
    },
    onError: (err) => {
      console.error("[useDeleteWarrantyClaim] error", err);
    },
  });
}

export interface BulkDeleteWarrantiesPayload {
  ids: number[];
}

export interface BulkDeleteWarrantiesResponse {
  deleted: number;
  failed: number;
  deleted_ids: number[];
  errors: string[];
}

export function useBulkDeleteWarranties() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: BulkDeleteWarrantiesPayload) => {
      const res = await customApi<BulkDeleteWarrantiesResponse>(
        "/api/v1/warranties/bulk-delete",
        "POST",
        payload,
      );
      return res.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: WARRANTIES_KEY });
    },
    onError: (err) => {
      console.error("[useBulkDeleteWarranties] error", err);
    },
  });
}