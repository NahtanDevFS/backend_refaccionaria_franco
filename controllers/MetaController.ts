// controllers/MetaController.ts
import { Request, Response } from "express";
import { MetaService } from "../services/MetaService";
import { asignarMetaSchema } from "../schemas/meta.schema";
import { ZodError } from "zod";

export class MetaController {
  constructor(private readonly metaService: MetaService) {}

  // ─── Asignar meta ───────────────────────────────────────────────────────
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

  // ─── Cálculo de comisiones individual ───────────────────────────────────
  consultarRendimiento = async (req: Request, res: Response): Promise<void> => {
    try {
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

  // ─── Rendimiento mensual filtrado por sucursal/región ───────────────────
  obtenerRendimientoMensual = async (
    req: Request,
    res: Response,
  ): Promise<void> => {
    try {
      const usuario = req.usuario!;
      const idSucursalQuery = req.query.id_sucursal
        ? parseInt(req.query.id_sucursal as string, 10)
        : undefined;

      const rendimientos = await this.metaService.obtenerRendimientoMensual(
        usuario.rol,
        usuario.id_sucursal, // null para GERENTE_REGIONAL
        usuario.id_region, // null para todos los demás roles
        idSucursalQuery,
      );

      res.status(200).json(rendimientos);
    } catch (error) {
      res.status(500).json({
        success: false,
        message:
          error instanceof Error ? error.message : "Error interno del servidor",
      });
    }
  };

  // ─── Consolidado (mes actual) ────────────────────────────────────────────
  obtenerConsolidado = async (req: Request, res: Response): Promise<void> => {
    try {
      const usuario = req.usuario!;
      const idSucursalQuery = req.query.id_sucursal
        ? parseInt(req.query.id_sucursal as string, 10)
        : undefined;

      const consolidado = await this.metaService.obtenerConsolidadoSucursal(
        usuario.rol,
        usuario.id_sucursal,
        usuario.id_region,
        idSucursalQuery,
      );

      res.status(200).json(consolidado);
    } catch (error) {
      res.status(500).json({
        exito: false,
        mensaje:
          error instanceof Error
            ? error.message
            : "Error al obtener consolidado",
      });
    }
  };

  // ─── Vendedores disponibles para asignar meta ───────────────────────────
  obtenerVendedoresAsignacion = async (
    req: Request,
    res: Response,
  ): Promise<void> => {
    try {
      const usuario = req.usuario!;
      const anio = parseInt(req.query.anio as string, 10);
      const mes = parseInt(req.query.mes as string, 10);
      const idSucursalQuery = req.query.id_sucursal
        ? parseInt(req.query.id_sucursal as string, 10)
        : undefined;

      if (isNaN(anio) || isNaN(mes)) {
        res
          .status(400)
          .json({ exito: false, mensaje: "Año y mes son obligatorios" });
        return;
      }

      const vendedores = await this.metaService.obtenerVendedoresParaAsignar(
        usuario.rol,
        usuario.id_sucursal,
        usuario.id_region,
        anio,
        mes,
        idSucursalQuery,
      );

      res.status(200).json(vendedores);
    } catch (error) {
      res.status(500).json({
        exito: false,
        mensaje: error instanceof Error ? error.message : "Error interno",
      });
    }
  };

  // ─── Sugerencia automática de meta ─────────────────────────────────────
  obtenerSugerencia = async (req: Request, res: Response): Promise<void> => {
    try {
      const id_empleado = parseInt(req.params.id_empleado as string, 10);
      if (isNaN(id_empleado)) {
        res
          .status(400)
          .json({ exito: false, mensaje: "ID de empleado inválido" });
        return;
      }

      const sugerencia =
        await this.metaService.obtenerSugerenciaMeta(id_empleado);
      res.status(200).json(sugerencia);
    } catch (error) {
      res.status(500).json({
        exito: false,
        mensaje: error instanceof Error ? error.message : "Error interno",
      });
    }
  };

  // ─── Sucursales (para selector — respeta región del gerente) ────────────
  obtenerSucursales = async (req: Request, res: Response): Promise<void> => {
    try {
      const usuario = req.usuario!;
      const sucursales = await this.metaService.obtenerSucursales(
        usuario.rol,
        usuario.id_region,
      );
      res.status(200).json(sucursales);
    } catch (error) {
      res.status(500).json({
        exito: false,
        mensaje: error instanceof Error ? error.message : "Error interno",
      });
    }
  };

  // ─── Historial de metas de un empleado ──────────────────────────────────
  obtenerHistorial = async (req: Request, res: Response): Promise<void> => {
    try {
      const id_empleado = parseInt(req.params.id_empleado as string, 10);
      if (isNaN(id_empleado)) {
        res
          .status(400)
          .json({ exito: false, mensaje: "ID de empleado inválido" });
        return;
      }

      const historial =
        await this.metaService.obtenerHistorialMetas(id_empleado);
      res.status(200).json(historial);
    } catch (error) {
      res.status(500).json({
        exito: false,
        mensaje: error instanceof Error ? error.message : "Error interno",
      });
    }
  };
}
