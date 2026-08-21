export function WorkbenchBrand({ compact = false, name = "工作台" }: { compact?: boolean; name?: string }) {
  return (
    <span className="workbenchBrand">
      <span className="workbenchBrandIcon" aria-hidden="true">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
          <rect x="3.5" y="4.5" width="17" height="12" rx="2.5" stroke="currentColor" strokeWidth="1.7" />
          <path d="M3.5 10.5h17" stroke="currentColor" strokeWidth="1.7" />
          <path d="M8 20.5h8M12 16.5v4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
        </svg>
      </span>
      {!compact && <span className="workbenchBrandText">{name}</span>}
    </span>
  );
}
