// controllers/CajaController.ts
import { Request, Response } from "express";
import { CajaService } from "../services/CajaService";
import {
  registrarPagoSchema,
  registrarArqueoSchema,
} from "../schemas/caja.schema";

export class CajaController {
  constructor(private readonly cajaService: CajaService) {}

  obtenerPendientes = async (req: Request, res: Response): Promise<void> => {
    try {
      const id_sucursal = req.usuario!.id_sucursal;
      const pendientes = await this.cajaService.obtenerPendientes(id_sucursal);
      res.status(200).json({ success: true, data: pendientes });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message });
    }
  };

  cobrar = async (req: Request, res: Response): Promise<void> => {
    try {
      const id_cajero = req.usuario!.id_empleado;
      const payload = registrarPagoSchema.parse(req.body);

      await this.cajaService.registrarPago(id_cajero, payload);
      res.status(200).json({
        success: true,
        message: "Pago registrado y orden completada exitosamente",
      });
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

  obtenerResumen = async (req: Request, res: Response): Promise<void> => {
    try {
      const id_cajero = req.usuario!.id_empleado;
      const resumen = await this.cajaService.obtenerResumenDia(id_cajero);
      res.status(200).json({ success: true, data: resumen });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message });
    }
  };

  registrarArqueo = async (req: Request, res: Response): Promise<void> => {
    try {
      const id_sucursal = req.usuario!.id_sucursal;
      const id_cajero = req.usuario!.id_empleado;
      const payload = registrarArqueoSchema.parse(req.body);

      const id_arqueo = await this.cajaService.registrarArqueo(
        id_sucursal,
        id_cajero,
        payload,
      );
      res.status(201).json({
        success: true,
        message: "Arqueo de caja registrado correctamente",
        data: { id_arqueo },
      });
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

  // NUEVO
  obtenerHistorial = async (req: Request, res: Response): Promise<void> => {
    try {
      const id_sucursal = req.usuario!.id_sucursal;
      const { desde, hasta } = req.query as { desde?: string; hasta?: string };

      const historial = await this.cajaService.obtenerHistorial(
        id_sucursal,
        desde,
        hasta,
      );
      res.status(200).json({ success: true, data: historial });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message });
    }
  };
}
