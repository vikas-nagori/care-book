# Temporary-password user invites

Status: requested by the user on 21 November 2026 ("emails not arriving, remove email entirely, just dive in").

## Intent

Supabase invite emails are not reliably reaching invitees. Replace email-based clinic user invites with the
temporary-password flow already used for clinic-owner onboarding: the clinic admin copies a one-time password,
shares it directly (e.g. WhatsApp), and the invitee is forced to set their own password on first login.

## Goals

- Settings → Invite User creates a confirmed auth account with a generated temp password and
  `app_metadata.must_change_password = true`; no email is sent. The admin sees the password once, with a copy button.
- External staff "Send invite" (linking an external staff record to a login) uses the same path.
- Invites list "Resend" becomes "New password": issues a fresh temp password for a still-pending invite.
- First login goes through the existing forced `/auth/change-password` page, which marks the invite accepted,
  syncs name/mobile, and (new) links the external staff record when the invite carries one.

## Non-goals

- No email fallback or toggle. No change to clinic-owner approval or platform "issue temp password".
- No migration: all state already exists (`user_invites`, `must_change_password`, auth bans).

## Anti-goals

- A revoked invitee must not be able to sign in or read clinic data with a temp password they already hold.
- The temp password is never persisted or logged.

## Decisions (Claude's calls)

- **Revoke** now also bans the auth user (`BAN_DURATION`) and resets the profile to the clinic-less placeholder
  (`clinic_id = null`, role `staff`). Under email invites revoke only flipped the status, which was enough because
  the invitee had no password; with temp passwords the account is usable immediately, and RLS keys off
  `profiles.clinic_id`, so clearing it cuts data access even for a session issued before the ban.
- **Re-inviting a revoked email** reuses the existing auth user: new temp password, ban lifted, flag re-armed,
  profile re-synced (no `createUser`, which would fail on the existing email).
- **Already-sent invite emails**: `/auth/complete-invite` stays as-is so links already in inboxes still work;
  "New password" also works for those legacy invites (sets `email_confirm` so unconfirmed accounts can sign in).
- `TempPasswordDialog` moves from `components/platform` to `components/onboarding` with recipient-neutral copy.
- **Mobile-first hand-over** (user: "mobile is primary interface"): on phones the password step is a bottom
  sheet like every other settings flow; desktop keeps a centred dialog. The primary action is **Share login**
  (Web Share API → WhatsApp/SMS) with a ready message (sign-in link, email, temp password); **Copy login details**
  copies the same message and becomes primary where no share sheet exists; **Done** is a quiet text button.
  Tapping outside / Escape cannot dismiss it until the details were shared or copied. A cancelled share sheet is
  a no-op; a failed share falls back to copying.
- The mobile Settings "Invites" row shows the pending count with a key icon (was "N sent" with an envelope).
- Copy updates: invite form, invites list, external staff list, guided-tour text/mockups, clinic onboarding
  success message (owner no longer gets an email).

## Testing

Component tests for the invite form / invites list / dialog; e2e admin settings spec asserts the
password dialog, `must_change_password`, ban on revoke, re-invite; plus an invitee first-login e2e path through
`/auth/change-password` to dashboard.
