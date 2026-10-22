import { Compass } from 'lucide-react';
export function Brand({ light = false }: { light?: boolean }) {
  return (
    <div className={`brand ${light ? 'brand-light' : ''}`}>
      <span className="brand-mark">
        <Compass size={25} strokeWidth={1.6} />
      </span>
      <div>
        <strong>
          FYP Compass<span className="brand-dot">.</span>
        </strong>
        <small>PROJECT SUPERVISION PORTAL</small>
      </div>
    </div>
  );
}
