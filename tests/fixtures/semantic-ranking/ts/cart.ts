export interface CartItem {
  sku: string;
  price: number;
  quantity: number;
}

export function calculateCartTotal(items: CartItem[]): number {
  let total = 0;
  for (const item of items) {
    total += item.price * item.quantity;
  }
  return total;
}

export function applyDiscount(total: number, percent: number): number {
  const clamped = Math.min(Math.max(percent, 0), 100);
  return total - (total * clamped) / 100;
}
