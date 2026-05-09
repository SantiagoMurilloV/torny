import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router';
import { Trophy, Lock, User, ArrowRight, Eye, EyeOff } from 'lucide-react';
import { motion } from 'motion/react';
import { ImageWithFallback } from '../components/figma/ImageWithFallback';
import { useAuth } from '../context/AuthContext';
import { useData } from '../context/DataContext';
import { ApiError } from '../services/api';
import { homeForRole } from '../lib/roles';

export function Login() {
  const navigate = useNavigate();
  const { login, isAuthenticated, sessionMessage, user } = useAuth();
  const { tournaments, teams, matches } = useData();
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

      {/* Right Side - Image */}
      <div className="hidden lg:block lg:w-1/2 relative">
        <div className="absolute inset-0 bg-gradient-to-l from-transparent via-black/50 to-black z-10" />
        <ImageWithFallback
          src="https://images.unsplash.com/photo-1771909713106-86b9a412964a?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHx2b2xsZXliYWxsJTIwY291cnQlMjBzcG9ydHMlMjBhcmVuYXxlbnwxfHx8fDE3NzU1NzU1MTB8MA&ixlib=rb-4.1.0&q=80&w=1080"
          alt="Volleyball court"
          className="w-full h-full object-cover"
        />
        
        {/* Floating stats */}
        <div className="absolute bottom-12 left-12 right-12 z-20">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="bg-white/10 backdrop-blur-xl border border-white/20 p-8 rounded-sm"
          >
            <h3 
              className="text-3xl font-bold mb-6"
              style={{ fontFamily: 'Barlow Condensed, sans-serif' }}
            >
              GESTIONA TUS TORNEOS
            </h3>
            <div className="grid grid-cols-3 gap-6">
              <div>
                <div className="text-4xl font-bold mb-1" style={{ fontFamily: 'Barlow Condensed, sans-serif' }}>
                  {tournaments.length}
                </div>
                <div className="text-sm text-white/60 uppercase tracking-wider">Torneos</div>
              </div>
              <div>
                <div className="text-4xl font-bold mb-1" style={{ fontFamily: 'Barlow Condensed, sans-serif' }}>
                  {teams.length}
                </div>
                <div className="text-sm text-white/60 uppercase tracking-wider">Equipos</div>
              </div>
              <div>
                <div className="text-4xl font-bold mb-1" style={{ fontFamily: 'Barlow Condensed, sans-serif' }}>
                  {matches.length}
                </div>
                <div className="text-sm text-white/60 uppercase tracking-wider">Partidos</div>
              </div>
            </div>
          </motion.div>
        </div>
      </div>
    </div>
  );
}
