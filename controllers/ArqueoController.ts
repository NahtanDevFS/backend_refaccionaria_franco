import { Request, Response } from "express";
import { ArqueoService } from "../services/ArqueoService";
import { generarArqueoSchema } from "../schemas/arqueo.schema";
import { ZodError } from "zod";

export class ArqueoController {
  constructor(private readonly arqueoService: ArqueoService) {}

  procesarCierre = async (req: Request, res: Response): Promise<void> => {
    try {
      //Validación estricta del payload (Zod)
      const payload = generarArqueoSchema.parse(req.body);

      //Inyectar IDs seguros para la auditoría
      const dtoValidado = {
        ...payload,
        id_sucursal: req.usuario!.id_sucursal,
        id_supervisor_verifica: req.usuario!.id_empleado,
      };

      //Ejecutar la auditoría a través del servicio
      const resultado =
        await this.arqueoService.procesarCierreDeCaja(dtoValidado);

      //Responder al cliente
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
