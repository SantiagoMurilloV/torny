-- Seed: Usuario administrador inicial
-- Contraseña por defecto: admin123 (hasheada con bcrypt, cost 10)
INSERT INTO users (username, password_hash, role)
VALUES (
    'admin',
    '$2b$10$JIxtEhKqgAPZQoj6O/b3p.ViM/7pE2alMDHlSWQkp5Q4egKsaVwbS',
    'admin'
)
ON CONFLICT (username) DO NOTHING;

-- Seed: Configuración inicial del sistema
INSERT INTO system_settings (system_name, club_name, language)
VALUES ('Torny', 'Torny', 'es');
