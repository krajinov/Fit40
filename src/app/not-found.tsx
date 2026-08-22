import Link from 'next/link';

export default function NotFoundPage() {
  return (
    <main className="container mx-auto flex flex-1 flex-col items-center justify-center px-4 py-24 text-center">
      <h1 className="text-4xl font-bold tracking-tight text-foreground">404</h1>
      <p className="mt-2 text-lg text-muted-foreground">
        We could not find the page you were looking for.
      </p>
      <Link
        href="/exercises"
        className="mt-6 inline-flex items-center text-sm font-medium text-primary hover:underline"
      >
        Browse the exercise catalog
      </Link>
    </main>
  );
}