// vendor-portal/src/utils/money.ts

export function formatMoney(cents: number | null | undefined): string {
  if (cents == null || Number.isNaN(cents)) {
    return "$0.00";
  }

  const dollars = cents / 100;

  return dollars.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}
