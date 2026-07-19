# Guided Tour Mobile Flows Design

## Problem

The guided tour detects a phone-sized viewport but still renders desktop artwork for chapters whose `hasMobile` flag is false. This makes the device label change between Desktop and Mobile while a user advances through the same tour. A manual Desktop selection can also remain active after the tour is closed because the mounted tour preserves its internal override.

The affected mobile fallbacks are Roles and Permissions for all relevant users, plus Billing for admins. The current optional `MOBILE_MOCKUPS` type and existing test expectations allow these omissions.

## Approved behavior

- A viewport below the existing 768px breakpoint always renders mobile tour artwork.
- Mobile users do not see a Desktop/Mobile selector and cannot retain or create a desktop override.
- Desktop users retain the Desktop/Mobile selector and can inspect either version.
- Every tour chapter has both desktop and mobile artwork. Roles, Permissions, and Billing receive genuine phone-oriented illustrations based on the application's mobile navigation and settings/billing layouts.
- Changing viewport size resolves the displayed device from the current viewport policy. A desktop-only override is ignored on mobile and becomes relevant again only when the viewport is desktop-width.
- Closing and reopening the tour cannot cause desktop artwork to appear on a mobile viewport.

## Architecture

Move device selection into a small pure helper in `src/lib/tour/device.ts`. It accepts the viewport class and optional desktop-view choice, and returns the effective mockup device. The helper makes the invariant explicit: mobile viewport always returns `mobile`; desktop viewport returns the user's selected view or defaults to `desktop`.

`GuidedTour` continues to observe the 768px media query. It uses the helper for rendering, shows the selector only on desktop viewports, and uses the resolved device consistently for the label, mockup lookup, hotspot placement, and stage sizing. Existing desktop scaling remains useful only for narrow embedded contexts but is no longer a mobile fallback path.

The content model no longer needs `hasMobile`. `MOBILE_MOCKUPS` becomes `Record<TourChapterId, string>` so TypeScript requires artwork for every chapter. This removes the possibility of silently falling back when a new chapter is introduced.

## Mobile illustrations

- **Roles:** Compare Admin and Staff using compact phone screens with the mobile bottom navigation. Highlight Billing availability and the different dashboard scope without showing a desktop sidebar.
- **Permissions:** Present the admin-only capabilities as a mobile Settings menu and Billing access summary inside a phone frame.
- **Billing:** Present the mobile Billing overview with collections, outstanding balance, payment-due entry points, and the mobile bottom navigation.

The new illustrations use the same static, developer-authored HTML model and existing Care-Book design tokens as the other tour mockups.

## Testing

- Unit-test the pure resolver: mobile always resolves to mobile, desktop defaults to desktop, and desktop honors both explicit choices.
- Update tour content tests to assert that every staff and admin chapter has a mobile mockup rather than asserting a limited mobile subset.
- Add source-level integration assertions that the mobile selector is desktop-only and that rendering no longer depends on `hasMobile` or an optional mobile mockup.
- Run the focused tour tests, the full unit suite, ESLint, and the production build.
- Manually verify the admin and staff tours at phone and desktop widths, including closing/reopening and crossing the 768px breakpoint.

## Non-goals

- Replacing the static mockup system with live application components.
- Changing role-specific chapter order or tutorial copy.
- Persisting a user's desktop mockup preference across full page reloads.
