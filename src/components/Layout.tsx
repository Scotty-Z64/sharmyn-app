import type { ReactNode } from 'react';
import Navbar from './Navbar';
import Footer from './Footer';
import CartDrawer from './CartDrawer';
import Toasts from './Toast';
import WhatsAppFloat from './WhatsAppFloat';
import SizeGuideModal from './SizeGuideModal';
import InstallPrompt from './InstallPrompt';

/** Children-pattern layout (Layout wraps <Routes/> in App.tsx). */
export default function Layout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-[100dvh] flex flex-col bg-sand text-ink-900">
      <InstallPrompt storageKey="sharmyn-install-dismissed-store" appName="Sharmyn" />
      <Navbar />
      <main className="flex-1">{children}</main>
      <Footer />
      <CartDrawer />
      <SizeGuideModal />
      <Toasts />
      <WhatsAppFloat />
    </div>
  );
}
