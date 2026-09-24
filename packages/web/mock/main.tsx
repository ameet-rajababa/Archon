/** Standalone entry for the Files-tab mock, built to a static page so the
 *  layouts can be clicked through without a dev server port. Throwaway. */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './mock.css';
import { FilesMock } from '../src/experiments/console/preview/FilesMock';

const el = document.getElementById('root');
if (el === null) throw new Error('no #root');
createRoot(el).render(
  <StrictMode>
    <div className="console-root min-h-screen bg-surface p-6 text-text-primary">
      <div className="mx-auto max-w-[1100px]">
        <h1 className="text-base font-medium text-text-primary">
          Files tab · three layouts to choose from
        </h1>
        <p className="mb-5 text-xs text-text-tertiary">
          Static mock. Nothing here calls the server.
        </p>
        <FilesMock />
      </div>
    </div>
  </StrictMode>
);
