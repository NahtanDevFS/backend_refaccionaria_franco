import { Request, Response } from "express";
import { VentaService } from "../services/VentaService";
import { crearVentaSchema } from "../schemas/venta.schema";
import { ZodError } from "zod";

export class VentaController {
  constructor(private readonly ventaService: VentaService) {}

  registrarVentaMostrador = async (
    req: Request,
    res: Response,
  ): Promise<void> => {
    try {
      // 1. Validación estricta de los datos de entrada (sin IDs sensibles)
      const payload = crearVentaSchema.parse(req.body);

      // 2. Inyección segura de la identidad desde el Token JWT
      const dtoValidado = {
        ...payload,
        id_sucursal: req.usuario!.id_sucursal,
        id_vendedor: req.usuario!.id_empleado,
      };

      // 3. Ejecución de la lógica de negocio a través del servicio
      const nuevaVenta =
        await this.ventaService.registrarVentaMostrador(dtoValidado);

      // 4. Respuesta exitosa
      res.status(201).json({
        success: true,
        message: "Venta registrada exitosamente con estado pendiente_pago",
        data: nuevaVenta,
      });
    } catch (error) {
      if (error instanceof ZodError) {
        res.status(400).json({
          success: false,
          message: "Error de validación en los datos de entrada",
          errors: error.issues,
        });
        return;
      }

      const errorMessage =
        error instanceof Error ? error.message : "Error interno del servidor";
      res.status(400).json({
        success: false,
        message: errorMessage,
      });
    }
  };
}
