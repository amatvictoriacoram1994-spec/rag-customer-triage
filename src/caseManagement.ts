import { randomBytes, randomUUID } from "node:crypto";

export type CaseStatus = "open" | "awaiting_customer" | "action_pending" | "escalated" | "resolved";
export type ActionStatus = "none" | "pending" | "unclear";

export interface CustomerIdentityInput {
  external_customer_id?: string;
  email?: string;
  phone?: string;
}

export interface CustomerIdentity {
  external_customer_id: string | null;
  normalized_email: string | null;
  normalized_phone: string | null;
}

export interface CustomerRecord extends CustomerIdentity {
  id: string;
  created_at: string;
  updated_at: string;
}

export interface CaseRecord {
  id: string;
  case_reference: string;
  customer_id: string;
  order_id: string | null;
  summary: string;
  status: CaseStatus;
  decision_due_at: string;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
}

export interface CaseEventInput {
  case_id: string;
  request_id: string;
  source: string;
  external_message_id: string | null;
  event_type: string;
  decision_type?: string | null;
  confidence?: string | null;
  action_status?: ActionStatus | null;
}

export interface CaseRepository {
  findCustomers(identity: CustomerIdentity): Promise<CustomerRecord[]>;
  getCustomer(id: string): Promise<CustomerRecord | null>;
  createCustomer(identity: CustomerIdentity, now: string): Promise<CustomerRecord>;
  updateCustomer(id: string, identity: CustomerIdentity, now: string): Promise<CustomerRecord>;
  getCaseByReference(caseReference: string): Promise<CaseRecord | null>;
  listOpenCases(customerId: string): Promise<CaseRecord[]>;
  createCase(input: Omit<CaseRecord, "id">): Promise<CaseRecord>;
  updateCase(id: string, changes: Partial<Pick<CaseRecord, "status" | "updated_at" | "resolved_at">>): Promise<CaseRecord>;
  addCaseEvent(input: CaseEventInput, now: string): Promise<void>;
}

export class CaseNotFoundError extends Error {}
export class CaseIdentityConflictError extends Error {}
export class CustomerIdentityConflictError extends Error {}
export class DuplicateCaseReferenceError extends Error {}

export interface ResolveCaseInput {
  case_reference?: string;
  confirm_case_reference?: string;
  customer?: CustomerIdentityInput;
  order_id?: string;
  new_issue?: boolean;
  reopen_case?: boolean;
}

export interface CaseSelectionOption {
  case_reference: string;
  status: CaseStatus;
  order_id: string | null;
  summary: string;
  created_at: string;
}

export type CaseResolution =
  | { outcome: "selected"; customer: CustomerRecord; case: CaseRecord; created: boolean; reopened: boolean; preserveStatus: boolean }
  | { outcome: "needs_case_confirmation"; case: CaseSelectionOption }
  | { outcome: "needs_case_selection"; cases: CaseSelectionOption[] };

export function normalizeCustomerIdentity(input: CustomerIdentityInput | undefined): CustomerIdentity {
  const externalId = input?.external_customer_id?.trim() || null;
  const email = input?.email?.trim().toLowerCase() || null;
  const rawPhone = input?.phone?.trim() || "";
  const digits = rawPhone.replace(/\D/g, "");
  const phone = digits ? `${rawPhone.startsWith("+") ? "+" : ""}${digits}` : null;
  return {
    external_customer_id: externalId,
    normalized_email: email,
    normalized_phone: phone,
  };
}

function hasIdentity(identity: CustomerIdentity): boolean {
  return Object.values(identity).some(Boolean);
}

function identityConflicts(expected: CustomerIdentity, supplied: CustomerIdentity): boolean {
  return (supplied.external_customer_id !== null && expected.external_customer_id !== null
      && supplied.external_customer_id !== expected.external_customer_id)
    || (supplied.normalized_email !== null && expected.normalized_email !== null
      && supplied.normalized_email !== expected.normalized_email)
    || (supplied.normalized_phone !== null && expected.normalized_phone !== null
      && supplied.normalized_phone !== expected.normalized_phone);
}

function mergeIdentity(existing: CustomerIdentity, supplied: CustomerIdentity): CustomerIdentity {
  if (identityConflicts(existing, supplied)) throw new CustomerIdentityConflictError("Supplied customer identifiers conflict.");
  return {
    external_customer_id: existing.external_customer_id ?? supplied.external_customer_id,
    normalized_email: existing.normalized_email ?? supplied.normalized_email,
    normalized_phone: existing.normalized_phone ?? supplied.normalized_phone,
  };
}

