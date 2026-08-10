/**
 * Pay-In PK response-code table (guide §8).
 *
 * Integrate on the code, never on the message — message strings have been
 * corrected in place without the code moving.
 */

export const RESPONSE_CODES: Record<string, string> = {
  "0000": "Success",
  "0001": "Invalid-Operator",
  "0002": "Invalid-Product/Amount",
  "0003": "Invalid-Merchant",
  "0004": "Invalid-Value",
  "0005": "Invalid-Call",
  "0006": "Channel-Rejected-Transaction",
  "0007": "No-Response-From-Operator",
  "0008": "Invalid-Account",
  "0009": "Not-Enough-Balance",
  "0010": "OTP-Expired",
  "0011": "Invalid-OTP",
  "0012": "Transaction-Failed",
  "0015": "Invalid-Flow",
  "0016": "Threshold-Exceeded",
  "0018": "Request-In-Progress",
  "0019": "Invalid-UserKey",
  "0020": "Channel-Auth-Failed",
  "0021": "Channel-Failed-Transaction",
  "0023": "Method-Not-Allowed",
  "0025": "Invalid-Mobile-No",
  "0026": "Operator-Disabled",
  "0027": "Amount-Beyond-Limit",
  "0028": "Token-Expired",
  "0033": "Channel-Invalid-Call",
  "0034": "Invalid-Token",
  "0036": "Token-Not-Found",
  "0037": "Transaction-Pending",
  "0042": "Record-Not-Found",
  "0043": "Invalid-Account-Number",
  "0054": "Invalid-Signature",
  "0073": "No-Threshold-Found",
  "0087": "No-Active-Subscription-Found",
  "0088": "Invalid-Transaction-Type",
  "0089": "Transaction-Cancelled",
  "0090": "Transaction-Not-Found",
  "0091": "User-didn't-approve-or-rejected",
  "0093": "Transaction-Initiation-Failed",
  "0094": "Transaction-In-Progress",
  "0095": "Otp-Not-Entered",
  "0097": "Invalid-Transaction-Id",
  "0098": "Otp-Threshold-Exceeded",
  "0106": "Merchant-not-allowed",
  "0134": "Refund-Request-Already-Exists",
  "0135": "Refund-Request-Submitted",
  "0137": "Amount-Greater-Than-Transaction-Amount",
  "0138": "Amount-Exceeds-Total-Amount-In-Process",
  "0140": "Invalid-Transaction-Date",
  "9999": "System-Failure",
};

export const SUCCESS = "0000";
/** Refund's success answer is 0135, not 0000. */
export const REFUND_SUBMITTED = "0135";

/**
 * The outcome is not yet known and money may have moved (guide §6).
 * Never show these as a failure, never re-fire the request — resolve by inquiry.
 */
const INDETERMINATE_CODES = new Set(["0007", "0018", "0037", "0094", "9999"]);

export type Outcome = "success" | "failure" | "indeterminate";

/**
 * An unrecognised code is treated as indeterminate on purpose: the safe reading
 * of a code we cannot classify is that we don't know what happened.
 */
export function classify(code: string | undefined | null): Outcome {
  if (!code) return "indeterminate";
  if (code === SUCCESS || code === REFUND_SUBMITTED) return "success";
  if (INDETERMINATE_CODES.has(code)) return "indeterminate";
  if (!(code in RESPONSE_CODES)) return "indeterminate";
  return "failure";
}

export function isIndeterminate(code: string | undefined | null): boolean {
  return classify(code) === "indeterminate";
}

export function codeMessage(code: string | undefined | null): string {
  if (!code) return "No response code";
  return RESPONSE_CODES[code] ?? `Unknown code ${code}`;
}

/** Copy safe to put in front of a customer for a given code. */
export function customerMessage(code: string | undefined | null): string {
  switch (classify(code)) {
    case "success":
      return "Payment successful.";
    case "indeterminate":
      return "Your payment is being confirmed. We'll update this order as soon as the operator responds.";
    case "failure":
      break;
  }
  switch (code) {
    case "0009":
      return "Not enough balance in your wallet.";
    case "0010":
      return "That OTP has expired. Please start again.";
    case "0011":
      return "That OTP is incorrect.";
    case "0095":
      return "Please enter the OTP sent to your mobile.";
    case "0098":
      return "Too many incorrect OTP attempts. Please try again later.";
    case "0016":
    case "0027":
      return "This amount is beyond your wallet limit.";
    case "0025":
      return "That mobile number is not valid.";
    case "0028":
    case "0036":
      return "This saved wallet is no longer usable. Please link it again.";
    case "0089":
      return "The transaction was cancelled.";
    case "0091":
      return "You declined the payment.";
    case "0026":
      return "This wallet is temporarily unavailable. Please try another.";
    default:
      return "The payment could not be completed. Please try again or use another wallet.";
  }
}
