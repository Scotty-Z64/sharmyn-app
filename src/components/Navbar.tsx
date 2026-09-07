import { useEffect, useState } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { AnimatePresence, motion } from 'framer-motion';
import { Facebook, Instagram, Menu, Search, ShoppingBag, X } from 'lucide-react';
import { useShop } from '@/lib/shop';

export const MENU_LINKS = [
  { label: 'Sneakers', to: '/#sneakers' },
  { label: 'Custom Jewellery', to: '/#jewellery' },
  { label: 'Handbags', to: '/#handbags' },
  { label: 'Clothing', to: '/#clothing' },
  { label: 'Track Order', to: '/track' },
  { label: 'Contact', to: '/#contact' },
];

export function Logo({ size = 34 }: { size?: number }) {
  return (
    <span className="flex items-center gap-2 leading-none">
      <img src="/sharmyn-mark.png" alt="Sharmyn logo" style={{ width: size, height: size }} className="rounded-full" />
      <span className="font-display text-lg font-semibold tracking-[0.18em] text-ink-900">Sharmyn</span>
    </span>
  );
}

export default function Navbar() {
  const { cart, setCartOpen, setSearchOpen, menuOpen, setMenuOpen } = useShop();
  const [scrolled, setScrolled] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const count = cart.reduce((s, c) => s + c.qty, 0);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 10);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => { setMenuOpen(false); }, [location.pathname, location.hash, setMenuOpen]);

  const go = (to: string) => (e: ReactMouseEvent) => {
    if (to.startsWith('/#')) {
      const id = to.slice(2);
      e.preventDefault();
      setMenuOpen(false);
      if (location.pathname !== '/') {
        navigate('/');
        setTimeout(() => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' }), 150);
      } else {
        document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
      }
    } else {
      setMenuOpen(false);
    }
  };

  return (
    <>
      <header className={`sticky top-0 z-50 bg-white transition-shadow duration-300 ${scrolled ? 'border-b border-gold-400/40 shadow-[0_2px_12px_rgba(43,29,35,0.05)]' : 'border-b border-transparent'}`}>
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-1">
            <button onClick={() => setMenuOpen(true)} aria-label="Menu"
              className="lg:hidden w-11 h-11 grid place-items-center text-ink-900">
              <Menu size={22} />
            </button>
            <Link to="/" aria-label="Sharmyn home" className="shrink-0">
              <Logo />
            </Link>
          </div>

          <nav className="hidden lg:flex items-center gap-6">
            {MENU_LINKS.map((l) => (
              <Link key={l.label} to={l.to} onClick={go(l.to)}
                className="text-[12px] font-medium uppercase tracking-[0.14em] text-ink-500 hover:text-gold-500 transition-colors">
                {l.label}
              </Link>
            ))}
          </nav>

          <div className="flex items-center gap-1">
            <button onClick={() => setSearchOpen(true)} aria-label="Search"
              className="w-11 h-11 grid place-items-center text-ink-900 hover:text-gold-500 transition-colors">
              <Search size={20} />
            </button>
            <button onClick={() => setCartOpen(true)} aria-label="Open bag"
              className="relative w-11 h-11 grid place-items-center text-ink-900 hover:text-gold-500 transition-colors">
              <ShoppingBag size={20} />
              <AnimatePresence>
                {count > 0 && (
                  <motion.span key={count} initial={{ scale: 0.4 }} animate={{ scale: 1 }} exit={{ scale: 0 }}
                    className="absolute top-1 right-0 min-w-[18px] h-[18px] px-1 rounded-full bg-rose-500 text-white text-[10px] font-semibold grid place-items-center">
                    {count}
                  </motion.span>
                )}
              </AnimatePresence>
            </button>
          </div>
        </div>
      </header>

      <AnimatePresence>
        {menuOpen && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setMenuOpen(false)}
              className="fixed inset-0 z-[60] bg-ink-900/30" />
            <motion.aside
              initial={{ x: '-100%' }} animate={{ x: 0 }} exit={{ x: '-100%' }}
              transition={{ type: 'spring', damping: 30, stiffness: 300 }}
              className="fixed top-0 left-0 bottom-0 z-[61] w-[280px] max-w-[85vw] bg-white flex flex-col border-r border-gold-400/30">
              <div className="h-16 px-4 flex items-center justify-between border-b border-gold-400/20">
                <Logo size={30} />
                <button onClick={() => setMenuOpen(false)} aria-label="Close menu"
                  className="w-11 h-11 grid place-items-center text-ink-900">
                  <X size={22} />
                </button>
              </div>
              <nav className="flex-1 overflow-y-auto py-4">
                {MENU_LINKS.map((l, i) => (
                  <motion.div key={l.label} initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.04 * i, duration: 0.3 }}>
                    <Link to={l.to} onClick={go(l.to)}
                      className="flex items-center h-12 px-6 text-sm font-medium uppercase tracking-[0.12em] text-ink-900 hover:text-gold-500 hover:bg-[#FDF3E7]/60 transition-colors">
                      {l.label}
                    </Link>
                  </motion.div>
                ))}
              </nav>
              <div className="border-t border-gold-400/20 px-6 py-5 flex items-center gap-4">
                <a href="https://facebook.com" target="_blank" rel="noreferrer" aria-label="Facebook"
                  className="w-11 h-11 grid place-items-center rounded-full border border-gold-400/40 text-gold-500 hover:bg-gold-400 hover:text-white transition-colors">
                  <Facebook size={18} />
                </a>
                <a href="https://instagram.com" target="_blank" rel="noreferrer" aria-label="Instagram"
                  className="w-11 h-11 grid place-items-center rounded-full border border-gold-400/40 text-gold-500 hover:bg-gold-400 hover:text-white transition-colors">
                  <Instagram size={18} />
                </a>
              </div>
            </motion.aside>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
