// middlewares/auth.middleware.ts
import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { PayloadToken } from "../types/auth.types";

export const verificarToken = (
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  try {
    // 1. Extraer el header de autorización
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      res.status(401).json({
        exito: false,
        mensaje:
          "Acceso denegado. No se proporcionó un token de autenticación válido.",
      });
      return;
    }

    // 2. Extraer el token (viene con el formato "Bearer eyJ...")
    const token = authHeader.split(" ")[1];
    const secreto = process.env.JWT_SECRET;

    if (!secreto) {
      throw new Error("CONFIG ERROR: JWT_SECRET no definido");
    }

    // 3. Verificar y decodificar el token
    const payloadDecodificado = jwt.verify(token, secreto) as PayloadToken;

    // 4. Inyectar los datos del usuario en la request
    req.usuario = payloadDecodificado;

    // 5. Ceder el paso al siguiente controlador
    next();
  } catch (error) {
    res.status(401).json({
      exito: false,
      mensaje: "Token inválido o expirado. Inicie sesión nuevamente.",
    });
  }
};
