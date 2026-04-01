/**
 * Billing Screen
 *
 * Route: /billing?visitId=<uuid>
 * - Shows consultation + prescription details
 * - Builds invoice with line items
 * - Processes payment (cash / UPI / card / insurance)
 * - Closes the visit
 */
import { useState } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { visitService } from '@/services/visitService'
import { billingService } from '@/services/clinicalService'
import type { Invoice } from '@/types/common'

const PAYMENT_METHODS = [
  { value: 'cash', label: 'Cash', icon: '💵' },
  { value: 'upi', label: 'UPI', icon: '📱' },
  { value: 'card', label: 'Card', icon: '💳' },
  { value: 'insurance', label: 'Insurance', icon: '🏥' },
]

interface LineItemRow {
  description: string
  amount: string
}

export default function BillingPage() {
  const [params] = useSearchParams()
  const visitId = params.get('visitId') ?? ''
  const returnTo = params.get('returnTo') ?? ''
  const navigate = useNavigate()
  const qc = useQueryClient()

  const [lineItems, setLineItems] = useState<LineItemRow[]>([
    { description: 'Consultation Fee', amount: '' },
  ])
  const [discount, setDiscount] = useState('0')
  const [tax, setTax] = useState('0')
  const [paymentMethod, setPaymentMethod] = useState('cash')
  const [invoice, setInvoice] = useState<Invoice | null>(null)
  const [step, setStep] = useState<'build' | 'confirm' | 'paid'>('build')

  const { data: visit } = useQuery({
    queryKey: ['visit', visitId],
    queryFn: () => visitService.get(visitId),
    enabled: !!visitId,
  })

  const subtotal = lineItems.reduce((sum, item) => sum + (parseFloat(item.amount) || 0), 0)
  const discountAmt = parseFloat(discount) || 0
  const taxAmt = parseFloat(tax) || 0
  const total = Math.max(subtotal - discountAmt + taxAmt, 0)

  const { mutate: createInvoice, isPending: creating } = useMutation({
    mutationFn: () => billingService.createInvoice({
      visit_id: visitId,
      line_items: lineItems
        .filter(li => li.description && li.amount)
        .map(li => ({ description: li.description, amount: parseFloat(li.amount) })),
      discount: discountAmt,
      tax: taxAmt,
    }),
    onSuccess: (inv) => {
      setInvoice(inv)
      setStep('confirm')
    },
  })

  const { mutate: processPayment, isPending: paying } = useMutation({
    mutationFn: () => billingService.pay(invoice!.id, paymentMethod),
    onSuccess: (paid) => {
      setInvoice(paid)
      setStep('paid')
      qc.invalidateQueries({ queryKey: ['visits'] })
    },
  })

  const addRow = () => setLineItems(prev => [...prev, { description: '', amount: '' }])
  const updateRow = (i: number, field: 'description' | 'amount', val: string) =>
    setLineItems(prev => prev.map((r, idx) => idx === i ? { ...r, [field]: val } : r))
  const removeRow = (i: number) => setLineItems(prev => prev.filter((_, idx) => idx !== i))

  if (!visitId) {
    return (
      <div className="p-6">
        <h1 className="text-2xl font-semibold text-gray-900 mb-4">Billing</h1>
        <p className="text-gray-500">No visit selected. Search for an active visit to process billing.</p>
      </div>
    )
  }

  return (
    <div className="p-6 max-w-3xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Billing</h1>
          {visit && <p className="text-sm text-gray-500 mt-0.5">Patient: <strong>{visit.patient_name}</strong></p>}
        </div>
        {step === 'paid' && (
          <button onClick={() => navigate(returnTo === 'queue' ? '/queue' : '/billing')}
            className="bg-green-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-green-700">
            {returnTo === 'queue' ? 'Back to Queue' : 'New Billing'}
          </button>
        )}
      </div>

      {/* Success state */}
      {step === 'paid' && invoice && (
        <div className="bg-green-50 border border-green-200 rounded-xl p-8 text-center">
          <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h2 className="text-xl font-bold text-green-800 mb-2">Payment Received</h2>
          <p className="text-green-700 text-sm mb-1">
            ₹{invoice.total.toFixed(2)} paid via <span className="font-semibold capitalize">{invoice.payment_method}</span>
          </p>
          <p className="text-xs text-green-600">
            {returnTo === 'queue'
              ? 'Patient added to nurse queue.'
              : 'Visit closed. Patient discharge complete.'}
          </p>
        </div>
      )}

      {/* Building invoice */}
      {step === 'build' && (
        <>
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="px-5 py-3 bg-gray-50 border-b border-gray-200 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-700">Invoice Line Items</h2>
              <button onClick={addRow} className="text-xs text-primary hover:underline font-medium">+ Add Row</button>
            </div>

            <div className="divide-y divide-gray-100">
              {lineItems.map((row, i) => (
                <div key={i} className="flex items-center gap-3 px-5 py-3">
                  <input
                    value={row.description}
                    onChange={e => updateRow(i, 'description', e.target.value)}
                    placeholder="Service description"
                    className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                  />
                  <div className="relative w-32">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">₹</span>
                    <input
                      value={row.amount}
                      onChange={e => updateRow(i, 'amount', e.target.value)}
                      placeholder="0.00"
                      type="number"
                      min="0"
                      className="w-full pl-6 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                    />
                  </div>
                  {lineItems.length > 1 && (
                    <button onClick={() => removeRow(i)} className="text-gray-400 hover:text-red-500">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  )}
                </div>
              ))}
            </div>

            {/* Summary */}
            <div className="px-5 py-4 bg-gray-50 border-t border-gray-200 space-y-2">
              <SumRow label="Subtotal" value={`₹${subtotal.toFixed(2)}`} />
              <div className="flex items-center justify-between">
                <label className="text-sm text-gray-500">Discount (₹)</label>
                <input value={discount} onChange={e => setDiscount(e.target.value)} type="number" min="0"
                  className="w-28 text-right border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
              </div>
              <div className="flex items-center justify-between">
                <label className="text-sm text-gray-500">Tax (₹)</label>
                <input value={tax} onChange={e => setTax(e.target.value)} type="number" min="0"
                  className="w-28 text-right border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
              </div>
              <div className="flex items-center justify-between pt-2 border-t border-gray-200">
                <span className="font-semibold text-gray-900">Total</span>
                <span className="text-xl font-bold text-primary">₹{total.toFixed(2)}</span>
              </div>
            </div>
          </div>

          <button
            onClick={() => createInvoice()}
            disabled={creating || lineItems.every(li => !li.amount)}
            className="w-full bg-primary text-white py-3 rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
          >
            {creating ? 'Creating Invoice…' : 'Generate Invoice & Proceed to Payment'}
          </button>
        </>
      )}

      {/* Payment confirmation */}
      {step === 'confirm' && invoice && (
        <div className="space-y-5">
          <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-3">
            <h2 className="font-semibold text-gray-900">Invoice Summary</h2>
            <div className="space-y-1">
              {invoice.line_items?.map((li: any, i: number) => (
                <SumRow key={i} label={li.description} value={`₹${parseFloat(li.amount).toFixed(2)}`} />
              ))}
            </div>
            <div className="pt-2 border-t border-gray-100 space-y-1">
              <SumRow label="Discount" value={`-₹${invoice.discount.toFixed(2)}`} />
              <SumRow label="Tax" value={`₹${invoice.tax.toFixed(2)}`} />
              <div className="flex items-center justify-between pt-1">
                <span className="font-bold text-gray-900">Total Due</span>
                <span className="text-2xl font-black text-primary">₹{invoice.total.toFixed(2)}</span>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <h3 className="font-semibold text-gray-900 mb-3">Payment Method</h3>
            <div className="grid grid-cols-4 gap-3">
              {PAYMENT_METHODS.map(pm => (
                <button
                  key={pm.value}
                  onClick={() => setPaymentMethod(pm.value)}
                  className={`flex flex-col items-center py-4 rounded-xl border-2 transition-colors ${
                    paymentMethod === pm.value
                      ? 'border-primary bg-primary/5 text-primary'
                      : 'border-gray-200 text-gray-600 hover:border-primary/30'
                  }`}
                >
                  <span className="text-2xl mb-1">{pm.icon}</span>
                  <span className="text-xs font-medium">{pm.label}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="flex gap-3">
            <button onClick={() => setStep('build')}
              className="border border-gray-300 text-gray-700 px-5 py-2.5 rounded-lg text-sm font-medium hover:bg-gray-50">
              Back
            </button>
            <button onClick={() => processPayment()} disabled={paying}
              className="flex-1 bg-green-600 text-white py-2.5 rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-60">
              {paying ? 'Processing…' : `Confirm Payment — ₹${invoice.total.toFixed(2)}`}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function SumRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-gray-500">{label}</span>
      <span className="font-medium text-gray-900">{value}</span>
    </div>
  )
}
