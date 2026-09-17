import { ArrowLeft } from 'lucide-react';
import { useNavigate } from 'react-router';

/**
 * Standalone PWA installs have no browser chrome — no back button, no
 * address bar — so every non-home page needs its own way back.
 */
export default function BackButton({ fallback = '/', label = 'Back' }: { fallback?: string; label?: string }) {
  const navigate = useNavigate();
  const go = () => {
    if (window.history.length > 1) navigate(-1);
    else navigate(fallback);
  };
  return (
    <button type="button" onClick={go}
      className="inline-flex items-center gap-1.5 h-10 px-1 text-[13px] font-medium text-ink-500 hover:text-gold-500 transition-colors">
      <ArrowLeft size={16} /> {label}
    </button>
  );
}
