// controllers/VentaController.ts
import { Request, Response } from "express";
import { VentaService } from "../services/VentaService";
import { crearVentaSchema } from "../schemas/venta.schema";
import { ZodError } from "zod";

const ROLES_GLOBALES = ["ADMINISTRADOR", "GERENTE_REGIONAL"];

function requireSucursal(req: Request): number {
  const id = req.usuario!.id_sucursal;
  if (id === null) {
    throw new Error(
      "Este endpoint requiere un usuario asociado a una sucursal.",
    );
  }
  return id;
}

export class VentaController {
  constructor(private readonly ventaService: VentaService) {}

  obtenerVentas = async (req: Request, res: Response): Promise<void> => {
    try {
      const page = req.query.page ? Number(req.query.page) : 1;
      const limit = req.query.limit ? Number(req.query.limit) : 20;

      const rol = req.usuario!.rol;
      const esGlobal = ROLES_GLOBALES.includes(rol);

      let id_sucursal: number | undefined;
      if (esGlobal) {
        id_sucursal = req.query.id_sucursal
          ? Number(req.query.id_sucursal)
          : undefined;
      } else {
        //Para roles locales id_sucursal nunca es null (lo garantiza el middleware de auth)
        id_sucursal = requireSucursal(req);
      }

      const filtros = {
        id_venta: req.query.id_venta ? Number(req.query.id_venta) : undefined,
        fechaInicio: req.query.fechaInicio as string | undefined,
        fechaFin: req.query.fechaFin as string | undefined,
        id_vendedor: req.query.id_vendedor
          ? Number(req.query.id_vendedor)
          : undefined,
        estado: req.query.estado as string | undefined,
        id_sucursal,
        page,
        limit,
      };

      const resultado = await this.ventaService.obtenerVentas(filtros);
      const totalPages = Math.ceil(resultado.total / limit);

      res.status(200).json({
        success: true,
        data: resultado.data,
        meta: {
          totalRecords: resultado.total,
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
      const idSucursal = requireSucursal(req); // ✅ era: req.usuario!.id_sucursal
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
      const bodyValidado = crearVentaSchema.parse(req.body);

      const id_sucursal = requireSucursal(req);

      const datosSeguro = {
        ...bodyValidado,
        id_sucursal,
        id_vendedor: req.usuario!.id_empleado,
      };

      const id_venta = await this.ventaService.crearOrdenVenta(
        datosSeguro,
        req.usuario!.id_usuario,
      );
      res.status(201).json({ success: true, data: { id_venta } });
    } catch (error) {
      if (error instanceof ZodError) {
        res.status(400).json({
          success: false,
          message: error.issues.map((i) => i.message).join(", "),
        });
        return;
      }
      const errorMessage =
        error instanceof Error ? error.message : "Error interno";
      res.status(400).json({ success: false, message: errorMessage });
    }
  };

  obtenerVentaPorId = async (req: Request, res: Response): Promise<void> => {
    try {
      const id_venta = Number(req.params.id);

      if (!id_venta || !Number.isInteger(id_venta) || id_venta <= 0) {
        res
          .status(400)
          .json({ success: false, message: "ID de venta inválido." });
        return;
      }

      const resultado = await this.ventaService.obtenerVentaPorId(id_venta);
      if (!resultado) {
        res
          .status(404)
          .json({ success: false, message: "Venta no encontrada" });
        return;
      }
      res.status(200).json({ success: true, data: resultado });
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
      const id_sucursal = requireSucursal(req);
      const pendientes =
        await this.ventaService.obtenerPendientesAutorizacion(id_sucursal);
      res.status(200).json({ success: true, data: pendientes });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Error interno";
      res.status(400).json({ success: false, message: errorMessage });
    }
  };

  resolverAutorizacion = async (req: Request, res: Response): Promise<void> => {
    try {
      const { id_venta, aprobado } = req.body;
      const id_supervisor = req.usuario!.id_empleado;
      const id_usuario_log = req.usuario!.id_usuario;

      await this.ventaService.resolverAutorizacion(
        id_venta,
        id_supervisor,
        id_usuario_log,
        aprobado,
      );
      res.status(200).json({ success: true, message: "Resolución registrada" });
    } catch (error) {
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
      const idSucursal = requireSucursal(req);
      const repartidores =
        await this.ventaService.obtenerRepartidores(idSucursal);
      res.status(200).json({ success: true, data: repartidores });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Error interno";
      res.status(500).json({ success: false, message: errorMessage });
    }
  };

  obtenerHistorialDescuentos = async (
    req: Request,
    res: Response,
  ): Promise<void> => {
    try {
      const id_sucursal = requireSucursal(req);

      const hoy = new Date().toISOString().split("T")[0];
      const hace30 = new Date(Date.now() - 29 * 86400000)
        .toISOString()
        .split("T")[0];

      const desde = (req.query.desde as string) ?? hace30;
      const hasta = (req.query.hasta as string) ?? hoy;
      const id_vendedor = req.query.id_vendedor
        ? Number(req.query.id_vendedor)
        : undefined;

      const data = await this.ventaService.obtenerHistorialDescuentos(
        id_sucursal,
        desde,
        hasta,
        id_vendedor,
      );

      res.status(200).json({ success: true, data });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Error interno";
      res.status(500).json({ success: false, message: errorMessage });
    }
  };
}
