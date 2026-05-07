-- Migration 021: tournament regulations (text + PDF).
--
-- Context: la pestaña pública "Info" mostraba un bloque "FORMATO" derivado del
-- enum técnico `format` (groups / knockout / etc), que el motor de fixtures
-- también usa. Esa copia automática es útil para el código pero pobre para el
-- espectador — el admin quiere comunicar el reglamento real del torneo
-- (sistema de puntuación, sets, sanciones, fechas de inscripción, etc).
--
-- Solución: agregar dos columnas opcionales al lado del enum `format`:
--   · regulation_text → texto plano que el admin escribe en un textarea.
--   · regulation_pdf  → data URL (`data:application/pdf;base64,...`) generada
--                        por /api/upload/document. Usamos el mismo patrón que
--                        cover_image / logo / players.document_file (ver 007)
--                        para que el contenido sobreviva redeploys de Railway.
--
-- Ambos son opcionales y combinables — el admin puede subir PDF, escribir
-- texto, ambos o ninguno. La vista pública decide qué renderizar y la enum
-- técnica `format` se queda intacta porque el motor de fixtures depende de
-- ella.

ALTER TABLE tournaments
  ADD COLUMN IF NOT EXISTS regulation_text TEXT,
  ADD COLUMN IF NOT EXISTS regulation_pdf TEXT;
