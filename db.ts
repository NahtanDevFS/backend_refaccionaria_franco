import { Pool } from "pg";
import "dotenv/config";

const PG_USER_POR_ROL: Record<string, string> = {
  ADMINISTRADOR: process.env.DB_USER_ADMINISTRADOR!,
  GERENTE_REGIONAL: process.env.DB_USER_GERENTE_REGIONAL!,
  SUPERVISOR_SUCURSAL: process.env.DB_USER_SUPERVISOR_SUCURSAL!,
  VENDEDOR: process.env.DB_USER_VENDEDOR!,
  CAJERO: process.env.DB_USER_CAJERO!,
  BODEGUERO: process.env.DB_USER_BODEGUERO!,
  REPARTIDOR: process.env.DB_USER_REPARTIDOR!,
};

const poolCache: Record<string, Pool> = {};

export const poolAdmin = new Pool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});

export function obtenerPoolPorRol(rol: string): Pool {
  if (poolCache[rol]) return poolCache[rol];

  const pgUser = PG_USER_POR_ROL[rol];

  if (!pgUser) {
    throw new Error(
      `Rol desconocido: "${rol}". No se puede asignar pool de BD.`,
    );
  }

  poolCache[rol] = new Pool({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT),
    database: process.env.DB_NAME,
    user: pgUser,
    password: process.env.DB_ROLE_PASSWORD,
  });

  console.log(`[DB] Pool creado para rol: ${rol} → usuario PG: ${pgUser}`);

  return poolCache[rol];
}
