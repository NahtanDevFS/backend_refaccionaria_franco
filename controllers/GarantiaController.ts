// controllers/GarantiaController.ts
import { Request, Response } from "express";
import { GarantiaService } from "../services/GarantiaService";
import {
  crearGarantiaSchema,
  resolverGarantiaSchema,
} from "../schemas/garantia.schema";

export class GarantiaController {
  constructor(private readonly garantiaService: GarantiaService) {}

  crear = async (req: Request, res: Response): Promise<void> => {
    try {
      // Validación con Zod
      const dataValidada = crearGarantiaSchema.parse(req.body);

      const id_garantia =
        await this.garantiaService.crearGarantia(dataValidada);
      res.status(201).json({
        success: true,
        message: "Garantía registrada",
        data: { id_garantia },
      });
    } catch (error: any) {
      if (error.errors) {
        // Error de Zod
        res.status(400).json({
          success: false,
          message: error.errors.map((e: any) => e.message).join(", "),
        });
      } else {
        res.status(400).json({ success: false, message: error.message });
      }
    }
  };

  resolver = async (req: Request, res: Response): Promise<void> => {
    try {
      // Validación con Zod
      const dataValidada = resolverGarantiaSchema.parse(req.body);

      // CORRECCIÓN: Usar req.usuario en lugar de req.user
      const id_supervisor = req.usuario?.id_empleado;
      if (!id_supervisor) throw new Error("Usuario no autenticado");

      await this.garantiaService.resolverGarantia({
        ...dataValidada,
        id_supervisor,
      });
      res
        .status(200)
        .json({ success: true, message: "Garantía resuelta con éxito" });
    } catch (error: any) {
      if (error.errors) {
        res.status(400).json({
          success: false,
          message: error.errors.map((e: any) => e.message).join(", "),
        });
      } else {
        res.status(400).json({ success: false, message: error.message });
      }
    }
  };

  obtenerPendientes = async (req: Request, res: Response): Promise<void> => {
    try {
      const { id_sucursal } = req.params;
      const data = await this.garantiaService.obtenerPendientes(
        Number(id_sucursal),
      );
      res.status(200).json({ success: true, data });
    } catch (error: any) {
      res.status(400).json({ success: false, message: error.message });
    }
  };
}
