import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
} from '@react-pdf/renderer'
import { createElement, type ReactElement } from 'react'
import { formatDateOnly } from '../timezone'
import { formatPaiseAsInr, type PaymentDueStatement } from './payment-due-statement'

const styles = StyleSheet.create({
  page: { paddingTop: 42, paddingBottom: 42, paddingHorizontal: 42, fontFamily: 'Helvetica', fontSize: 9, color: '#172033' },
  header: { marginBottom: 20 },
  clinic: { fontSize: 10, color: '#566176', marginBottom: 4 },
  title: { fontSize: 20, fontFamily: 'Helvetica-Bold', marginBottom: 10, color: '#0f172a' },
  patient: { fontSize: 11, fontFamily: 'Helvetica-Bold', marginBottom: 3 },
  generated: { fontSize: 8, color: '#566176' },
  section: { marginBottom: 18 },
  sectionTitle: { fontSize: 12, fontFamily: 'Helvetica-Bold', color: '#0f172a', marginBottom: 3 },
  sectionSubtitle: { fontSize: 8, color: '#566176', marginBottom: 8 },
  table: { borderWidth: 1, borderColor: '#d8dee9', borderRadius: 3 },
  tableHeader: { flexDirection: 'row', backgroundColor: '#f3f5f8', borderBottomWidth: 1, borderBottomColor: '#d8dee9', paddingVertical: 6, paddingHorizontal: 7, fontFamily: 'Helvetica-Bold', fontSize: 7.5 },
  row: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#e6eaf0', paddingVertical: 6, paddingHorizontal: 7, minHeight: 24 },
  subtotal: { flexDirection: 'row', backgroundColor: '#fafbfc', paddingVertical: 7, paddingHorizontal: 7, fontFamily: 'Helvetica-Bold' },
  date: { width: '22%' },
  type: { width: '28%' },
  amount: { width: '16.66%', textAlign: 'right' },
  detailLabel: { width: '65%' },
  detailValue: { width: '35%', textAlign: 'right', fontFamily: 'Helvetica-Bold' },
  packageCard: { borderWidth: 1, borderColor: '#d8dee9', borderRadius: 3, padding: 10, marginBottom: 10 },
  packageName: { fontSize: 10, fontFamily: 'Helvetica-Bold', marginBottom: 7 },
  packageMeta: { flexDirection: 'row', marginBottom: 3 },
  datesLabel: { fontFamily: 'Helvetica-Bold', marginTop: 8, marginBottom: 4 },
  dateList: { color: '#566176', lineHeight: 1.35 },
  packageDue: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: '#e6eaf0', paddingTop: 7, marginTop: 8, fontFamily: 'Helvetica-Bold' },
  total: { borderTopWidth: 2, borderTopColor: '#0f172a', paddingTop: 10, marginTop: 4, flexDirection: 'row', fontSize: 13, fontFamily: 'Helvetica-Bold' },
  totalLabel: { width: '65%' },
  totalValue: { width: '35%', textAlign: 'right' },
  note: { marginTop: 10, color: '#566176', fontSize: 8, lineHeight: 1.4 },
  footer: { position: 'absolute', left: 42, right: 42, bottom: 20, flexDirection: 'row', justifyContent: 'space-between', color: '#7a8498', fontSize: 7 },
})

function Money({ value }: { value: number }) {
  return createElement(Text, null, formatPaiseAsInr(value))
}

function RegularSection({ statement }: { statement: PaymentDueStatement }) {
  if (!statement.regular) return null
  const regular = statement.regular
  const header = createElement(
    View,
    { style: styles.tableHeader, fixed: true },
    createElement(Text, { style: styles.date }, 'Date'),
    createElement(Text, { style: styles.type }, 'Session type'),
    createElement(Text, { style: styles.amount }, 'Fee'),
    createElement(Text, { style: styles.amount }, 'Paid'),
    createElement(Text, { style: styles.amount }, 'Due'),
  )
  const rows = regular.rows.map((row) => createElement(
    View,
    { style: styles.row, key: row.id, wrap: false },
    createElement(Text, { style: styles.date }, formatDateOnly(row.date, 'dd MMM yyyy')),
    createElement(Text, { style: styles.type }, row.type),
    createElement(Text, { style: styles.amount }, createElement(Money, { value: row.feePaise })),
    createElement(Text, { style: styles.amount }, createElement(Money, { value: row.paidPaise })),
    createElement(Text, { style: styles.amount }, createElement(Money, { value: row.duePaise })),
  ))
  const subtotal = createElement(
    View,
    { style: styles.subtotal, wrap: false },
    createElement(Text, { style: { width: '50%' } }, `Subtotal — ${regular.rows.length} session${regular.rows.length === 1 ? '' : 's'}`),
    createElement(Text, { style: styles.amount }, createElement(Money, { value: regular.totalFeePaise })),
    createElement(Text, { style: styles.amount }, createElement(Money, { value: regular.totalPaidPaise })),
    createElement(Text, { style: styles.amount }, createElement(Money, { value: regular.totalDuePaise })),
  )
  return createElement(
    View,
    { style: styles.section },
    createElement(Text, { style: styles.sectionTitle }, 'Regular sessions'),
    createElement(Text, { style: styles.sectionSubtitle }, regular.periodLabel),
    createElement(View, { style: styles.table }, header, ...rows, subtotal),
  )
}

