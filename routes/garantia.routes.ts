// routes/garantia.routes.ts
import { Router } from "express";
import { Pool } from "pg";
import { GarantiaController } from "../controllers/GarantiaController";
import { GarantiaService } from "../services/GarantiaService";

export const crearGarantiaRouter = (pool: Pool): Router => {
  const router = Router();

  const service = new GarantiaService(pool);
  const controller = new GarantiaController(service);

  //Solicitudes
  router.post("/", controller.crear);
  router.post("/resolver", controller.resolver);

  //Getters para pestañas
  router.get("/sucursal/:id_sucursal/pendientes", controller.obtenerPendientes);
  router.get(
    "/sucursal/:id_sucursal/inspecciones",
    controller.obtenerPendientesInspeccion,
  );

  //Acción de inspección técnica
  router.post("/retorno/inspeccion", controller.inspeccionarRetorno);

  router.get("/sucursal/:id_sucursal/historial", controller.obtenerHistorial);
  router.get(
    "/sucursal/:id_sucursal/reacondicionados",
    controller.obtenerReacondicionados,
  );

  return router;
};
