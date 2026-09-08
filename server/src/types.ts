import { z } from "zod";

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

export const LineItemSchema = z.object({
  description: z.string(),
  amount: z.number().nullable(),
});

/**
 * The shape the model fills in for one receipt image. Every field is nullable so
 * a torn, blurred or partly cropped receipt still yields whatever is legible
 * rather than failing the whole extraction.
 */
export const ReceiptExtractionSchema = z.object({
  is_receipt: z
    .boolean()
    .describe("False for screenshots, documents, photos of people, or anything that is not a purchase receipt or invoice."),
  merchant_name: z.string().nullable().describe("Trading name as printed, e.g. 'Pret A Manger'. Not the legal entity."),
  merchant_location: z.string().nullable().describe("City, airport code or street shown on the receipt."),
  country_code: z.string().nullable().describe("ISO 3166-1 alpha-2 country code if determinable."),
  transaction_date: z
    .string()
    .nullable()
    .describe("Date of purchase in YYYY-MM-DD. Resolve ambiguous DD/MM vs MM/DD using the country and any month names."),
  transaction_time: z.string().nullable().describe("24-hour HH:MM if printed."),
  currency: z.string().nullable().describe("ISO 4217 code, e.g. GBP, EUR, USD. Infer from the symbol and country."),
  total_amount: z.number().nullable().describe("Grand total actually paid, including tax and tip."),
  subtotal_amount: z.number().nullable(),
  tax_amount: z.number().nullable().describe("VAT, GST or sales tax total."),
  tax_rate_percent: z.number().nullable(),
  tip_amount: z.number().nullable(),
  payment_method: z.string().nullable().describe("e.g. Visa, Mastercard, Amex, Cash, Apple Pay."),
  card_last4: z.string().nullable().describe("Last four digits of the card if printed."),
  vat_number: z.string().nullable(),
  invoice_number: z.string().nullable().describe("Receipt, invoice, folio or transaction number."),
  expense_type: z.enum(EXPENSE_TYPES).describe("Best-fit expense category."),
  attendee_count: z.number().nullable().describe("Number of covers or guests, when a meal receipt shows it."),
  line_items: z.array(LineItemSchema).describe("Individual purchased items, empty when not legible."),
  contains_alcohol: z.boolean().describe("True when any line item is alcoholic. Many travel policies require this."),
  is_duplicate_candidate: z
    .boolean()
    .describe("True when the image looks like a second photo of the same receipt, e.g. a partial re-shoot."),
  legibility: z.enum(["clear", "partial", "poor"]),
  confidence: z.enum(["high", "medium", "low"]).describe("Overall confidence in merchant, date and total together."),
  warnings: z
    .array(z.string())
    .describe("Short notes on anything a human should check, e.g. 'total obscured by glare'."),
});

export type ReceiptExtraction = z.infer<typeof ReceiptExtractionSchema>;
export type ExpenseType = (typeof EXPENSE_TYPES)[number];

/** The subset of extracted fields a user may correct by hand. */
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

export const ReceiptOverridesSchema = z
  .object({
    merchant_name: z.string().nullable(),
    merchant_location: z.string().nullable(),
    transaction_date: z.string().nullable(),
    currency: z.string().nullable(),
    total_amount: z.number().nullable(),
    tax_amount: z.number().nullable(),
    expense_type: z.enum(EXPENSE_TYPES),
    payment_method: z.string().nullable(),
    card_last4: z.string().nullable(),
    invoice_number: z.string().nullable(),
    notes: z.string().nullable(),
  })
  .partial();

export type ReceiptStatus =
  | "pending"
  | "extracting"
  | "extracted"
  | "failed"
  | "ignored";

export type Receipt = {
  id: string;
  googleMediaItemId: string | null;
  sha256: string;
  storedFilename: string;
  originalFilename: string | null;
  mimeType: string;
  byteSize: number;
  photoTakenAt: string | null;
  importedAt: string;
  pickerSessionId: string | null;
  status: ReceiptStatus;
  error: string | null;
  extraction: ReceiptExtraction | null;
  overrides: Partial<ReceiptFields>;
  matchedTransactionId: string | null;
  emailedAt: string | null;
  exportedAt: string | null;
};

/** One row from the card statement exported out of Concur or the bank. */
export type StatementTransaction = {
  id: string;
  date: string | null;
  description: string;
  amount: number | null;
  currency: string | null;
  raw: Record<string, string>;
};
