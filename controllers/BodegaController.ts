// controllers/BodegaController.ts
import { Request, Response } from "express";
import { BodegaService } from "../services/BodegaService";
import {
  emitirDespachoSchema,
  ajusteInventarioSchema,
} from "../schemas/bodega.schema";

export class BodegaController {
  constructor(private readonly bodegaService: BodegaService) {}

  obtenerInventario = async (req: Request, res: Response): Promise<void> => {
    try {
      const id_sucursal = req.usuario!.id_sucursal;
      const filtros = req.query;
      const inventario = await this.bodegaService.obtenerInventarioLocal(
        id_sucursal,
        filtros,
      );
      res.status(200).json({ success: true, data: inventario });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message });
    }
  };

  //GET /bodega/lotes/:id_producto
  //Devuelve los lotes activos de un producto en la sucursal del usuario.
  //Llamada lazy desde el frontend al expandir el panel de lotes.
  obtenerLotes = async (req: Request, res: Response): Promise<void> => {
    try {
      const id_sucursal = req.usuario!.id_sucursal;
      const id_producto = Number(req.params.id_producto);

      if (isNaN(id_producto) || id_producto <= 0) {
        res
          .status(400)
          .json({ success: false, message: "ID de producto inválido." });
        return;
      }

      const lotes = await this.bodegaService.obtenerLotesDeProducto(
        id_producto,
        id_sucursal,
      );
      res.status(200).json({ success: true, data: lotes });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message });
    }
  };

  emitirDespacho = async (req: Request, res: Response): Promise<void> => {
    try {
      const id_sucursal = req.usuario!.id_sucursal;
      const id_usuario = req.usuario!.id_empleado;
      const payload = emitirDespachoSchema.parse(req.body);

      const id_despacho = await this.bodegaService.emitirDespacho(
        id_sucursal,
        id_usuario,
        payload,
      );
      res.status(201).json({
        success: true,
        message: "Despacho emitido exitosamente",
        data: { id_despacho },
      });
    } catch (error: any) {
      const errorMsg = error.errors
        ? error.errors.map((e: any) => e.message).join(", ")
        : error.message;
      res.status(400).json({ success: false, message: errorMsg });
    }
  };

  obtenerRecepciones = async (req: Request, res: Response): Promise<void> => {
    try {
      const id_sucursal = req.usuario!.id_sucursal;
      const data = await this.bodegaService.obtenerRecepciones(id_sucursal);
      res.status(200).json({ success: true, data });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message });
    }
  };

  confirmarRecepcion = async (req: Request, res: Response): Promise<void> => {
    try {
      const id_despacho = Number(req.params.id);
      const id_sucursal = req.usuario!.id_sucursal;
      const id_usuario = req.usuario!.id_empleado;

      await this.bodegaService.confirmarRecepcion(
        id_despacho,
        id_sucursal,
        id_usuario,
      );
      res.status(200).json({
        success: true,
        message: "Mercadería recibida e ingresada al inventario.",
      });
    } catch (error: any) {
      res.status(400).json({ success: false, message: error.message });
    }
  };

  registrarAjuste = async (req: Request, res: Response): Promise<void> => {
    try {
      const id_sucursal = req.usuario!.id_sucursal;
      const id_usuario = req.usuario!.id_empleado;
      const payload = ajusteInventarioSchema.parse(req.body);

      await this.bodegaService.ajustarInventario(
        id_sucursal,
        id_usuario,
        payload,
      );
      res.status(200).json({
        success: true,
        message: "Ajuste registrado exitosamente.",
      });
    } catch (error: any) {
      const errorMsg = error.errors
        ? error.errors.map((e: any) => e.message).join(", ")
        : error.message;
      res.status(400).json({ success: false, message: errorMsg });
    }
  };
}
