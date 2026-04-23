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
      const dataValidada = crearGarantiaSchema.parse(req.body);
      const id_garantia =
        await this.garantiaService.crearGarantia(dataValidada);
      res.status(201).json({
        success: true,
        message: "Garantía registrada",
        data: { id_garantia },
      });
    } catch (error: any) {
      if (error.errors)
        res.status(400).json({
          success: false,
          message: error.errors.map((e: any) => e.message).join(", "),
        });
      else res.status(400).json({ success: false, message: error.message });
    }
  };

  resolver = async (req: Request, res: Response): Promise<void> => {
    try {
      const dataValidada = resolverGarantiaSchema.parse(req.body);
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
      if (error.errors)
        res.status(400).json({
          success: false,
          message: error.errors.map((e: any) => e.message).join(", "),
        });
      else res.status(400).json({ success: false, message: error.message });
    }
  };

  obtenerPendientes = async (req: Request, res: Response): Promise<void> => {
    try {
      const data = await this.garantiaService.obtenerPendientes(
        Number(req.params.id_sucursal),
      );
      res.status(200).json({ success: true, data });
    } catch (error: any) {
      res.status(400).json({ success: false, message: error.message });
    }
  };

  obtenerPendientesInspeccion = async (
    req: Request,
    res: Response,
  ): Promise<void> => {
    try {
      const data = await this.garantiaService.obtenerPendientesInspeccion(
        Number(req.params.id_sucursal),
      );
      res.status(200).json({ success: true, data });
    } catch (error: any) {
      res.status(400).json({ success: false, message: error.message });
    }
  };

  inspeccionarRetorno = async (req: Request, res: Response): Promise<void> => {
    try {
      const { id_garantia, resultado, observaciones, destino } = req.body;
      const id_tecnico = req.usuario?.id_empleado;

      if (!id_tecnico) throw new Error("Usuario no autenticado");
      if (!id_garantia || !resultado || !destino)
        throw new Error("Faltan campos obligatorios");

      const id_inspeccion = await this.garantiaService.inspeccionarRetorno({
        id_garantia,
        id_tecnico,
        resultado,
        observaciones,
        destino,
      });
      res.status(200).json({
        success: true,
        message: "Inspección técnica registrada",
        data: { id_inspeccion },
      });
    } catch (error: any) {
      res.status(400).json({ success: false, message: error.message });
    }
  };

  obtenerHistorial = async (req: Request, res: Response): Promise<void> => {
    try {
      const { search, estado, fechaInicio, fechaFin, page, limit } = req.query;

      const pageNumber = page ? parseInt(page as string, 10) : 1;
      const limitNumber = limit ? parseInt(limit as string, 10) : 10;

      const result = await this.garantiaService.obtenerHistorial(
        Number(req.params.id_sucursal),
        search as string,
        estado as string,
        fechaInicio as string,
        fechaFin as string,
        pageNumber,
        limitNumber,
      );

      res.status(200).json({
        success: true,
        data: result.data,
        total: result.total,
        page: pageNumber,
        totalPages: Math.ceil(result.total / limitNumber),
      });
    } catch (error: any) {
      res.status(400).json({ success: false, message: error.message });
    }
  };

  obtenerReacondicionados = async (
    req: Request,
    res: Response,
  ): Promise<void> => {
    try {
      const data =
        await this.garantiaService.obtenerReacondicionadosDisponibles(
          Number(req.params.id_sucursal),
        );
      res.status(200).json({ success: true, data });
    } catch (error: any) {
      res.status(400).json({ success: false, message: error.message });
    }
  };
}
