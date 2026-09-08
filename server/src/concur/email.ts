import nodemailer, { type Transporter } from "nodemailer";
import path from "node:path";
import fs from "node:fs";
import { config } from "../config.js";
import type { Receipt } from "../types.js";
import { effectiveFields, receiptSlug } from "../extract/normalize.js";

let transporter: Transporter | null = null;

export function isEmailConfigured(): boolean {
  return Boolean(config.smtp.host && config.smtp.user && config.smtp.pass && config.smtp.from);
}

function getTransporter(): Transporter {
  if (!isEmailConfigured()) {
    throw new Error(
      "SMTP is not configured, so receipts cannot be emailed to Concur. See README.md, section 'Emailing receipts into Concur'."
    );
  }
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.secure,
      auth: { user: config.smtp.user, pass: config.smtp.pass },
    });
  }
  return transporter;
}

export type EmailTarget = "receipts" | "expenseit";

export function targetAddress(target: EmailTarget): string {
  return target === "expenseit" ? config.concur.expenseItAddress : config.concur.receiptsAddress;
}

export type EmailOutcome = { receiptId: string; ok: boolean; error?: string };

/**
 * Sends one receipt image to Concur. Concur ties the image to the traveller by
 * the From address, so it must be an address verified on their Concur profile.
 */
export async function emailReceipt(receipt: Receipt, target: EmailTarget): Promise<EmailOutcome> {
  const filePath = path.join(config.imagesDir, receipt.storedFilename);
  if (!fs.existsSync(filePath)) {
    return { receiptId: receipt.id, ok: false, error: "The stored image file is missing." };
  }

  const f = effectiveFields(receipt);
  const amount = f.total_amount != null ? `${f.currency ?? ""} ${f.total_amount.toFixed(2)}`.trim() : "amount unread";
  const subject = [f.transaction_date ?? "undated", f.merchant_name ?? "unknown merchant", amount].join(" ");

  const body = [
    `Merchant: ${f.merchant_name ?? "not read"}`,
    `Date: ${f.transaction_date ?? "not read"}`,
    `Total: ${amount}`,
    `Tax: ${f.tax_amount != null ? f.tax_amount.toFixed(2) : "not read"}`,
    `Expense type: ${f.expense_type}`,
    f.merchant_location ? `Location: ${f.merchant_location}` : null,
    f.card_last4 ? `Card ending: ${f.card_last4}` : null,
    f.invoice_number ? `Receipt number: ${f.invoice_number}` : null,
    "",
    "Sent from Google Photos by the receipt reconciler.",
  ]
    .filter((line): line is string => line !== null)
    .join("\n");

  try {
    await getTransporter().sendMail({
      from: config.smtp.from,
      to: targetAddress(target),
      subject,
      text: body,
      attachments: [
        {
          filename: `${receiptSlug(receipt)}${path.extname(receipt.storedFilename) || ".jpg"}`,
          path: filePath,
          contentType: receipt.mimeType,
        },
      ],
    });
    return { receiptId: receipt.id, ok: true };
  } catch (err) {
    return { receiptId: receipt.id, ok: false, error: (err as Error).message };
  }
}

export async function verifyEmail(): Promise<void> {
  await getTransporter().verify();
}
