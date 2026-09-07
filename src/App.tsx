import { lazy, Suspense, useEffect } from 'react';
import { Routes, Route, useLocation } from 'react-router';
import Lenis from 'lenis';
import Layout from '@/components/Layout';
import { ShopProvider } from '@/lib/shop';
import Home from '@/pages/Home';
import Checkout from '@/pages/Checkout';
import Track from '@/pages/Track';
import PaymentResult from '@/pages/PaymentResult';

// Owner portal — lazy chunk so store visitors never download portal code.
const PortalAdmin = lazy(() => import('@/portal/Admin'));

function useIsPortal(): boolean {
  const { pathname } = useLocation();
  return pathname === '/manage' || pathname.startsWith('/manage/');
}

function LenisRoot() {
  const isPortal = useIsPortal();
  useEffect(() => {
    if (isPortal) return; // portal manages its own scrolling
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const lenis = new Lenis({ lerp: 0.09 });
    let raf = 0;
    const loop = (t: number) => { lenis.raf(t); raf = requestAnimationFrame(loop); };
    raf = requestAnimationFrame(loop);
    return () => { cancelAnimationFrame(raf); lenis.destroy(); };
  }, [isPortal]);
  return null;
}

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => { if (!location.hash) window.scrollTo(0, 0); }, [pathname]);
  return null;
}

function StoreRoutes() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/checkout" element={<Checkout />} />
        <Route path="/track" element={<Track />} />
        <Route path="/payment/result" element={<PaymentResult />} />
      </Routes>
    </Layout>
  );
}

function PortalFallback() {
  return (
    <div className="min-h-[100dvh] grid place-items-center bg-blush-50">
      <div className="w-8 h-8 rounded-full border-2 border-gold-400 border-t-transparent animate-spin" />
    </div>
  );
}

export default function App() {
  return (
    <ShopProvider>
      <LenisRoot />
      <ScrollToTop />
      <Routes>
        <Route
          path="/manage/*"
          element={
            <Suspense fallback={<PortalFallback />}>
              <PortalAdmin />
            </Suspense>
          }
        />
        <Route path="/*" element={<StoreRoutes />} />
      </Routes>
    </ShopProvider>
  );
}
