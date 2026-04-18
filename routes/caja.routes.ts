// routes/caja.routes.ts
import { Router } from "express";
import { Pool } from "pg";
import { CajaService } from "../services/CajaService";
import { ArqueoService } from "../services/ArqueoService";
import { CajaController } from "../controllers/CajaController";

export function crearCajaRouter(dbPool: Pool): Router {
  const router = Router();

  const cajaService = new CajaService(dbPool);
  const arqueoService = new ArqueoService(dbPool);
  const controller = new CajaController(cajaService, arqueoService);

  // Cobros de mostrador
  router.get("/pendientes", controller.obtenerPendientes);
  router.post("/cobrar", controller.cobrar);
  router.get("/resumen", controller.obtenerResumen);
  router.get("/historial", controller.obtenerHistorial);

  // Liquidación de repartidores
  router.get("/repartidores/pendientes", controller.obtenerCobrosRepartidores);
  router.post("/repartidores/liquidar", controller.liquidarRepartidor);

  // Arqueo
  router.post("/arqueo", controller.registrarArqueo);
  router.get("/arqueos", controller.obtenerHistorialArqueos);
  router.get("/arqueos/cajeros", controller.obtenerCajeros);

  return router;
}
