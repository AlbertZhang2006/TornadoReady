export function TornadoIcon({ className, size = 20 }: { className?: string; size?: number }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 32 32" fill="none">
      <path d="M5 3h22L23 11H9Z" fill="currentColor" />
      <path d="M10 13h12L20 20H12Z" fill="currentColor" />
      <path d="M13 22h6L17.5 29h-3Z" fill="currentColor" />
    </svg>
  );
}
