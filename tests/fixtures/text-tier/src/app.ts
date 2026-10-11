/** Returns the invoice total including tax. */
export function invoiceTotal(net: number, taxRate: number): number {
  return net + net * taxRate;
}
