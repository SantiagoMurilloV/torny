import { Save, Globe, Shield, Mail, Eye, EyeOff, Loader2 } from 'lucide-react';
import { useState, useEffect } from 'react';
import { toast } from 'sonner';
import { api, type SystemSettings } from '../../services/api';
import { getErrorMessage } from '../../lib/errors';

export function AdminSettings() {
  const [showPassword, setShowPassword] = useState(false);
  const [loadingSettings, setLoadingSettings] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');

  const [settings, setSettings] = useState<SystemSettings>({
    systemName: '',
    clubName: '',
    location: '',
    language: 'es',
    contactEmail: '',
    website: '',
  });

  useEffect(() => {
    async function loadSettings() {
      try {
        const data = await api.getSettings();
        setSettings(data);
      } catch (err) {
        toast.error(getErrorMessage(err, 'Error al cargar configuración'));
      } finally {
        setLoadingSettings(false);
      }
    }
    loadSettings();
  }, []);

  const handleSaveSettings = async () => {
    setSaving(true);
    try {
      const updated = await api.updateSettings({
        systemName: settings.systemName,
        clubName: settings.clubName,
        location: settings.location,
        language: settings.language,
        contactEmail: settings.contactEmail,
        website: settings.website,
      });
      setSettings(updated);
      toast.success('Configuración guardada correctamente');
    } catch (err) {
      toast.error(getErrorMessage(err, 'Error al guardar configuración'));
    } finally {
      setSaving(false);
    }
  };

  const handleChangePassword = async () => {
    if (!currentPassword) {
      toast.error('Ingresá tu contraseña actual para confirmar');
      return;
    }
    // Mirror the backend policy so the user gets feedback before the
    // round-trip: min 8 chars with at least one letter and one digit.
    if (newPassword.length < 8 || !/[A-Za-z]/.test(newPassword) || !/[0-9]/.test(newPassword)) {
      toast.error('La nueva contraseña debe tener al menos 8 caracteres con letras y números');
      return;
    }
    if (newPassword === currentPassword) {
      toast.error('La nueva contraseña debe ser distinta a la actual');
      return;
    }
    setSavingPassword(true);
    try {
      await api.changePassword(currentPassword, newPassword);
      setCurrentPassword('');
      setNewPassword('');
      toast.success('Contraseña actualizada correctamente');
    } catch (err) {
      toast.error(getErrorMessage(err, 'Error al cambiar contraseña'));
    } finally {
      setSavingPassword(false);
    }
  };

  if (loadingSettings) {
    return (
      <div className="p-6 flex items-center justify-center min-h-[400px]">
        <Loader2 className="w-8 h-8 animate-spin text-spk-red" />
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 space-y-4 sm:space-y-6 max-w-4xl">
      {/* Header */}
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold mb-2" style={{ fontFamily: 'Barlow Condensed, sans-serif' }}>
          CONFIGURACIÓN
        </h1>
        <p className="text-sm sm:text-base text-muted-foreground">
          Ajusta las configuraciones generales del sistema
        </p>
      </div>

      {/* General Settings */}
      <div className="bg-card border border-border rounded-sm overflow-hidden">
        <div className="bg-secondary px-4 sm:px-6 py-4 border-b border-border">
          <h2 className="font-bold flex items-center gap-2" style={{ fontFamily: 'Barlow Condensed, sans-serif' }}>
            <Globe className="w-5 h-5" />
            CONFIGURACIÓN GENERAL
          </h2>
        </div>
        <div className="p-4 sm:p-6 space-y-4 sm:space-y-6">
          <div>
            <label className="block text-sm font-medium mb-2">Nombre del Sistema</label>
            <input
              type="text"
              value={settings.systemName}
              onChange={(e) => setSettings({ ...settings, systemName: e.target.value })}
              className="w-full px-4 py-2 bg-background border border-border rounded-sm focus:outline-none focus:ring-2 focus:ring-[#E31E24]/50"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-2">Nombre del Club</label>
            <input
              type="text"
              value={settings.clubName || ''}
              onChange={(e) => setSettings({ ...settings, clubName: e.target.value })}
              className="w-full px-4 py-2 bg-background border border-border rounded-sm focus:outline-none focus:ring-2 focus:ring-[#E31E24]/50"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-2">Ubicación por Defecto</label>
            <input
              type="text"
              value={settings.location || ''}
              onChange={(e) => setSettings({ ...settings, location: e.target.value })}
              className="w-full px-4 py-2 bg-background border border-border rounded-sm focus:outline-none focus:ring-2 focus:ring-[#E31E24]/50"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-2">Idioma</label>
            <select
              value={settings.language}
              onChange={(e) => setSettings({ ...settings, language: e.target.value })}
              className="w-full px-4 py-2 bg-background border border-border rounded-sm focus:outline-none focus:ring-2 focus:ring-[#E31E24]/50"
            >
              <option value="es">Español</option>
              <option value="en">English</option>
              <option value="pt">Português</option>
            </select>
          </div>
        </div>
      </div>

      {/* Security Settings */}
      <div className="bg-card border border-border rounded-sm overflow-hidden">
        <div className="bg-secondary px-4 sm:px-6 py-4 border-b border-border">
          <h2 className="font-bold flex items-center gap-2" style={{ fontFamily: 'Barlow Condensed, sans-serif' }}>
            <Shield className="w-5 h-5" />
            SEGURIDAD
          </h2>
        </div>
        <div className="p-4 sm:p-6 space-y-4 sm:space-y-6">
          <div>
            <label className="block text-sm font-medium mb-2">Contraseña actual</label>
            <input
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              placeholder="Confirmá tu contraseña actual"
              autoComplete="current-password"
              className="w-full px-4 py-2 bg-background border border-border rounded-sm focus:outline-none focus:ring-2 focus:ring-[#E31E24]/50"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-2">Nueva contraseña</label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Mínimo 8 caracteres, con letras y números"
                autoComplete="new-password"
                className="w-full px-4 py-2 pr-12 bg-background border border-border rounded-sm focus:outline-none focus:ring-2 focus:ring-[#E31E24]/50"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
              >
                {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
              </button>
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              Usa al menos 8 caracteres incluyendo una letra y un número.
            </p>
          </div>
          <button
            onClick={handleChangePassword}
            disabled={savingPassword || !currentPassword || !newPassword}
            className="flex items-center gap-2 px-4 py-2 bg-spk-blue text-white hover:bg-spk-blue/90 rounded-sm transition-colors font-medium disabled:opacity-50"
          >
            {savingPassword && <Loader2 className="w-4 h-4 animate-spin" />}
            Cambiar Contraseña
          </button>
        </div>
      </div>

      {/* Contact Settings */}
      <div className="bg-card border border-border rounded-sm overflow-hidden">
        <div className="bg-secondary px-4 sm:px-6 py-4 border-b border-border">
          <h2 className="font-bold flex items-center gap-2" style={{ fontFamily: 'Barlow Condensed, sans-serif' }}>
            <Mail className="w-5 h-5" />
            INFORMACIÓN DE CONTACTO
          </h2>
        </div>
        <div className="p-4 sm:p-6 space-y-4 sm:space-y-6">
          <div>
            <label className="block text-sm font-medium mb-2">Email de Contacto</label>
            <input
              type="email"
              value={settings.contactEmail || ''}
              onChange={(e) => setSettings({ ...settings, contactEmail: e.target.value })}
              className="w-full px-4 py-2 bg-background border border-border rounded-sm focus:outline-none focus:ring-2 focus:ring-[#E31E24]/50"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-2">Sitio Web</label>
            <input
              type="url"
              value={settings.website || ''}
              onChange={(e) => setSettings({ ...settings, website: e.target.value })}
              className="w-full px-4 py-2 bg-background border border-border rounded-sm focus:outline-none focus:ring-2 focus:ring-[#E31E24]/50"
            />
          </div>
        </div>
      </div>

      {/* Save Button */}
      <div className="flex justify-end gap-3 pt-4">
        <button
          onClick={handleSaveSettings}
          disabled={saving}
          className="flex items-center gap-2 px-6 py-2 bg-spk-red text-white hover:bg-spk-red-dark rounded-sm transition-colors font-medium disabled:opacity-50"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          Guardar Cambios
        </button>
      </div>
    </div>
  );
}
