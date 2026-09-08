export function Icon({ kind }: { kind: 'weather' | 'warnings' | 'monitor' | 'training' }) {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {kind === 'weather' ? (
        <>
          <path d="M7 17a4 4 0 1 1 1-7.87A5 5 0 0 1 18 11a3 3 0 0 1 0 6Z" />
          <path d="m9 20-1 2m6-2-1 2" />
        </>
      ) : kind === 'warnings' ? (
        <>
          <path d="m12 3 10 18H2Z" />
          <path d="M12 9v5m0 3v.1" />
        </>
      ) : kind === 'monitor' ? (
        <>
          <rect x="2" y="3" width="20" height="14" rx="2" />
          <path d="M8 21h8m-4-4v4M5 11h3l2-4 4 7 2-3h3" />
        </>
      ) : (
        <>
          <circle cx="12" cy="12" r="8" />
          <circle cx="12" cy="12" r="4" />
          <circle cx="12" cy="12" r="0.6" fill="currentColor" stroke="none" />
        </>
      )}
    </svg>
  );
}
