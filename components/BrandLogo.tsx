import Image from 'next/image';

const TAMCO_LOGO_SRC = '/brand/tamco-logo-white.png';

export function TamcoLogo({
  className = '',
  imageClassName = '',
  priority = false,
}: {
  className?: string;
  imageClassName?: string;
  priority?: boolean;
}) {
  return (
    <span
      className={`inline-flex items-center justify-center overflow-hidden rounded-xl bg-slate-950 px-3 py-2 shadow-sm ${className}`}
    >
      <Image
        src={TAMCO_LOGO_SRC}
        alt="TAMCO"
        width={260}
        height={77}
        priority={priority}
        className={`h-auto w-full object-contain ${imageClassName}`}
      />
    </span>
  );
}

export function TamcoBrandLockup({
  title = 'First Aid Box Inspection',
  subtitle = 'TAMCO EHS readiness system',
  className = '',
  priority = false,
  titleAs = 'h1',
}: {
  title?: string;
  subtitle?: string;
  className?: string;
  priority?: boolean;
  titleAs?: 'h1' | 'p';
}) {
  const Title = titleAs;

  return (
    <div className={`text-center ${className}`}>
      <TamcoLogo priority={priority} className="mx-auto mb-4 h-16 w-44 bg-brand px-4 py-3" />
      <p className="text-xs font-bold uppercase text-brand-dark">TAMCO EHS</p>
      <Title className="text-2xl font-bold leading-tight text-slate-950">{title}</Title>
      {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
    </div>
  );
}
