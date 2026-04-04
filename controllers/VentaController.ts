// controllers/VentaController.ts
import { Request, Response } from "express";
import { VentaService } from "../services/VentaService";
import { crearVentaSchema } from "../schemas/venta.schema";
import { ZodError } from "zod";

export class VentaController {
  constructor(private readonly ventaService: VentaService) {}

  // Usamos una arrow function para no perder el contexto de 'this' en las rutas de Express
  registrarVentaMostrador = async (
    req: Request,
    res: Response,
  ): Promise<void> => {
    try {
      // 1. Validación estricta de los datos de entrada
      const dtoValidado = crearVentaSchema.parse(req.body);

      // 2. Ejecución de la lógica de negocio a través del servicio
      const nuevaVenta =
        await this.ventaService.registrarVentaMostrador(dtoValidado);

      // 3. Respuesta exitosa
      res.status(201).json({
        success: true,
        message: "Venta registrada exitosamente con estado pendiente_pago",
        data: nuevaVenta,
      });
    } catch (error) {
      // Manejo de errores de validación de Zod
      if (error instanceof ZodError) {
        res.status(400).json({
          success: false,
          message: "Error de validación en los datos de entrada",
          errors: error.issues,
        });
        return;
      }

      // Manejo de errores de negocio (Ej: stock insuficiente, regla del 5%)
      const errorMessage =
        error instanceof Error ? error.message : "Error interno del servidor";
      res.status(400).json({
        success: false,
        message: errorMessage,
      });
    }
  };
}
