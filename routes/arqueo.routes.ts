// routes/arqueo.routes.ts
import { Router } from "express";
import { Pool } from "pg";
import { ArqueoRepository } from "../repositories/ArqueoRepository";
import { ArqueoService } from "../services/ArqueoService";
import { ArqueoController } from "../controllers/ArqueoController";

export function crearArqueoRouter(dbPool: Pool): Router {
  const router = Router();

  const arqueoRepository = new ArqueoRepository(dbPool);
  const arqueoService = new ArqueoService(arqueoRepository);
  const arqueoController = new ArqueoController(arqueoService);

  // POST /api/arqueos/cierre
  router.post("/cierre", arqueoController.procesarCierre);

  return router;
}
