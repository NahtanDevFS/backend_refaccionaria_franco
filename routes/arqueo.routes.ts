// routes/arqueo.routes.ts
import { Router } from "express";
import { Pool } from "pg";
import { ArqueoService } from "../services/ArqueoService";
import { ArqueoController } from "../controllers/ArqueoController";

export function crearArqueoRouter(dbPool: Pool): Router {
  const router = Router();
  const arqueoService = new ArqueoService(dbPool);
  const arqueoController = new ArqueoController(arqueoService);

  router.post("/cierre", arqueoController.procesarCierre);

  return router;
}
