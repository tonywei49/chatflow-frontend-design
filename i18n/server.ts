import 'server-only'

import { cookies, headers } from 'next/headers'
import Negotiator from 'negotiator'
import { match } from '@formatjs/intl-localematcher'
import type { Locale } from '.'
import { i18n } from '.'

const normalizeLocaleList = (values: string[]) => {
  return values.filter((value) => {
    if (!value || value === '*')
      return false

    try {
      Intl.getCanonicalLocales(value)
      return true
    }
    catch {
      return false
    }
  })
}

export const getLocaleOnServer = (): Locale => {
  // @ts-expect-error locales are readonly
  const locales: string[] = normalizeLocaleList([...i18n.locales])

  let languages: string[] | undefined
  // get locale from cookie
  const localeCookie = cookies().get('locale')
  languages = localeCookie?.value ? [localeCookie.value] : []

  if (!languages.length) {
    // Negotiator expects plain object so we need to transform headers
    const negotiatorHeaders: Record<string, string> = {}
    headers().forEach((value, key) => (negotiatorHeaders[key] = value))
    // Use negotiator and intl-localematcher to get best locale
    languages = new Negotiator({ headers: negotiatorHeaders }).languages()
  }

  const normalizedLanguages = normalizeLocaleList(languages)
  if (!normalizedLanguages.length)
    return i18n.defaultLocale

  // match locale
  const matchedLocale = match(normalizedLanguages, locales, i18n.defaultLocale) as Locale
  return matchedLocale
}
