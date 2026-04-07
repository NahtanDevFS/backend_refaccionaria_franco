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

      await this.entregaService.marcarExito(id_repartidor, {
        id_pedido,
        monto_cobrado: payload.monto_cobrado,
      });

      res
        .status(200)
        .json({ success: true, message: "Entrega registrada exitosamente" });
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
}
