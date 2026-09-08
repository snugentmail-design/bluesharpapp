export const EXPENSE_TYPES = [
  "Meals - Self",
  "Meals - Entertainment",
  "Hotel / Accommodation",
  "Air Travel",
  "Rail Travel",
  "Taxi / Rideshare",
  "Car Rental",
  "Fuel / Mileage",
  "Parking / Tolls",
  "Office Supplies",
  "Telecoms",
  "Conference / Training",
  "Client Gift",
  "Other",
] as const;

export type ExpenseType = (typeof EXPENSE_TYPES)[number];

export type ReceiptFields = {
  merchant_name: string | null;
  merchant_location: string | null;
  transaction_date: string | null;
  currency: string | null;
  total_amount: number | null;
  tax_amount: number | null;
  expense_type: ExpenseType;
  payment_method: string | null;
  card_last4: string | null;
  invoice_number: string | null;
  notes: string | null;
};

export type ReceiptStatus = "pending" | "extracting" | "extracted" | "failed" | "ignored";

export type Extraction = {
  is_receipt: boolean;
  confidence: "high" | "medium" | "low";
  legibility: "clear" | "partial" | "poor";
  contains_alcohol: boolean;
  is_duplicate_candidate: boolean;
  line_items: Array<{ description: string; amount: number | null }>;
  warnings: string[];
  subtotal_amount: number | null;
  tip_amount: number | null;
  attendee_count: number | null;
};

export type Receipt = {
  id: string;
  status: ReceiptStatus;
  error: string | null;
  photoTakenAt: string | null;
  importedAt: string;
  originalFilename: string | null;
  byteSize: number;
  month: string | null;
  fields: ReceiptFields;
  overrides: Partial<ReceiptFields>;
  extraction: Extraction | null;
  reviewReasons: string[];
  matchedTransactionId: string | null;
  emailedAt: string | null;
  exportedAt: string | null;
  imageUrl: string;
};

export type StatementTransaction = {
  id: string;
  date: string | null;
  description: string;
  amount: number | null;
  currency: string | null;
  raw: Record<string, string>;
};

export type MatchPair = {
  transaction: StatementTransaction;
  receipt: Receipt;
  score: number;
  reasons: string[];
};

export type ReconcileResponse = {
  statement: { label: string; uploadedAt: string; count: number } | null;
  matched: MatchPair[];
  transactionsWithoutReceipt: StatementTransaction[];
  receiptsWithoutTransaction: Receipt[];
};

export type Status = {
  googleConnected: boolean;
  googleEmail: string | null;
  googleConfigured: boolean;
  anthropicConfigured: boolean;
  emailConfigured: boolean;
  emailFrom: string | null;
  receiptsAddress: string;
  expenseItAddress: string;
  defaultCurrency: string;
};

export type PickerSession = {
  sessionId: string;
  pickerUri: string;
  qrDataUrl: string | null;
  pollIntervalMs: number;
  expireTime: string | null;
};

export type ImportSummary = {
  imported: number;
  duplicates: number;
  failed: number;
  errors: string[];
  receiptIds: string[];
};

export type ExtractionProgress = {
  running: boolean;
  total: number;
  done: number;
  failed: number;
  startedAt: string | null;
  lastError: string | null;
};

export type ReceiptsResponse = {
  months: string[];
  receipts: Receipt[];
  counts: { total: number; pending: number; failed: number };
};
