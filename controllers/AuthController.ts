// controllers/AuthController.ts
import { Request, Response } from "express";
import { AuthService } from "../services/AuthService";
import { loginSchema, registrarUsuarioSchema } from "../schemas/auth.schema";
import { ZodError } from "zod";

export class AuthController {
  constructor(private readonly authService: AuthService) {}

  login = async (req: Request, res: Response): Promise<void> => {
    try {
      const dtoValidado = loginSchema.parse(req.body);
      const resultado = await this.authService.login(dtoValidado);
      res.status(200).json(resultado);
    } catch (error) {
      if (error instanceof ZodError) {
        res.status(400).json({
          exito: false,
          mensaje: "Datos inválidos",
          errores: error.issues,
        });
        return;
      }
      res.status(401).json({
        exito: false,
        mensaje:
          error instanceof Error ? error.message : "Error de autenticación",
      });
    }
  };

  registrar = async (req: Request, res: Response): Promise<void> => {
    try {
      const dtoValidado = registrarUsuarioSchema.parse(req.body);
      const resultado = await this.authService.registrar(dtoValidado);
      res
        .status(201)
        .json({ exito: true, mensaje: "Usuario registrado", data: resultado });
    } catch (error) {
      if (error instanceof ZodError) {
        res.status(400).json({
          exito: false,
          mensaje: "Datos inválidos",
          errores: error.issues,
        });
        return;
      }
      res.status(400).json({
        exito: false,
        mensaje: error instanceof Error ? error.message : "Error al registrar",
      });
    }
  };
}
