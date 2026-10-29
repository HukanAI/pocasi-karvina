// Zachycení chyb vykreslení: místo prázdné obrazovky nabídne obnovení
// (typicky po nasazení nové verze, kdy stará záložka nenajde část aplikace)

import { Component, type ReactNode } from 'react'

interface State {
  error: Error | null
}

// Při změně záložky se boundary vytváří znovu (key = cesta), takže chyba nezůstane viset
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children
    const chunk = /dynamically imported module|Importing a module script failed|Loading chunk/i.test(error.message)
    return (
      <section className="glass rounded-3xl p-4">
        <h2 className="font-semibold">{chunk ? 'Je k dispozici nová verze aplikace' : 'Něco se pokazilo'}</h2>
        <p className="mt-1 text-sm text-muted">
          {chunk ? 'Část aplikace se nepodařilo načíst, nejspíš kvůli aktualizaci. Načtěte ji prosím znovu.' : 'Tuto část se nepodařilo zobrazit.'}
        </p>
        <p className="mt-1 text-xs break-words text-faint">{error.message}</p>
        <button type="button" onClick={() => location.reload()} className="mt-3 rounded-full bg-[var(--accent)] px-4 py-1.5 text-sm font-medium text-white">
          Načíst znovu
        </button>
      </section>
    )
  }
}
