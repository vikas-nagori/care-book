import { SEED } from './ids.ts'

export type RouteAccessGroup = 'shared' | 'admin' | 'platform' | 'public'

export type RouteLandmark = {
  kind: 'heading' | 'button' | 'text'
  name: string
}

export type RouteRuntimeCase = {
  requestPath: string
  expected: {
    kind: 'render' | 'redirect'
    pathname: string
    query?: Record<string, string>
  }
  landmark: RouteLandmark
}

export type PageRouteDeclaration = {
  pattern: string
  access: RouteAccessGroup
  owner: string
  cases: readonly RouteRuntimeCase[]
}

export const PAGE_ROUTE_MANIFEST: readonly PageRouteDeclaration[] = [
  {
    pattern: '/',
    access: 'shared',
    owner: 'e2e/shared/routes.spec.ts',
    cases: [{ requestPath: '/', expected: { kind: 'render', pathname: '/' }, landmark: { kind: 'heading', name: 'Today' } }],
  },
  {
    pattern: '/patients',
    access: 'shared',
    owner: 'e2e/shared/routes.spec.ts',
    cases: [{ requestPath: '/patients', expected: { kind: 'render', pathname: '/patients' }, landmark: { kind: 'heading', name: 'Patients' } }],
  },
  {
    pattern: '/patients/new',
    access: 'shared',
    owner: 'e2e/shared/routes.spec.ts',
    cases: [{ requestPath: '/patients/new', expected: { kind: 'render', pathname: '/patients/new' }, landmark: { kind: 'heading', name: 'New Patient' } }],
  },
  {
    pattern: '/patients/[id]',
    access: 'shared',
    owner: 'e2e/shared/routes.spec.ts',
    cases: [{
      requestPath: `/patients/${SEED.patientAsha}`,
      expected: { kind: 'render', pathname: `/patients/${SEED.patientAsha}` },
      landmark: { kind: 'text', name: 'Asha Rao' },
    }],
  },
  {
    pattern: '/patients/[id]/edit',
    access: 'shared',
    owner: 'e2e/shared/routes.spec.ts',
    cases: [{
      requestPath: `/patients/${SEED.patientAsha}/edit`,
      expected: { kind: 'render', pathname: `/patients/${SEED.patientAsha}/edit` },
      landmark: { kind: 'heading', name: 'Edit Patient' },
    }],
  },
  {
    pattern: '/schedule',
    access: 'shared',
    owner: 'e2e/shared/routes.spec.ts',
    cases: [{ requestPath: '/schedule', expected: { kind: 'render', pathname: '/schedule' }, landmark: { kind: 'heading', name: 'Schedule' } }],
  },
  {
    pattern: '/schedule/new',
    access: 'shared',
    owner: 'e2e/shared/routes.spec.ts',
    cases: [{ requestPath: '/schedule/new', expected: { kind: 'render', pathname: '/schedule/new' }, landmark: { kind: 'text', name: 'New Appointment' } }],
  },
  {
    pattern: '/schedule/[id]',
    access: 'shared',
    owner: 'e2e/shared/routes.spec.ts',
    cases: [{
      requestPath: `/schedule/${SEED.appointmentShared}`,
      expected: { kind: 'render', pathname: `/schedule/${SEED.appointmentShared}` },
      landmark: { kind: 'text', name: 'Appointment' },
    }],
  },
  {
    pattern: '/settings',
    access: 'shared',
    owner: 'e2e/shared/routes.spec.ts',
    cases: [{ requestPath: '/settings', expected: { kind: 'render', pathname: '/settings' }, landmark: { kind: 'heading', name: 'Settings' } }],
  },
  {
    pattern: '/billing',
    access: 'admin',
    owner: 'e2e/admin/routes.spec.ts',
    cases: [{ requestPath: '/billing', expected: { kind: 'render', pathname: '/billing' }, landmark: { kind: 'heading', name: 'Billing' } }],
  },
  {
    pattern: '/billing/metrics/[metric]',
    access: 'admin',
    owner: 'e2e/admin/routes.spec.ts',
    cases: [
      { requestPath: '/billing/metrics/billed-this-month', expected: { kind: 'render', pathname: '/billing/metrics/billed-this-month' }, landmark: { kind: 'text', name: 'Total billed' } },
      { requestPath: '/billing/metrics/billed-last-month', expected: { kind: 'render', pathname: '/billing/metrics/billed-last-month' }, landmark: { kind: 'text', name: 'Monthly billed trend' } },
      { requestPath: '/billing/metrics/received-this-month', expected: { kind: 'render', pathname: '/billing/metrics/received-this-month' }, landmark: { kind: 'text', name: 'Received' } },
    ],
  },
  {
    pattern: '/billing/packages/[id]',
    access: 'admin',
    owner: 'e2e/admin/routes.spec.ts',
    cases: [{
      requestPath: `/billing/packages/${SEED.packageAsha}`,
      expected: { kind: 'render', pathname: `/billing/packages/${SEED.packageAsha}` },
      landmark: { kind: 'text', name: '10-Session Physiotherapy Package' },
    }],
  },
  {
    pattern: '/billing/payment-due/[patientId]',
    access: 'admin',
    owner: 'e2e/admin/routes.spec.ts',
    cases: [{
      requestPath: `/billing/payment-due/${SEED.patientPaymentDue}`,
      expected: { kind: 'render', pathname: `/billing/payment-due/${SEED.patientPaymentDue}` },
      landmark: { kind: 'text', name: 'Meera Payment Due' },
    }],
  },
  {
    pattern: '/platform',
    access: 'platform',
    owner: 'e2e/platform/routes.spec.ts',
    cases: [{ requestPath: '/platform', expected: { kind: 'render', pathname: '/platform' }, landmark: { kind: 'heading', name: 'Overview' } }],
  },
  {
    pattern: '/platform/clinics',
    access: 'platform',
    owner: 'e2e/platform/routes.spec.ts',
    cases: [{ requestPath: '/platform/clinics', expected: { kind: 'render', pathname: '/platform/clinics' }, landmark: { kind: 'heading', name: 'Clinics' } }],
  },
  {
    pattern: '/platform/users',
    access: 'platform',
    owner: 'e2e/platform/routes.spec.ts',
    cases: [{ requestPath: '/platform/users', expected: { kind: 'render', pathname: '/platform/users' }, landmark: { kind: 'heading', name: 'Users' } }],
  },
  {
    pattern: '/platform/clinic-requests',
    access: 'platform',
    owner: 'e2e/platform/routes.spec.ts',
    cases: [{ requestPath: '/platform/clinic-requests', expected: { kind: 'render', pathname: '/platform/clinic-requests' }, landmark: { kind: 'heading', name: 'Clinic Requests' } }],
  },
  {
    pattern: '/login',
    access: 'public',
    owner: 'e2e/public/routes.spec.ts',
    cases: [{ requestPath: '/login', expected: { kind: 'render', pathname: '/login' }, landmark: { kind: 'button', name: 'Sign In' } }],
  },
  {
    pattern: '/oauth/authorize',
    access: 'public',
    owner: 'e2e/public/routes.spec.ts',
    cases: [{ requestPath: '/oauth/authorize', expected: { kind: 'redirect', pathname: '/login', query: { next: '/oauth/authorize' } }, landmark: { kind: 'button', name: 'Sign In' } }],
  },
  {
    pattern: '/clinic-onboarding',
    access: 'public',
    owner: 'e2e/public/routes.spec.ts',
    cases: [{ requestPath: '/clinic-onboarding', expected: { kind: 'render', pathname: '/clinic-onboarding' }, landmark: { kind: 'text', name: 'Clinic Onboarding' } }],
  },
  {
    pattern: '/auth/complete-invite',
    access: 'public',
    owner: 'e2e/public/routes.spec.ts',
    cases: [{
      requestPath: '/auth/complete-invite',
      expected: { kind: 'redirect', pathname: '/login', query: { error: 'invite-required' } },
      landmark: { kind: 'button', name: 'Sign In' },
    }],
  },
  {
    pattern: '/auth/update-password',
    access: 'public',
    owner: 'e2e/public/routes.spec.ts',
    cases: [{
      requestPath: '/auth/update-password',
      expected: { kind: 'redirect', pathname: '/login', query: { error: 'reset-link-invalid' } },
      landmark: { kind: 'button', name: 'Sign In' },
    }],
  },
  {
    pattern: '/auth/change-password',
    access: 'public',
    owner: 'e2e/public/routes.spec.ts',
    cases: [{
      requestPath: '/auth/change-password',
      expected: { kind: 'redirect', pathname: '/login' },
      landmark: { kind: 'button', name: 'Sign In' },
    }],
  },
] as const

export function pageRoutesFor(access: RouteAccessGroup): readonly PageRouteDeclaration[] {
  return PAGE_ROUTE_MANIFEST.filter((route) => route.access === access)
}
