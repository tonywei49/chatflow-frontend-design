import { getLocaleOnServer } from '@/i18n/server'

import './styles/globals.css'
import './styles/markdown.scss'

const LocaleLayout = ({
  children,
}: {
  children: React.ReactNode
}) => {
  const locale = getLocaleOnServer()
  return (
    <html lang={locale ?? 'en'} className="h-full">
      <body className="h-full">
        <div className="overflow-x-auto">
          <div
            className="w-screen min-w-[300px]"
            style={{ minHeight: '100dvh', height: '100dvh' }}
          >
            {children}
          </div>
        </div>
      </body>
    </html>
  )
}

export default LocaleLayout
