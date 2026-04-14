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

  // --- GETTERS PARA LAS PESTAÑAS ---

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

  obtenerPendientesRecepcion = async (
    req: Request,
    res: Response,
  ): Promise<void> => {
    try {
      const data = await this.garantiaService.obtenerPendientesRecepcion(
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

  // --- ACCIONES FÍSICAS ---

  recibirRetorno = async (req: Request, res: Response): Promise<void> => {
    try {
      const { id_garantia, condicion_recibido, notas_inspeccion } = req.body;
      const id_empleado = req.usuario?.id_empleado;

      if (!id_empleado) throw new Error("Usuario no autenticado");
      if (!id_garantia || !condicion_recibido)
        throw new Error("Faltan campos obligatorios");

      const id_retorno = await this.garantiaService.recibirProductoDañado(
        id_garantia,
        id_empleado,
        condicion_recibido,
        notas_inspeccion || "",
      );
      res.status(201).json({
        success: true,
        message: "Pieza recibida correctamente",
        data: { id_retorno },
      });
    } catch (error: any) {
      res.status(400).json({ success: false, message: error.message });
    }
  };

  inspeccionarRetorno = async (req: Request, res: Response): Promise<void> => {
    try {
      const { id_retorno, resultado, observaciones, destino } = req.body;
      const id_tecnico = req.usuario?.id_empleado;

      if (!id_tecnico) throw new Error("Usuario no autenticado");
      if (!id_retorno || !resultado || !destino)
        throw new Error("Faltan campos obligatorios");

      const id_inspeccion = await this.garantiaService.inspeccionarRetorno(
        id_retorno,
        id_tecnico,
        resultado,
        observaciones || "",
        destino,
      );
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
      const data = await this.garantiaService.obtenerHistorial(
        Number(req.params.id_sucursal),
      );
      res.status(200).json({ success: true, data });
    } catch (error: any) {
      res.status(400).json({ success: false, message: error.message });
    }
  };
}
