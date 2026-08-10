/** PKR formatting in one place, so totals never disagree between pages. */
export function formatPkr(amount: number | string): string {
  const value = typeof amount === "string" ? Number(amount) : amount;
  return new Intl.NumberFormat("en-PK", {
    style: "currency",
    currency: "PKR",
    // PKR is conventionally shown without paisa, but a fractional amount must
    // not render as "Rs 149.5" — show both decimals when there are any.
    minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(value);
}

export function Money({ amount }: { amount: number | string }) {
  return <span className="tabular-nums">{formatPkr(amount)}</span>;
}
