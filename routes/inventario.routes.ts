// routes/inventario.routes.ts
import { Router } from "express";
import { Pool } from "pg";
import { InventarioService } from "../services/InventarioService";
import { InventarioController } from "../controllers/InventarioController";

export function crearInventarioRouter(dbPool: Pool): Router {
  const router = Router();
  const inventarioService = new InventarioService(dbPool);
  const inventarioController = new InventarioController(inventarioService);

  //Búsquedas generales
  router.get("/stock", inventarioController.consultarStock);
  router.get("/buscar", inventarioController.buscarMultiSucursal);

  //Rutas de Vehículos (Selectores en cascada para el Frontend)
  router.get("/vehiculos/marcas", inventarioController.obtenerMarcasVehiculo);
  router.get(
    "/vehiculos/marcas/:id_marca/modelos",
    inventarioController.obtenerModelosPorMarca,
  );

  //Búsqueda cruzada
  router.get("/buscar-por-vehiculo", inventarioController.buscarPorVehiculo);

  //Detalles de compatibilidad de un producto específico
  router.get(
    "/producto/:id_producto/compatibilidad",
    inventarioController.obtenerCompatibilidades,
  );

  //Búsquedas generales y filtros
  router.get("/categorias", inventarioController.obtenerCategorias);
  router.get("/marcas-repuesto", inventarioController.obtenerMarcasRepuesto);
  //router.get("/reacondicionados", inventarioController.obtenerReacondicionados);

  return router;
}
