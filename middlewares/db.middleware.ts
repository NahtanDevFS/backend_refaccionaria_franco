// middlewares/db.middleware.ts
//lee el rol del JWT (ya inyectado en req.usuario por verificarToken) y asigna el pool de PostgreSQL correspondiente a req.dbPool
//así cada request opera con los permisos exactos de su rol

import { Request, Response, NextFunction } from "express";
import { obtenerPoolPorRol, invalidarPoolPorRol } from "../db";

export const asignarPoolPorRol = (
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  try {
    const rol = req.usuario?.rol;

    if (!rol) {
      res.status(401).json({
        success: false,
        message: "No se pudo determinar el rol del usuario.",
      });
      return;
    }

    // Asigna el pool correcto al request, los servicios lo usarán.
    req.dbPool = obtenerPoolPorRol(rol);

    next();
  } catch (error: any) {
    res.status(403).json({
      success: false,
      message: error.message,
    });
  }
};

/**
 * Manejador de errores de permisos de base de datos.
 */
export const manejarErrorPermisosBD = (
  error: any,
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  //código SQLSTATE de PostgreSQL para "insufficient_privilege"
  const ES_ERROR_PERMISOS = error?.code === "42501";

  if (ES_ERROR_PERMISOS) {
    const rol = req.usuario?.rol;

    if (rol) {
      // Invalidar de forma asíncrona sin bloquear la respuesta
      invalidarPoolPorRol(rol).catch((err) =>
        console.error(`[DB] Error al invalidar pool del rol "${rol}":`, err),
      );

      console.warn(
        `[DB] Permiso revocado detectado para rol "${rol}". Pool invalidado.`,
      );
    }

    res.status(403).json({
      success: false,
      message:
        "Tu usuario no tiene permisos para realizar esta operación. " +
        "Contacta al administrador del sistema.",
    });
    return;
  }

  //cualquier otro error pasa al siguiente manejador de Express
  next(error);
};
