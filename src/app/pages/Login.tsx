import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router';
import { Trophy, Lock, User, ArrowRight, Eye, EyeOff } from 'lucide-react';
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
      {/* Left Side - Login Form
          Padding matches the right panel (p-12 xl:p-16) so the brand mark
          on the left sits at the SAME y-position as the "Tournament
          Platform" eyebrow on the right, and the form's title aligns
          horizontally with "GANA EL JUEGO". Layout is top-aligned (not
          vertically centered) so the brand mirrors HomeHeader's top-left
          position instead of floating mid-screen on tall viewports. */}
      <div className="w-full lg:w-1/2 flex flex-col items-center p-4 sm:p-6 md:p-12 xl:p-16">
        <div className="w-full max-w-md">
          {/* Brand mark — aligned with AdminLayout's sidebar header
              (w-12 trophy frame + text-2xl wordmark + 16-px hairline) so
              the visual scale stays constant the moment the user logs in
              and lands on the admin shell.
              `mb-5` keeps the title's top edge close to the right panel's
              "GANA EL JUEGO" headline (eyebrow + mb-4 ≈ same offset). */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-5"
          >
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-sm bg-white flex items-center justify-center flex-shrink-0">
                <Trophy className="w-6 h-6 text-black" />
              </div>
              <div>
                <h1
                  className="text-2xl font-bold tracking-tighter leading-none"
                  style={{ fontFamily: 'Barlow Condensed, sans-serif' }}
                >
                  Torn<span className="text-spk-red">y</span>
                </h1>
                <div className="w-16 h-0.5 bg-spk-red mt-1" />
              </div>
            </div>
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

      {/* Right Side — foto cinematográfica de voleibol + flujo instructivo
          en 3 pasos. Difuminado izquierdo (gradient from-black) integra
          el panel con el form left sin corte visual. Sin info de contacto
          personal. Foto Unsplash optimizada (hash perpetuo, 1080w). */}
      <div className="hidden lg:block lg:w-1/2 relative overflow-hidden bg-black">
        {/* Foto épica de voleibol en fullscreen */}
        <img
          src="https://images.unsplash.com/photo-1612872087720-bb876e2e67d1?auto=format&fit=crop&w=1400&q=85"
          alt="Jugadora de voleibol en acción"
          className="absolute inset-0 w-full h-full object-cover"
          loading="eager"
          decoding="async"
        />

        {/* Difuminado izquierdo — gradient que va del NEGRO PURO (mismo
            del panel left) al transparente, eliminando el corte visual.
            Más fuerte arriba/abajo y centro que en los costados para no
            tapar la foto. */}
        <div
          aria-hidden="true"
          className="absolute inset-0 pointer-events-none"
          style={{
            background:
              'linear-gradient(90deg, #000 0%, rgba(0,0,0,0.85) 12%, rgba(0,0,0,0.45) 35%, rgba(0,0,0,0.25) 60%, rgba(0,0,0,0.45) 100%)',
          }}
        />
        {/* Vignette sutil para que el contenido superpuesto destaque */}
        <div
          aria-hidden="true"
          className="absolute inset-0 pointer-events-none"
          style={{
            background:
              'radial-gradient(ellipse at center, transparent 0%, rgba(0,0,0,0.55) 100%)',
          }}
        />

        {/* Contenido superpuesto */}
        <div className="relative z-10 h-full flex flex-col justify-between p-12 xl:p-16">
          {/* TOP — eyebrow + headline corto inspiracional */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="max-w-lg"
          >
            <p
              className="text-xs font-bold uppercase tracking-[0.3em] text-spk-red mb-4 flex items-center gap-2"
              style={{ fontFamily: 'Barlow Condensed, sans-serif' }}
            >
              <span className="w-2 h-2 rounded-full bg-spk-red animate-pulse" />
              Tournament Platform
            </p>
            <h3
              className="font-black tracking-tighter leading-[0.95] text-5xl xl:text-6xl 2xl:text-7xl"
              style={{ fontFamily: 'Barlow Condensed, sans-serif' }}
            >
              GANA EL JUEGO
              <br />
              <span className="text-white/65">FUERA DE LA CANCHA.</span>
            </h3>
          </motion.div>

          {/* BOTTOM — flujo en 3 pasos tipo instructivo */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4 }}
          >
            <p
              className="text-[11px] font-bold uppercase tracking-[0.25em] text-white/55 mb-5"
              style={{ fontFamily: 'Barlow Condensed, sans-serif' }}
            >
              Cómo funciona
            </p>

            <div className="space-y-3">
              {[
                {
                  n: '01',
                  title: 'Crea tu torneo',
                  desc: 'Categorías, formato, canchas. En 5 minutos.',
                },
                {
                  n: '02',
                  title: 'Inscribe tus equipos',
                  desc: 'Capitanes y jueces con credenciales propias.',
                },
                {
                  n: '03',
                  title: 'Juega en vivo',
                  desc: 'Marcador, brackets y push notifications en tiempo real.',
                },
              ].map((s) => (
                <div
                  key={s.n}
                  className="flex items-start gap-4 bg-white/[0.04] backdrop-blur-md border border-white/10 rounded-sm p-4"
                >
                  <div
                    className="font-black text-2xl xl:text-3xl text-spk-red leading-none flex-shrink-0 w-10 xl:w-12 tabular-nums"
                    style={{ fontFamily: 'Barlow Condensed, sans-serif' }}
                  >
                    {s.n}
                  </div>
                  <div className="min-w-0">
                    <div
                      className="font-bold text-white text-base xl:text-lg leading-tight uppercase tracking-tight"
                      style={{ fontFamily: 'Barlow Condensed, sans-serif' }}
                    >
                      {s.title}
                    </div>
                    <p className="text-xs xl:text-sm text-white/60 leading-snug mt-1">
                      {s.desc}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </motion.div>
        </div>
      </div>
    </div>
  );
}
