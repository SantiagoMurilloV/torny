import { useParams, useNavigate } from 'react-router';
import { ArrowLeft, Trophy, TrendingUp, Calendar, MapPin, Award, Target, Zap, RefreshCw } from 'lucide-react';
import { motion, useScroll, useTransform } from 'motion/react';
import { MatchCard } from '../components/MatchCard';
import { useState, useEffect } from 'react';
import { TeamAvatar } from '../components/TeamAvatar';
import { ImageWithFallback } from '../components/figma/ImageWithFallback';
import spkLogo from '../../imports/spk-cup-logo-v4-1.svg';
import { api } from '../services/api';
import type { Team, Match } from '../types';
import { MatchCardSkeleton } from '../components/SkeletonLoaders';
import { getErrorMessage } from '../lib/errors';

export function TeamDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [scrolled, setScrolled] = useState(false);
  const { scrollY } = useScroll();
  const heroOpacity = useTransform(scrollY, [0, 200], [1, 0]);
  const heroScale = useTransform(scrollY, [0, 300], [1, 1.15]);

  const [team, setTeam] = useState<Team | null>(null);
  const [teamMatches, setTeamMatches] = useState<Match[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const handleScroll = () => {
      setScrolled(window.scrollY > 100);
    };
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const loadTeamData = async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const [teamData, matchesData] = await Promise.all([
        api.getTeam(id),
        api.getTeamMatches(id),
      ]);
      setTeam(teamData);
      setTeamMatches(matchesData);
    } catch (err) {
      setError(getErrorMessage(err, 'Error al cargar el equipo'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadTeamData();
  }, [id]);

  if (loading) {
    return (
      <div className="min-h-screen bg-white pt-20 px-4 md:px-6 lg:px-12">
        <div className="max-w-[1600px] mx-auto">
          <div className="h-[40vh] bg-black/5 rounded animate-pulse mb-8" />
          <div className="space-y-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <MatchCardSkeleton key={i} />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-screen bg-white">
        <div className="text-center">
          <div className="text-5xl mb-6">⚠️</div>
          <p className="text-2xl font-bold mb-2" style={{ fontFamily: 'Barlow Condensed, sans-serif' }}>
            ERROR AL CARGAR EQUIPO
          </p>
          <p className="text-black/60 mb-6">{error}</p>
          <div className="flex gap-3 justify-center">
            <button
              onClick={() => loadTeamData()}
              className="inline-flex items-center gap-2 px-6 py-3 bg-black text-white font-bold hover:bg-black/90 transition-colors"
            >
              <RefreshCw className="w-4 h-4" />
              Reintentar
            </button>
            <button
              onClick={() => navigate(-1)}
              className="px-6 py-3 bg-black/10 text-black font-bold hover:bg-black/20 transition-colors"
            >
              Volver
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!team) {
    return (
      <div className="flex items-center justify-center h-screen bg-black text-white">
        <div className="text-center">
          <p className="text-2xl font-bold mb-4" style={{ fontFamily: 'Barlow Condensed, sans-serif' }}>
            EQUIPO NO ENCONTRADO
          </p>
          <button 
            onClick={() => navigate(-1)} 
            className="px-6 py-3 bg-white text-black rounded-sm font-bold hover:bg-white/90 transition-colors"
          >
            Volver
          </button>
        </div>
      </div>
    );
  }

  const completedMatches = teamMatches.filter(m => m.status === 'completed');
  const upcomingMatches = teamMatches.filter(m => m.status === 'upcoming');
  const liveMatches = teamMatches.filter(m => m.status === 'live');

  // Calculate stats from matches
  const wins = completedMatches.filter(m => {
    const isTeam1 = m.team1.id === team.id;
    const teamScore = isTeam1 ? m.score?.team1 : m.score?.team2;
    const opponentScore = isTeam1 ? m.score?.team2 : m.score?.team1;
    return teamScore != null && opponentScore != null && teamScore > opponentScore;
  }).length;
  const losses = completedMatches.length - wins;
  const played = completedMatches.length;
  const points = wins * 3;
  const winRate = played > 0 ? (wins / played) * 100 : 0;

  // Calculate sets
  let setsFor = 0;
  let setsAgainst = 0;
  completedMatches.forEach(m => {
    if (m.sets) {
      const isTeam1 = m.team1.id === team.id;
      m.sets.forEach(s => {
        if (isTeam1) {
          setsFor += s.team1 > s.team2 ? 1 : 0;
          setsAgainst += s.team2 > s.team1 ? 1 : 0;
        } else {
          setsFor += s.team2 > s.team1 ? 1 : 0;
          setsAgainst += s.team1 > s.team2 ? 1 : 0;
        }
      });
    }
  });
  const setsDiff = setsFor - setsAgainst;

  // Recent matches
  const recentMatches = completedMatches
    .sort((a, b) => b.date.getTime() - a.date.getTime())
    .slice(0, 5);

  // Streak
  const streak = recentMatches.map(match => {
    const isTeam1 = match.team1.id === team.id;
    const teamScore = isTeam1 ? match.score?.team1 : match.score?.team2;
    const opponentScore = isTeam1 ? match.score?.team2 : match.score?.team1;
    if (teamScore != null && opponentScore != null) {
      return teamScore > opponentScore ? 'W' : 'L';
    }
    return null;
  }).filter(Boolean);

  return (
    <div className="min-h-screen bg-white">
      {/* Fixed Header */}
      <motion.header
        className={`fixed top-0 left-0 right-0 z-50 transition-all duration-500 ${
          scrolled 
            ? 'bg-black/95 backdrop-blur-2xl border-b border-white/10' 
            : 'bg-black/80 backdrop-blur-md'
        }`}
      >
        <div className="max-w-[1600px] mx-auto px-4 md:px-6 lg:px-12">
          <div className="flex items-center justify-between h-16">
            {/* Back Button */}
            <motion.button
              onClick={() => navigate(-1)}
              whileHover={{ scale: 1.05, x: -3 }}
              whileTap={{ scale: 0.95 }}
              className="flex items-center gap-2 text-white/70 hover:text-white transition-colors"
            >
              <ArrowLeft className="w-5 h-5" />
              <span className="hidden sm:inline text-sm font-medium">Volver</span>
            </motion.button>

            {/* Team Name (visible when scrolled) */}
            <motion.div 
              className="flex items-center gap-2 md:gap-3 text-white"
              initial={{ opacity: 0 }}
              animate={{ opacity: scrolled ? 1 : 0 }}
              transition={{ duration: 0.3 }}
            >
              <TeamAvatar team={team} size="sm" className="w-7 h-7 md:w-8 md:h-8" />
              <span className="font-bold text-sm md:text-base truncate max-w-[150px] sm:max-w-none">{team.name}</span>
            </motion.div>

            {/* Logo */}
            <div className="flex items-center gap-3">
              <div className="w-7 h-7 md:w-8 md:h-8 rounded-sm bg-white flex items-center justify-center">
                <Trophy className="w-3.5 h-3.5 md:w-4 md:h-4 text-black" />
              </div>
            </div>
          </div>
        </div>
      </motion.header>

      {/* Hero Section */}
      <section className="relative h-[50vh] md:h-[60vh] lg:h-[70vh] overflow-hidden bg-black">
        {/* Background with Team Color */}
        <motion.div
          style={{ scale: heroScale }}
          className="absolute inset-0"
        >
          <div 
            className="absolute inset-0 opacity-20"
            style={{ backgroundColor: team.colors.primary }}
          />
          <div className="absolute inset-0 bg-gradient-to-b from-black/70 via-black/50 to-black z-10" />
          <ImageWithFallback
            src="https://images.unsplash.com/photo-1612872087720-bb876e2e67d1?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHx2b2xsZXliYWxsJTIwdGVhbSUyMGNlbGVicmF0aW9ufGVufDF8fHx8MTc3NTU3NTUxMnww&ixlib=rb-4.1.0&q=80&w=1080"
            alt="Team"
            className="w-full h-full object-cover opacity-30"
          />
        </motion.div>

        {/* Hero Content */}
        <motion.div
          style={{ opacity: heroOpacity }}
          className="relative z-20 h-full flex items-center"
        >
          <div className="max-w-[1600px] mx-auto px-4 md:px-6 lg:px-12 w-full pt-16 md:pt-20">
            <div className="max-w-4xl">
              {/* Team Badge */}
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="mb-4 md:mb-8"
              >
                <div className="w-16 h-16 md:w-24 md:h-24 lg:w-32 lg:h-32 rounded-sm border-2 md:border-4 border-white/20 overflow-hidden flex-shrink-0 bg-white/5 flex items-center justify-center">
                  {team.logo ? (
                    // Hero avatar uses object-contain so uploads with
                    // transparent padding (common for club logos) keep
                    // their framing instead of being hard-cropped.
                    <img
                      src={team.logo}
                      alt={team.initials}
                      className="w-full h-full object-contain p-1 md:p-2"
                      onError={(e) => {
                        e.currentTarget.style.display = 'none';
                      }}
                    />
                  ) : (
                    <div
                      className="w-full h-full flex items-center justify-center text-white font-bold text-3xl md:text-5xl lg:text-6xl"
                      style={{ backgroundColor: team.colors.primary, fontFamily: 'Barlow Condensed, sans-serif' }}
                    >
                      {team.initials}
                    </div>
                  )}
                </div>
              </motion.div>

              {/* Team Name */}
              <motion.h1
                initial={{ opacity: 0, y: 30 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1 }}
                className="text-4xl sm:text-5xl md:text-7xl lg:text-8xl xl:text-9xl font-bold mb-4 md:mb-6 leading-[0.9] tracking-tighter text-white"
                style={{ fontFamily: 'Barlow Condensed, sans-serif' }}
              >
                {team.name}
              </motion.h1>

              {/* Quick Stats */}
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.3 }}
                className="grid grid-cols-2 md:flex md:flex-wrap gap-6 md:gap-8 lg:gap-12"
              >
                <div>
                  <div className="text-3xl sm:text-4xl md:text-5xl lg:text-6xl font-bold mb-1 text-white" style={{ fontFamily: 'Barlow Condensed, sans-serif' }}>
                    {wins}
                  </div>
                  <div className="text-xs md:text-sm text-white/60 uppercase tracking-wider">Victorias</div>
                </div>
                <div>
                  <div className="text-3xl sm:text-4xl md:text-5xl lg:text-6xl font-bold mb-1 text-white" style={{ fontFamily: 'Barlow Condensed, sans-serif' }}>
                    {losses}
                  </div>
                  <div className="text-xs md:text-sm text-white/60 uppercase tracking-wider">Derrotas</div>
                </div>
                <div>
                  <div className="text-3xl sm:text-4xl md:text-5xl lg:text-6xl font-bold mb-1 text-white" style={{ fontFamily: 'Barlow Condensed, sans-serif' }}>
                    {points}
                  </div>
                  <div className="text-xs md:text-sm text-white/60 uppercase tracking-wider">Puntos</div>
                </div>
                <div>
                  <div className="text-3xl sm:text-4xl md:text-5xl lg:text-6xl font-bold mb-1 text-white" style={{ fontFamily: 'Barlow Condensed, sans-serif' }}>
                    {winRate.toFixed(0)}%
                  </div>
                  <div className="text-xs md:text-sm text-white/60 uppercase tracking-wider">Efectividad</div>
                </div>
              </motion.div>
            </div>
          </div>
        </motion.div>
      </section>

      {/* Content */}
      <div className="max-w-[1600px] mx-auto px-6 md:px-12 py-12 md:py-20">
        {/* Stats Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6 mb-16">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            whileHover={{ y: -4 }}
            className="border-2 p-4 md:p-6 transition-all"
            style={{ backgroundColor: 'rgba(0, 0, 0, 0.05)', borderColor: 'rgba(0, 0, 0, 0.1)' }}
          >
            <div className="flex items-center justify-between mb-3 md:mb-4">
              <div className="w-10 h-10 md:w-12 md:h-12 bg-spk-blue rounded-sm flex items-center justify-center">
                <Calendar className="w-5 h-5 md:w-6 md:h-6 text-white" />
              </div>
              <TrendingUp className="w-4 h-4 md:w-5 md:h-5 text-spk-win" />
            </div>
            <div className="text-3xl md:text-4xl font-bold mb-1 md:mb-2" style={{ fontFamily: 'Barlow Condensed, sans-serif' }}>
              {played}
            </div>
            <div className="text-xs md:text-sm text-black/60 uppercase tracking-wider font-bold" style={{ fontFamily: 'Barlow Condensed, sans-serif' }}>
              Partidos Jugados
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            whileHover={{ y: -4 }}
            className="border-2 p-4 md:p-6 transition-all"
            style={{ backgroundColor: 'rgba(0, 0, 0, 0.05)', borderColor: 'rgba(0, 0, 0, 0.1)' }}
          >
            <div className="flex items-center justify-between mb-3 md:mb-4">
              <div className="w-10 h-10 md:w-12 md:h-12 bg-spk-win rounded-sm flex items-center justify-center">
                <Target className="w-5 h-5 md:w-6 md:h-6 text-white" />
              </div>
            </div>
            <div className="text-3xl md:text-4xl font-bold mb-1 md:mb-2" style={{ fontFamily: 'Barlow Condensed, sans-serif' }}>
              {setsFor}/{setsAgainst}
            </div>
            <div className="text-xs md:text-sm text-black/60 uppercase tracking-wider font-bold" style={{ fontFamily: 'Barlow Condensed, sans-serif' }}>
              Sets a Favor/Contra
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            whileHover={{ y: -4 }}
            className="border-2 p-4 md:p-6 transition-all"
            style={{ backgroundColor: 'rgba(0, 0, 0, 0.05)', borderColor: 'rgba(0, 0, 0, 0.1)' }}
          >
            <div className="flex items-center justify-between mb-3 md:mb-4">
              <div className={`w-10 h-10 md:w-12 md:h-12 ${setsDiff >= 0 ? 'bg-spk-win' : 'bg-spk-red'} rounded-sm flex items-center justify-center`}>
                <Zap className="w-5 h-5 md:w-6 md:h-6 text-white" />
              </div>
            </div>
            <div className="text-3xl md:text-4xl font-bold mb-1 md:mb-2" style={{ fontFamily: 'Barlow Condensed, sans-serif' }}>
              {setsDiff > 0 ? '+' : ''}{setsDiff}
            </div>
            <div className="text-xs md:text-sm text-black/60 uppercase tracking-wider font-bold" style={{ fontFamily: 'Barlow Condensed, sans-serif' }}>
              Diferencia de Sets
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            whileHover={{ y: -4 }}
            className="border-2 p-4 md:p-6 transition-all"
            style={{ backgroundColor: 'rgba(0, 0, 0, 0.05)', borderColor: 'rgba(0, 0, 0, 0.1)' }}
          >
            <div className="flex items-center justify-between mb-3 md:mb-4">
              <div className="w-10 h-10 md:w-12 md:h-12 bg-spk-gold rounded-sm flex items-center justify-center">
                <Trophy className="w-5 h-5 md:w-6 md:h-6 text-white" />
              </div>
            </div>
            <div className="text-3xl md:text-4xl font-bold mb-1 md:mb-2" style={{ fontFamily: 'Barlow Condensed, sans-serif' }}>
              {wins}W/{losses}L
            </div>
            <div className="text-xs md:text-sm text-black/60 uppercase tracking-wider font-bold" style={{ fontFamily: 'Barlow Condensed, sans-serif' }}>
              Récord
            </div>
          </motion.div>
        </div>

        {/* Streak */}
        {streak.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4 }}
            className="mb-16"
          >
            <h2 className="text-3xl font-bold tracking-tighter mb-6" style={{ fontFamily: 'Barlow Condensed, sans-serif' }}>
              ÚLTIMOS RESULTADOS
            </h2>
            <div className="flex gap-3">
              {streak.map((result, index) => (
                <motion.div
                  key={index}
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: 0.5 + index * 0.1 }}
                  className={`w-14 h-14 rounded-sm flex items-center justify-center font-bold text-2xl text-white ${
                    result === 'W' ? 'bg-spk-win' : 'bg-spk-red'
                  }`}
                  style={{ fontFamily: 'Barlow Condensed, sans-serif' }}
                >
                  {result}
                </motion.div>
              ))}
            </div>
          </motion.div>
        )}

        {/* Live Matches */}
        {liveMatches.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.5 }}
            className="mb-16"
          >
            <div className="flex items-center gap-3 mb-6">
              <motion.div
                className="w-3 h-3 bg-spk-red rounded-full"
                animate={{ scale: [1, 1.3, 1], opacity: [1, 0.5, 1] }}
                transition={{ duration: 2, repeat: Infinity }}
              />
              <h2 className="text-3xl font-bold tracking-tighter" style={{ fontFamily: 'Barlow Condensed, sans-serif' }}>
                PARTIDO EN VIVO
              </h2>
            </div>
            <div className="space-y-4">
              {liveMatches.map(match => (
                <MatchCard 
                  key={match.id} 
                  match={match}
                  onClick={() => navigate(`/match/${match.id}`)}
                />
              ))}
            </div>
          </motion.div>
        )}

        {/* Upcoming Matches */}
        {upcomingMatches.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.6 }}
            className="mb-16"
          >
            <h2 className="text-3xl font-bold tracking-tighter mb-6" style={{ fontFamily: 'Barlow Condensed, sans-serif' }}>
              PRÓXIMOS PARTIDOS ({upcomingMatches.length})
            </h2>
            <div className="space-y-4">
              {upcomingMatches.map(match => (
                <MatchCard 
                  key={match.id} 
                  match={match}
                  onClick={() => navigate(`/match/${match.id}`)}
                />
              ))}
            </div>
          </motion.div>
        )}

        {/* Recent Matches */}
        {recentMatches.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.7 }}
            className="mb-16"
          >
            <h2 className="text-3xl font-bold tracking-tighter mb-6" style={{ fontFamily: 'Barlow Condensed, sans-serif' }}>
              PARTIDOS RECIENTES
            </h2>
            <div className="space-y-4">
              {recentMatches.map(match => (
                <MatchCard 
                  key={match.id} 
                  match={match}
                  onClick={() => navigate(`/match/${match.id}`)}
                />
              ))}
            </div>
          </motion.div>
        )}

        {/* All Matches */}
        {completedMatches.length > recentMatches.length && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.8 }}
          >
            <h2 className="text-3xl font-bold tracking-tighter mb-6" style={{ fontFamily: 'Barlow Condensed, sans-serif' }}>
              HISTORIAL COMPLETO ({completedMatches.length} partidos)
            </h2>
            <div className="space-y-4">
              {completedMatches.slice(5).map(match => (
                <MatchCard 
                  key={match.id} 
                  match={match}
                  onClick={() => navigate(`/match/${match.id}`)}
                />
              ))}
            </div>
          </motion.div>
        )}
      </div>

      {/* Footer */}
      <footer className="bg-black text-white py-12 border-t border-white/10">
        <div className="max-w-[1600px] mx-auto px-6 md:px-12">
          <div className="flex flex-col md:flex-row items-center justify-between gap-6">
            <div className="flex items-center gap-3">
              <img 
                src={spkLogo} 
                alt="Torny Logo"
                className="w-16 h-16"
              />
              <div>
                <div className="text-xl font-bold tracking-tighter" style={{ fontFamily: 'Barlow Condensed, sans-serif' }}>
                  Torny
                </div>
                <div className="text-xs text-white/50">Sistema de Torneos</div>
              </div>
            </div>
            <div className="text-sm text-white/50">
              &copy; 2026 Torny. Todos los derechos reservados.
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
