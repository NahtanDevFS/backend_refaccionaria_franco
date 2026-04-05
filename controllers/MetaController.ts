// controllers/MetaController.ts
import { Request, Response } from "express";
import { MetaService } from "../services/MetaService";
import { asignarMetaSchema } from "../schemas/meta.schema";
import { ZodError } from "zod";

export class MetaController {
  constructor(private readonly metaService: MetaService) {}

  asignarMeta = async (req: Request, res: Response): Promise<void> => {
    try {
      const dtoValidado = asignarMetaSchema.parse(req.body);
      const nuevaMeta = await this.metaService.asignarMetaMensual(dtoValidado);

      res.status(201).json({
        exito: true,
        mensaje: "Meta mensual asignada exitosamente al vendedor",
        data: nuevaMeta,
      });
    } catch (error) {
      if (error instanceof ZodError) {
        res.status(400).json({
          exito: false,
          mensaje: "Error de validación al asignar la meta",
          errores: error.issues,
        });
        return;
      }

      res.status(400).json({
        exito: false,
        mensaje:
          error instanceof Error
            ? error.message
            : "Error interno al asignar meta",
      });
    }
  };

  consultarRendimiento = async (req: Request, res: Response): Promise<void> => {
    try {
      // Extraemos los parámetros de la URL: /api/metas/rendimiento/:id_empleado/:anio/:mes
      const id_empleado = parseInt(req.params.id_empleado as string, 10);
      const anio = parseInt(req.params.anio as string, 10);
      const mes = parseInt(req.params.mes as string, 10);

      if (isNaN(id_empleado) || isNaN(anio) || isNaN(mes)) {
        res
          .status(400)
          .json({ exito: false, mensaje: "Parámetros de URL inválidos" });
        return;
      }

      const reporte = await this.metaService.calcularRendimientoYComision(
        id_empleado,
        anio,
        mes,
      );

      res.status(200).json({
        exito: true,
        mensaje: "Cálculo de comisiones generado exitosamente",
        data: reporte,
      });
    } catch (error) {
      res.status(400).json({
        exito: false,
        mensaje:
          error instanceof Error
            ? error.message
            : "Error al calcular comisiones",
      });
    }
  };

  obtenerRendimientoMensual = async (
    req: Request,
    res: Response,
  ): Promise<void> => {
    try {
      const rendimientos = await this.metaService.obtenerRendimientoMensual();

      // Retornamos directamente el arreglo para que el frontend lo pueda mapear (datosMostrar.map)
      res.status(200).json(rendimientos);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Error interno del servidor";
      res.status(500).json({
        success: false,
        message: errorMessage,
      });
    }
  };
}
