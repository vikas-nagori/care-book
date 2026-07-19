import type { UserRole } from '../supabase/types'

/**
 * Content + logic layer for the in-app Guided Tour.
 *
 * These strings are the single source of truth for the tour copy — lift them
 * into an i18n/content layer if the app is ever localised. The tour component
 * consumes {@link getChaptersForRole} to render the role-appropriate track.
 *
 * Role/permission facts are grounded in the codebase:
 * - `lib/access/restricted-visibility.ts` — staff: no billing, no payment signals
 * - `lib/access/appointment-visibility.ts` — staff see own/assigned/shared only
 * - `lib/settings/access.ts` — `admin` vs `profile_only`
 */

export type TourRole = UserRole

/** A single step: a hotspot pinned over the mockup plus its explanatory copy. */
export type TourStep = {
  title: string
  body: string
  /** Horizontal hotspot position over the desktop mockup, as a percentage. */
  x: number
  /** Vertical hotspot position over the desktop mockup, in pixels. */
  y: number
}

/** Which mockup a chapter renders. Doubles as the chapter's stable id. */
export type TourChapterId =
  | 'roles'
  | 'permissions'
  | 'appointment'
  | 'patients'
  | 'billing'
  | 'invite'
  | 'external'
  | 'types'
  | 'packages'
  | 'pending'

export type TourGroup = 'Get started' | 'Daily work' | 'Admin setup'

/** Authoring shape — carries both the shared and staff-specific variants. */
type TourChapterDef = {
  id: TourChapterId
  title: string
  group: TourGroup
  roles: TourRole[]
  intro: string
  introStaff?: string
  steps: TourStep[]
  stepsStaff?: TourStep[]
}

/** Resolved shape handed to the UI — intro/steps already picked for the role. */
export type TourChapter = {
  id: TourChapterId
  title: string
  group: TourGroup
  intro: string
  steps: TourStep[]
}

