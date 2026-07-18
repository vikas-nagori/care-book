import type { UserRole } from '../supabase/types'

export type TutorialIcon =
  | 'sparkles'
  | 'dashboard'
  | 'schedule'
  | 'patients'
  | 'session'
  | 'billing'
  | 'settings'
  | 'finish'

export type TutorialAction = {
  href: string
  label: string
}

export type TutorialStep = {
  id: string
  icon: TutorialIcon
  eyebrow: string
  title: string
  description: string
  checklist: string[]
  actions?: TutorialAction[]
}

const welcomeStep: TutorialStep = {
  id: 'welcome',
  icon: 'sparkles',
  eyebrow: 'Welcome',
  title: 'Your clinic day, in one place',
  description:
    'This two-minute guide shows you the Care-Book workflow you will use most often on your phone.',
  checklist: [
    'Use the bottom navigation to move between the main areas.',
    'Start from Dashboard, then open Schedule, Patients, or Settings.',
    'You can leave the guide and replay it from Settings at any time.',
  ],
}

const scheduleStep: TutorialStep = {
  id: 'schedule',
  icon: 'schedule',
  eyebrow: 'Plan the day',
  title: 'Book and review sessions',
  description:
    'Schedule is the clinic calendar. Use it to move through dates, review bookings, and add new appointments.',
  checklist: [
    'Move between dates or jump to a date with the calendar picker.',
    'Switch between Day and Week, then filter by appointment type.',
    'Open a booking for details, or use New appointment to create one.',
  ],
  actions: [{ href: '/schedule', label: 'Open schedule' }],
}

const patientsStep: TutorialStep = {
  id: 'patients',
  icon: 'patients',
  eyebrow: 'Know the patient',
  title: 'Keep patient records together',
  description:
    'Patients gives you one place to find contact details, treatment plans, and appointment history.',
  checklist: [
    'Add a patient, or search existing records by name or phone.',
    'Open a record to review or edit patient details.',
    'Use the record to follow appointment history and maintain the treatment plan.',
  ],
  actions: [{ href: '/patients', label: 'Open patients' }],
}

const sessionWorkflowStep: TutorialStep = {
  id: 'session-workflow',
  icon: 'session',
  eyebrow: 'During the session',
  title: 'Update the appointment as you work',
  description:
    'Open an appointment from Schedule to keep the visit details and clinical record current.',
  checklist: [
    'Confirm the patient, time, appointment type, and assignment.',
    'Update the appointment status when the visit is completed or cancelled.',
    'Record the session note before moving to the next patient.',
  ],
  actions: [{ href: '/schedule', label: 'Find a session' }],
}

const adminBillingStep: TutorialStep = {
  id: 'billing',
  icon: 'billing',
  eyebrow: 'Admin tools',
  title: 'Keep collections up to date',
  description:
    'Billing is admin-only and brings payments, balances, packages, and clinic totals together.',
  checklist: [
    'Record a payment or a prepaid package for the selected patient.',
    'Review Payment due to follow outstanding balances and available credit.',
    'Open a metric to inspect the sessions and entries behind the total.',
  ],
  actions: [{ href: '/billing', label: 'Open billing' }],
}

const adminClinicSetupStep: TutorialStep = {
  id: 'clinic-setup',
  icon: 'settings',
  eyebrow: 'Admin tools',
  title: 'Set up the clinic and team',
  description:
    'Settings keeps the choices that shape booking, billing, and who can work in the clinic.',
  checklist: [
    'Maintain appointment types and reusable package templates.',
    'Add external staff and invite team members to Care-Book.',
    'Review pending invitations and active users in one place.',
  ],
  actions: [{ href: '/settings', label: 'Open settings' }],
}

function getDashboardStep(role: UserRole): TutorialStep {
  const adminChecklist = [
    'See the next appointment and the clinic activity for today and this week.',
    'Use New appointment or New billing for common mobile tasks.',
    'Open payment summaries to review collected and outstanding amounts.',
  ]

  const staffChecklist = [
    'See the next appointment and the clinic activity for today and this week.',
    'Use New appointment to book a visit without leaving the Dashboard.',
    'Open a summary card to move directly into the relevant schedule view.',
  ]

  return {
    id: 'dashboard',
    icon: 'dashboard',
    eyebrow: 'Start here',
    title: 'See what needs attention today',
    description:
      role === 'admin'
        ? 'Dashboard gives you a quick view of the clinic day, upcoming work, and financial follow-ups.'
        : 'Dashboard gives you a quick view of the clinic day and the work coming up next.',
    checklist: role === 'admin' ? adminChecklist : staffChecklist,
    actions: [{ href: '/', label: 'Open dashboard' }],
  }
}

function getFinishStep(role: UserRole): TutorialStep {
  return {
    id: 'finish',
    icon: 'finish',
    eyebrow: 'You are ready',
    title: 'Follow the same simple loop each day',
    description:
      role === 'admin'
        ? 'Find or add the patient, book the session, keep the appointment updated, save the session note, then review payment.'
        : 'Find or add the patient, book the session, keep the appointment updated, and save the session note.',
    checklist:
      role === 'admin'
        ? [
            'Find or add the patient and book the session.',
            'Update the appointment and record the session note.',
            'Record or review payment before closing the workflow.',
          ]
        : [
            'Find or add the patient and book the session.',
            'Update the appointment as the visit progresses.',
            'Record the session note before moving on.',
          ],
    actions: [
      { href: '/schedule', label: 'Open schedule' },
      { href: '/patients', label: 'Open patients' },
    ],
  }
}

export function getTutorialSteps(role: UserRole): TutorialStep[] {
  const sharedSteps = [
    welcomeStep,
    getDashboardStep(role),
    scheduleStep,
    patientsStep,
    sessionWorkflowStep,
  ]

  return role === 'admin'
    ? [...sharedSteps, adminBillingStep, adminClinicSetupStep, getFinishStep(role)]
    : [...sharedSteps, getFinishStep(role)]
}

export function clampTutorialStepIndex(index: number, stepCount: number) {
  if (stepCount <= 0) return 0
  return Math.min(Math.max(index, 0), stepCount - 1)
}

export function getTutorialProgress(index: number, stepCount: number) {
  if (stepCount <= 0) return 0
  return (clampTutorialStepIndex(index, stepCount) + 1) * (100 / stepCount)
}
