export function Logo({ className }: { className?: string }) {
  return (
    <picture>
      <source media="(prefers-color-scheme: dark)" srcSet="/logo-dark-bg.png" />
      <img src="/logo-light-bg.png" alt="Market77" className={className} />
    </picture>
  );
}
