// controllers/ArqueoController.ts
import { Request, Response } from "express";
import { ArqueoService } from "../services/ArqueoService";
import { generarArqueoSchema } from "../schemas/arqueo.schema";
import { ZodError } from "zod";

export class ArqueoController {
  constructor(private readonly arqueoService: ArqueoService) {}

  procesarCierre = async (req: Request, res: Response): Promise<void> => {
    try {
      const payload = generarArqueoSchema.parse(req.body);

      // id_sucursal puede ser null para GERENTE_REGIONAL —
      // el arqueo siempre requiere una sucursal concreta
      const id_sucursal = req.usuario!.id_sucursal;
      if (id_sucursal === null) {
        res.status(400).json({
          exito: false,
          mensaje: "Este endpoint requiere un usuario asociado a una sucursal.",
        });
        return;
      }

      const dtoValidado = {
        ...payload,
        id_sucursal,
        id_supervisor_verifica: req.usuario!.id_empleado,
      };

      const resultado =
        await this.arqueoService.procesarCierreDeCaja(dtoValidado);

      res.status(201).json(resultado);
    } catch (error) {
      if (error instanceof ZodError) {
        res.status(400).json({
          exito: false,
          mensaje: "Error de validación en los datos del arqueo",
          errores: error.issues,
        });
        return;
      }
      res.status(400).json({
        exito: false,
        mensaje:
          error instanceof Error
            ? error.message
            : "Error interno al procesar el arqueo",
      });
    }
  };
}
