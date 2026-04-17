// controllers/CajaController.ts
import { Request, Response } from "express";
import { CajaService } from "../services/CajaService";
import { ArqueoService } from "../services/ArqueoService";
import {
  registrarPagoSchema,
  registrarArqueoSchema,
} from "../schemas/caja.schema";

export class CajaController {
  constructor(
    private readonly cajaService: CajaService,
    private readonly arqueoService: ArqueoService,
  ) {}

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

  // ── Registro de arqueo — ahora delega en ArqueoService (canónico) ────────
  registrarArqueo = async (req: Request, res: Response): Promise<void> => {
    try {
      const payload = registrarArqueoSchema.parse(req.body);

      const resultado = await this.arqueoService.procesarCierreDeCaja({
        ...payload,
        id_sucursal: req.usuario!.id_sucursal,
        id_cajero: req.usuario!.id_empleado,
        id_supervisor_verifica: req.usuario!.id_empleado,
      });

      res.status(201).json({
        success: true,
        message: resultado.mensaje,
        data: { id_arqueo: resultado.data.id_arqueo },
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

  // ── Historial de cobros (pagos individuales) ─────────────────────────────
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

  // ── Historial de arqueos (cierres de caja) ───────────────────────────────
  obtenerHistorialArqueos = async (
    req: Request,
    res: Response,
  ): Promise<void> => {
    try {
      const id_sucursal = req.usuario!.id_sucursal;
      const rol = req.usuario!.rol;
      const id_cajero_usuario = req.usuario!.id_empleado;

      const hoy = new Date().toISOString().split("T")[0];
      const hace30 = new Date(Date.now() - 29 * 86400000)
        .toISOString()
        .split("T")[0];

      const desde = (req.query.desde as string) || hace30;
      const hasta = (req.query.hasta as string) || hoy;
      const id_cajero_filtro = req.query.id_cajero
        ? Number(req.query.id_cajero)
        : undefined;

      const data = await this.arqueoService.obtenerHistorialArqueos({
        id_sucursal,
        rol,
        id_cajero_usuario,
        desde,
        hasta,
        id_cajero_filtro,
      });

      res.status(200).json({ success: true, data });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message });
    }
  };

  // ── Cajeros de la sucursal (para el selector del supervisor) ─────────────
  obtenerCajeros = async (req: Request, res: Response): Promise<void> => {
    try {
      const id_sucursal = req.usuario!.id_sucursal;
      const cajeros =
        await this.arqueoService.obtenerCajerosDeSucursal(id_sucursal);
      res.status(200).json({ success: true, data: cajeros });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message });
    }
  };
}
