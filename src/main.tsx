import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';
class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { message: string }> {
  state = { message: '' };
  static getDerivedStateFromError(error: Error) { return { message: error.message }; }
  render() { return this.state.message ? <div className="fatal-error"><h1>Could not display the viewer</h1><p>{this.state.message}</p><button onClick={() => location.reload()}>Reload</button></div> : this.props.children; }
}
createRoot(document.getElementById('root')!).render(<ErrorBoundary><App /></ErrorBoundary>);
