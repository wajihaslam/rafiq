/** Wire types for the Collection gateway (guide §4). */

/** The only two operators on this gateway. Anything else answers 0001. */
export const OPERATORS = {
  easypaisa: "100007",
  jazzcash: "100008",
} as const;

export type OperatorId = (typeof OPERATORS)[keyof typeof OPERATORS];

export const OPERATOR_LABELS: Record<OperatorId, string> = {
  "100007": "Easypaisa",
  "100008": "JazzCash",
};

/** Easypaisa tokenizes over JSON; JazzCash tokenizes via a hosted page. */
export const TOKENIZATION_STYLE: Record<OperatorId, "json" | "hosted"> = {
  "100007": "json",
  "100008": "hosted",
};

/** "0" = payment, "8" = tokenization. */
export type TransactionType = "0" | "8";

/** Every wallet response carries at least these. */
export interface WalletResponse {
  status: string;
  message?: string;
  msisdn?: string;
  operatorId?: string;
  merchantId?: string;
  transactionId?: string;
  /** Only present when transactionType is "8" and the code is a success. */
  sourceId?: string;
  amount?: string;
}

export interface InitiateRequest {
  operatorId: OperatorId;
  amount: string | number;
  userKey: string;
  msisdn: string;
  transactionType: TransactionType;
}

export interface VerifyRequest extends InitiateRequest {
  /** Pass initiate's transactionId on the OTP flow. Omit on Non-OTP. */
  transactionId?: string;
  otp?: string;
}

export interface FinalizeRequest {
  operatorId: OperatorId;
  orderId: string;
  msisdn: string;
}

export interface DirectPaymentRequest {
  operatorId: OperatorId;
  amount: string | number;
  userKey: string;
  sourceId: string;
  platform?: string;
}

export interface DelinkRequest {
  operatorId: OperatorId;
  sourceId: string;
}

export interface InquiryRequest {
  /** At least one of transactionId / userKey is required. */
  transactionId?: string;
  userKey?: string;
}

export interface InquiryResponse {
  merchantId?: string;
  transactionId?: string;
  userKey?: string;
  transaction?: {
    amount?: string;
    operatorId?: string;
    transactionId?: string;
    status?: string;
    message?: string;
    updatedTimestamp?: string;
  };
}

export interface RefundRequest {
  transactionId: string;
  /** YYYY-MM-DD */
  transactionDate: string;
  /** Omit for a full refund. */
  amount?: string;
}

export interface RefundResponse {
  status: string;
  message?: string;
  merchantId?: string;
  transactionId?: string;
  referenceNumber?: string;
}

/** Hosted-page inquiry (§4.9) is keyed by orderId, not transactionId. */
export interface HostedInquiryResponse {
  status: string;
  message?: string;
  amount?: string;
  operatorId?: string;
  transactionId?: string;
  merchantId?: string;
  orderId?: string;
  createdDate?: string;
}

