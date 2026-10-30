// Tlačítko „Nainstalovat aplikaci“ s náhradními postupy pro iPhone a případ, kdy prohlížeč instalaci nenabízí

import { type ReactNode, useState } from 'react'
import { useInstall } from '../state/install.ts'
import { Card } from './ui.tsx'

const DISMISS_KEY = 'pocasi-karvina:install-dismissed'

function ShareIcon() {
  return (
    <svg viewBox="0 0 24 24" className="inline h-4 w-4 align-[-2px]" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-label="Sdílet">
      <path d="M12 3v12M8 7l4-4 4 4" />
      <path d="M5 11v8a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-8" />
    </svg>
  )
}

const Button = ({ onClick, children }: { onClick: () => void; children: ReactNode }) => (
  <button type="button" onClick={onClick} className="mt-3 flex w-full items-center justify-center gap-2 rounded-2xl bg-[var(--accent)] px-4 py-3 text-base font-semibold text-white shadow-lg active:scale-[0.98]">
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3v12M7 10l5 5 5-5M5 21h14" />
    </svg>
    {children}
  </button>
)

/**
 * @param compact  na hlavní obrazovce: lze skrýt, nezobrazuje se v nainstalované aplikaci
 */
export function InstallCard({ compact = false }: { compact?: boolean }) {
  const { state, platform, install } = useInstall()
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(DISMISS_KEY) === '1'
    } catch {
      return false
    }
  })
  const [result, setResult] = useState<string | null>(null)
  const [showHelp, setShowHelp] = useState(false)

  if (compact && (state === 'installed' || dismissed || state === 'waiting')) return null
  const dismiss = () => {
    setDismissed(true)
    try {
      localStorage.setItem(DISMISS_KEY, '1')
    } catch {
      /* úložiště nedostupné */
    }
  }
  const close = compact ? (
    <button type="button" onClick={dismiss} className="-mt-1 -mr-1 rounded-full p-1 text-muted" aria-label="Skrýt">
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <path d="M6 6l12 12M18 6L6 18" />
      </svg>
    </button>
  ) : undefined

  return (
    <Card title="Aplikace do telefonu" action={close}>
      {state === 'installed' && <p className="text-sm">✓ Aplikace je nainstalovaná a právě běží z plochy.</p>}
      {state === 'just-installed' && <p className="text-sm">✓ Hotovo! Aplikaci najdete na ploše telefonu jako „Počasí KA“.</p>}
      {state === 'waiting' && <p className="text-sm text-muted">Zjišťuji, jestli prohlížeč umožní instalaci…</p>}

      {state === 'can-prompt' && (
        <>
          <p className="text-sm">Nainstalujte si aplikaci na plochu – otevře se na celou obrazovku a funguje i bez internetu.</p>
          <Button
            onClick={async () => {
              const r = await install()
              setResult(r === 'dismissed' ? 'Instalace byla zrušena. Tlačítko se objeví znovu po obnovení stránky.' : null)
            }}
          >
            Nainstalovat aplikaci
          </Button>
          {result && <p className="mt-2 text-xs text-muted">{result}</p>}
        </>
      )}

      {state === 'ios-manual' && (
        <>
          <p className="text-sm">Na iPhonu instalaci nelze spustit tlačítkem – Apple to webovým aplikacím nedovoluje. Stačí dva kroky v Safari:</p>
          <ol className="mt-2 space-y-1.5 text-sm">
            <li>
              1. Klepněte dole na <b>Sdílet</b> <ShareIcon />
            </li>
            <li>
              2. Zvolte <b>Přidat na plochu</b> a potvrďte <b>Přidat</b>.
            </li>
          </ol>
          <p className="mt-2 text-xs text-faint">Funguje jen v Safari. V Chrome na iPhonu použijte menu ⋯ → Přidat na plochu.</p>
        </>
      )}

      {state === 'unavailable' && (
        <>
          <p className="text-sm">
            {platform === 'android'
              ? 'Prohlížeč teď instalaci nenabízí. Nejčastěji proto, že v telefonu zůstala dřívější instalace – smazáním ikony z plochy se aplikace neodinstaluje.'
              : 'Tento prohlížeč instalaci nenabízí. Použijte Chrome nebo Edge.'}
          </p>
          {platform === 'android' && (
            <>
              <button type="button" onClick={() => setShowHelp((v) => !v)} className="mt-2 text-sm font-medium text-[var(--accent)]">
                {showHelp ? 'Skrýt postup' : 'Jak to opravit'}
              </button>
              {showHelp && (
                <ol className="mt-2 space-y-1.5 text-sm">
                  <li>1. Otevřete <b>Nastavení telefonu → Aplikace</b> a najděte „Počasí KA“ (případně „Počasí Karviná“).</li>
                  <li>2. Pokud tam je, zvolte <b>Odinstalovat</b>. Pokud ji tam najdete, můžete ji také rovnou otevřít – je nainstalovaná.</li>
                  <li>3. Vraťte se sem v Chrome, stránku obnovte a objeví se tlačítko Nainstalovat.</li>
                  <li>
                    Nepomůže-li to: Chrome → menu ⋮ → <b>Přidat na plochu</b> / <b>Nainstalovat aplikaci</b>.
                  </li>
                </ol>
              )}
            </>
          )}
        </>
      )}
    </Card>
  )
}
