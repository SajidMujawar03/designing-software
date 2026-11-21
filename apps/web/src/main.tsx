import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Root } from './Root';
import { editor } from './editor/editor';
import './styles.css';
import { applyTheme } from './theme';
import { installErrorReporting } from './errors';
import { ErrorBoundary } from './panels/ErrorBoundary';

installErrorReporting();

// Before the first paint, so the page doesn't flash the wrong colors.
applyTheme();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary name="app">
      <Root />
    </ErrorBoundary>
  </StrictMode>,
);

// Handy for debugging in the browser console.
(window as unknown as { editor: typeof editor }).editor = editor;
