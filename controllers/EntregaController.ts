import { Request, Response } from "express";
import { EntregaService } from "../services/EntregaService";
import {
  entregaExitosaSchema,
  entregaFallidaSchema,
} from "../schemas/entrega.schema";

export class EntregaController {
  constructor(private readonly entregaService: EntregaService) {}

  obtenerMisPedidos = async (req: Request, res: Response): Promise<void> => {
    try {
      const id_repartidor = req.usuario!.id_empleado;
      const pedidos =
        await this.entregaService.obtenerMisPedidos(id_repartidor);
      res.status(200).json({ success: true, data: pedidos });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message });
    }
  };

  marcarExito = async (req: Request, res: Response): Promise<void> => {
    try {
      const id_pedido = Number(req.params.id);
      const id_repartidor = req.usuario!.id_empleado;
      const payload = entregaExitosaSchema.parse(req.body);

      const resultado = await this.entregaService.marcarExito(id_repartidor, {
        id_pedido,
        monto_cobrado: payload.monto_cobrado,
      });

      res.status(200).json({
        success: true,
        message: "Entrega registrada exitosamente",
        data: resultado,
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

  marcarFallida = async (req: Request, res: Response): Promise<void> => {
    try {
      const id_pedido = Number(req.params.id);
      const id_repartidor = req.usuario!.id_empleado;
      const payload = entregaFallidaSchema.parse(req.body);

      await this.entregaService.marcarFallida(id_repartidor, {
        id_pedido,
        motivo_fallido: payload.motivo_fallido,
      });

      res
        .status(200)
        .json({ success: true, message: "Entrega marcada como fallida" });
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

  obtenerComprobante = async (req: Request, res: Response): Promise<void> => {
    try {
      const id_pago = Number(req.params.id_pago);
      const id_repartidor = req.usuario!.id_empleado;

      const comprobante = await this.entregaService.obtenerComprobante(
        id_pago,
        id_repartidor,
      );

      res.status(200).json({ success: true, data: comprobante });
    } catch (error: any) {
      res.status(404).json({ success: false, message: error.message });
    }
  };

  // ─── NUEVO ────────────────────────────────────────────────────────────────
  obtenerMiHistorial = async (req: Request, res: Response): Promise<void> => {
    try {
      const id_repartidor = req.usuario!.id_empleado;

      // Rango por defecto: últimos 7 días
      const hoy = new Date();
      const hace7 = new Date(hoy);
      hace7.setDate(hoy.getDate() - 6);

      const hasta =
        (req.query.hasta as string) ?? hoy.toISOString().split("T")[0];
      const desde =
        (req.query.desde as string) ?? hace7.toISOString().split("T")[0];

      const data = await this.entregaService.obtenerMiHistorial(
        id_repartidor,
        desde,
        hasta,
      );

      res.status(200).json({ success: true, data });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message });
    }
  };

  confirmarCancelacion = async (req: Request, res: Response): Promise<void> => {
    try {
      const id_pedido = Number(req.params.id);
      const id_repartidor = req.usuario!.id_empleado;

      await this.entregaService.confirmarCancelacion(id_repartidor, id_pedido);

      res.status(200).json({
        success: true,
        message: "Cancelación confirmada correctamente.",
      });
    } catch (error: any) {
      res.status(400).json({ success: false, message: error.message });
    }
  };
}
