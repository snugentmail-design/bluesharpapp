import fs from "node:fs/promises";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { config, assertAnthropicConfigured } from "../config.js";
import { ReceiptExtractionSchema, type ReceiptExtraction } from "../types.js";

let client: Anthropic | null = null;

function getClient(): Anthropic {
  assertAnthropicConfigured();
  if (!client) client = new Anthropic({ apiKey: config.anthropic.apiKey });
  return client;
}

const SYSTEM_PROMPT = `You read photographs of purchase receipts and invoices and return their contents as structured data. The images are phone photos taken by a business traveller, so expect glare, creases, curled thermal paper, tables and hands in shot, and receipts photographed at an angle.

Rules that matter for expense reconciliation:

- The total is the amount actually charged. On a restaurant bill where a tip was added by hand, the total is the handwritten grand total, not the printed subtotal. On a card slip showing both "AMOUNT" and "TOTAL", take the TOTAL.
- Resolve date ambiguity using the country. A UK or European receipt reading 04/03/25 is 2025-03-04. A US receipt reading the same is 2025-04-03. Prefer any spelled-out month over a numeric guess.
- Where the year is only two digits, assume the current decade.
- Infer the currency from the symbol, the country, the tax wording (VAT means UK or EU, GST means Australia, Canada, India or Singapore) and any card scheme text. Never leave the currency null when the amount is legible.
- Report amounts as plain numbers with a decimal point, never with thousands separators or currency symbols.
- Hotel folios often list nightly charges. The total is the folio balance actually settled.
- If a value is genuinely not legible, return null for it and add a short note in warnings. Do not guess a total you cannot read.
- Set is_receipt false for anything that is not a proof of purchase, such as a screenshot, a boarding pass with no price, a business card, or a photo of a person or place.

Be accurate rather than complete. A null with a warning is more useful to the person reconciling than a confident wrong number.`;

export type ExtractionResult =
  | { ok: true; extraction: ReceiptExtraction }
  | { ok: false; error: string };

function mediaTypeFor(filename: string, declared: string): "image/jpeg" | "image/png" | "image/gif" | "image/webp" {
  const normalized = declared.toLowerCase();
  if (normalized === "image/png") return "image/png";
  if (normalized === "image/gif") return "image/gif";
  if (normalized === "image/webp") return "image/webp";
  if (normalized === "image/jpeg" || normalized === "image/jpg") return "image/jpeg";
  const ext = path.extname(filename).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".gif") return "image/gif";
  if (ext === ".webp") return "image/webp";
  return "image/jpeg";
}

/** Sends one receipt image to Claude and returns validated structured fields. */
export async function extractReceipt(
  imagePath: string,
  opts: { mimeType: string; photoTakenAt: string | null }
): Promise<ExtractionResult> {
  let bytes: Buffer;
  try {
    bytes = await fs.readFile(imagePath);
  } catch (err) {
    return { ok: false, error: `Could not read the stored image: ${(err as Error).message}` };
  }

  const contextLines = [
    `Assume ${config.defaultCurrency} only if the receipt shows an amount with no symbol or currency clue at all.`,
  ];
  if (opts.photoTakenAt) {
    contextLines.push(
      `The photo was taken on ${opts.photoTakenAt.slice(0, 10)}. The purchase date is usually that day or shortly before. Use this to break a tie between two readings of a smudged date, but always prefer the date printed on the receipt.`
    );
  }

  try {
    const response = await getClient().messages.parse({
      model: config.anthropic.model,
      max_tokens: 8000,
      system: SYSTEM_PROMPT,
      output_config: { format: zodOutputFormat(ReceiptExtractionSchema) },
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: mediaTypeFor(imagePath, opts.mimeType),
                data: bytes.toString("base64"),
              },
            },
            { type: "text", text: `${contextLines.join("\n")}\n\nRead this receipt.` },
          ],
        },
      ],
    });

    if (response.stop_reason === "refusal") {
      return { ok: false, error: "The model declined to process this image. Check it manually." };
    }
    if (!response.parsed_output) {
      return { ok: false, error: "The model returned no structured output for this image." };
    }
    return { ok: true, extraction: response.parsed_output };
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) {
      return { ok: false, error: "The Anthropic API key was rejected. Check ANTHROPIC_API_KEY." };
    }
    if (err instanceof Anthropic.RateLimitError) {
      return { ok: false, error: "Rate limited by the Anthropic API. Press Read receipts again shortly." };
    }
    if (err instanceof Anthropic.APIError) {
      return { ok: false, error: `Anthropic API error ${err.status}: ${err.message}` };
    }
    return { ok: false, error: (err as Error).message };
  }
}