const CHAPTER_DEFS: TourChapterDef[] = [
  {
    id: 'roles',
    title: 'Admin vs Staff — who sees what',
    group: 'Get started',
    roles: ['admin', 'staff'],
    intro:
      'Care-Book gives each person one of two roles. Knowing which one you have tells you exactly what you can see and do.',
    introStaff:
      'You are a Staff member. Here is what that means day to day, and where Admins can do more.',
    steps: [
      {
        title: 'Two kinds of user',
        body: 'Everyone is either an Admin or Staff. Admins run the whole clinic; Staff look after their own patients and sessions.',
        x: 50,
        y: -6,
      },
      {
        title: 'Only Admins see Billing',
        body: 'The Billing tab and every payment figure are hidden from Staff. Admins see the clinic’s full financial picture.',
        x: 15,
        y: 128,
      },
      {
        title: 'Staff see only their own work',
        body: 'Staff see appointments they created or were assigned, plus any marked as shared. Admins see every appointment in the clinic.',
        x: 66,
        y: 60,
      },
    ],
    stepsStaff: [
      {
        title: 'You are Staff',
        body: 'You can manage patients, run your sessions, and see the appointments assigned to you — everything you need for daily care.',
        x: 66,
        y: -6,
      },
      {
        title: 'Billing is Admin-only',
        body: 'Payments and the Billing tab sit with Admins. If a patient asks about fees, an Admin can help.',
        x: 15,
        y: 128,
      },
      {
        title: 'Your focused schedule',
        body: 'You see your own and shared appointments — not the whole clinic. That keeps your day uncluttered.',
        x: 66,
        y: 60,
      },
    ],
  },
  {
    id: 'permissions',
    title: 'Extra powers admins have',
    group: 'Get started',
    roles: ['admin'],
    intro:
      'Beyond everything Staff can do, Admins unlock the clinic’s setup and money tools. Here is what is yours alone.',
    steps: [
      {
        title: 'Set up the clinic',
        body: 'Appointment types, package templates and rates are all yours to configure — they shape how every booking and bill works.',
        x: 26,
        y: 40,
      },
      {
        title: 'Manage the team',
        body: 'Invite new users, add external staff, and see who has accepted — all from Settings.',
        x: 74,
        y: 40,
      },
      {
        title: 'See the whole clinic & its money',
        body: 'Only Admins open Billing and see every appointment across all staff, not just their own.',
        x: 50,
        y: 150,
      },
    ],
  },
  {
    id: 'appointment',
    title: 'Book an appointment & assign it',
    group: 'Daily work',
    roles: ['admin', 'staff'],
    intro:
      'Bookings are the heart of Care-Book. Creating one takes a moment — the important part is who it is assigned to.',
    introStaff: 'Booking a session for your patients is quick. Here is the flow you’ll use most.',
    steps: [
      {
        title: 'Pick patient & type',
        body: 'Choose the patient and the appointment type. The type decides the fee and whether the booking is shared with the team.',
        x: 24,
        y: 30,
      },
      {
        title: 'Assign it to someone',
        body: 'Assign the session to a staff member or an external person. Whoever is assigned will see it on their schedule.',
        x: 24,
        y: 140,
      },
      {
        title: 'Shared vs private',
        body: 'Shared appointments are visible to all staff; private ones stay with the people involved. Admins can always see both.',
        x: 76,
        y: 90,
      },
    ],
    stepsStaff: [
      {
        title: 'Pick patient & type',
        body: 'Choose the patient and appointment type. The type sets the fee for you automatically.',
        x: 24,
        y: 30,
      },
      {
        title: 'It’s assigned to you',
        body: 'New sessions you create are assigned to you, so they show up on your own schedule right away.',
        x: 24,
        y: 140,
      },
    ],
  },
  {
    id: 'patients',
    title: 'Patients & their records',
    group: 'Daily work',
    roles: ['admin', 'staff'],
    intro:
      'Every patient has one record: their details, treatment plans and session history in one place.',
    introStaff:
      'Everything about a patient lives in their record — details, plans and past sessions.',
    steps: [
      {
        title: 'Find or add a patient',
        body: 'Search by name or phone. New to the clinic? Add them in a few fields and they’re ready to book.',
        x: 24,
        y: 24,
      },
      {
        title: 'Open their record',
        body: 'Tap any patient to see contact details, medical history and treatment plans together.',
        x: 50,
        y: 120,
      },
      {
        title: 'Session history',
        body: 'Past sessions and notes are listed here, so anyone caring for them can catch up quickly.',
        x: 76,
        y: 120,
      },
    ],
    stepsStaff: [
      {
        title: 'Find or add a patient',
        body: 'Search by name or phone, or add a new patient in a few fields.',
        x: 24,
        y: 24,
      },
      {
        title: 'Open their record',
        body: 'Tap a patient to see history, plans and notes — everything you need before a session.',
        x: 55,
        y: 120,
      },
    ],
  },
  {
    id: 'billing',
    title: 'Billing & payments',
    group: 'Daily work',
    roles: ['admin'],
    intro:
      'Billing is Admin-only. Record payments, sell session packages, and keep an eye on who owes what.',
    steps: [
      {
        title: 'See balances at a glance',
        body: 'Each patient’s paid and pending amounts are here, so nothing slips through.',
        x: 26,
        y: 26,
      },
      {
        title: 'Record a payment',
        body: 'Log a payment against a patient in a couple of taps — it links to their sessions automatically.',
        x: 74,
        y: 26,
      },
      {
        title: 'Sell a package',
        body: 'Turn a package template into a paid plan of sessions for a patient.',
        x: 50,
        y: 140,
      },
    ],
  },
  {
    id: 'invite',
    title: 'Invite a team member',
    group: 'Admin setup',
    roles: ['admin'],
    intro:
      'Bring a colleague into Care-Book. They get an email link to finish setting up their own login.',
    steps: [
      {
        title: 'Fill in their details',
        body: 'Enter the person’s name, mobile number and email. This is who the invitation goes to.',
        x: 50,
        y: 34,
      },
      {
        title: 'Choose their role',
        body: 'Pick Staff for therapists and helpers, or Admin for people who also manage setup and billing. Choose carefully — Admins can see everything.',
        x: 50,
        y: 118,
      },
      {
        title: 'Send the invite',
        body: 'Press Send Invite. They get an email link to create a password — no need for you to set one.',
        x: 50,
        y: 160,
      },
    ],
  },
  {
    id: 'external',
    title: 'Add & invite external staff',
    group: 'Admin setup',
    roles: ['admin'],
    intro:
      'External staff are visiting or part-time people — locums, visiting doctors — you can assign appointments to without giving full access.',
    steps: [
      {
        title: 'Add the person',
        body: 'Enter their name and phone to add them. They can now be assigned to appointments straight away.',
        x: 40,
        y: 30,
      },
      {
        title: 'They appear in the list',
        body: 'Added people show here with their status: active, invite pending, or onboarded.',
        x: 30,
        y: 118,
      },
      {
        title: 'Optionally invite them in',
        body: 'If a visiting person should log in themselves, add their email and Send invite — that upgrades them to a full Staff login.',
        x: 82,
        y: 108,
      },
    ],
  },
  {
    id: 'types',
    title: 'Appointment types & rates',
    group: 'Admin setup',
    roles: ['admin'],
    intro:
      'Appointment types define what you offer and what it costs. Every booking picks one of these.',
    steps: [
      {
        title: 'Name & session rate',
        body: 'Each type has a name and a fee. When staff book this type, the fee fills in automatically.',
        x: 30,
        y: 40,
      },
      {
        title: 'Shared or private',
        body: 'Shared types are visible to all staff; private ones stay with the people involved. This controls who sees the booking.',
        x: 74,
        y: 40,
      },
      {
        title: 'Set a default',
        body: 'Mark the type used most often as default, so booking is one tap faster.',
        x: 50,
        y: 130,
      },
    ],
  },
  {
    id: 'packages',
    title: 'Package templates',
    group: 'Admin setup',
    roles: ['admin'],
    intro:
      'Package templates are pre-priced bundles of sessions — e.g. 10 sessions at a set rate — you can sell to patients.',
    steps: [
      {
        title: 'Define the bundle',
        body: 'Give it a name, a minimum number of sessions and a per-session amount. That’s the template.',
        x: 44,
        y: 44,
      },
      {
        title: 'Reuse it in Billing',
        body: 'Once saved, you can apply this package to any patient from the Billing screen — no re-typing.',
        x: 50,
        y: 132,
      },
    ],
  },
  {
    id: 'pending',
    title: 'Manage pending invites',
    group: 'Admin setup',
    roles: ['admin'],
    intro:
      'After you invite someone, track it here until they accept — and fix things if an email goes astray.',
    steps: [
      {
        title: 'Watch the status',
        body: 'Each invite shows pending, accepted or revoked, so you always know who has joined.',
        x: 55,
        y: 40,
      },
      {
        title: 'Resend if needed',
        body: 'Email lost or expired? Resend sends a fresh link to the same person.',
        x: 74,
        y: 108,
      },
      {
        title: 'Revoke a mistake',
        body: 'Invited the wrong person or picked the wrong role? Revoke cancels the link before they can use it.',
        x: 88,
        y: 108,
      },
    ],
  },
]

/**
 * Resolve the ordered list of chapters for a role, picking the staff-specific
 * intro/steps where they exist. Admins get all 10 chapters; staff get the 3
 * chapters that include `'staff'` in their `roles`.
 */
export function getChaptersForRole(role: TourRole): TourChapter[] {
  return CHAPTER_DEFS.filter((chapter) => chapter.roles.includes(role)).map((chapter) => ({
    id: chapter.id,
    title: chapter.title,
    group: chapter.group,
    intro: role === 'staff' && chapter.introStaff ? chapter.introStaff : chapter.intro,
    steps: role === 'staff' && chapter.stepsStaff ? chapter.stepsStaff : chapter.steps,
  }))
}

/** Ordered, de-duplicated group names for the role's chapters. */
export function getGroupsForRole(role: TourRole): TourGroup[] {
  const groups: TourGroup[] = []
  for (const chapter of getChaptersForRole(role)) {
    if (!groups.includes(chapter.group)) groups.push(chapter.group)
  }
  return groups
}
