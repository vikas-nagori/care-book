import { Badge } from '@/components/ui/badge'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { getAccountSummaryItems } from '@/lib/settings/account-summary'
import type { Profile } from '@/lib/supabase/types'
import { ChangePasswordForm } from './change-password-form'
import { LogoutButton } from './logout-button'

type AccountSummaryProps = {
  profile: Profile
  variant?: 'card' | 'sheet'
}

export function AccountSummary({ profile, variant = 'card' }: AccountSummaryProps) {
  const summaryItems = getAccountSummaryItems(profile)
  const displayItems = variant === 'sheet'
    ? [summaryItems[0], summaryItems[3], summaryItems[1], summaryItems[2]]
    : summaryItems

  const summary = (
    <dl className={variant === 'sheet' ? 'grid grid-cols-2 gap-3' : 'grid gap-4 sm:grid-cols-2'}>
      {displayItems.map((item) => (
        <div
          key={item.label}
          className={variant === 'sheet'
            ? 'min-w-0 space-y-1 rounded-lg border p-3'
            : 'space-y-1 rounded-lg border p-3'}
        >
          <dt className="text-sm text-muted-foreground">{item.label}</dt>
          <dd className={variant === 'sheet' ? 'break-words text-sm font-medium' : 'text-sm font-medium'}>
            {item.label === 'Role' ? (
              <Badge variant={profile.role === 'admin' ? 'default' : 'secondary'}>
                {item.value}
              </Badge>
            ) : (
              item.value
            )}
          </dd>
        </div>
      ))}
    </dl>
  )

  const changePasswordSection = (
    <section className="space-y-3 rounded-lg border p-3.5">
      <div>
        <h3 className="text-sm font-semibold">Change Password</h3>
        <p className="text-xs text-muted-foreground">
          Confirm your current password, then choose a new one. No email needed.
        </p>
      </div>
      <ChangePasswordForm />
    </section>
  )

  if (variant === 'sheet') {
    return (
      <div className="space-y-5">
        {summary}
        {changePasswordSection}
        <LogoutButton className="h-11 w-full" />
      </div>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Your Account</CardTitle>
        <CardDescription>Your profile details are visible here for reference only.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {summary}
        {changePasswordSection}
      </CardContent>
      <CardFooter className="justify-end">
        <LogoutButton />
      </CardFooter>
    </Card>
  )
}
