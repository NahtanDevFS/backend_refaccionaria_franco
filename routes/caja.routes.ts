// routes/caja.routes.ts
import { Router } from "express";
import { Pool } from "pg";
import { CajaService } from "../services/CajaService";
import { CajaController } from "../controllers/CajaController";

export function crearCajaRouter(dbPool: Pool): Router {
  const router = Router();
  const service = new CajaService(dbPool);
  const controller = new CajaController(service);

  router.get("/pendientes", controller.obtenerPendientes);
  router.post("/cobrar", controller.cobrar);
  router.get("/resumen", controller.obtenerResumen);
  router.post("/arqueo", controller.registrarArqueo);
  router.get("/historial", controller.obtenerHistorial);

  return router;
}
