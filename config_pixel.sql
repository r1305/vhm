-- Tabla para configuración del pixel de Meta
CREATE TABLE IF NOT EXISTS config_pixel (
  id INT PRIMARY KEY DEFAULT 1,
  pixel_id VARCHAR(50) NULL,
  activo BOOLEAN DEFAULT FALSE,
  fecha_actualizacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT chk_single_row CHECK (id = 1)
);

-- Insertar registro inicial si no existe
INSERT IGNORE INTO config_pixel (id, pixel_id, activo) VALUES (1, NULL, FALSE);