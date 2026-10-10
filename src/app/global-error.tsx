'use client';

import { useEffect } from 'react';

/**
 * M19 S1 — root-level (global) error boundary.
 *
 * WHY A SEPARATE FILE: `global-error.tsx` is the ONLY boundary that catches
 * failures in the ROOT layout (`src/app/layout.tsx`). When it renders, the root
 * layout — including the `<html>`/`<body>` shell, the loaded fonts and the
 * Tailwind stylesheet — has already failed, so this component MUST supply its
 * own `<html>`/`<body>` and MUST NOT depend on application styles or design
 * tokens that live in that layout. It renders plain, inline-styled HTML only.
 *
 * This is the last-resort fallback. Segment boundaries (`(app)/error.tsx`,
 * `(auth)/error.tsx`) handle ordinary page failures and render the richer,
 * fully styled `ErrorState`; this file is intentionally self-contained.
 *
 * PRIVACY: the raw `error` is logged and never rendered.
 */
interface GlobalErrorProps {
  readonly error: Error & { digest?: string };
  readonly reset: () => void;
}

export default function GlobalError({ error, reset }: GlobalErrorProps) {
  useEffect(() => {
    console.error('Unhandled error in Fit40 root layout', error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '24px',
          fontFamily: 'system-ui, -apple-system, sans-serif',
          backgroundColor: '#ffffff',
          color: '#1a1a1a',
        }}
      >
        <main
          role="alert"
          style={{
            maxWidth: '28rem',
            width: '100%',
            textAlign: 'center',
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
          }}
        >
          <h1 style={{ fontSize: '1.125rem', fontWeight: 600, margin: 0 }}>
            Fit40 is having trouble loading.
          </h1>
          <p style={{ fontSize: '0.9375rem', lineHeight: 1.5, margin: 0 }}>
            This is a temporary problem, not something you did. You can try again.
          </p>
          <div>
            <button
              type="button"
              onClick={reset}
              style={{
                minHeight: '44px',
                padding: '0 28px',
                fontSize: '1rem',
                fontWeight: 600,
                borderRadius: '0.75rem',
                border: 'none',
                cursor: 'pointer',
                backgroundColor: '#1f3d2b',
                color: '#ffffff',
              }}
            >
              Try again
            </button>
          </div>
        </main>
      </body>
    </html>
  );
}
