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

  // controllers/GarantiaController.ts (Actualizar método)
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

      // 1. Extraemos quién está haciendo la petición desde el token validado
      // Usamos "!" porque el middleware ya nos garantizó que esto existe
      const id_supervisor = req.usuario!.id_empleado;
      const id_usuario = req.usuario!.id_usuario;

      // 2. Validamos el payload (que ahora solo trae estado y resolucion)
      const dtoValidado = resolverGarantiaSchema.parse(req.body);

      // 3. Ejecutamos el servicio inyectando la identidad segura
      const garantiaResuelta = await this.garantiaService.procesarResolucion(
        id_garantia,
        dtoValidado,
        id_supervisor,
        id_usuario,
      );

      res.status(200).json({
        exito: true,
        mensaje: `Garantía ${dtoValidado.estado} exitosamente y stock actualizado.`,
        data: garantiaResuelta,
      });
    } catch (error) {
      if (error instanceof ZodError) {
        res.status(400).json({
          exito: false,
          mensaje: "Error de validación",
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