function identitiesEqual(left: CustomerIdentity, right: CustomerIdentity): boolean {
  return left.external_customer_id === right.external_customer_id
    && left.normalized_email === right.normalized_email
    && left.normalized_phone === right.normalized_phone;
}

const CASE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

export function generateCaseReference(): string {
  const bytes = randomBytes(6);
  let suffix = "";
  for (const byte of bytes) suffix += CASE_ALPHABET[byte % CASE_ALPHABET.length];
  return `CASE-${suffix}`;
}

export class CaseService {
  constructor(
    private readonly repository: CaseRepository,
    private readonly options: {
      responseTatHours?: number;
      now?: () => Date;
      generateReference?: () => string;
    } = {},
  ) {}

  async resolve(input: ResolveCaseInput): Promise<CaseResolution> {
    const identity = normalizeCustomerIdentity(input.customer);
    if (input.case_reference || input.confirm_case_reference) return this.resolveByReference(input, identity);

    const customer = await this.resolveCustomer(identity);
    if (input.new_issue) return this.createCase(customer, input.order_id);

    const openCases = await this.repository.listOpenCases(customer.id);
    const candidates = input.order_id
      ? openCases.filter((caseRecord) => caseRecord.order_id === input.order_id)
      : openCases;

    if (candidates.length === 1) {
      return { outcome: "needs_case_confirmation", case: caseOption(candidates[0]!) };
    }
    if (candidates.length > 1) {
      return {
        outcome: "needs_case_selection",
        cases: candidates.map(caseOption),
      };
    }
    return this.createCase(customer, input.order_id);
  }

  async recordInteraction(
    resolution: Extract<CaseResolution, { outcome: "selected" }>,
    input: Omit<CaseEventInput, "case_id">,
  ): Promise<CaseRecord> {
    const now = this.now().toISOString();
    await this.repository.addCaseEvent({ ...input, case_id: resolution.case.id }, now);
    if (resolution.preserveStatus) return resolution.case;
    const status = input.event_type === "information_requested" ? "awaiting_customer"
      : input.decision_type === "answer" && input.action_status === "pending" ? "action_pending"
      : input.decision_type === "answer" && input.action_status === "none" ? "resolved"
      : input.decision_type === "escalate" || input.decision_type === "contradiction" ? "escalated"
      : resolution.case.status;
    if (status === resolution.case.status) return resolution.case;
    return this.repository.updateCase(resolution.case.id, {
      status,
      updated_at: now,
      resolved_at: status === "resolved" ? now : null,
    });
  }

  private async resolveByReference(input: ResolveCaseInput, identity: CustomerIdentity): Promise<CaseResolution> {
    const caseReference = (input.confirm_case_reference ?? input.case_reference)!.trim().toUpperCase();
    const caseRecord = await this.repository.getCaseByReference(caseReference);
    if (!caseRecord) throw new CaseNotFoundError("Case not found.");
    const customer = await this.repository.getCustomer(caseRecord.customer_id);
    if (!customer) throw new CaseNotFoundError("Case customer not found.");

    const matches = hasIdentity(identity) ? await this.repository.findCustomers(identity) : [];
    if (matches.length > 1) throw new CustomerIdentityConflictError("Supplied customer identifiers resolve to different customers.");
    const identityMatches = matches.length === 1 && matches[0]!.id === customer.id;
    const orderMatches = Boolean(input.order_id && caseRecord.order_id && input.order_id === caseRecord.order_id);
    if (identityConflicts(customer, identity) || (matches.length === 1 && !identityMatches)
      || (input.order_id && caseRecord.order_id && input.order_id !== caseRecord.order_id)
      || (!identityMatches && !orderMatches)) {
      throw new CaseIdentityConflictError("Supplied identity or order context does not match this case.");
    }

    const merged = mergeIdentity(customer, identity);
    const updatedCustomer = identitiesEqual(merged, customer)
      ? customer
      : await this.repository.updateCustomer(customer.id, merged, this.now().toISOString());
    if (input.new_issue) return this.createCase(updatedCustomer, input.order_id);
    if (caseRecord.status !== "resolved" || !input.reopen_case) {
      return {
        outcome: "selected", customer: updatedCustomer, case: caseRecord, created: false,
        reopened: false, preserveStatus: caseRecord.status === "resolved",
      };
    }
    const now = this.now().toISOString();
    const reopened = await this.repository.updateCase(caseRecord.id, {
      status: "escalated", updated_at: now, resolved_at: null,
    });
    return { outcome: "selected", customer: updatedCustomer, case: reopened, created: false, reopened: true, preserveStatus: true };
  }

