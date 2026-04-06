import { Request, Response } from "express";
import { VentaService } from "../services/VentaService";
import { crearVentaSchema } from "../schemas/venta.schema";
import { ZodError } from "zod";

export class VentaController {
  constructor(private readonly ventaService: VentaService) {}

  obtenerVentas = async (req: Request, res: Response): Promise<void> => {
    try {
      const ventas = await this.ventaService.obtenerVentas();
      res.status(200).json(ventas);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Error interno";
      res.status(500).json({ success: false, message: errorMessage });
    }
  };

  crearOrden = async (req: Request, res: Response): Promise<void> => {
    try {
      // 1. Validación estricta con el nuevo Schema de Zod
      const payload = crearVentaSchema.parse(req.body);

      // 2. Inyectamos de forma segura quién hace la venta y en qué sucursal desde el Token JWT
      const dtoValidado = {
        ...payload,
        id_sucursal: req.usuario!.id_sucursal,
        id_vendedor: req.usuario!.id_empleado,
      };

      // 3. Ejecutamos la transacción maestra
      const idVenta = await this.ventaService.crearOrdenVenta(dtoValidado);

      res.status(201).json({
        success: true,
        id_venta: idVenta,
        message: "Orden de venta creada exitosamente (Pendiente de pago)",
      });
    } catch (error) {
      if (error instanceof ZodError) {
        res.status(400).json({
          success: false,
          message: "Error de validación en los datos de entrada",
          errors: error.issues,
        });
        return;
      }
      const errorMessage =
        error instanceof Error ? error.message : "Error interno";
      res.status(400).json({ success: false, message: errorMessage });
    }
  };

  // Añade este método a la clase VentaController
  obtenerRepartidoresActivos = async (
    req: Request,
    res: Response,
  ): Promise<void> => {
    try {
      // Extraemos la sucursal directamente del token por seguridad
      const idSucursal = req.usuario!.id_sucursal;
      const repartidores =
        await this.ventaService.obtenerRepartidores(idSucursal);
      res.status(200).json(repartidores);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Error interno";
      res.status(500).json({ success: false, message: errorMessage });
    }
  };

  obtenerAutorizacionesPendientes = async (
    req: Request,
    res: Response,
  ): Promise<void> => {
    try {
      const idSucursal = req.usuario!.id_sucursal; // Restringe a su propia sucursal
      const ventas =
        await this.ventaService.obtenerPendientesAutorizacion(idSucursal);
      res.status(200).json(ventas);
    } catch (error) {
      res
        .status(500)
        .json({ success: false, message: (error as Error).message });
    }
  };

  resolverAutorizacion = async (req: Request, res: Response): Promise<void> => {
    try {
      const { id_venta, aprobado } = req.body;
      const idSupervisor = req.usuario!.id_empleado;
      const idUsuarioLog = req.usuario!.id_usuario;

      await this.ventaService.resolverAutorizacion(
        id_venta,
        idSupervisor,
        idUsuarioLog,
        aprobado,
      );
      res
        .status(200)
        .json({
          success: true,
          message: `Descuento ${aprobado ? "aprobado" : "rechazado"}`,
        });
    } catch (error) {
      res
        .status(500)
        .json({ success: false, message: (error as Error).message });
    }
  };
}
