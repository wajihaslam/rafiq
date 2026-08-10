/**
 * Field rules from guide §3, enforced before we hit the network.
 *
 * The gateway enforces these too, and records no transaction when one fails —
 * so checking locally costs nothing and lets us return the param's own error
 * code without a round trip.
 */

import { OPERATORS, type OperatorId } from "./types";

export class FieldError extends Error {
  constructor(
    readonly code: string,
    readonly field: string,
    message?: string,
  ) {
    super(message ?? `Invalid ${field}`);
    this.name = "FieldError";
  }
}

const MERCHANT_ID = /^\d{7}$/;
const AMOUNT = /^(?!0+(\.0{1,2})?$)\d+(\.\d{1,2})?$/;
const MSISDN = /^0?3\d{9}$/;

export function assertMerchantId(value: string): string {
  if (!MERCHANT_ID.test(value)) throw new FieldError("0003", "merchantId");
  return value;
}

export function assertOperatorId(value: string): OperatorId {
  const allowed = Object.values(OPERATORS) as string[];
  if (!allowed.includes(value)) throw new FieldError("0001", "operatorId");
  return value as OperatorId;
}

/**
 * Formats a PKR number as the gateway wants it: non-zero, at most 2 decimals.
 * We send the trimmed decimal string rather than a float — "100" and "100.00"
 * are both accepted, "100.000" is not.
 */
export function formatAmount(value: number | string): string {
  const asString =
    typeof value === "number" ? value.toFixed(2) : String(value).trim();
  // drop a trailing ".00" / ".50" -> ".5" is fine to keep, only strip zeros
  const normalised = asString.replace(/\.0+$/, "").replace(/(\.\d)0$/, "$1");
  if (!AMOUNT.test(normalised)) throw new FieldError("0002", "amount");
  return normalised;
}

/**
 * The gateway compares msisdn by national significant digits, so 923001234567
 * and 03001234567 are the same subscriber. We normalise to the 03xxxxxxxxx
 * form the guide's examples use.
 */
export function normaliseMsisdn(value: string): string {
  const digits = value.replace(/[^\d]/g, "");
  let national = digits;
  if (national.startsWith("0092")) national = national.slice(4);
  else if (national.startsWith("92")) national = national.slice(2);
  if (national.startsWith("3")) national = `0${national}`;
  if (!MSISDN.test(national)) throw new FieldError("0025", "msisdn");
  return national;
}

export function assertUserKey(value: string): string {
  if (!value.trim()) throw new FieldError("0019", "userKey");
  return value;
}

export function assertTransactionType(value: string): "0" | "8" {
  if (value !== "0" && value !== "8")
    throw new FieldError("0088", "transactionType");
  return value;
}

export function assertSourceId(value: string | undefined | null): string {
  if (!value || !value.trim()) throw new FieldError("0034", "sourceId");
  return value;
}

export function assertTransactionId(value: string | undefined | null): string {
  if (!value || !value.trim()) throw new FieldError("0097", "transactionId");
  return value;
}

export function assertTransactionDate(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value))
    throw new FieldError("0140", "transactionDate");
  return value;
}

/**
 * Guards the happy path against §7's fixture selectors. On initiate/verify the
 * last 4 digits of userKey select a canned response code, so an order
 * reference that happens to end in "0009" would return Not-Enough-Balance
 * instead of touching the real gateway.
 */
export function collidesWithFixture(userKey: string): boolean {
  const tail = userKey.slice(-4);
  return /^\d{4}$/.test(tail) && tail !== "0000";
}
