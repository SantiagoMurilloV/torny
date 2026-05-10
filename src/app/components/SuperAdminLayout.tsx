import { Link, Outlet, useLocation, useNavigate } from 'react-router';
import {
  LayoutDashboard,
  Users,
  Shield,
  LogOut,
  Menu,
  X,
} from 'lucide-react';
import { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useAuth } from '../context/AuthContext';

/**
 * Sidebar layout for the super-admin console, mirroring AdminLayout so
 * the look feels consistent across the two privileged panels. Two
 * sections today — Dashboard + Usuarios — plus a logout pinned at the
 * bottom. Adding billing / audit log later just means extending
 * `navItems`.
 */
export function SuperAdminLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const { logout, user } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const navItems = [
    { icon: LayoutDashboard, label: 'Dashboard', path: '/super-admin' },
    { icon: Users, label: 'Usuarios', path: '/super-admin/users' },
  ];

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <div className="min-h-screen bg-white">
      {/* Mobile Header */}
      <div className="md:hidden fixed top-0 left-0 right-0 bg-black border-b border-white/10 z-50">
        <div className="flex items-center justify-between p-4">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="p-2 hover:bg-white/10 rounded-sm transition-colors text-white"
              aria-label={sidebarOpen ? 'Cerrar menú' : 'Abrir menú'}
            >
              {sidebarOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
            </button>
            <div className="w-10 h-10 bg-spk-red rounded-sm flex items-center justify-center">
              <Shield className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="font-bold text-white text-lg" style={{ fontFamily: 'Barlow Condensed, sans-serif' }}>
                Torn<span className="text-spk-red">y</span> · SUPER
              </h1>
              <p className="text-xs text-white/60">Plataforma</p>
            </div>
          </div>
        </div>
      </div>

      {/* Sidebar */}
      <aside
        className={`
          fixed top-0 left-0 h-full bg-black border-r-2 border-spk-red/80 z-40
          transition-transform duration-300 ease-in-out
          ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
          md:translate-x-0 w-72
        `}
      >
        {/* Logo */}
        <div className="hidden md:flex items-center gap-3 p-6 border-b border-white/10">
          <div className="w-12 h-12 bg-spk-red rounded-sm flex items-center justify-center">
            <Shield className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1
              className="text-2xl font-bold text-white tracking-tighter"
              style={{ fontFamily: 'Barlow Condensed, sans-serif' }}
            >
              Torn<span className="text-spk-red">y</span>
            </h1>
            <div className="w-16 h-0.5 bg-spk-red mt-1" />
            <p className="text-xs text-white/60 mt-1 uppercase tracking-wider">
              Super Admin
            </p>
          </div>
        </div>

        {/* Navigation */}
        <nav className="p-4 space-y-2 mt-16 md:mt-0">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive =
              item.path === '/super-admin'
                ? location.pathname === '/super-admin'
                : location.pathname.startsWith(item.path);
            return (
              <Link
                key={item.path}
                to={item.path}
                onClick={() => setSidebarOpen(false)}
              >
                <motion.div
                  whileHover={{
                    x: 4,
                    backgroundColor: isActive ? 'rgb(255, 255, 255)' : 'rgba(255, 255, 255, 0.1)',
                  }}
                  whileTap={{ scale: 0.98 }}
                  className={`
                    flex items-center gap-3 px-4 py-3 rounded-sm transition-all relative overflow-hidden
                    ${isActive ? 'text-black' : 'text-white/70 hover:text-white'}
                  `}
                  style={{ backgroundColor: isActive ? 'rgb(255, 255, 255)' : 'transparent' }}
                >
                  {isActive && (
                    <motion.div
                      layoutId="activeSuperNav"
                      className="absolute left-0 top-0 bottom-0 w-1 bg-spk-red"
                      transition={{ type: 'spring', stiffness: 300, damping: 30 }}
                    />
                  )}
                  <Icon className="w-5 h-5" />
                  <span
                    className="font-bold uppercase tracking-wider text-sm"
                    style={{ fontFamily: 'Barlow Condensed, sans-serif' }}
                  >
                    {item.label}
                  </span>
                </motion.div>
              </Link>
            );
          })}
        </nav>

        {/* User & Logout */}
        <div className="absolute bottom-0 left-0 right-0 p-4 border-t border-white/10 bg-black">
          <div className="flex items-center gap-3 mb-4 px-2">
            <div className="w-10 h-10 bg-spk-red rounded-sm flex items-center justify-center">
              <span
                className="text-white font-bold text-lg"
                style={{ fontFamily: 'Barlow Condensed, sans-serif' }}
              >
                {(user?.username ?? 'S').charAt(0).toUpperCase()}
              </span>
            </div>
            <div className="flex-1 min-w-0">
              <div
                className="font-bold text-white truncate"
                style={{ fontFamily: 'Barlow Condensed, sans-serif' }}
              >
                {user?.username ?? 'Super Admin'}
              </div>
              <div className="text-xs text-white/60 truncate">Super administrador</div>
            </div>
          </div>
          <motion.button
            onClick={handleLogout}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-spk-red text-white hover:bg-spk-red/90 rounded-sm transition-colors"
          >
            <LogOut className="w-4 h-4" />
            <span
              className="font-bold uppercase tracking-wider text-sm"
              style={{ fontFamily: 'Barlow Condensed, sans-serif' }}
            >
              Cerrar Sesión
            </span>
          </motion.button>
        </div>
      </aside>

      {/* Overlay for mobile */}
      <AnimatePresence>
        {sidebarOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="md:hidden fixed inset-0 z-30"
            style={{ backgroundColor: 'rgba(0, 0, 0, 0.8)' }}
            onClick={() => setSidebarOpen(false)}
          />
        )}
      </AnimatePresence>

      {/* Main Content */}
      <main className="md:ml-72 pt-16 md:pt-0 min-h-screen bg-white">
        <Outlet />
      </main>
    </div>
  );
}
