/** Every monetary value in this domain is integer minor units (pence). This is the one place that gets formatted for display. */
export function formatMinorUnits(minorUnits: number, currency: string = "GBP"): string {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency }).format(minorUnits / 100)
}

export function poundsToMinorUnits(pounds: number): number {
  return Math.round(pounds * 100)
}
