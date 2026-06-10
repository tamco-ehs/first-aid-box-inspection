export function CompanyLogo({ className = 'h-8 w-auto' }: { className?: string }) {
  return (
    <img
      src="/brand/tamco-logo.png"
      alt="TAMCO"
      className={className}
      width={1024}
      height={305}
      decoding="async"
    />
  );
}
