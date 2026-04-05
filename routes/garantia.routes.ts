// routes/garantia.routes.ts
import { Router } from "express";
import { Pool } from "pg";
import { GarantiaRepository } from "../repositories/GarantiaRepository";
import { GarantiaService } from "../services/GarantiaService";
import { GarantiaController } from "../controllers/GarantiaController";

export function crearGarantiaRouter(dbPool: Pool): Router {
  const router = Router();

  const garantiaRepository = new GarantiaRepository(dbPool);
  const garantiaService = new GarantiaService(garantiaRepository);
  const garantiaController = new GarantiaController(garantiaService);

  // POST /api/garantias/solicitar (Lo usa el vendedor)
  router.post("/solicitar", garantiaController.solicitarGarantia);

  // PUT /api/garantias/:id/resolver (Lo usa el supervisor)
  router.put("/:id/resolver", garantiaController.resolverGarantia);

  return router;
}
