// middlewares/db.middleware.ts
//lee el rol del JWT (ya inyectado en req.usuario por verificarToken) y asigna el pool de PostgreSQL correspondiente a req.dbPool
//así cada request opera con los permisos exactos de su rol.

import { Request, Response, NextFunction } from "express";
import { obtenerPoolPorRol } from "../db";

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

    //asignamos el pool correcto al request, los servicios lo usarán
    req.dbPool = obtenerPoolPorRol(rol);

    next();
  } catch (error: any) {
    res.status(403).json({
      success: false,
      message: error.message,
    });
  }
};