function PackageSection({ statement }: { statement: PaymentDueStatement }) {
  if (statement.packages.length === 0) return null
  const cards = statement.packages.map((pkg) => createElement(
    View,
    { style: styles.packageCard, key: pkg.id },
    createElement(Text, { style: styles.packageName }, pkg.name),
    createElement(View, { style: styles.packageMeta }, createElement(Text, { style: styles.detailLabel }, 'Total package amount'), createElement(Text, { style: styles.detailValue }, createElement(Money, { value: pkg.quoteAmountPaise }))),
    createElement(View, { style: styles.packageMeta }, createElement(Text, { style: styles.detailLabel }, 'Amount paid into package'), createElement(Text, { style: styles.detailValue }, createElement(Money, { value: pkg.paidIntoPackagePaise }))),
    createElement(View, { style: styles.packageMeta }, createElement(Text, { style: styles.detailLabel }, 'Total sessions'), createElement(Text, { style: styles.detailValue }, pkg.totalSessions)),
    createElement(View, { style: styles.packageMeta }, createElement(Text, { style: styles.detailLabel }, 'Sessions left'), createElement(Text, { style: styles.detailValue }, pkg.sessionsLeft)),
    createElement(Text, { style: styles.datesLabel }, 'Completed session dates'),
    createElement(Text, { style: styles.dateList }, pkg.completedSessions.map((session) => formatDateOnly(session.date, 'dd MMM yyyy')).join(' · ')),
    createElement(View, { style: styles.packageMeta }, createElement(Text, { style: styles.detailLabel }, 'Charges for completed sessions'), createElement(Text, { style: styles.detailValue }, createElement(Money, { value: pkg.completedChargePaise }))),
    createElement(View, { style: styles.packageMeta }, createElement(Text, { style: styles.detailLabel }, 'Payment applied to completed sessions'), createElement(Text, { style: styles.detailValue }, createElement(Money, { value: pkg.completedPaidPaise }))),
    createElement(View, { style: styles.packageDue }, createElement(Text, { style: styles.detailLabel }, 'Package payment due'), createElement(Text, { style: styles.detailValue }, createElement(Money, { value: pkg.duePaise }))),
  ))
  return createElement(
    View,
    { style: styles.section },
    createElement(Text, { style: styles.sectionTitle }, 'Packages'),
    createElement(Text, { style: styles.sectionSubtitle }, 'Complete package history'),
    ...cards,
  )
}

/**
 * Build the renderer element with React.createElement. Next's server JSX
 * runtime can emit a React element symbol that react-pdf's reconciler does
 * not understand, so this factory keeps the PDF tree on the classic element
 * shape expected by @react-pdf/renderer.
 */
export function createPaymentDuePdfElement(statement: PaymentDueStatement): ReactElement {
  const generated = new Date(statement.generatedAt)
  const generatedLabel = `${generated.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' })}, ${generated.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false })} IST`
  return createElement(
    Document,
    { title: `Payment summary — ${statement.patientName}`, author: statement.clinicName },
    createElement(
      Page,
      { size: 'A4', style: styles.page, wrap: true },
      createElement(
        View,
        { style: styles.header },
        createElement(Text, { style: styles.clinic }, statement.clinicName),
        createElement(Text, { style: styles.title }, 'Payment summary'),
        createElement(Text, { style: styles.patient }, `Patient: ${statement.patientName}`),
        createElement(Text, { style: styles.generated }, `Generated: ${generatedLabel}`),
      ),
      createElement(RegularSection, { statement }),
      createElement(PackageSection, { statement }),
      createElement(
        View,
        { style: styles.total, wrap: false },
        createElement(Text, { style: styles.totalLabel }, 'Total payment due in this statement'),
        createElement(Text, { style: styles.totalValue }, createElement(Money, { value: statement.totalDuePaise })),
      ),
      createElement(Text, { style: styles.note }, 'Please arrange payment at your convenience. Thank you.'),
      createElement(Text, { style: styles.footer, fixed: true, render: ({ pageNumber, totalPages }: { pageNumber: number; totalPages: number }) => `Care-Book · ${pageNumber} / ${totalPages}` }),
    ),
  )
}

export function PaymentDuePdf({ statement }: { statement: PaymentDueStatement }) {
  return createPaymentDuePdfElement(statement)
}
