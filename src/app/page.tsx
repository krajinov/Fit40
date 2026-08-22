export function HomePage() {
  return (
    <div className="flex flex-1 items-center justify-center">
      <main className="flex flex-col items-center gap-6 px-6 py-32 text-center">
        <h1 className="text-5xl font-bold tracking-tight">Fit40</h1>
        <p className="max-w-md text-xl text-muted-foreground">
          Strength, mobility and fitness for life after 40.
        </p>
      </main>
    </div>
  );
}

export default HomePage;