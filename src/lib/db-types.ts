/** Shapes of the rows we read. Hand-written to stay readable; regenerate with
 *  `supabase gen types typescript` if the schema grows. */

export type ProductKind = "one_time" | "subscription";

export type OrderStatus =
  | "pending"
  | "paid"
  | "failed"
  | "cancelled"
  | "refund_submitted"
  | "refunded";

export type TokenStatus = "active" | "delinked" | "expired";
export type SubStatus = "active" | "paused" | "cancelled" | "past_due";
export type TxnKind =
  | "payment"
  | "tokenization"
  | "direct_payment"
  | "refund"
  | "delink";

/**
 * The gateway call a transaction row records. `kind` says what the call was
 * about; this says what it did — initiate and verify are both `payment`, and
 * telling them apart is the whole of what a step breadcrumb needs.
 */
export type TxnOperation =
  | "initiate"
  | "verify"
  | "finalize"
  | "direct_payment"
  | "inquiry"
  | "refund"
  | "delink"
  | "postback";

/** How an order was paid for. Mirrors `orders.channel`. */
export type OrderChannel =
  | "wallet_otp"
  | "wallet_non_otp"
  | "hosted_page"
  | "direct_payment";

export interface Product {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  image_url: string | null;
  price: number;
  kind: ProductKind;
  interval_days: number | null;
  active: boolean;
}

export interface Order {
  id: string;
  user_id: string;
  order_ref: string;
  amount: number;
  status: OrderStatus;
  operator_id: string | null;
  msisdn: string | null;
  channel: string;
  status_code: string | null;
  message: string | null;
  created_at: string;
  updated_at: string;
}

export interface OrderItem {
  id: string;
  order_id: string;
  product_id: string;
  name: string;
  qty: number;
  unit_price: number;
}

export interface Transaction {
  id: string;
  order_id: string | null;
  user_id: string | null;
  gateway_transaction_id: string | null;
  operator_id: string | null;
  kind: TxnKind;
  operation: TxnOperation | null;
  status_code: string;
  message: string | null;
  indeterminate: boolean;
  created_at: string;
}

/** An in-flight wallet link, keyed by the orderRef/userKey we sent. */
export interface WalletRegistration {
  id: string;
  user_id: string;
  order_ref: string;
  operator_id: string;
  msisdn: string;
  label: string | null;
  gateway_transaction_id: string | null;
  status: "pending" | "linked" | "declined" | "failed";
  status_code: string | null;
  message: string | null;
  created_at: string;
}

export interface PaymentToken {
  id: string;
  user_id: string;
  operator_id: string;
  source_id: string;
  msisdn: string;
  label: string | null;
  status: TokenStatus;
  linked_at: string;
  expires_at: string;
}

export interface Subscription {
  id: string;
  user_id: string;
  product_id: string;
  payment_token_id: string;
  status: SubStatus;
  interval_days: number;
  amount: number;
  next_charge_at: string;
  last_charge_at: string | null;
  failed_attempts: number;
  products?: Product | null;
  payment_tokens?: PaymentToken | null;
}
