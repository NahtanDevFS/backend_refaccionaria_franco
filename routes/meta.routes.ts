// routes/meta.routes.ts
import { Router } from "express";
import { Pool } from "pg";
import { MetaService } from "../services/MetaService";
import { MetaController } from "../controllers/MetaController";

export function crearMetaRouter(dbPool: Pool): Router {
  const router = Router();

  const metaService = new MetaService(dbPool);
  const metaController = new MetaController(metaService);

  // Asignación
  router.post("/asignar", metaController.asignarMeta);

  // Cálculo de comisiones individual (existente)
  router.get(
    "/rendimiento/:id_empleado/:anio/:mes",
    metaController.consultarRendimiento,
  );

  // Rendimiento mensual (mes actual) — filtrado por sucursal según rol/JWT
  router.get("/rendimiento", metaController.obtenerRendimientoMensual);

  // Consolidado de la sucursal del mes actual
  router.get("/consolidado", metaController.obtenerConsolidado);

  // Vendedores disponibles para asignar meta
  router.get("/vendedores", metaController.obtenerVendedoresAsignacion);

  // Sugerencia automática de meta para un empleado
  router.get("/sugerencia/:id_empleado", metaController.obtenerSugerencia);

  // Sucursales (para selector — solo Admin/Gerente)
  router.get("/sucursales", metaController.obtenerSucursales);

  // Historial completo de metas de un empleado
  router.get("/historial/:id_empleado", metaController.obtenerHistorial);

  return router;
}
