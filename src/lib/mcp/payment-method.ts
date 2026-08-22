/**
 * The payment methods the billing RPCs accept, and how to get there from what a caller says.
 *
 * `record_payment_v2`, `record_billing_entry_v2` and `record_refund` all compare the method against
 * this exact lowercase set and reject anything else with "Choose a valid payment method." Nothing
 * in the app normalized the value first, so a perfectly reasonable "UPI" or "bank transfer" was
 * refused — and the refusal surfaced as a generic save error, which made it look like a bug in the
 * write rather than a rejected input.
 */
export const PAYMENT_METHODS = ['cash', 'upi', 'card', 'bank_transfer'] as const

export type PaymentMethod = (typeof PAYMENT_METHODS)[number]

/** Spellings people and models reach for, mapped to what the database accepts. */
const ALIASES: Record<string, PaymentMethod> = {
  banktransfer: 'bank_transfer',
  bank: 'bank_transfer',
  transfer: 'bank_transfer',
  neft: 'bank_transfer',
  imps: 'bank_transfer',
  rtgs: 'bank_transfer',
  netbanking: 'bank_transfer',
  cheque: 'bank_transfer',
  check: 'bank_transfer',
  creditcard: 'card',
  debitcard: 'card',
  gpay: 'upi',
  googlepay: 'upi',
  phonepe: 'upi',
  paytm: 'upi',
  online: 'upi',
}

/**
 * Map a free-text method onto one the RPCs accept, or null when there is no honest mapping.
 *
 * Returning null rather than guessing matters: a payment recorded under the wrong method is a
 * quietly wrong financial record, which is worse than an error the caller can correct.
 */
export function normalizePaymentMethod(value: unknown): PaymentMethod | null {
  if (typeof value !== 'string') return null
  const cleaned = value.trim().toLocaleLowerCase()
  if (!cleaned) return null

  const underscored = cleaned.replace(/[\s-]+/g, '_')
  if ((PAYMENT_METHODS as readonly string[]).includes(underscored)) return underscored as PaymentMethod

  const collapsed = cleaned.replace(/[^a-z]/g, '')
  return ALIASES[collapsed] ?? null
}

export function paymentMethodError(field = 'payment_method'): string {
  return `${field} must be one of: ${PAYMENT_METHODS.join(', ')}.`
}
