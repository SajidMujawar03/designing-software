import { Component, type ErrorInfo, type ReactNode } from 'react';
import { errorDetails, reportError, type ErrorReport } from '../errors';

interface Props {
  /** Shown in reports: which part of the app crashed. */
  name: string;
  children: ReactNode;
  /** 'page' replaces the whole app; 'panel' replaces just this part. */
  variant?: 'page' | 'panel';
  /** When this changes, a crashed panel tries again (e.g. the selection). */
  resetKey?: unknown;
}

interface State {
  report: ErrorReport | null;
  copied: boolean;
  resetKey?: unknown;
}

/**
 * Catches a crash while rendering, reports it, and shows a way out instead of
 * a blank page. Edits are saved as they happen (in this browser and on the
 * server), so reloading loses nothing that was already on the canvas.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { report: null, copied: false, resetKey: this.props.resetKey };

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    if (props.resetKey !== state.resetKey) return { resetKey: props.resetKey, report: null, copied: false };
    return null;
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    const report = reportError(error, `boundary:${this.props.name}`, { componentStack: info.componentStack?.slice(0, 4000) });
    this.setState({ report });
  }

  static getDerivedStateFromError(): Partial<State> {
    // Filled in by componentDidCatch; a placeholder keeps the children from re-rendering.
    return { report: { id: '', message: '', type: '', source: '', path: '', release: '', time: '', breadcrumbs: [] } };
  }

  private copy = async () => {
    try {
      await navigator.clipboard.writeText(errorDetails(this.state.report ?? undefined));
      this.setState({ copied: true });
    } catch {
      // clipboard blocked: the details are still in the console
    }
  };

  render(): ReactNode {
    const { report, copied } = this.state;
    if (!report) return this.props.children;
    if (this.props.variant === 'panel') {
      return (
        <div className="crash-panel" role="alert">
          <b>This panel ran into a problem.</b>
          <span>The rest of the editor still works, and your file is safe.</span>
          <div className="component-actions">
            <button className="btn" onClick={() => this.setState({ report: null, copied: false })}>
              Try again
            </button>
            <button className="btn" onClick={this.copy}>
              {copied ? 'Copied' : 'Copy details'}
            </button>
          </div>
        </div>
      );
    }
    return (
      <div className="crash-page" role="alert">
        <div className="crash-card">
          <h1>Something went wrong</h1>
          <p>The app hit an error it couldn't recover from. Your edits are saved as you make them, so reloading won't lose your work.</p>
          {report.message && <code className="crash-message">{report.message}</code>}
          <div className="component-actions">
            <button className="btn primary" onClick={() => location.reload()}>
              Reload
            </button>
            <button className="btn" onClick={this.copy}>
              {copied ? 'Copied' : 'Copy error details'}
            </button>
            <a className="btn" href="/">
              Back to your files
            </a>
          </div>
          {report.id && <p className="hint">Error id {report.id.slice(0, 12)}</p>}
        </div>
      </div>
    );
  }
}
