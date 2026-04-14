// routes/meta.routes.ts
import { Router } from "express";
import { Pool } from "pg";
import { MetaService } from "../services/MetaService";
import { MetaController } from "../controllers/MetaController";

export function crearMetaRouter(dbPool: Pool): Router {
  const router = Router();

  const metaService = new MetaService(dbPool);
  const metaController = new MetaController(metaService);

  router.post("/asignar", metaController.asignarMeta);
  router.get(
    "/rendimiento/:id_empleado/:anio/:mes",
    metaController.consultarRendimiento,
  );
  router.get("/rendimiento", metaController.obtenerRendimientoMensual);

  return router;
}
