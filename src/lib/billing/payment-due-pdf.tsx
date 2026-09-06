import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
} from '@react-pdf/renderer'
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
  return <Text>{formatPaiseAsInr(value)}</Text>
}

function RegularSection({ statement }: { statement: PaymentDueStatement }) {
  if (!statement.regular) return null
  const regular = statement.regular
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>Regular sessions</Text>
      <Text style={styles.sectionSubtitle}>{regular.periodLabel}</Text>
      <View style={styles.table}>
        <View style={styles.tableHeader} fixed>
          <Text style={styles.date}>Date</Text>
          <Text style={styles.type}>Session type</Text>
          <Text style={styles.amount}>Fee</Text>
          <Text style={styles.amount}>Paid</Text>
          <Text style={styles.amount}>Due</Text>
        </View>
        {regular.rows.map((row) => (
          <View style={styles.row} key={row.id} wrap={false}>
            <Text style={styles.date}>{formatDateOnly(row.date, 'dd MMM yyyy')}</Text>
            <Text style={styles.type}>{row.type}</Text>
            <Text style={styles.amount}><Money value={row.feePaise} /></Text>
            <Text style={styles.amount}><Money value={row.paidPaise} /></Text>
            <Text style={styles.amount}><Money value={row.duePaise} /></Text>
          </View>
        ))}
        <View style={styles.subtotal} wrap={false}>
          <Text style={{ width: '50%' }}>Subtotal — {regular.rows.length} session{regular.rows.length === 1 ? '' : 's'}</Text>
          <Text style={styles.amount}><Money value={regular.totalFeePaise} /></Text>
          <Text style={styles.amount}><Money value={regular.totalPaidPaise} /></Text>
          <Text style={styles.amount}><Money value={regular.totalDuePaise} /></Text>
        </View>
      </View>
    </View>
  )
}

function PackageSection({ statement }: { statement: PaymentDueStatement }) {
  if (statement.packages.length === 0) return null
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>Packages</Text>
      <Text style={styles.sectionSubtitle}>Complete package history</Text>
      {statement.packages.map((pkg) => (
        <View style={styles.packageCard} key={pkg.id}>
          <Text style={styles.packageName}>{pkg.name}</Text>
          <View style={styles.packageMeta}><Text style={styles.detailLabel}>Total package amount</Text><Text style={styles.detailValue}><Money value={pkg.quoteAmountPaise} /></Text></View>
          <View style={styles.packageMeta}><Text style={styles.detailLabel}>Amount paid into package</Text><Text style={styles.detailValue}><Money value={pkg.paidIntoPackagePaise} /></Text></View>
          <View style={styles.packageMeta}><Text style={styles.detailLabel}>Total sessions</Text><Text style={styles.detailValue}>{pkg.totalSessions}</Text></View>
          <View style={styles.packageMeta}><Text style={styles.detailLabel}>Sessions left</Text><Text style={styles.detailValue}>{pkg.sessionsLeft}</Text></View>
          <Text style={styles.datesLabel}>Completed session dates</Text>
          <Text style={styles.dateList}>{pkg.completedSessions.map((session) => formatDateOnly(session.date, 'dd MMM yyyy')).join(' · ')}</Text>
          <View style={styles.packageMeta}><Text style={styles.detailLabel}>Charges for completed sessions</Text><Text style={styles.detailValue}><Money value={pkg.completedChargePaise} /></Text></View>
          <View style={styles.packageMeta}><Text style={styles.detailLabel}>Payment applied to completed sessions</Text><Text style={styles.detailValue}><Money value={pkg.completedPaidPaise} /></Text></View>
          <View style={styles.packageDue}><Text style={styles.detailLabel}>Package payment due</Text><Text style={styles.detailValue}><Money value={pkg.duePaise} /></Text></View>
        </View>
      ))}
    </View>
  )
}

export function PaymentDuePdf({ statement }: { statement: PaymentDueStatement }) {
  const generated = new Date(statement.generatedAt)
  const generatedLabel = `${generated.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' })}, ${generated.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false })} IST`
  return (
    <Document title={`Payment summary — ${statement.patientName}`} author={statement.clinicName}>
      <Page size="A4" style={styles.page} wrap>
        <View style={styles.header}>
          <Text style={styles.clinic}>{statement.clinicName}</Text>
          <Text style={styles.title}>Payment summary</Text>
          <Text style={styles.patient}>Patient: {statement.patientName}</Text>
          <Text style={styles.generated}>Generated: {generatedLabel}</Text>
        </View>

        <RegularSection statement={statement} />
        <PackageSection statement={statement} />

        <View style={styles.total} wrap={false}>
          <Text style={styles.totalLabel}>Total payment due in this statement</Text>
          <Text style={styles.totalValue}><Money value={statement.totalDuePaise} /></Text>
        </View>
        <Text style={styles.note}>Please arrange payment at your convenience. Thank you.</Text>

        <Text style={styles.footer} fixed render={({ pageNumber, totalPages }) => `Care-Book · ${pageNumber} / ${totalPages}`} />
      </Page>
    </Document>
  )
}
