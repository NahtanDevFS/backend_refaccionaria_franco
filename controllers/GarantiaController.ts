// controllers/GarantiaController.ts
import { Request, Response } from "express";
import { GarantiaService } from "../services/GarantiaService";
import {
  solicitarGarantiaSchema,
  resolverGarantiaSchema,
} from "../schemas/garantia.schema";
import { ZodError } from "zod";

export class GarantiaController {
  constructor(private readonly garantiaService: GarantiaService) {}

  solicitarGarantia = async (req: Request, res: Response): Promise<void> => {
    try {
      const dtoValidado = solicitarGarantiaSchema.parse(req.body);
      const nuevaGarantia =
        await this.garantiaService.solicitarGarantia(dtoValidado);

      res.status(201).json({
        exito: true,
        mensaje: "Solicitud de garantía ingresada y en estado de revisión",
        data: nuevaGarantia,
      });
    } catch (error) {
      if (error instanceof ZodError) {
        res.status(400).json({
          exito: false,
          mensaje: "Error de validación en la solicitud",
          errores: error.issues,
        });
        return;
      }

      res.status(400).json({
        exito: false,
        mensaje:
          error instanceof Error
            ? error.message
            : "Error interno al procesar la solicitud",
      });
    }
  };

  resolverGarantia = async (req: Request, res: Response): Promise<void> => {
    try {
      const idParam = req.params.id as string;
      const id_garantia = parseInt(idParam, 10);

      if (isNaN(id_garantia) || id_garantia <= 0) {
        res
          .status(400)
          .json({ exito: false, mensaje: "ID de garantía inválido" });
        return;
      }

      const dtoValidado = resolverGarantiaSchema.parse(req.body);
      const garantiaResuelta = await this.garantiaService.procesarResolucion(
        id_garantia,
        dtoValidado,
      );

      res.status(200).json({
        exito: true,
        mensaje: `Garantía ${dtoValidado.estado} exitosamente`,
        data: garantiaResuelta,
      });
    } catch (error) {
      if (error instanceof ZodError) {
        res.status(400).json({
          exito: false,
          mensaje: "Error de validación en la resolución",
          errores: error.issues,
        });
        return;
      }

      res.status(400).json({
        exito: false,
        mensaje:
          error instanceof Error
            ? error.message
            : "Error interno al resolver garantía",
      });
    }
  };
}
