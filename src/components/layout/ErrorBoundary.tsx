/**
 * ErrorBoundary — Catches React rendering errors and shows fallback UI.
 */

import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Button } from '../ui/button'
import { AlertTriangle, RefreshCw } from 'lucide-react'

interface Props {
  children: ReactNode
  fallback?: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary] Caught error:', error, info)
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null })
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback

      return (
        <div className="flex-1 flex items-center justify-center p-8">
          <div className="text-center space-y-4 max-w-md">
            <AlertTriangle size={48} className="mx-auto text-amber-500" />
            <h2 className="text-lg font-semibold">出了点问题</h2>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              {this.state.error?.message || '渲染时发生了未知错误'}
            </p>
            <pre className="text-xs text-left bg-zinc-100 dark:bg-zinc-900 rounded-lg p-3 overflow-x-auto max-h-32 overflow-y-auto">
              {this.state.error?.stack?.slice(0, 500) || 'No stack trace'}
            </pre>
            <Button onClick={this.handleReset} variant="outline">
              <RefreshCw size={14} />
              重试
            </Button>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}
