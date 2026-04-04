// controllers/CajaController.ts
import { Request, Response } from "express";
import { CajaService } from "../services/CajaService";
import { registrarPagoSchema } from "../schemas/caja.schema";
import { ZodError } from "zod";

export class CajaController {
  constructor(private readonly cajaService: CajaService) {}

  registrarPago = async (req: Request, res: Response): Promise<void> => {
    try {
      // 1. Validar payload de entrada
      const dtoValidado = registrarPagoSchema.parse(req.body);

      // 2. Ejecutar servicio (Lógica de negocio, pago y facturación)
      const resultado =
        await this.cajaService.procesarPagoYFacturar(dtoValidado);

      // 3. Responder éxito
      res.status(200).json({
        success: true,
        message:
          "Pago procesado, inventario actualizado y factura emitida exitosamente",
        data: resultado, // Esto contiene el uuid_factura
      });
    } catch (error) {
      if (error instanceof ZodError) {
        res.status(400).json({
          success: false,
          message: "Error de validación en los datos de pago",
          errors: error.issues,
        });
        return;
      }

      const errorMessage =
        error instanceof Error
          ? error.message
          : "Error interno al procesar el pago";
      res.status(400).json({
        success: false,
        message: errorMessage,
      });
    }
  };
}
