// controllers/CajaController.ts
import { Request, Response } from "express";
import { CajaService } from "../services/CajaService";
import { ArqueoService } from "../services/ArqueoService";
import {
  registrarPagoSchema,
  registrarArqueoSchema,
} from "../schemas/caja.schema";
import { z } from "zod";

const ROLES_SUPERVISOR = [
  "ADMINISTRADOR",
  "GERENTE_REGIONAL",
  "SUPERVISOR_SUCURSAL",
];

const liquidarSchema = z.object({
  id_repartidor: z.number().int().positive(),
  id_pagos: z.array(z.number().int().positive()).min(1),
});

export class CajaController {
  constructor(
    private readonly cajaService: CajaService,
    private readonly arqueoService: ArqueoService,
  ) {}

  obtenerPendientes = async (req: Request, res: Response): Promise<void> => {
    try {
      const id_sucursal = req.usuario!.id_sucursal;
      const data = await this.cajaService.obtenerPendientes(id_sucursal);
      res.status(200).json({ success: true, data });
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
        res
          .status(400)
          .json({
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
      const data = await this.cajaService.obtenerResumenDia(id_cajero);
      res.status(200).json({ success: true, data });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message });
    }
  };

  // ── Registro de arqueo — SIN supervisor (se asigna después si hay diferencia)
  registrarArqueo = async (req: Request, res: Response): Promise<void> => {
    try {
      const payload = registrarArqueoSchema.parse(req.body);
      const resultado = await this.arqueoService.procesarCierreDeCaja({
        ...payload,
        id_sucursal: req.usuario!.id_sucursal,
        id_cajero: req.usuario!.id_empleado,
        // id_supervisor_verifica no se pasa — queda NULL en BD
      });
      res.status(201).json({
        success: true,
        message: resultado.mensaje,
        data: { id_arqueo: resultado.data.id_arqueo },
      });
    } catch (error: any) {
      if (error.errors) {
        res
          .status(400)
          .json({
            success: false,
            message: error.errors.map((e: any) => e.message).join(", "),
          });
      } else {
        res.status(400).json({ success: false, message: error.message });
      }
    }
  };

  // ── Verificar arqueo con diferencia (solo supervisor/admin) ───────────────
  verificarArqueo = async (req: Request, res: Response): Promise<void> => {
    try {
      const rol = req.usuario!.rol;
      if (!ROLES_SUPERVISOR.includes(rol)) {
        res
          .status(403)
          .json({
            success: false,
            message:
              "Solo supervisores o administradores pueden verificar arqueos.",
          });
        return;
      }

      const id_arqueo = Number(req.params.id);
      const id_supervisor = req.usuario!.id_empleado;
      const id_sucursal = req.usuario!.id_sucursal;

      if (!id_arqueo || isNaN(id_arqueo)) {
        res
          .status(400)
          .json({ success: false, message: "ID de arqueo inválido." });
        return;
      }

      const data = await this.arqueoService.verificarArqueo(
        id_arqueo,
        id_supervisor,
        id_sucursal,
      );

      res.status(200).json({
        success: true,
        message: "Arqueo verificado correctamente.",
        data,
      });
    } catch (error: any) {
      res.status(400).json({ success: false, message: error.message });
    }
  };

  // ── Cobros de repartidores pendientes ─────────────────────────────────────
  obtenerCobrosRepartidores = async (
    req: Request,
    res: Response,
  ): Promise<void> => {
    try {
      const id_sucursal = req.usuario!.id_sucursal;
      const data =
        await this.cajaService.obtenerCobrosRepartidoresPendientes(id_sucursal);
      res.status(200).json({ success: true, data });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message });
    }
  };

  // ── Liquidar cobros de un repartidor ──────────────────────────────────────
  liquidarRepartidor = async (req: Request, res: Response): Promise<void> => {
    try {
      const id_cajero = req.usuario!.id_empleado;
      const id_sucursal = req.usuario!.id_sucursal;
      const payload = liquidarSchema.parse(req.body);

      const resultado = await this.cajaService.liquidarRepartidor(
        id_cajero,
        payload.id_repartidor,
        payload.id_pagos,
        id_sucursal,
      );

      res.status(200).json({
        success: true,
        message: `Liquidación registrada. Se recibieron Q${resultado.total_recibido.toFixed(2)} de ${resultado.pagos_liquidados} cobro(s).`,
        data: resultado,
      });
    } catch (error: any) {
      if (error.errors) {
        res
          .status(400)
          .json({
            success: false,
            message: error.errors.map((e: any) => e.message).join(", "),
          });
      } else {
        res.status(400).json({ success: false, message: error.message });
      }
    }
  };

  // ── Historial de cobros ───────────────────────────────────────────────────
  obtenerHistorial = async (req: Request, res: Response): Promise<void> => {
    try {
      const id_sucursal = req.usuario!.id_sucursal;
      const { desde, hasta } = req.query as { desde?: string; hasta?: string };
      const data = await this.cajaService.obtenerHistorial(
        id_sucursal,
        desde,
        hasta,
      );
      res.status(200).json({ success: true, data });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message });
    }
  };

  // ── Historial de arqueos ──────────────────────────────────────────────────
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

  obtenerCajeros = async (req: Request, res: Response): Promise<void> => {
    try {
      const id_sucursal = req.usuario!.id_sucursal;
      const data =
        await this.arqueoService.obtenerCajerosDeSucursal(id_sucursal);
      res.status(200).json({ success: true, data });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message });
    }
  };
}
