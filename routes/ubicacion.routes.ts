import { Router } from "express";
import { Pool } from "pg";
import { UbicacionController } from "../controllers/UbicacionController";

export function crearUbicacionRouter(pool: Pool): Router {
  const router = Router();
  const ubicacionController = new UbicacionController(pool);

  router.get("/departamentos", ubicacionController.obtenerDepartamentos);
  router.get(
    "/departamentos/:id/municipios",
    ubicacionController.obtenerMunicipiosPorDepartamento,
  );

  return router;
}
