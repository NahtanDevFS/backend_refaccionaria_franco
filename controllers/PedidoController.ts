// controllers/PedidoController.ts
import { Request, Response } from "express";
import { PedidoService } from "../services/PedidoService";
import {
  programarPedidoSchema,
  resultadoEntregaSchema,
} from "../schemas/pedido.schema";
import { ZodError } from "zod";

export class PedidoController {
  constructor(private readonly pedidoService: PedidoService) {}

  programarDespacho = async (req: Request, res: Response): Promise<void> => {
    try {
      const dtoValidado = programarPedidoSchema.parse(req.body);
      const nuevoPedido =
        await this.pedidoService.programarDespacho(dtoValidado);

      res.status(201).json({
        success: true,
        message: "Despacho programado y en estado pendiente",
        data: nuevoPedido,
      });
    } catch (error) {
      if (error instanceof ZodError) {
        res.status(400).json({
          success: false,
          message: "Error de validación en la programación del pedido",
          errors: error.issues,
        });
        return;
      }

      res.status(400).json({
        success: false,
        message:
          error instanceof Error
            ? error.message
            : "Error interno al programar despacho",
      });
    }
  };

  reportarResultado = async (req: Request, res: Response): Promise<void> => {
    try {
      // Validamos que el ID venga en la URL y sea un número válido
      const idParam = req.params.id as string;
      const id_pedido = parseInt(idParam, 10);
      if (isNaN(id_pedido) || id_pedido <= 0) {
        res
          .status(400)
          .json({ success: false, message: "ID de pedido inválido" });
        return;
      }

      const dtoValidado = resultadoEntregaSchema.parse(req.body);
      const resultado = await this.pedidoService.reportarEntrega(
        id_pedido,
        dtoValidado,
      );

      res.status(200).json(resultado);
    } catch (error) {
      if (error instanceof ZodError) {
        res.status(400).json({
          success: false,
          message: "Error de validación al reportar el resultado",
          errors: error.issues,
        });
        return;
      }

      res.status(400).json({
        success: false,
        message:
          error instanceof Error
            ? error.message
            : "Error interno al reportar entrega",
      });
    }
  };
}
