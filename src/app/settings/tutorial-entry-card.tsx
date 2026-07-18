import Link from 'next/link'
import { ArrowRight, BookOpenCheck, Smartphone } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'

export function TutorialEntryCard() {
  return (
    <Card className="overflow-hidden">
      <CardContent className="p-4 sm:p-6">
        <div className="flex items-start gap-4">
          <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-[var(--ph-accent-soft)] text-[var(--ph-accent)]">
            <BookOpenCheck aria-hidden="true" size={22} />
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-semibold text-foreground">App tutorial</h2>
              <Badge variant="secondary" className="gap-1 font-medium">
                <Smartphone aria-hidden="true" size={12} />
                Mobile friendly
              </Badge>
            </div>
            <p className="mt-2 text-sm leading-5 text-muted-foreground">
              Learn the daily Care-Book workflow in about 2 minutes. Replay it any time.
            </p>

            <Button asChild className="mt-4 min-h-[44px] w-full sm:w-auto">
              <Link href="/settings/tutorial">
                Open tutorial
                <ArrowRight aria-hidden="true" />
              </Link>
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
