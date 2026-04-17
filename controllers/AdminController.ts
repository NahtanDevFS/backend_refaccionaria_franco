// controllers/AdminController.ts
import { Request, Response } from "express";
import { AdminService } from "../services/AdminService";
import { z, ZodError } from "zod";

// ─── Schemas de validación ────────────────────────────────────────────────────
const crearEmpleadoSchema = z.object({
  nombre: z.string().min(2, "Nombre requerido"),
  apellido: z.string().min(2, "Apellido requerido"),
  id_sucursal: z.number().int().positive(),
  id_puesto: z.number().int().positive(),
  dpi: z.string().max(20).optional(),
  nit: z.string().max(20).optional(),
  telefono: z.string().max(20).optional(),
  email: z.string().email().optional().or(z.literal("")),
  fecha_ingreso: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Formato YYYY-MM-DD"),
  // Salario
  salario_base: z.number().positive("El salario debe ser mayor a 0"),
  tipo_contrato: z.enum(["planilla", "honorarios"]),
  // Usuario
  username: z.string().min(4, "Username mínimo 4 caracteres"),
  password: z.string().min(6, "Password mínimo 6 caracteres"),
  id_rol: z.number().int().positive(),
});

const actualizarSalarioSchema = z.object({
  salario_base: z.number().positive(),
  tipo_contrato: z.enum(["planilla", "honorarios"]),
  fecha_vigencia: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  motivo_cambio: z.string().min(3, "Indique el motivo del cambio"),
});

export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  // GET /admin/empleados?id_sucursal=1
  listarEmpleados = async (req: Request, res: Response): Promise<void> => {
    try {
      const id_sucursal = req.query.id_sucursal
        ? Number(req.query.id_sucursal)
        : undefined;
      const data = await this.adminService.listarEmpleados(id_sucursal);
      res.status(200).json({ success: true, data });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message });
    }
  };

  // POST /admin/empleados
  crearEmpleado = async (req: Request, res: Response): Promise<void> => {
    try {
      const payload = crearEmpleadoSchema.parse(req.body);
      const id_usuario_creador = req.usuario!.id_usuario;

      const resultado = await this.adminService.crearEmpleadoCompleto({
        ...payload,
        email: payload.email || undefined,
        id_usuario_creador,
      });

      res.status(201).json({
        success: true,
        message: "Empleado y usuario creados correctamente",
        data: resultado,
      });
    } catch (error: any) {
      if (error instanceof ZodError) {
        res.status(400).json({
          success: false,
          message: error.issues.map((e) => e.message).join(", "),
        });
      } else {
        res.status(400).json({ success: false, message: error.message });
      }
    }
  };

  // GET /admin/empleados/:id/salario
  obtenerHistorialSalario = async (
    req: Request,
    res: Response,
  ): Promise<void> => {
    try {
      const id_empleado = Number(req.params.id);
      if (!id_empleado) {
        res.status(400).json({ success: false, message: "ID inválido" });
        return;
      }
      const data = await this.adminService.obtenerHistorialSalario(id_empleado);
      res.status(200).json({ success: true, data });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message });
    }
  };

  // POST /admin/empleados/:id/salario
  actualizarSalario = async (req: Request, res: Response): Promise<void> => {
    try {
      const id_empleado = Number(req.params.id);
      const payload = actualizarSalarioSchema.parse(req.body);
      const id_usuario_creador = req.usuario!.id_usuario;

      const data = await this.adminService.actualizarSalario({
        id_empleado,
        ...payload,
        id_usuario_creador,
      });

      res.status(201).json({
        success: true,
        message: "Cambio de salario registrado",
        data,
      });
    } catch (error: any) {
      if (error instanceof ZodError) {
        res.status(400).json({
          success: false,
          message: error.issues.map((e) => e.message).join(", "),
        });
      } else {
        res.status(400).json({ success: false, message: error.message });
      }
    }
  };

  // GET /admin/catalogos
  obtenerCatalogos = async (req: Request, res: Response): Promise<void> => {
    try {
      const [sucursales, puestos, roles] = await Promise.all([
        this.adminService.listarSucursales(),
        this.adminService.listarPuestos(),
        this.adminService.listarRoles(),
      ]);
      res
        .status(200)
        .json({ success: true, data: { sucursales, puestos, roles } });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message });
    }
  };
}
