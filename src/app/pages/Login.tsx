import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router';
import { Trophy, Lock, User, ArrowRight, Eye, EyeOff, Zap, WifiOff, Bell, MessageCircle, Smartphone, Shield } from 'lucide-react';
import { motion } from 'motion/react';
import { useAuth } from '../context/AuthContext';
import { ApiError } from '../services/api';
import { homeForRole } from '../lib/roles';

export function Login() {
  const navigate = useNavigate();
  const { login, isAuthenticated, sessionMessage, user } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  // Show session expiry message if present
  useEffect(() => {
    if (sessionMessage) {
      setError(sessionMessage);
    }
  }, [sessionMessage]);

  // Redirect if already authenticated
  useEffect(() => {
    if (isAuthenticated) {
      navigate(homeForRole(user?.role), { replace: true });
    }
  }, [isAuthenticated, user?.role, navigate]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    try {
      const session = await login(username, password);
      navigate(homeForRole(session.user.role));
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError('Error de conexión. Intenta de nuevo.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-black text-white flex">
      {/* Left Side - Login Form */}
      <div className="w-full lg:w-1/2 flex items-center justify-center p-4 sm:p-6 md:p-12">
        <div className="w-full max-w-md">
          {/* Logo */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-8 sm:mb-12"
          >
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-sm bg-white flex items-center justify-center">
                <Trophy className="w-5 h-5 sm:w-6 sm:h-6 text-black" />
              </div>
              <h1
                className="text-2xl sm:text-3xl font-bold tracking-tighter"
                style={{ fontFamily: 'Barlow Condensed, sans-serif' }}
              >
                Torny
              </h1>
            </div>
            <div className="w-20 h-1 bg-spk-red" />
          </motion.div>

          {/* Title */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="mb-8 sm:mb-10"
          >
            <h2
              className="text-4xl sm:text-5xl md:text-6xl font-bold mb-4 tracking-tighter break-words"
              style={{ fontFamily: 'Barlow Condensed, sans-serif' }}
            >
              PANEL DE
              <br />
              ADMINISTRACIÓN
            </h2>
            <p className="text-white/60 text-base sm:text-lg">
              Ingresa tus credenciales para continuar
            </p>
          </motion.div>

          {/* Login Form */}
          <motion.form
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            onSubmit={handleLogin}
            className="space-y-6"
          >
            {/* Username */}
            <div>
              <label
                htmlFor="username"
                className="block text-xs font-bold uppercase mb-3 text-white/80"
                style={{ fontFamily: 'Barlow Condensed, sans-serif', letterSpacing: '0.12em' }}
              >
                USUARIO
              </label>
              <div className="relative">
                <User className="absolute left-5 top-1/2 -translate-y-1/2 w-5 h-5 text-white/40" />
                <input
                  id="username"
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="Ingresa tu usuario"
                  className="w-full pl-12 sm:pl-14 pr-4 sm:pr-5 py-3.5 sm:py-4 bg-white/10 border-2 border-white/20 text-white placeholder:text-white/40 rounded-sm focus:outline-none focus:border-white transition-colors text-base sm:text-lg"
                  required
                />
              </div>
            </div>

            {/* Password */}
            <div>
              <label
                htmlFor="password"
                className="block text-xs font-bold uppercase mb-3 text-white/80"
                style={{ fontFamily: 'Barlow Condensed, sans-serif', letterSpacing: '0.12em' }}
              >
                CONTRASEÑA
              </label>
              <div className="relative">
                <Lock className="absolute left-5 top-1/2 -translate-y-1/2 w-5 h-5 text-white/40" />
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Ingresa tu contraseña"
                  className="w-full pl-12 sm:pl-14 pr-12 sm:pr-14 py-3.5 sm:py-4 bg-white/10 border-2 border-white/20 text-white placeholder:text-white/40 rounded-sm focus:outline-none focus:border-white transition-colors text-base sm:text-lg"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                  aria-pressed={showPassword}
                  tabIndex={-1}
                  className="absolute right-3 sm:right-4 top-1/2 -translate-y-1/2 p-2 rounded-sm text-white/50 hover:text-white hover:bg-white/10 transition-colors focus:outline-none focus:ring-2 focus:ring-white/40"
                >
                  {showPassword ? (
                    <EyeOff className="w-5 h-5" />
                  ) : (
                    <Eye className="w-5 h-5" />
                  )}
                </button>
              </div>
            </div>

            {/* Error Message */}
            {error && (
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                className="p-4 bg-spk-red/20 border-2 border-spk-red rounded-sm"
              >
                <p className="text-sm font-medium text-white">{error}</p>
              </motion.div>
            )}

            {/* Submit Button */}
            <motion.button
              type="submit"
              disabled={isLoading}
              whileHover={{ scale: isLoading ? 1 : 1.02 }}
              whileTap={{ scale: isLoading ? 1 : 0.98 }}
              className="w-full flex items-center justify-center gap-3 px-6 py-3.5 sm:py-4 bg-white text-black rounded-sm font-bold text-base sm:text-lg hover:bg-white/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              style={{ fontFamily: 'Barlow Condensed, sans-serif' }}
            >
              {isLoading ? (
                <>
                  <motion.div
                    className="w-5 h-5 border-2 border-black/20 border-t-black rounded-full"
                    animate={{ rotate: 360 }}
                    transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                  />
                  INGRESANDO...
                </>
              ) : (
                <>
                  INGRESAR
                  <ArrowRight className="w-5 h-5" />
                </>
              )}
            </motion.button>

            {/* Back to Home */}
            <motion.button
              type="button"
              onClick={() => navigate('/')}
              whileHover={{ x: -5 }}
              className="w-full text-center text-white/60 hover:text-white transition-colors text-sm mt-6"
            >
              ← Volver al inicio
            </motion.button>
          </motion.form>

          {/* Demo Credentials Info */}
        </div>
      </div>

      {/* Right Side — composición visual on-brand (sin foto stock).
          Background gradient navy oscuro + radial hotspot azul claro
          + pelota geométrica decorativa gigante. Coherente con los SVGs
          de la marca (mismo gradient #0B1746→#00072E + #7BA8FF hotspot).
          Sobre eso, dos cards: brand block + soporte/info útil. */}
      <div
        className="hidden lg:block lg:w-1/2 relative overflow-hidden"
        style={{
          background:
            'radial-gradient(circle at 22% 18%, rgba(123,168,255,0.22) 0%, transparent 55%), linear-gradient(135deg, #0B1746 0%, #00072E 100%)',
        }}
      >
        {/* Capa glass overlay */}
        <div
          aria-hidden="true"
          className="absolute inset-0 pointer-events-none"
          style={{
            background:
              'linear-gradient(180deg, rgba(255,255,255,0.10) 0%, rgba(255,255,255,0.02) 45%, transparent 100%)',
          }}
        />

        {/* Banda diagonal roja sutil — mismo motivo del logo */}
        <div
          aria-hidden="true"
          className="absolute inset-0 pointer-events-none opacity-[0.06]"
          style={{
            background:
              'linear-gradient(105deg, transparent 35%, #E31E24 35%, #E31E24 38%, transparent 38%)',
          }}
        />

        {/* Pelota de voley geométrica decorativa GIGANTE — opacity baja
            como motivo de fondo. Mismo SVG que el wordmark del landing. */}
        <svg
          viewBox="0 0 64 64"
          className="absolute -top-12 -right-16 w-[520px] h-[520px] text-white opacity-[0.08] pointer-events-none"
          aria-hidden="true"
        >
          <g
            stroke="currentColor"
            strokeWidth={2.4}
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="32" cy="32" r="26" />
            <path d="M 7 27 C 18 22 46 22 57 27" />
            <path d="M 7 37 C 18 42 46 42 57 37" />
            <path d="M 27 7 C 22 18 22 46 27 57" />
            <path d="M 37 7 C 42 18 42 46 37 57" />
          </g>
          <circle cx="32" cy="32" r="3.2" fill="#E31E24" />
        </svg>

        {/* Esquinas decorativas rojas (mismo del logo de la app) */}
        <div className="absolute top-8 left-8 w-12 h-12 border-t-2 border-l-2 border-spk-red/40" />
        <div className="absolute top-8 right-8 w-12 h-12 border-t-2 border-r-2 border-spk-red/40" />
        <div className="absolute bottom-8 left-8 w-12 h-12 border-b-2 border-l-2 border-spk-red/40" />
        <div className="absolute bottom-8 right-8 w-12 h-12 border-b-2 border-r-2 border-spk-red/40" />

        {/* Contenido principal */}
        <div className="relative z-10 h-full flex flex-col justify-between p-12 xl:p-16">
          {/* TOP — Brand block */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="space-y-6 max-w-md"
          >
            <div>
              <p
                className="text-xs font-bold uppercase tracking-[0.25em] text-spk-red mb-3"
                style={{ fontFamily: 'Barlow Condensed, sans-serif' }}
              >
                ● Voleibol · En vivo
              </p>
              <h3
                className="font-black tracking-tighter leading-none text-6xl xl:text-7xl"
                style={{ fontFamily: 'Barlow Condensed, sans-serif' }}
              >
                TORN<span className="text-spk-red">Y</span>
              </h3>
              <div className="h-1 w-16 bg-spk-red mt-4" />
            </div>

            <p className="text-white/75 text-base xl:text-lg leading-relaxed">
              Plataforma para organizar torneos de voleibol con marcador en
              vivo, brackets automáticos y panel de jueces.
            </p>
          </motion.div>

          {/* BOTTOM — value props + soporte */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4 }}
            className="space-y-6"
          >
            {/* Value props row */}
            <div className="grid grid-cols-3 gap-3">
              {[
                { icon: Zap, label: 'Setup', value: '5 MIN' },
                { icon: WifiOff, label: 'Sin App Store', value: '100% PWA' },
                { icon: Bell, label: 'Marcador', value: 'EN VIVO' },
              ].map((p) => (
                <div
                  key={p.label}
                  className="bg-white/[0.05] backdrop-blur border border-white/10 rounded-sm p-4"
                >
                  <div className="w-8 h-8 rounded-sm bg-spk-red/15 text-spk-red flex items-center justify-center mb-3">
                    <p.icon className="w-4 h-4" />
                  </div>
                  <div className="text-[10px] uppercase tracking-[0.18em] text-white/55 leading-tight mb-1">
                    {p.label}
                  </div>
                  <div
                    className="font-bold text-white text-base leading-none"
                    style={{ fontFamily: 'Barlow Condensed, sans-serif' }}
                  >
                    {p.value}
                  </div>
                </div>
              ))}
            </div>

            {/* Soporte + info útil */}
            <div className="bg-white/[0.05] backdrop-blur border border-white/10 rounded-sm p-5 space-y-4">
              <p
                className="text-[11px] font-bold uppercase tracking-[0.2em] text-white/45"
                style={{ fontFamily: 'Barlow Condensed, sans-serif' }}
              >
                ¿Necesitás ayuda?
              </p>

              <div className="grid grid-cols-2 gap-3">
                <a
                  href="https://wa.me/573166275710?text=Hola%20Santiago%2C%20necesito%20ayuda%20con%20Torny."
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2.5 bg-[#25D366]/15 hover:bg-[#25D366]/25 border border-[#25D366]/40 rounded-sm px-3 py-2.5 transition-colors group"
                >
                  <MessageCircle className="w-4 h-4 text-[#25D366] flex-shrink-0" />
                  <div className="min-w-0">
                    <div className="text-[10px] uppercase tracking-wider text-white/55 leading-tight">
                      WhatsApp
                    </div>
                    <div className="text-sm font-bold text-white leading-tight truncate">
                      316 627 5710
                    </div>
                  </div>
                </a>

                <a
                  href="mailto:hola@torny.app"
                  className="flex items-center gap-2.5 bg-white/[0.04] hover:bg-white/[0.08] border border-white/10 rounded-sm px-3 py-2.5 transition-colors"
                >
                  <Smartphone className="w-4 h-4 text-spk-red flex-shrink-0" />
                  <div className="min-w-0">
                    <div className="text-[10px] uppercase tracking-wider text-white/55 leading-tight">
                      Email
                    </div>
                    <div className="text-sm font-bold text-white leading-tight truncate">
                      hola@torny.app
                    </div>
                  </div>
                </a>
              </div>

              {/* Tip — instalación PWA */}
              <div className="flex items-start gap-2.5 pt-3 border-t border-white/10">
                <Shield className="w-4 h-4 text-white/50 flex-shrink-0 mt-0.5" />
                <p className="text-xs text-white/55 leading-relaxed">
                  <span className="text-white/80 font-semibold">Tip:</span>{' '}
                  instalá Torny como app en tu celular desde el menú del
                  navegador (Compartir → Añadir a Inicio en iOS, ⋮ → Instalar
                  app en Android).
                </p>
              </div>
            </div>
          </motion.div>
        </div>
      </div>
    </div>
  );
}
