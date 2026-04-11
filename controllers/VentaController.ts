// controllers/VentaController.ts
import { Request, Response } from "express";
import { VentaService } from "../services/VentaService";
import { crearVentaSchema } from "../schemas/venta.schema";
import { ZodError } from "zod";

export class VentaController {
  constructor(private readonly ventaService: VentaService) {}

  obtenerVentas = async (req: Request, res: Response): Promise<void> => {
    try {
      // 1. Extraemos los filtros y la paginación de los query params
      const page = req.query.page ? Number(req.query.page) : 1;
      const limit = req.query.limit ? Number(req.query.limit) : 20;

      const filtros = {
        fechaInicio: req.query.fechaInicio as string,
        fechaFin: req.query.fechaFin as string,
        id_vendedor: req.query.id_vendedor
          ? Number(req.query.id_vendedor)
          : undefined,
        estado: req.query.estado as string,
        page,
        limit,
      };

      // 2. Llamamos al servicio (que nos devuelve la data y el total)
      const resultado = await this.ventaService.obtenerVentas(filtros);
      const totalRecords = resultado.total;
      const data = resultado.data;

      // 3. Calculamos el total de páginas
      const totalPages = Math.ceil(totalRecords / limit);

      // 4. Armamos la respuesta con la estructura que leerá el frontend
      res.status(200).json({
        success: true,
        data: data,
        meta: {
          totalRecords,
          totalPages,
          currentPage: page,
          limit,
        },
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Error interno";
      res.status(500).json({ success: false, message: errorMessage });
    }
  };

  obtenerVendedoresActivos = async (
    req: Request,
    res: Response,
  ): Promise<void> => {
    try {
      const idSucursal = req.usuario!.id_sucursal;
      const vendedores = await this.ventaService.obtenerVendedores(idSucursal);
      res.status(200).json({ success: true, data: vendedores });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Error interno";
      res.status(500).json({ success: false, message: errorMessage });
    }
  };

  crearOrden = async (req: Request, res: Response): Promise<void> => {
    try {
      const payload = crearVentaSchema.parse(req.body);

      const dtoValidado = {
        ...payload,
        id_sucursal: req.usuario!.id_sucursal,
        id_vendedor: req.usuario!.id_empleado,
      };

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

  obtenerRepartidoresActivos = async (
    req: Request,
    res: Response,
  ): Promise<void> => {
    try {
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
      const idSucursal = req.usuario!.id_sucursal;
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
      res.status(200).json({
        success: true,
        message: `Descuento ${aprobado ? "aprobado" : "rechazado"}`,
      });
    } catch (error) {
      res
        .status(500)
        .json({ success: false, message: (error as Error).message });
    }
  };

  obtenerVentaPorId = async (req: Request, res: Response): Promise<void> => {
    try {
      const id_venta = Number(req.params.id);
      if (isNaN(id_venta)) {
        res
          .status(400)
          .json({ success: false, message: "ID de venta inválido" });
        return;
      }

      const data = await this.ventaService.obtenerVentaPorId(id_venta);
      if (!data) {
        res
          .status(404)
          .json({ success: false, message: "Ticket no encontrado" });
        return;
      }

      res.status(200).json({ success: true, data });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Error interno";
      res.status(500).json({ success: false, message: errorMessage });
    }
  };
}
