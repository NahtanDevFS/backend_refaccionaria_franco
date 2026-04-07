// routes/caja.routes.ts
import { Router } from "express";
import { Pool } from "pg";
import { PagoRepository } from "../repositories/PagoRepository";
import { ArqueoRepository } from "../repositories/ArqueoRepository";
import { CajaService } from "../services/CajaService";
import { CajaController } from "../controllers/CajaController";

export function crearCajaRouter(dbPool: Pool): Router {
  const router = Router();

  // 1. Instanciar Repositorios
  const pagoRepo = new PagoRepository(dbPool);
  const arqueoRepo = new ArqueoRepository(dbPool);

  // 2. Instanciar Servicio y Controlador
  const service = new CajaService(pagoRepo, arqueoRepo);
  const controller = new CajaController(service);

  // 3. Definir Rutas
  router.get("/pendientes", controller.obtenerPendientes);
  router.post("/cobrar", controller.cobrar);
  router.get("/resumen", controller.obtenerResumen);
  router.post("/arqueo", controller.registrarArqueo);

  return router;
}
