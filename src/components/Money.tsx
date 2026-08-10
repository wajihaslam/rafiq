/** PKR formatting in one place, so totals never disagree between pages. */
export function formatPkr(amount: number | string): string {
  const value = typeof amount === "string" ? Number(amount) : amount;
  return new Intl.NumberFormat("en-PK", {
    style: "currency",
    currency: "PKR",
    maximumFractionDigits: 2,
  }).format(value);
}

export function Money({ amount }: { amount: number | string }) {
  return <span className="tabular-nums">{formatPkr(amount)}</span>;
}
