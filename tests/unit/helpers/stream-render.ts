/**
 * M19 S2 review fix helper: the private pages now return
 * `<Suspense><AsyncContent/></Suspense>` so slow reads stream behind the
 * placeholder while auth/validation stay pre-stream. React's sync
 * renderToString renders the FALLBACK for a Suspense child (it cannot await
 * async components), so content assertions must unwrap one Suspense level by
 * awaiting the async child manually and rendering the resolved tree.
 *
 * Casts are unavoidable here: React element typing does not model
 * "a function component we control and may await", and the cast is confined to
 * this single test-only seam.
 */
import { Suspense, isValidElement } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

export async function renderStream(element: ReactNode): Promise<string> {
  if (isValidElement(element) && element.type === Suspense) {
    const suspense = element as ReactElement<{ children: ReactElement }>;
    const child = suspense.props.children;
    const Component = child.type as (props: unknown) => Promise<ReactNode>;
    const resolved = await Component(child.props);
    return renderStream(resolved);
  }

  return renderToStaticMarkup(element);
}
