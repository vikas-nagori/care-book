import { redirect } from 'next/navigation'
import { getCurrentProfile } from '@/lib/auth'
import { getTutorialSteps } from '@/lib/tutorial/tutorial-steps'
import { TutorialView } from './tutorial-view'

export default async function TutorialPage() {
  const profile = await getCurrentProfile()
  if (!profile) redirect('/')

  const steps = getTutorialSteps(profile.role)
  return <TutorialView steps={steps} />
}
