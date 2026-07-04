# Repository Guidelines

## Project Structure & Module Organization
This is a Next.js 14 App Router CRM for a physiotherapy practice, backed by Supabase Auth, Postgres, RLS, admin/staff roles, invite onboarding, admin-only billing, and restricted staff visibility. Route entrypoints live in `src/app`, with server-rendered `page.tsx` files and feature-specific client components such as `schedule-view.tsx`, `patient-list.tsx`, and `appointment-form.tsx`. Shared primitives are in `src/components/ui`, layout shell components are in `src/components/layout`, and reusable access, billing, onboarding, settings, schedule, Supabase, and utility helpers live in `src/lib` and `src/hooks`. Database schema and migrations are under `supabase/`, while installable assets such as `manifest.json` and `sw.js` live in `public/`.

## Architecture & Data Flow
Code and migrations are the source of truth; `docs/PRD.md` is historical context and may be stale. Route `page.tsx` files fetch data server-side through `src/lib/supabase/server.ts`, then pass props into client components for search, dialogs, forms, and other interactivity. Client forms and views perform mutations through Supabase clients or server actions, then refresh server data with `router.refresh()` or `revalidatePath()`. Keep auth and access behavior aligned with `src/middleware.ts`, `src/lib/auth.ts`, `src/lib/access/restricted-visibility.ts`, `src/lib/settings/access.ts`, and Supabase RLS migrations.

## Build, Test, and Development Commands
Use `npm run dev` to start the local dev server, `npm run build` to verify the production build, `npm run start` to serve the built app, `npm run lint` for ESLint checks, and `npm run test:unit` for the existing Node test suite covering `src/lib/**/*.test.ts`. For most code changes, run the focused unit tests first when relevant, then `npm run lint` and `npm run build` before handing off.

## Coding Style & Naming Conventions
Use TypeScript with strict typing and the `@/*` path alias from `tsconfig.json`. Follow existing React patterns: route files stay as `page.tsx`, shared components use PascalCase exports, and feature files use descriptive kebab-case names like `payment-form.tsx` or `users-list.tsx`. Match the current style of 2-space indentation, functional components, and Tailwind utility classes. For server-side logging, prefer `src/lib/logger.ts` over ad hoc console output.

## Testing Guidelines
Add or update focused unit tests under `src/lib/**/*.test.ts` when changing reusable helpers, access rules, billing calculations, onboarding validation, or date logic. Validate broader changes with `npm run test:unit`, `npm run lint`, and `npm run build`, then manually exercise affected flows such as `/patients`, `/schedule`, `/billing`, `/settings`, and invite completion when UI or data behavior changes. Include concise manual QA notes in the pull request for visible or workflow changes.

## Branching Policy
**Always do all fixes and development in a new branch.** Never commit code changes directly to `main`. Create a descriptive branch (e.g. `feat/…`, `fix/…`, `chore/…`) before touching any source file. This makes every change easy to review and revert.

## Commit & Pull Request Guidelines
Recent history follows Conventional Commit prefixes such as `feat:`, `fix:`, and `chore:`. Keep commits focused and scoped to a single change. Pull requests should describe behavior changes, call out any `supabase/migrations/` updates, link related issues when available, and include screenshots for visible UI changes.

## Security & Configuration Tips
Do not commit `.env.local`; this app depends on `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and admin onboarding flows may require Supabase service-role configuration outside the client bundle. Billing data, packages, payments, and payment-to-session linking are admin-only. Staff-facing UI intentionally hides billing/payment signals and filters home visits from key views, so keep UI restrictions, server queries, access helpers, and RLS policies in sync. When changing database behavior, update migrations rather than relying only on `supabase/schema.sql`.
