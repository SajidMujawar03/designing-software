import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Root } from './Root';
import { editor } from './editor/editor';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);

// Handy for debugging in the browser console.
(window as unknown as { editor: typeof editor }).editor = editor;
