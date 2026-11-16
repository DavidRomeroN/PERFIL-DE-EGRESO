-- Turnos tomados desde la app móvil del cliente (la TV distingue app y WhatsApp en la misma cola)
ALTER TYPE "CanalTurno" ADD VALUE IF NOT EXISTS 'APP';
