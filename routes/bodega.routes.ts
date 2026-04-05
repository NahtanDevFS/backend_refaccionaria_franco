// routes/bodega.routes.ts
import { Router } from "express";
import { Pool } from "pg";
import { BodegaRepository } from "../repositories/BodegaRepository";
import { BodegaService } from "../services/BodegaService";
import { BodegaController } from "../controllers/BodegaController";

export function crearBodegaRouter(dbPool: Pool): Router {
  const router = Router();
  const bodegaRepository = new BodegaRepository(dbPool);
  const bodegaService = new BodegaService(bodegaRepository);
  const bodegaController = new BodegaController(bodegaService);

  // POST /api/bodega/movimiento
  router.post("/movimiento", bodegaController.registrarMovimiento);

  return router;
}
