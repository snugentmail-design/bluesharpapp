import { test } from "node:test";
import assert from "node:assert/strict";
import { parseAmount, parseDate, parseStatementCsv } from "../src/concur/statement.js";

test("parseAmount handles the formats card statements actually emit", () => {
  assert.equal(parseAmount("12.30"), 12.3);
  assert.equal(parseAmount("1,234.56"), 1234.56);
  assert.equal(parseAmount("£4.50"), 4.5);
  assert.equal(parseAmount("(12.30)"), -12.3);
  assert.equal(parseAmount("-12.30"), -12.3);
  assert.equal(parseAmount("1.234,56"), 1234.56);
  assert.equal(parseAmount("12,30"), 12.3);
  assert.equal(parseAmount(""), null);
  assert.equal(parseAmount(undefined), null);
});

test("parseDate prefers day-first and only swaps when day-first is impossible", () => {
  assert.equal(parseDate("2025-03-04"), "2025-03-04");
  assert.equal(parseDate("04/03/2025"), "2025-03-04");
  assert.equal(parseDate("04/03/25"), "2025-03-04");
  assert.equal(parseDate("13/03/2025"), "2025-03-13");
  // 03/25 cannot be a month, so this row must be month-first.
  assert.equal(parseDate("03/25/2025"), "2025-03-25");
  assert.equal(parseDate("4 March 2025"), "2025-03-04");
  assert.equal(parseDate("not a date"), null);
});

test("parseStatementCsv detects columns and normalises spend to positive", () => {
  const csv = [
    "Transaction Date,Description,Billed Amount,Transaction Currency",
    "04/03/2025,PRET A MANGE 456 LONDON,-4.50,GBP",
    "05/03/2025,HILTON READING,-212.00,GBP",
  ].join("\n");

  const result = parseStatementCsv(csv);
  assert.equal(result.transactions.length, 2);
  assert.equal(result.mapping.date, "Transaction Date");
  assert.equal(result.mapping.amount, "Billed Amount");
  assert.equal(result.mapping.currency, "Transaction Currency");

  const first = result.transactions[0]!;
  assert.equal(first.date, "2025-03-04");
  assert.equal(first.amount, 4.5);
  assert.equal(first.currency, "GBP");
});

test("parseStatementCsv survives a file with unfamiliar headers", () => {
  const csv = "Posted,Narrative,Value\n2025-03-04,COSTA COFFEE,3.10";
  const result = parseStatementCsv(csv);
  assert.equal(result.transactions.length, 1);
  assert.equal(result.transactions[0]!.amount, 3.1);
  assert.equal(result.transactions[0]!.description, "COSTA COFFEE");
});