  private async resolveCustomer(identity: CustomerIdentity): Promise<CustomerRecord> {
    const now = this.now().toISOString();
    if (!hasIdentity(identity)) return this.repository.createCustomer(identity, now);
    const matches = await this.repository.findCustomers(identity);
    if (matches.length > 1) throw new CustomerIdentityConflictError("Supplied customer identifiers resolve to different customers.");
    if (!matches.length) return this.repository.createCustomer(identity, now);
    const customer = matches[0]!;
    const merged = mergeIdentity(customer, identity);
    return identitiesEqual(merged, customer)
      ? customer
      : this.repository.updateCustomer(customer.id, merged, now);
  }

  private async createCase(customer: CustomerRecord, orderId?: string): Promise<CaseResolution> {
    const now = this.now();
    const responseTatHours = this.options.responseTatHours ?? 24;
    if (!Number.isFinite(responseTatHours) || responseTatHours <= 0) {
      throw new Error("Customer response TAT must be a positive number of hours.");
    }
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const caseReference = (this.options.generateReference ?? generateCaseReference)();
      try {
        const timestamp = now.toISOString();
        const order = inputValue(orderId);
        const caseRecord = await this.repository.createCase({
          case_reference: caseReference,
          customer_id: customer.id,
          order_id: order,
          summary: order ? `Support issue for order ${order}` : "General support issue",
          status: "open",
          decision_due_at: new Date(now.getTime() + responseTatHours * 3_600_000).toISOString(),
          created_at: timestamp,
          updated_at: timestamp,
          resolved_at: null,
        });
        return { outcome: "selected", customer, case: caseRecord, created: true, reopened: false, preserveStatus: false };
      } catch (error) {
        if (!(error instanceof DuplicateCaseReferenceError)) throw error;
      }
    }
    throw new Error("Unable to generate a unique case reference after 10 attempts.");
  }

  private now(): Date {
    return (this.options.now ?? (() => new Date()))();
  }
}

function inputValue(value: string | undefined): string | null {
  return value?.trim() || null;
}

function caseOption(caseRecord: CaseRecord): CaseSelectionOption {
  const { case_reference, status, order_id, summary, created_at } = caseRecord;
  return { case_reference, status, order_id, summary, created_at };
}

export class InMemoryCaseRepository implements CaseRepository {
  readonly customers: CustomerRecord[] = [];
  readonly cases: CaseRecord[] = [];
  readonly events: Array<CaseEventInput & { id: string; created_at: string }> = [];

  async findCustomers(identity: CustomerIdentity): Promise<CustomerRecord[]> {
    return this.customers.filter((customer) =>
      (identity.external_customer_id !== null && customer.external_customer_id === identity.external_customer_id)
      || (identity.normalized_email !== null && customer.normalized_email === identity.normalized_email)
      || (identity.normalized_phone !== null && customer.normalized_phone === identity.normalized_phone));
  }
  async getCustomer(id: string): Promise<CustomerRecord | null> {
    return this.customers.find((customer) => customer.id === id) ?? null;
  }
  async createCustomer(identity: CustomerIdentity, now: string): Promise<CustomerRecord> {
    const record = { id: randomUUID(), ...identity, created_at: now, updated_at: now };
    this.customers.push(record);
    return record;
  }
  async updateCustomer(id: string, identity: CustomerIdentity, now: string): Promise<CustomerRecord> {
    const customer = await this.getCustomer(id);
    if (!customer) throw new Error("Customer not found.");
    Object.assign(customer, identity, { updated_at: now });
    return customer;
  }
  async getCaseByReference(caseReference: string): Promise<CaseRecord | null> {
    return this.cases.find((caseRecord) => caseRecord.case_reference === caseReference) ?? null;
  }
  async listOpenCases(customerId: string): Promise<CaseRecord[]> {
    return this.cases.filter((caseRecord) => caseRecord.customer_id === customerId && caseRecord.status !== "resolved");
  }
  async createCase(input: Omit<CaseRecord, "id">): Promise<CaseRecord> {
    if (this.cases.some((caseRecord) => caseRecord.case_reference === input.case_reference)) {
      throw new DuplicateCaseReferenceError("Duplicate case reference.");
    }
    const record = { id: randomUUID(), ...input };
    this.cases.push(record);
    return record;
  }
  async updateCase(id: string, changes: Partial<Pick<CaseRecord, "status" | "updated_at" | "resolved_at">>): Promise<CaseRecord> {
    const caseRecord = this.cases.find((candidate) => candidate.id === id);
    if (!caseRecord) throw new Error("Case not found.");
    Object.assign(caseRecord, changes);
    return caseRecord;
  }
  async addCaseEvent(input: CaseEventInput, now: string): Promise<void> {
    this.events.push({ id: randomUUID(), ...input, created_at: now });
  }
}
