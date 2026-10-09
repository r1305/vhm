-- =====================================================================
-- VHM CRM: eliminar tablas de módulos retirados (oct 2026)
--   Leads, Consentimientos, Lista de espera, Email Marketing
--   (suscriptores + campañas) y Asignación automática.
--
-- NO se ejecuta automáticamente: ensureSchema ya no crea estas tablas,
-- pero tampoco las borra. Ejecutar a mano (phpMyAdmin o cliente mysql)
-- sobre la BD del CRM, una sola vez.
--
-- 1) HACER BACKUP ANTES (solo estas tablas), por ejemplo:
--
--   mysqldump -h <DB_HOST> -u <DB_USER> -p --single-transaction \
--     <DB_NAME> leads consentimientos lista_espera asignacion_reglas \
--     suscriptores campanas_email web_sesiones \
--     > backup_modulos_retirados_$(date +%Y%m%d).sql
--
--   (web_sesiones se incluye porque se le quita la FK hacia leads.)
--
-- 2) Ejecutar este script. Es idempotente (IF EXISTS / comprobación
--    en information_schema).
--
-- Se CONSERVAN (datos del paciente / analítica viva):
--   pacientes.consentimiento, pacientes.consentimiento_at,
--   pacientes.estado = 'lista_espera' (ENUM), web_sesiones.lead_id.
-- =====================================================================

SET time_zone = '-05:00';

-- ── FK desde tabla VIVA: web_sesiones.lead_id -> leads(id) ────────────
-- El nombre de la constraint lo generó MySQL (p. ej. web_sesiones_ibfk_1),
-- por eso se busca en information_schema y se elimina con SQL dinámico.
SET @fk := (
  SELECT CONSTRAINT_NAME
  FROM information_schema.KEY_COLUMN_USAGE
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'web_sesiones'
    AND COLUMN_NAME = 'lead_id'
    AND REFERENCED_TABLE_NAME = 'leads'
  LIMIT 1
);
SET @sql := IF(@fk IS NULL,
  'SELECT ''web_sesiones: sin FK hacia leads'' AS info',
  CONCAT('ALTER TABLE web_sesiones DROP FOREIGN KEY `', @fk, '`'));
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ── DROP de tablas retiradas ──────────────────────────────────────────
-- Ninguna de estas tablas referencia a otra del mismo grupo (solo a
-- pacientes / terapeutas), y la única FK entrante desde una tabla viva
-- (web_sesiones) se eliminó arriba. Se desactiva la verificación de FKs
-- por si existieran restos de versiones antiguas del esquema.
SET FOREIGN_KEY_CHECKS = 0;

DROP TABLE IF EXISTS campanas_email;
DROP TABLE IF EXISTS suscriptores;
DROP TABLE IF EXISTS asignacion_reglas;
DROP TABLE IF EXISTS lista_espera;
DROP TABLE IF EXISTS consentimientos;
DROP TABLE IF EXISTS leads;

SET FOREIGN_KEY_CHECKS = 1;

-- ── Opcional (descomentar si se desea) ────────────────────────────────
-- Columna huérfana en analítica (deja de alimentarse; conserva histórico
-- usado por el KPI "Conversiones" de Analítica web):
-- ALTER TABLE web_sesiones DROP COLUMN lead_id;
--
-- Claves de configuración que ya no usa el CRM (webhooks Meta/TikTok y
-- texto del widget del site):
-- DELETE FROM configuracion WHERE clave IN (
--   'meta_verify_token','meta_access_token','meta_app_secret',
--   'tiktok_app_secret','tiktok_verify_token','widget_btn_texto'
-- );
