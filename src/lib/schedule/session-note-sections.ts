import type { SessionNote } from '../supabase/types'

const SESSION_NOTE_SECTIONS = [
  ['subjective', 'Subjective'],
  ['objective', 'Objective'],
  ['assessment', 'Assessment'],
  ['plan', 'Plan'],
  ['exercises_prescribed', 'Exercises Prescribed'],
] as const

export type SessionNoteSection = { label: string; text: string }

type SessionNoteFields = Pick<SessionNote, typeof SESSION_NOTE_SECTIONS[number][0]>

/**
 * The SOAP sections of a note that have text, in display order. The appointment page draws the
 * Session Notes card only when this is non-empty and puts a divider between sections, never above
 * the first one (G-17g).
 */
export function sessionNoteSections(note: SessionNoteFields | null | undefined): SessionNoteSection[] {
  if (!note) return []
  return SESSION_NOTE_SECTIONS.flatMap(([field, label]) => {
    const text = note[field]
    return text?.trim() ? [{ label, text }] : []
  })
}
