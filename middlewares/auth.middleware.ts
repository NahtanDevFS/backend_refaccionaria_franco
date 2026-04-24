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
    //extraer el header de autorización
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      res.status(401).json({
        exito: false,
        mensaje:
          "Acceso denegado. No se proporcionó un token de autenticación válido.",
      });
      return;
    }

    //extraer el token (viene con el formato "Bearer ")
    const token = authHeader.split(" ")[1];
    const secreto = process.env.JWT_SECRET;

    if (!secreto) {
      throw new Error("CONFIG ERROR: JWT_SECRET no definido");
    }

    //verificar y decodificar el token
    const payloadDecodificado = jwt.verify(token, secreto) as PayloadToken;

    //inyectar los datos del usuario en la request
    req.usuario = payloadDecodificado;

    //ceder el paso al siguiente controlador
    next();
  } catch (error) {
    res.status(401).json({
      exito: false,
      mensaje: "Token inválido o expirado. Inicie sesión nuevamente.",
    });
  }
};
