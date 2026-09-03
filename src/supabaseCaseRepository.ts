import "dotenv/config";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  CaseService,
  DuplicateCaseReferenceError,
  type CaseEventInput,
  type CaseRecord,
  type CaseRepository,
  type CustomerIdentity,
  type CustomerRecord,
} from "./caseManagement.js";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export class SupabaseCaseRepository implements CaseRepository {
  constructor(private readonly supabase: SupabaseClient) {}

  async findCustomers(identity: CustomerIdentity): Promise<CustomerRecord[]> {
    const matches = new Map<string, CustomerRecord>();
    const signals = [
      ["external_customer_id", identity.external_customer_id],
      ["normalized_email", identity.normalized_email],
      ["normalized_phone", identity.normalized_phone],
    ] as const;
    for (const [column, value] of signals) {
      if (!value) continue;
      const { data, error } = await this.supabase.from("customers").select("*").eq(column, value);
      if (error) throw new Error(`Failed to resolve customer: ${error.message}`);
      for (const record of data as CustomerRecord[]) matches.set(record.id, record);
    }
    return [...matches.values()];
  }

  async getCustomer(id: string): Promise<CustomerRecord | null> {
    const { data, error } = await this.supabase.from("customers").select("*").eq("id", id).maybeSingle();
    if (error) throw new Error(`Failed to fetch customer: ${error.message}`);
    return data as CustomerRecord | null;
  }

  async createCustomer(identity: CustomerIdentity, now: string): Promise<CustomerRecord> {
    const { data, error } = await this.supabase.from("customers")
      .insert({ ...identity, created_at: now, updated_at: now }).select("*").single();
    if (error) throw new Error(`Failed to create customer: ${error.message}`);
    return data as CustomerRecord;
  }

  async updateCustomer(id: string, identity: CustomerIdentity, now: string): Promise<CustomerRecord> {
    const { data, error } = await this.supabase.from("customers")
      .update({ ...identity, updated_at: now }).eq("id", id).select("*").single();
    if (error) throw new Error(`Failed to update customer: ${error.message}`);
    return data as CustomerRecord;
  }

  async getCaseByReference(caseReference: string): Promise<CaseRecord | null> {
    const { data, error } = await this.supabase.from("cases").select("*")
      .eq("case_reference", caseReference).maybeSingle();
    if (error) throw new Error(`Failed to fetch case: ${error.message}`);
    return data as CaseRecord | null;
  }

  async listOpenCases(customerId: string): Promise<CaseRecord[]> {
    const { data, error } = await this.supabase.from("cases").select("*")
      .eq("customer_id", customerId).neq("status", "resolved").order("created_at", { ascending: false });
    if (error) throw new Error(`Failed to list customer cases: ${error.message}`);
    return data as CaseRecord[];
  }

  async createCase(input: Omit<CaseRecord, "id">): Promise<CaseRecord> {
    const { data, error } = await this.supabase.from("cases").insert(input).select("*").single();
    if (error?.code === "23505") throw new DuplicateCaseReferenceError("Duplicate case reference.");
    if (error) throw new Error(`Failed to create case: ${error.message}`);
    return data as CaseRecord;
  }

  async updateCase(id: string, changes: Partial<Pick<CaseRecord, "status" | "updated_at" | "resolved_at">>): Promise<CaseRecord> {
    const { data, error } = await this.supabase.from("cases").update(changes).eq("id", id).select("*").single();
    if (error) throw new Error(`Failed to update case: ${error.message}`);
    return data as CaseRecord;
  }

  async addCaseEvent(input: CaseEventInput, now: string): Promise<void> {
    const { error } = await this.supabase.from("case_events").insert({ ...input, created_at: now });
    if (error) throw new Error(`Failed to record case event: ${error.message}`);
  }
}

let defaultService: CaseService | undefined;

export function getDefaultCaseService(): CaseService {
  if (defaultService) return defaultService;
  const configuredTat = Number.parseFloat(process.env.CUSTOMER_RESPONSE_TAT_HOURS ?? "24");
  const client = createClient(requireEnv("SUPABASE_URL"), requireEnv("SUPABASE_SECRET_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  defaultService = new CaseService(new SupabaseCaseRepository(client), { responseTatHours: configuredTat });
  return defaultService;
}
