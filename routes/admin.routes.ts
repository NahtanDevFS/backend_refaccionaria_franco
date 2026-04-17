// routes/admin.routes.ts
import { Router, Request, Response, NextFunction } from "express";
import { Pool } from "pg";
import { AdminService } from "../services/AdminService";
import { AdminController } from "../controllers/AdminController";

// ─── Middleware: solo ADMINISTRADOR puede acceder ──────────────────────────
function soloAdmin(req: Request, res: Response, next: NextFunction): void {
  if (req.usuario?.rol !== "ADMINISTRADOR") {
    res.status(403).json({
      success: false,
      message: "Acceso denegado. Se requiere rol ADMINISTRADOR.",
    });
    return;
  }
  next();
}

export function crearAdminRouter(dbPool: Pool): Router {
  const router = Router();
  const service = new AdminService(dbPool);
  const controller = new AdminController(service);

  // Todas las rutas de este router requieren ser ADMINISTRADOR
  router.use(soloAdmin);

  // Catálogos de apoyo (sucursales, puestos, roles)
  router.get("/catalogos", controller.obtenerCatalogos);

  // Empleados
  router.get("/empleados", controller.listarEmpleados);
  router.post("/empleados", controller.crearEmpleado);

  // Salarios
  router.get("/empleados/:id/salario", controller.obtenerHistorialSalario);
  router.post("/empleados/:id/salario", controller.actualizarSalario);

  return router;
}
