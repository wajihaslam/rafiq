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

export interface CartItem {
  id: string;
  cart_id: string;
  product_id: string;
  qty: number;
  unit_price: number;
  products?: Product | null;
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
