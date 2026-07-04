import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
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

type AccountSummaryProps = {
  profile: Profile
  logoutAction: () => Promise<void>
}

export function AccountSummary({ profile, logoutAction }: AccountSummaryProps) {
  const summaryItems = getAccountSummaryItems(profile)

  return (
    <Card>
      <CardHeader>
        <CardTitle>Your Account</CardTitle>
        <CardDescription>Your profile details are visible here for reference only.</CardDescription>
      </CardHeader>
      <CardContent>
        <dl className="grid gap-4 sm:grid-cols-2">
          {summaryItems.map((item) => (
            <div key={item.label} className="space-y-1 rounded-lg border p-3">
              <dt className="text-sm text-muted-foreground">{item.label}</dt>
              <dd className="text-sm font-medium">
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
      </CardContent>
      <CardFooter className="justify-end">
        <form action={logoutAction}>
          <Button type="submit" variant="outline">
            Logout
          </Button>
        </form>
      </CardFooter>
    </Card>
  )
}
