// controllers/BodegaController.ts
import { Request, Response } from "express";
import { BodegaService } from "../services/BodegaService";
import { movimientoBodegaSchema } from "../schemas/bodega.schema";
import { ZodError } from "zod";

export class BodegaController {
  constructor(private readonly bodegaService: BodegaService) {}

  registrarMovimiento = async (req: Request, res: Response): Promise<void> => {
    try {
      // 1. Extraer credenciales seguras del Token JWT
      const id_sucursal = req.usuario!.id_sucursal;
      const id_usuario = req.usuario!.id_usuario;

      // 2. Validar payload
      const dtoValidado = movimientoBodegaSchema.parse(req.body);

      // 3. Ejecutar servicio
      const resultado = await this.bodegaService.procesarMovimiento(
        dtoValidado,
        id_sucursal,
        id_usuario,
      );

      res.status(200).json({
        exito: true,
        mensaje: "Movimiento de inventario registrado exitosamente",
        data: resultado,
      });
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
        mensaje: error instanceof Error ? error.message : "Error interno",
      });
    }
  };
}
